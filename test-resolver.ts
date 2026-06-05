// Headless unit test for the resolver (run via esbuild → node). Pure logic, no
// Babylon/DOM. Asserts phrases resolve to the right thin verb + params, and that
// the escalation triggers fire when (and only when) they should.
import { resolve, type ResolveContext } from "./src/resolver";

let pass = 0, fail = 0;
const sel = { hasSelection: true };
const nosel = { hasSelection: false };

// a small seed scene so colour/kind references can resolve to an object id
const scene: ResolveContext = {
  hasSelection: false,
  objects: [
    { id: "plate", color: [0.40, 0.55, 0.85], kind: "box" }, // blue box
    { id: "block", color: [0.36, 0.66, 0.40], kind: "box" }, // green box
    { id: "post", color: [0.86, 0.52, 0.26], kind: "cylinder" }, // orange cylinder
  ],
};

/** assert a phrase resolves to a verb AND points at the expected target object */
function tgt(input: string, ctx: any, verb: string, target: string, label: string) {
  const r = resolve(input, ctx);
  if (!r.ok) { console.log(`✗ ${label}: "${input}" → escalated (${(r as any).reason})`); fail++; return; }
  if (r.verb.verb !== verb) { console.log(`✗ ${label}: "${input}" → verb ${r.verb.verb}, want ${verb}`); fail++; return; }
  if (r.target !== target) { console.log(`✗ ${label}: "${input}" → target ${r.target}, want ${target}`); fail++; return; }
  console.log(`✓ ${label}: "${input}" → ${verb} @ ${r.target}`);
  pass++;
}

function ok(input: string, ctx: any, verb: string, params: Record<string, any>, label: string) {
  const r = resolve(input, ctx);
  if (!r.ok) { console.log(`✗ ${label}: "${input}" → escalated (${(r as any).reason})`); fail++; return; }
  if (r.verb.verb !== verb) { console.log(`✗ ${label}: "${input}" → verb ${r.verb.verb}, want ${verb}`); fail++; return; }
  for (const k of Object.keys(params)) {
    if (r.verb.params[k] !== params[k]) {
      console.log(`✗ ${label}: "${input}" → ${k}=${r.verb.params[k]}, want ${params[k]}`); fail++; return;
    }
  }
  console.log(`✓ ${label}: "${input}" → ${verb} ${JSON.stringify(r.verb.params)}`);
  pass++;
}

function esc(input: string, ctx: any, reason: string, label: string) {
  const r = resolve(input, ctx);
  if (r.ok) { console.log(`✗ ${label}: "${input}" → resolved ${r.verb.verb}, expected escalation`); fail++; return; }
  if (r.reason !== reason) { console.log(`✗ ${label}: "${input}" → ${r.reason}, want ${reason}`); fail++; return; }
  console.log(`✓ ${label}: "${input}" → escalate(${reason})`);
  pass++;
}

// --- the centerpiece: cut a hole ---------------------------------------------
ok("cut a hole r=4", sel, "subtract", { shape: "cylinder", radius: 4 }, "cut hole r=4");
ok("drill a 6 hole", sel, "subtract", { shape: "cylinder", radius: 6 }, "drill 6");
ok("carve a box 3", sel, "subtract", { shape: "box", radius: 3 }, "carve box");
ok("subtract sphere", sel, "subtract", { shape: "sphere", radius: 4 }, "subtract sphere (default r)");

// --- create -------------------------------------------------------------------
ok("add a cube", nosel, "add", { shape: "box", size: 20 }, "add cube (no selection ok)");
ok("make a ball 30", nosel, "add", { shape: "sphere", size: 30 }, "make ball 30");
ok("new cylinder 12", nosel, "add", { shape: "cylinder", size: 12 }, "new cylinder");

// --- union --------------------------------------------------------------------
ok("glue a box on", sel, "union", { shape: "box", size: 12 }, "glue box");
ok("attach a peg 8", sel, "union", { shape: "cylinder", size: 8 }, "attach peg");

// --- transforms (ported from P2 commands) ------------------------------------
ok("move up 5", sel, "move", { direction: "up", distance: 5 }, "move up 5");
ok("up 5", sel, "move", { direction: "up", distance: 5 }, "bare up 5");
ok("slide left 10", sel, "move", { direction: "left", distance: 10 }, "slide left");
ok("rotate 45 y", sel, "rotate", { angle: 45, axis: "y" }, "rotate 45 y");
ok("spin 90", sel, "rotate", { angle: 90, axis: "y" }, "spin 90 (default axis)");
ok("turn 30 x", sel, "rotate", { angle: 30, axis: "x" }, "turn 30 x");
ok("scale 1.5", sel, "scale", { factor: 1.5 }, "scale 1.5");
ok("grow", sel, "scale", { factor: 1.5 }, "grow (default)");
ok("shrink", sel, "scale", { factor: 0.66 }, "shrink (default <1)");

// --- escalations --------------------------------------------------------------
esc("cut four holes", sel, "composition", "four holes → reasoning");
esc("put holes evenly around the edge", sel, "composition", "evenly/around → reasoning");
esc("add a box and cut a hole", sel, "composition", "two verbs → reasoning");
esc("flibber the wotsit", sel, "no-verb", "nonsense → no verb");
esc("cut a hole r=4", nosel, "needs-selection", "subtract w/o selection");
esc("", sel, "empty", "empty input");

// --- colour / shape object references (NEW) -----------------------------------
tgt("move the green cube up 8", scene, "move", "block", "move green cube");
tgt("move the blue box up", scene, "move", "plate", "move blue box");
tgt("rotate the orange cylinder 45", scene, "rotate", "post", "rotate orange cyl");
tgt("scale the green one 1.5", scene, "scale", "block", "scale green (colour only)");
tgt("cut a hole r=3 in the blue box", scene, "subtract", "plate", "cut hole in blue box (target=plate, cutter=cylinder)");
ok("cut a hole r=3 in the blue box", scene, "subtract", { shape: "cylinder", radius: 3 }, "blue-box cut keeps cylinder cutter");
tgt("move the cube up", scene, "move", "plate", "bare kind → first matching object");
// a colour with no matching object → no-target escalation (not a silent guess)
esc("move the purple cube up", scene, "no-target", "no purple object → no-target");

// --- colour on create ---------------------------------------------------------
ok("add a red cube 24", nosel, "add", { shape: "box", size: 24, color: "red" }, "add red cube");
ok("make a blue ball 20", nosel, "add", { shape: "sphere", size: 20, color: "blue" }, "make blue ball");
ok("add a cube", nosel, "add", { shape: "box", color: "auto" }, "add cube → auto colour");

// --- ready-made library objects (spawn) ---------------------------------------
ok("spawn a rabbit", nosel, "spawn", { object: "rabbit", color: "auto" }, "spawn rabbit");
ok("add a snowman", nosel, "spawn", { object: "snowman" }, "add a snowman → spawn");
ok("place a white robot", nosel, "spawn", { object: "robot", color: "white" }, "white robot");
ok("a bunny", nosel, "spawn", { object: "rabbit" }, "bare 'bunny' → spawn rabbit (alias)");
// two ready-made objects in one breath → composition (hand to the AI)
esc("build a snowman next to a rocket", sel, "composition", "two library objects → AI");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
