/**
 * 把 lib/src/*.js 打成 DSH 客户端要求的单个经典脚本 lib/client.js。
 *
 * 目标格式（已由已装皮肤与一方插件核实）：
 *   window.__ModuleLoader__.load({
 *     id: "<package name>",                    // 必须等于包名
 *     factory: (require) => { ...; return module.exports; }   // 导出 apply / inject
 *   })
 *
 * 没有真正的打包器：源码按依赖顺序拼接，剥掉 import/export 关键字。
 * 之所以可行，是因为这些文件是刻意写成可拼接的（无默认导出、无重名标识符）。
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(here, "..");

/** 允许覆盖，方便测试用夹具跑这个打包器: --src <dir> --out <file> */
const argOf = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const srcDir = argOf("--src") ? resolve(argOf("--src")) : join(pluginRoot, "lib", "src");
const outFile = argOf("--out") ? resolve(argOf("--out")) : join(pluginRoot, "lib", "client.js");

// 这套源码同时活在两种布局里：开发工作区（本包在 plugin/ 子目录）与 GitHub 仓库
// （本包就是仓库根）。素材路径按顺序找第一个存在的。
const framesFile =
  argOf("--frames") ??
  [
    resolve(pluginRoot, "assets", "frames-base64.js"),
    resolve(pluginRoot, "..", "assets", "frames-base64.js"),
  ].find((candidate) => existsSync(candidate));

const pkg = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8"));

/**
 * 剥掉 ESM 语法：拼接后的代码活在 factory 闭包里，不是模块。
 * 只支持这个项目的写法（具名 import/export）；任何不认识的 ESM 语法都必须**报错**，
 * 不能静默产出坏 bundle。
 */
function toFactoryCode(code, label) {
  const exported = [];
  if (/^[ \t]*export\s+default\b/m.test(code)) {
    throw new Error(`${label}: 不支持 export default —— factory 只接受具名导出`);
  }
  const stripped = code
    .replace(/^[ \t]*import\s[^\n]*\n/gm, "")
    .replace(
      /^([ \t]*)export\s+(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm,
      (match, indent, kind, name) => {
        exported.push(name);
        return `${indent}${kind} ${name}`;
      },
    );
  // 这里必须包含 `export{`、`import"x"`、多行 import 等所有没被上面正则吃掉的写法
  const leftover = stripped.match(/^[ \t]*(?:import|export)\b.*$/m);
  if (leftover) {
    throw new Error(
      `${label}: 还剩没处理的 ESM 语法 → ${leftover[0].trim()}\n` +
        `  只支持「具名 import」和「export const/let/var/function/class」。`,
    );
  }
  return { code: stripped.trimEnd(), exported };
}

/**
 * 收集一份源码里声明的**顶格**名字，用来发现跨文件重名（拼接后共享同一作用域、
 * 会互相覆盖）。只看行首没有缩进的声明：拼接后只有这些属于 factory 那一层，
 * 缩进的声明都在各自的函数体里，彼此无关。
 */
function topLevelNames(code) {
  const names = [];
  for (const match of code.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.push(match[1]);
  }
  return names;
}

/**
 * DSH 的 loader 把 factory 的返回值当成「对象插件」：命名导出就是插件字段。
 * 只有入口文件（lib/src/client.js）的导出有意义，工具模块的导出不外泄。
 */
function exportLines(names) {
  return names.map((name) => `\t\texports.${name} = ${name};`).join("\n");
}

function read(file, label) {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(
      label === "pet-frames.js"
        ? `缺少桌宠图片数据：${framesFile}\n请先运行 python tools/build_assets.py 生成。`
        : `读不到 ${file}: ${error.message}`,
    );
  }
}

// 顺序即依赖顺序：图片 → 台词 → 样式 → 组件 → DSH 适配层
const PARTS = [
  ["pet-frames.js", read(framesFile, "pet-frames.js")],
  ["pet-lines.js", read(join(srcDir, "pet-lines.js"), "pet-lines.js")],
  ["pet-css.js", read(join(srcDir, "pet-css.js"), "pet-css.js")],
  ["pet-core.js", read(join(srcDir, "pet-core.js"), "pet-core.js")],
  ["client.js", read(join(srcDir, "client.js"), "client.js")],
];

const ENTRY = "client.js";
const parts = PARTS.map(([name, code]) => {
  const { code: body, exported } = toFactoryCode(code, name);
  return { name, body, exported, names: topLevelNames(body) };
});
const entry = parts.find((part) => part.name === ENTRY);
if (!entry) throw new Error(`缺少入口文件 ${ENTRY}`);
if (!entry.exported.includes("apply")) throw new Error(`${ENTRY} 必须导出 apply`);

// 拼接是"平铺"的：两份文件里同名的顶层声明会互相覆盖，而且不会报语法错，
// 所以这里主动查一遍重名（同一个文件内部的重名由下面的解析检查兜住）。
const seen = new Map();
const collisions = [];
for (const part of parts) {
  for (const name of new Set(part.names)) {
    if (seen.has(name)) collisions.push(`${name}（${seen.get(name)} 与 ${part.name}）`);
    else seen.set(name, part.name);
  }
}
if (collisions.length > 0) {
  throw new Error(`拼接后出现重名声明，会静默互相覆盖：\n  - ${collisions.join("\n  - ")}`);
}

const body = parts
  .map(({ name, body: code }) => `/* ==== ${name} ==== */\n${code}`)
  .join("\n\n");

const bundle = `/* 自动生成，请勿直接编辑：改 lib/src/*.js 后运行 node tools/build-client.mjs */
window.__ModuleLoader__.load({
\tid: ${JSON.stringify(pkg.name)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
\t\tconst react = require("react");
${body}
${exportLines(entry.exported)}
\t\treturn module.exports;
\t}
});
`;

// 最后一道闸：真解析一遍。没有这一步，`export{a}`、重复 const、JSX 这类问题
// 会以"构建成功"的姿态出厂，直到浏览器里才炸。
try {
  new Script(bundle, { filename: outFile });
} catch (error) {
  throw new Error(
    `拼出来的 bundle 无法解析，构建中止（源码有问题，别把坏产物发出去）：\n  ${error.message}`,
  );
}

writeFileSync(outFile, bundle, "utf8");
const kb = (Buffer.byteLength(bundle, "utf8") / 1024).toFixed(1);
console.log(`wrote ${outFile} (${kb} KB)`);
console.log(`parts: ${parts.map(({ name }) => name).join(" → ")}`);
console.log(`exports: ${entry.exported.join(", ")}`);
