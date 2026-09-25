/**
 * Static contract checks for this DSH client plugin. No dependencies.
 *
 * DSH only recognises a client plugin when a handful of small things line up
 * exactly; every one of them has bitten this project at least once, so they are
 * asserted here instead of being discovered in a browser:
 *
 *   1. package.json declares `dsh.client.platform === "web"` and a `dsh.bundle.patch`
 *   2. `exports["./client"]` points at a real file
 *   3. the bundle is a CLASSIC script that self-registers with `__ModuleLoader__.load`
 *      whose `id` equals the package name (DSH throws when it does not match)
 *   4. the factory exports `apply` (and `inject`, when it needs services)
 *   5. the bundle patch inserts exactly one row, under the package's own name
 *   6. the artwork made it into the bundle (7 inlined frames)
 *
 * Usage: node test/verify-contract.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(root, file), "utf8");

const results = [];
const check = (label, ok, detail = "") => results.push({ label, ok, detail });

const pkg = JSON.parse(read("package.json"));
const name = pkg.name;

// 1 --- manifest ------------------------------------------------------------
check("package.json has a name", typeof name === "string" && name.length > 0, name);
check("license declared", typeof pkg.license === "string" && pkg.license.length > 0, pkg.license ?? "(none)");
check("dsh.client.platform is 'web'", pkg.dsh?.client?.platform === "web", String(pkg.dsh?.client?.platform));

const patchPath = pkg.dsh?.bundle?.patch;
check("dsh.bundle.patch points at a real file", typeof patchPath === "string" && existsSync(join(root, patchPath)), patchPath ?? "(none)");

// 2 --- client entry --------------------------------------------------------
const clientExport = pkg.exports?.["./client"];
const clientRel = typeof clientExport === "string" ? clientExport : clientExport?.default;
check("exports['./client'] resolves to a file", typeof clientRel === "string" && existsSync(join(root, clientRel)), clientRel ?? "(none)");
check("main host entry exists", existsSync(join(root, pkg.main)), pkg.main);

// 3 + 4 + 6 --- the bundle itself ------------------------------------------
const bundle = read(clientRel);
check("bundle self-registers via window.__ModuleLoader__.load", /window\.__ModuleLoader__\.load\(/.test(bundle));
check("registered id equals the package name", bundle.includes(`id: ${JSON.stringify(name)}`), name);
check("factory is a classic script (no ESM syntax)", !/^\s*(import|export)\s/m.test(bundle));
check("exports apply()", /exports\.apply\s*=\s*apply/.test(bundle));
check("exports inject[]", /exports\.inject\s*=\s*inject/.test(bundle));
const frames = bundle.match(/data:image\/webp;base64,/g)?.length ?? 0;
check("7 animation frames inlined", frames === 7, `${frames} frame(s)`);

// 5 --- bundle patch -------------------------------------------------------
// 注释行里也会出现 `- id: …`（那是给用户看的停用示例），所以先把注释剥掉再数。
const patch = read(patchPath)
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");
const rowNames = [...patch.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);
check("patch inserts exactly one row", rowNames.length === 1, rowNames.join(", "));
check("patch row mounts this package", rowNames[0] === name, rowNames[0] ?? "(none)");
const rowIds = [...patch.matchAll(/id:\s*([\w-]+)/g)].map((m) => m[1]);
check("patch row has exactly one id (the disable handle)", rowIds.length === 1, rowIds.join(", "));

// assets stay in sync with the module the bundle inlines -------------------
const framesModule = read("assets/frames-base64.js");
const moduleFrames = framesModule.match(/data:image\/webp;base64,/g)?.length ?? 0;
check("assets/frames-base64.js has the same 7 frames", moduleFrames === 7, `${moduleFrames} frame(s)`);

// -------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
for (const { label, ok, detail } of results) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}
console.log(`\n${failed.length === 0 ? `ALL PASS (${results.length}/${results.length})` : `${failed.length} FAILED of ${results.length}`}`);
process.exit(failed.length === 0 ? 0 : 1);
