/**
 * 通过 DevTools 协议在无头浏览器里执行一段表达式，把结果打回终端。
 * 用法: node cdp-probe.mjs <debugPort> <expressionFile|expression>
 */

const port = process.argv[2] ?? "9223";
const expr = process.argv[3] ?? "1+1";

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
// 只要不是浏览器自带的 edge:// 页面就行（也要能认 file:// 的离线测试页）
const page = targets.find((t) => t.type === "page" && !/^(edge|devtools):/.test(t.url));
if (!page) {
  console.error("no page target:", JSON.stringify(targets.map((t) => ({ type: t.type, url: t.url })), null, 2));
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

let seq = 0;
function send(method, params) {
  const id = ++seq;
  return new Promise((resolve) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id === id) {
        ws.removeEventListener("message", onMessage);
        resolve(message);
      }
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send("Runtime.enable", {});
const result = await send("Runtime.evaluate", {
  expression: expr,
  returnByValue: true,
  awaitPromise: true,
  userGesture: true,
});

if (result.result?.exceptionDetails) {
  console.error("EXCEPTION:", JSON.stringify(result.result.exceptionDetails, null, 2));
  process.exit(2);
}
console.log(typeof result.result?.result?.value === "string"
  ? result.result.result.value
  : JSON.stringify(result.result?.result?.value, null, 2));
ws.close();
