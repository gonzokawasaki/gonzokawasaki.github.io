// Drive the live UI headlessly and assert behaviour. Selects the "block",
// runs a text command, and reads back the op-tree JSON + command log.
// Usage: node cdp-eval.mjs <url>
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] || "http://localhost:4173/";
const PORT = 9335;
const profile = mkdtempSync(join(tmpdir(), "cdp-"));
const chrome = spawn("google-chrome-stable", [
  "--headless=new", "--no-sandbox",
  "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getWsUrl() {
  for (let i = 0; i < 50; i++) { try { const j = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; } catch {} await sleep(100); }
  throw new Error("no devtools endpoint");
}
let id = 0;
const send = (ws, method, params = {}, s) => { const m = { id: ++id, method, params }; if (s) m.sessionId = s; ws.send(JSON.stringify(m)); return m.id; };

const ws = new WebSocket(await getWsUrl());
let sessionId = null;
await new Promise((res) => (ws.onopen = res));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Target.attachedToTarget") {
    if (m.params.targetInfo.type !== "page" || sessionId) return;
    sessionId = m.params.sessionId;
    send(ws, "Runtime.enable", {}, sessionId);
    send(ws, "Page.enable", {}, sessionId);
    send(ws, "Runtime.runIfWaitingForDebugger", {}, sessionId);
    send(ws, "Page.navigate", { url }, sessionId);
  }
};
send(ws, "Target.setDiscoverTargets", { discover: true });
send(ws, "Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
await sleep(6000);

function evaluate(expression) {
  const eid = send(ws, "Runtime.evaluate", { expression, returnByValue: true }, sessionId);
  return new Promise((res) => {
    ws.addEventListener("message", function h(ev) {
      const m = JSON.parse(ev.data);
      if (m.id === eid) { ws.removeEventListener("message", h); res(m.result?.result?.value ?? JSON.stringify(m.result ?? m.error)); }
    });
  });
}

// helper: pull the "block" object's translate out of the rendered op-tree JSON
const readBlockTranslate = `(() => {
  const j = JSON.parse(document.getElementById('json').textContent);
  const b = j.scene.find(o => o.id === 'block');
  return JSON.stringify(b.transform.translate);
})()`;

const before = await evaluate(readBlockTranslate);
const log = await evaluate(`(() => {
  document.querySelector('.treeItem[data-id="block"]').click();
  document.getElementById('cmd').value = 'move up 5';
  document.getElementById('runCmd').click();
  return document.getElementById('cmdlog').textContent;
})()`);
const after = await evaluate(readBlockTranslate);

// second command: directional shorthand without "move"
const log2 = await evaluate(`(() => {
  document.getElementById('cmd').value = 'right 10';
  document.getElementById('runCmd').click();
  return document.getElementById('cmdlog').textContent;
})()`);
const after2 = await evaluate(readBlockTranslate);

console.log("block.translate before     :", before);
console.log("after 'move up 5'          :", after, "| log:", log);
console.log("after 'right 10' (shorthand):", after2, "| log:", log2);

ws.close(); chrome.kill("SIGKILL"); process.exit(0);
