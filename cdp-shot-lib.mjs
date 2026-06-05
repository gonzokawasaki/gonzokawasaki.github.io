// One-off visual check: spawn the special library objects, frame them, screenshot.
// Usage: node cdp-shot-lib.mjs <url> <outPng>
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] || "http://localhost:4173/";
const out = process.argv[3] || "/tmp/lib-shot.png";
const PORT = 9337;
const profile = mkdtempSync(join(tmpdir(), "cdp-"));
const chrome = spawn("google-chrome-stable", [
  "--headless=new", "--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--window-size=1280,800", "--hide-scrollbars", "about:blank",
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
  if (m.method === "Target.attachedToTarget" && m.params.targetInfo.type === "page" && !sessionId) {
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
      if (m.id === eid) { ws.removeEventListener("message", h); res(m.result?.result?.value); }
    });
  });
}
const run = (text) => evaluate(`(()=>{document.getElementById('cmd').value=${JSON.stringify(text)};document.getElementById('runCmd').click();return true;})()`);

// clear the seed scene out of the way, then drop one of each special object
await run("spawn a rabbit");
await run("move left 40");
await run("spawn a snowman");
await run("move left 0");
await run("spawn a rocket");
await run("move right 40");
await run("spawn a robot");
await run("move right 80");
await sleep(800);
await evaluate(`document.querySelector('button[data-view="iso"]').click()`);
await sleep(1200);

const shot = await new Promise((res) => {
  const eid = send(ws, "Page.captureScreenshot", { format: "png" }, sessionId);
  ws.addEventListener("message", function h(ev) {
    const m = JSON.parse(ev.data);
    if (m.id === eid) { ws.removeEventListener("message", h); res(m.result?.data); }
  });
});
writeFileSync(out, Buffer.from(shot, "base64"));
console.log(`wrote ${out}`);
ws.close(); chrome.kill("SIGKILL"); process.exit(0);
