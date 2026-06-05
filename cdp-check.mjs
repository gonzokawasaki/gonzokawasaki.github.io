// Headless-Chrome console/exception capture over the DevTools Protocol.
// Launches chrome --headless, navigates to a URL, prints all console output,
// uncaught exceptions, and failed network requests. Used to see *why* the
// built page renders nothing (errors thrown during the async boot are silent
// otherwise). Usage: node cdp-check.mjs <url> [waitMs]
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] || "http://localhost:4173/";
const waitMs = Number(process.argv[3] || 6000);
const PORT = 9333;

const profile = mkdtempSync(join(tmpdir(), "cdp-"));
const chrome = spawn("google-chrome-stable", [
  "--headless=new", "--no-sandbox",
  // headless has no GPU; force software WebGL so Babylon's Engine can init
  // (otherwise it throws "WebGL not supported", masking the real app bug).
  "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--window-size=1280,800", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/json/version`);
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {}
    await sleep(100);
  }
  throw new Error("chrome devtools endpoint never came up");
}

let id = 0;
function send(ws, method, params = {}, sessionId) {
  const msg = { id: ++id, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return msg.id;
}

const wsUrl = await getWsUrl();
const ws = new WebSocket(wsUrl);
const logs = [];
let sessionId = null;

await new Promise((res) => (ws.onopen = res));

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  // attach to the page target as a flat session
  if (m.method === "Target.attachedToTarget") {
    // headless spawns several targets; only drive the real page (ignore the
    // initial about:blank + any service-worker targets, which would otherwise
    // overwrite our sessionId and make the DOM probe run in the wrong document)
    if (m.params.targetInfo.type !== "page") return;
    if (sessionId) return;
    sessionId = m.params.sessionId;
    send(ws, "Runtime.enable", {}, sessionId);
    send(ws, "Log.enable", {}, sessionId);
    send(ws, "Page.enable", {}, sessionId);
    send(ws, "Network.enable", {}, sessionId);
    // install global error capture BEFORE any page script runs, so an error
    // thrown inside the async boot IIFE (which only logs as a bare
    // "Uncaught (in promise)") is recorded with its full message + stack.
    send(ws, "Page.addScriptToEvaluateOnNewDocument", {
      source: `window.__errs=[];
        addEventListener('error',e=>__errs.push('window.onerror: '+(e.error&&e.error.stack||e.message)));
        addEventListener('unhandledrejection',e=>{const r=e.reason;__errs.push('unhandledrejection: '+((r&&r.stack)||r));});`,
    }, sessionId);
    send(ws, "Runtime.runIfWaitingForDebugger", {}, sessionId);
    send(ws, "Page.navigate", { url }, sessionId);
    return;
  }
  switch (m.method) {
    case "Runtime.consoleAPICalled": {
      const args = (m.params.args || []).map((a) => a.value ?? a.description ?? a.unserializableValue ?? "").join(" ");
      logs.push(`[console.${m.params.type}] ${args}`);
      break;
    }
    case "Runtime.exceptionThrown": {
      const d = m.params.exceptionDetails;
      const txt = d.exception?.description || d.text || JSON.stringify(d);
      logs.push(`[EXCEPTION] ${txt}`);
      break;
    }
    case "Log.entryAdded": {
      const e = m.params.entry;
      logs.push(`[log.${e.level}] ${e.text}${e.url ? " (" + e.url + ")" : ""}`);
      break;
    }
    case "Network.loadingFailed": {
      logs.push(`[net-fail] ${m.params.errorText} type=${m.params.type}`);
      break;
    }
  }
};

// discover & attach to the page target
send(ws, "Target.setDiscoverTargets", { discover: true });
send(ws, "Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });

await sleep(waitMs);

// probe the DOM: did a canvas get a non-zero drawing buffer + any meshes log?
if (sessionId) {
  const probeId = send(ws, "Runtime.evaluate", {
    expression: `(() => {
      const c = document.getElementById('renderCanvas');
      const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
      return JSON.stringify({
        hasCanvas: !!c,
        canvasW: c && c.width, canvasH: c && c.height,
        glOk: !!gl,
        treeItems: document.querySelectorAll('.treeItem').length,
        jsonLen: (document.getElementById('json') && document.getElementById('json').textContent || '').length,
        bootErrors: window.__errs || [],
      });
    })()`,
    returnByValue: true,
  }, sessionId);
  await new Promise((res) => {
    const h = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === probeId) { logs.push(`[DOM PROBE] ${m.result?.result?.value ?? JSON.stringify(m.result ?? m.error)}`); ws.removeEventListener("message", h); res(); }
    };
    ws.addEventListener("message", h);
    setTimeout(res, 2000);
  });
}

console.log(`\n=== ${url} ===`);
console.log(logs.length ? logs.join("\n") : "(no console output / no errors captured)");

ws.close();
chrome.kill("SIGKILL");
process.exit(0);
