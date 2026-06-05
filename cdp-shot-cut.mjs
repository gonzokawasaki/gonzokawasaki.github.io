// One-off: drive a "cut a hole" on the plate, then screenshot — to eyeball the
// carved hole + the resolved chip strip together. Usage: node cdp-shot-cut.mjs <url> <out>
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] || "http://localhost:4173/";
const out = process.argv[3] || "/tmp/p3-cut.png";
const PORT = 9337;
const profile = mkdtempSync(join(tmpdir(), "cdp-"));
const chrome = spawn("google-chrome-stable", [
  "--headless=new", "--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--window-size=1280,800", "--hide-scrollbars", "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getWsUrl() { for (let i = 0; i < 50; i++) { try { const j = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; } catch {} await sleep(100); } throw new Error("no devtools"); }
let id = 0; const send = (ws, method, params = {}, s) => { const m = { id: ++id, method, params }; if (s) m.sessionId = s; ws.send(JSON.stringify(m)); return m.id; };
const ws = new WebSocket(await getWsUrl()); let sessionId = null;
await new Promise((res) => (ws.onopen = res));
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.method === "Target.attachedToTarget") { if (m.params.targetInfo.type !== "page" || sessionId) return; sessionId = m.params.sessionId; send(ws, "Runtime.enable", {}, sessionId); send(ws, "Page.enable", {}, sessionId); send(ws, "Runtime.runIfWaitingForDebugger", {}, sessionId); send(ws, "Page.navigate", { url }, sessionId); } };
send(ws, "Target.setDiscoverTargets", { discover: true });
send(ws, "Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
await sleep(6000);
function evaluate(expression) { const eid = send(ws, "Runtime.evaluate", { expression, returnByValue: true }, sessionId); return new Promise((res) => { ws.addEventListener("message", function h(ev) { const m = JSON.parse(ev.data); if (m.id === eid) { ws.removeEventListener("message", h); res(m.result?.result?.value); } }); }); }
await evaluate(`(() => { document.querySelector('.treeItem[data-id="plate"]').click(); document.getElementById('cmd').value='cut a hole r=6'; document.getElementById('runCmd').click(); })()`);
await sleep(800);
const shot = await new Promise((res) => { const eid = send(ws, "Page.captureScreenshot", { format: "png" }, sessionId); ws.addEventListener("message", function h(ev) { const m = JSON.parse(ev.data); if (m.id === eid) { ws.removeEventListener("message", h); res(m.result?.data); } }); });
writeFileSync(out, Buffer.from(shot, "base64"));
console.log("saved", out);
ws.close(); chrome.kill("SIGKILL"); process.exit(0);
