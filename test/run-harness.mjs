/**
 * Runs the offline harness pages in a real headless browser and reports the results.
 * No npm dependencies — it talks to Chrome/Edge over the DevTools protocol using
 * Node's built-in fetch and WebSocket (Node 22+).
 *
 * The harnesses fake the DSH client environment (module loader, React, slot registry,
 * session store) and drive the real plugin bundle through ~50 assertions, so a green
 * run means the bundle still mounts, still reacts to agent state, and still cleans up
 * after itself. The second page covers the fallback path: a layout that never declares
 * `shell.overlay` must not make the pet vanish silently.
 *
 * Usage:
 *   node test/run-harness.mjs
 *   CHROME_PATH="/path/to/chrome" node test/run-harness.mjs
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PAGES = [
  "harness.html",
  "harness-fallback.html",
  "harness-stale-error.html",
  "harness-bad-storage.html",
];
/** 每页预期的断言数 —— 用来交叉验证"这一页真的是这一页"，而不只是"某页通过了"。 */
const EXPECTED = {
  "harness.html": 50,
  "harness-fallback.html": 12,
  "harness-stale-error.html": 7,
  "harness-bad-storage.html": 11,
};
const TIMEOUT_MS = 120_000;

/** First browser that actually starts wins. */
const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.EDGE_PATH,
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "msedge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].filter(Boolean);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * 结束浏览器及其所有子进程。Windows 上 msedge/chrome 会派生一整棵树，
 * 单靠 child.kill() 会留下一堆孤儿进程（实测过）。
 */
function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL"); // detached 起的进程组
  } catch {
    child.kill("SIGKILL");
  }
}

/**
 * 兜底清理：Windows 上启动器可能已经退出、真正的浏览器进程不在我们这棵树下，
 * 于是 taskkill 打不到。按「命令行里带着本次的临时 profile 目录」精确清理，
 * 不会误伤用户自己开着的浏览器。
 */
function killByProfile(profileDir) {
  if (process.platform !== "win32") return;
  const escaped = profileDir.replace(/'/g, "''");
  const script =
    "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' or Name='chrome.exe'\" | " +
    `Where-Object { $_.CommandLine -like '*${escaped}*' } | ` +
    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
  spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore" });
}

function launch(browser, args) {
  return new Promise((resolveLaunch, rejectLaunch) => {
    const child = spawn(browser, args, { stdio: "ignore" });
    child.once("error", rejectLaunch);
    setTimeout(() => resolveLaunch(child), 400);
  });
}

/** 只认「URL 就是我们要的那个页面」的 target —— 否则可能接到上一次遗留的浏览器上。 */
function isOurPage(target, pageUrl) {
  if (target.type !== "page") return false;
  try {
    return decodeURIComponent(target.url).split("?")[0] === decodeURIComponent(pageUrl).split("?")[0];
  } catch {
    return false;
  }
}

async function waitForPage(port, pageUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t) => isOurPage(t, pageUrl));
      if (page) return page;
    } catch {
      /* browser still starting */
    }
    await sleep(300);
  }
  return undefined;
}

let browserPath;
async function findBrowser(profileDir, pageUrl) {
  for (const candidate of CANDIDATES) {
    if (candidate.includes("/") && !existsSync(candidate)) continue;
    // 每次尝试换一个端口：遗留的无头浏览器可能还占着上一次的端口。
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const port = 9300 + Math.floor(Math.random() * 600);
      let child;
      try {
        child = await launch(candidate, [
          "--headless=new",
          "--disable-gpu",
          "--no-sandbox",
          "--allow-file-access-from-files",
          `--remote-debugging-port=${port}`,
          `--user-data-dir=${profileDir}`,
          "--window-size=1000,1400",
          pageUrl,
        ]);
      } catch {
        break; // 这个浏览器根本起不来，换下一个候选
      }
      const page = await waitForPage(port, pageUrl, 15_000);
      if (page) {
        browserPath = candidate;
        return { child, port, page };
      }
      child.kill();
      killTree(child);
      await sleep(300);
    }
  }
  throw new Error(`no browser found; set CHROME_PATH (tried: ${CANDIDATES.join(", ")})`);
}

async function readResult(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    ws.addEventListener("open", done, { once: true });
    ws.addEventListener("error", fail, { once: true });
  });

  let seq = 0;
  const evaluate = (expression) =>
    new Promise((done) => {
      const id = ++seq;
      const onMessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id !== id) return;
        ws.removeEventListener("message", onMessage);
        done(message.result?.result?.value);
      };
      ws.addEventListener("message", onMessage);
      ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
    });

  const deadline = Date.now() + TIMEOUT_MS;
  let text = "";
  let title = "";
  while (Date.now() < deadline) {
    text = (await evaluate("document.getElementById('result')?.innerText ?? ''")) ?? "";
    title = (await evaluate("document.title")) ?? "";
    if (/ALL PASS|FAILED of|HARNESS ERROR|NO RESULT/.test(text)) break;
    await sleep(1000);
  }
  ws.close();
  return { text, title };
}

async function runPage(file) {
  const profileDir = mkdtempSync(join(tmpdir(), "zx-harness-"));
  const pageUrl = pathToFileURL(join(here, file)).href;
  let child;
  try {
    const launched = await findBrowser(profileDir, pageUrl);
    child = launched.child;
    if (!browserPath) throw new Error("no browser");
    const { text, title } = await readResult(launched.page);
    console.log(`\n=== ${file} ===`);
    console.log(text.trim() || "(no output from harness)");
    // 断言数也要对得上，免得"接到了别的页面"这种情况被当成通过。
    const expect = EXPECTED[file];
    const count = Number(text.match(/ALL PASS \((\d+)\//)?.[1] ?? -1);
    const ok = count === expect;
    if (/^ALL PASS/m.test(text) && !ok) {
      console.log(`!! ${file}: 报的是 ALL PASS，但断言数 ${count} ≠ 预期 ${expect}（页面张冠李戴？）`);
    }
    return { file, ok, text };
  } finally {
    killTree(child);
    killByProfile(profileDir);
    await sleep(800);
    // Windows can still hold handles inside the profile dir; cleanup is best-effort.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        rmSync(profileDir, { recursive: true, force: true });
        break;
      } catch {
        await sleep(500);
      }
    }
  }
}

const summaries = [];
try {
  for (const page of PAGES) summaries.push(await runPage(page));
  const failed = summaries.filter((s) => !s.ok);
  console.log(
    `\n${failed.length === 0 ? `ALL HARNESSES PASS (${summaries.length}/${summaries.length})` : `FAILED: ${failed.map((f) => f.file).join(", ")}`}`,
  );
  process.exitCode = failed.length === 0 ? 0 : 1;
} catch (error) {
  console.error(`harness run failed: ${error.message ?? error}`);
  process.exitCode = 1;
}
