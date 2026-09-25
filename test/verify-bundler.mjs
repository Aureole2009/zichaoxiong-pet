/**
 * Exercises the bundler's failure modes with throwaway fixtures.
 *
 * `tools/build-client.mjs` concatenates `lib/src/*.js` into one factory by stripping
 * ESM syntax. Everything it does not understand MUST abort the build: a bundle that
 * cannot parse but still reports success would ship a broken plugin to everyone who
 * installs it. These fixtures pin that behaviour down.
 *
 * Usage: node test/verify-bundler.mjs
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builder = join(root, "tools", "build-client.mjs");
const scratch = mkdtempSync(join(tmpdir(), "zx-bundler-"));

const results = [];
const check = (label, ok, detail = "") => results.push({ label, ok, detail });

/** A minimal valid project: an entry file that exports apply, plus the helpers. */
const BASIC = {
  "pet-lines.js": 'export const LINES = { hi: ["x"] };\nexport function pick() { return "x"; }\n',
  "pet-css.js": 'export const CSS = "/* x */";\n',
  "pet-core.js": 'export function makePet() { return null; }\n',
  "client.js":
    'export const inject = [];\nexport function apply(ctx) {\n  void ctx;\n  return makePet() && pick() && LINES && CSS;\n}\n',
};

function runBuilder(files, label) {
  const srcDir = join(scratch, `${label}-src`);
  mkdirSync(srcDir, { recursive: true });
  for (const [name, code] of Object.entries(files)) writeFileSync(join(srcDir, name), code, "utf8");
  const outFile = join(scratch, `${label}-out.js`);
  const frames = join(scratch, `${label}-frames.js`);
  writeFileSync(frames, 'export const FRAME_DATA_URLS = ["data:image/webp;base64,AA"];\n', "utf8");
  const run = spawnSync(
    process.execPath,
    [builder, "--src", srcDir, "--out", outFile, "--frames", frames],
    { encoding: "utf8" },
  );
  // Node 先打位置再打信息，这里只留人能读的那一行
  const all = `${run.stdout ?? ""}${run.stderr ?? ""}`.split("\n");
  const message = all.find((line) => /^Error:/.test(line.trim())) ?? all.find((line) => line.trim()) ?? "";
  return { status: run.status, stderr: message.trim(), all: all.join("\n"), outFile };
}

// 1 --- the happy path still works -----------------------------------------
{
  const run = runBuilder(BASIC, "good");
  const fine = run.status === 0 && existsSync(run.outFile);
  check("正常源码能构建成功", fine, `exit=${run.status}`);
  if (fine) {
    const bundle = readFileSync(run.outFile, "utf8");
    try {
      new Script(bundle);
      check("产物可解析", true);
    } catch (error) {
      check("产物可解析", false, error.message);
    }
    check("产物注册了正确的 id", bundle.includes('id: "dsh-client-ui-pet-zichaoxiong"'));
  }
}

// 2 --- `export{a}` shorthand must abort -----------------------------------
{
  const run = runBuilder(
    { ...BASIC, "pet-core.js": "const a = 1;\nexport { a };\n" },
    "export-braces",
  );
  check("`export { a }` 会中止构建", run.status !== 0, `exit=${run.status}`);
  check("并且给出可读的原因", /export/i.test(run.stderr), run.stderr.split("\n")[0] ?? "");
}

// 3 --- `export default` must abort ----------------------------------------
{
  const run = runBuilder({ ...BASIC, "pet-core.js": "export default function pet() {}\n" }, "default");
  check("`export default` 会中止构建", run.status !== 0, `exit=${run.status}`);
}

// 4 --- a multi-line import must abort -------------------------------------
{
  const run = runBuilder(
    { ...BASIC, "pet-core.js": 'import {\n  a,\n  b,\n} from "./x.js";\nexport const c = 1;\n' },
    "multiline-import",
  );
  check("多行 import 会中止构建", run.status !== 0, `exit=${run.status}`);
}

// 5 --- duplicate top-level names across files must abort -------------------
{
  const run = runBuilder(
    { ...BASIC, "pet-core.js": "const shared = 1;\nexport const coreUses = shared;\n", "pet-css.js": "const shared = 2;\nexport const cssUses = shared;\n" },
    "duplicate-name",
  );
  check("跨文件重名会中止构建", run.status !== 0, `exit=${run.status}`);
  check("重名原因写清楚了", /重名/.test(run.stderr), run.stderr.split("\n").find((l) => l.includes("重名")) ?? "");
}

// 6 --- a syntax error inside one file must abort ---------------------------
{
  const run = runBuilder({ ...BASIC, "pet-core.js": "export function broken( { return 1 }\n" }, "syntax");
  check("源码语法错误会中止构建", run.status !== 0, `exit=${run.status}`);
  check("错误信息指向解析失败", /解析|Unexpected|SyntaxError/i.test(run.stderr), run.stderr.split("\n")[0] ?? "");
}

// 7 --- the real project still builds --------------------------------------
{
  const outFile = join(scratch, "real-out.js");
  const run = spawnSync(process.execPath, [builder, "--out", outFile], { encoding: "utf8" });
  check("真实源码能构建", run.status === 0, `exit=${run.status}`);
  const same = existsSync(outFile) && readFileSync(outFile, "utf8") === readFileSync(join(root, "lib", "client.js"), "utf8");
  check("用参数指定的输出与原产物一致", same);
}

rmSync(scratch, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
for (const { label, ok, detail } of results) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}
console.log(`\n${failed.length === 0 ? `ALL PASS (${results.length}/${results.length})` : `${failed.length} FAILED of ${results.length}`}`);
process.exit(failed.length === 0 ? 0 : 1);
