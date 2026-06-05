// Headless end-to-end check for Prototype 3 (resolver → chips → op-tree → rebake).
// Drives the live UI over CDP with software WebGL, asserts the op-tree changes
// the way the resolver+adapter intend, including a chip edit re-baking geometry.
// Usage: node cdp-p3.mjs <url>
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] || "http://localhost:4173/";
const PORT = 9336;
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
const bootErrors = [];
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
  if (m.method === "Runtime.exceptionThrown") bootErrors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
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
const run = (text, target) => evaluate(`(() => {
  ${target ? `document.querySelector('.treeItem[data-id="${target}"]').click();` : ""}
  document.getElementById('cmd').value = ${JSON.stringify(text)};
  document.getElementById('runCmd').click();
  return document.getElementById('cmdlog').textContent;
})()`);
const plateTree = () => evaluate(`JSON.stringify(JSON.parse(document.getElementById('json').textContent).scene.find(o=>o.id==='plate').tree)`);
const objCount = () => evaluate(`JSON.parse(document.getElementById('json').textContent).scene.length`);

let pass = 0, fail = 0;
const check = (label, cond, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`); cond ? pass++ : fail++; };

// 0. clean boot
check("boots with no exceptions", bootErrors.length === 0, bootErrors.join(" | "));
check("3 seed objects", (await objCount()) === 3);

// 1. the centerpiece: select plate, cut a hole r=4
const log1 = await run("cut a hole r=4", "plate");
const t1 = await plateTree();
check("cut → log shows resolution", /subtract/.test(log1), `log="${log1}"`);
check("op-tree gained a top-level subtract boolean", JSON.parse(t1).type === "boolean" && JSON.parse(t1).mode === "subtract");
check("cut shape is a cylinder Ø8 (radius 4)", /"kind":"cylinder"/.test(t1) && /"d":8\b/.test(t1), t1.slice(0, 80));

// 2. the chips rendered + are editable
const verbPill = await evaluate(`document.querySelector('.verbpill')?.textContent || ''`);
const chipCount = await evaluate(`document.querySelectorAll('#chips .chip').length`);
check("chip strip shows the 'subtract' verb pill", verbPill === "subtract", `pill="${verbPill}"`);
check("two chips rendered (shape + radius)", chipCount === 2, `count=${chipCount}`);

// 3. edit the radius chip 4 → 7 → re-bake from base (no re-resolution)
await evaluate(`(() => {
  const r = document.querySelector('#chips input[type=range]');
  r.value = '7'; r.dispatchEvent(new Event('input',{bubbles:true})); r.dispatchEvent(new Event('change',{bubbles:true}));
})()`);
const t2 = await plateTree();
check("radius chip edit re-baked geometry (Ø14)", /"d":14\b/.test(t2) && !/"d":8\b/.test(t2), "cylinder diameter updated in op-tree");
const subs1 = (t1.match(/"mode":"subtract"/g) || []).length;
const subs2 = (t2.match(/"mode":"subtract"/g) || []).length;
check("edited from base, not stacked (subtract count stable)", subs1 === subs2 && subs1 === 3, `${subs1}→${subs2}`);

// 4. create a new object
const before = await objCount();
await run("add a cube 24"); // no selection needed
const after = await objCount();
check("'add a cube' created a new object", after === before + 1, `${before}→${after}`);

// 5. escalation: composition phrase is shown, not applied
const log5 = await run("cut four holes evenly", "plate");
const escShown = await evaluate(`!!document.querySelector('#chips .escalate')`);
check("composition phrase escalates (shown, not applied)", escShown === true);

// helpers for the new features
const objTreeByPrefix = (p) => evaluate(`(()=>{const o=JSON.parse(document.getElementById('json').textContent).scene.find(o=>o.id.startsWith('${p}'));return o?JSON.stringify(o):'null';})()`);
const objYById = (id) => evaluate(`(()=>{const o=JSON.parse(document.getElementById('json').textContent).scene.find(o=>o.id==='${id}');return o?o.transform.translate[1]:null;})()`);
const click = (sel) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.click();return true;})()`);

// 6. colour reference: "move the green cube up" moves the GREEN object (block), not the plate
const blockY0 = await objYById("block");
const plateY0 = await objYById("plate");
await run("move the green cube up 10"); // no click — the colour word picks the noun
const blockY1 = await objYById("block");
const plateY1 = await objYById("plate");
check("colour ref moved the green object (block)", Math.abs(blockY1 - blockY0 - 10) < 0.01, `block y ${blockY0}→${blockY1}`);
check("colour ref left the blue object (plate) untouched", plateY1 === plateY0, `plate y ${plateY0}→${plateY1}`);

// 7. spawn: "spawn a rabbit" adds a composite object built from primitives (unions)
const c7 = await objCount();
await run("spawn a rabbit");
const c7b = await objCount();
const rabbitTree = await objTreeByPrefix("rabbit");
check("'spawn a rabbit' created a new object", c7b === c7 + 1, `${c7}→${c7b}`);
check("rabbit is a primitive-composed union tree", /"mode":"union"/.test(rabbitTree) && /"kind":"sphere"/.test(rabbitTree));

// 8. Shape Library tile actually places geometry (click the Robot tile)
const c8 = await objCount();
await evaluate(`(()=>{const t=[...document.querySelectorAll('#shapeGrid .shapetile')].find(t=>/Robot/.test(t.textContent));if(t)t.click();})()`);
const c8b = await objCount();
check("clicking a Shape Library tile placed an object", c8b === c8 + 1, `${c8}→${c8b}`);

// 9. paste-bridge: composition phrase → "Send to AI" → prompt built → paste reply → applied
await run("build a snowman next to a rocket", "plate");
const sentOk = await click("#chips .bridge-cta");
const promptText = await evaluate(`document.getElementById('bridgePrompt').value`);
check("composition offers a 'send to AI' button", sentOk === true);
check("generated AI prompt contains the verb grammar", /spawn/.test(promptText) && /one per line/.test(promptText), `len=${promptText.length}`);
const c9 = await objCount();
await evaluate(`(()=>{const r=document.getElementById('bridgeReply');r.value='\`\`\`\\nspawn a snowman\\nspawn a rocket\\n\`\`\`';document.getElementById('applyReply').click();})()`);
const c9b = await objCount();
check("pasted AI reply applied 2 spawns", c9b === c9 + 2, `${c9}→${c9b}`);

console.log(`\n${pass} passed, ${fail} failed`);
ws.close(); chrome.kill("SIGKILL"); process.exit(fail ? 1 : 0);
