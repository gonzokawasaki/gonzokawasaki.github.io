// Headless screenshot over CDP. Navigates, waits for the render loop, captures
// a PNG. Usage: node cdp-shot.mjs <url> <outPng> [waitMs]
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] || "http://localhost:4173/";
const out = process.argv[3] || "/tmp/shot.png";
const waitMs = Number(process.argv[4] || 6000);
const PORT = 9334;

const profile = mkdtempSync(join(tmpdir(), "cdp-"));
const chrome = spawn("google-chrome-stable", [
  "--headless=new", "--no-sandbox",
  "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--window-size=1280,800", "--hide-scrollbars", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getWsUrl() {
  for (let i = 0; i < 50; i++) {
    try { const j = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; } catch {}
    await sleep(100);
  }
  throw new Error("no devtools endpoint");
}

let id = 0;
const send = (ws, method, params = {}, sessionId) => { const m = { id: ++id, method, params }; if (sessionId) m.sessionId = sessionId; ws.send(JSON.stringify(m)); return m.id; };

const ws = new WebSocket(await getWsUrl());
let sessionId = null;
await new Promise((res) => (ws.onopen = res));

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Target.attachedToTarget") {
    if (m.params.targetInfo.type !== "page" || sessionId) return;
    sessionId = m.params.sessionId;
    send(ws, "Page.enable", {}, sessionId);
    send(ws, "Runtime.runIfWaitingForDebugger", {}, sessionId);
    send(ws, "Page.navigate", { url }, sessionId);
  }
};
send(ws, "Target.setDiscoverTargets", { discover: true });
send(ws, "Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });

await sleep(waitMs);
const shotId = send(ws, "Page.captureScreenshot", { format: "png" }, sessionId);
await new Promise((res) => {
  ws.addEventListener("message", function h(ev) {
    const m = JSON.parse(ev.data);
    if (m.id === shotId) { writeFileSync(out, Buffer.from(m.result.data, "base64")); ws.removeEventListener("message", h); res(); }
  });
  setTimeout(res, 4000);
});
console.log(`saved ${out}`);
ws.close(); chrome.kill("SIGKILL"); process.exit(0);
