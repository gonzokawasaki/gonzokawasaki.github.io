// Headless test for the paste-bridge (run via esbuild → node). Proves the
// round trip works: (1) we generate a self-contained prompt from the verb
// schema; (2) a realistic AI reply (prose + a fenced code block) is leniently
// reduced to clean command lines; (3) each line resolves through the SAME
// resolver the typed UI uses — so the AI is just another producer of thin verbs.
import { buildPrompt, extractCommands } from "./src/paste-bridge";
import { resolve, type ResolveContext } from "./src/resolver";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`);
  cond ? pass++ : fail++;
};

const scene: ResolveContext = {
  hasSelection: false,
  objects: [{ id: "plate", color: [0.40, 0.55, 0.85], kind: "box" }],
};

// 1. the prompt is self-contained: grammar + scene + request + output contract
const prompt = buildPrompt({ request: "build a snowman next to a rocket", sceneJSON: JSON.stringify({ scene: scene.objects }) });
check("prompt names the verbs", /spawn/.test(prompt) && /subtract|cut/.test(prompt));
check("prompt lists ready-made objects", /rabbit/.test(prompt) && /snowman/.test(prompt));
check("prompt lists colours", /blue/.test(prompt) && /green/.test(prompt));
check("prompt embeds the current scene", /plate/.test(prompt));
check("prompt carries the student's request", /snowman next to a rocket/.test(prompt));
check("prompt states the output contract", /one per line/.test(prompt) && /code block/.test(prompt));

// 2. lenient extraction: a realistic reply with prose + bullets + a code fence
const aiReply = `Sure! Here's how to build that:

\`\`\`
spawn a snowman
move left 25
spawn a rocket
move right 25
\`\`\`

Hope that helps!`;
const cmds = extractCommands(aiReply);
check("extracts only the command lines", cmds.length === 4, JSON.stringify(cmds));
check("strips the prose around the fence", !cmds.some((c) => /Sure|helps/.test(c)));

// bullets / numbering / stray backticks are tolerated too
const messy = "1. spawn a rabbit\n- move up 5\n`add a red cube`\n# a comment";
const cmds2 = extractCommands(messy);
check("strips bullets, numbers, backticks, comments", cmds2.length === 3 && cmds2[0] === "spawn a rabbit" && cmds2[2] === "add a red cube", JSON.stringify(cmds2));

// 3. apply the reply the way the app does — sequentially, re-reading the scene
// each step (a create auto-selects the new object, so the next "move" has a noun).
const verbs: string[] = [];
let hasSelection = false; // mirrors commit(): a create selects the new object
for (const line of cmds) {
  const r = resolve(line, { ...scene, hasSelection });
  if (!r.ok) { verbs.push(`ESC:${r.reason}`); continue; }
  verbs.push(r.verb.verb);
  if (r.verb.verb === "spawn" || r.verb.verb === "add") hasSelection = true;
}
check("all 4 AI commands resolve when applied in order", verbs.every((v) => !v.startsWith("ESC")), verbs.join(", "));
check("the plan reads spawn → move → spawn → move", verbs.join(",") === "spawn,move,spawn,move");

// the same line resolves in isolation too, when there IS a selection
const first = resolve(cmds[0], scene);
check("first command is spawn snowman", first.ok && first.verb.verb === "spawn" && first.verb.params.object === "snowman");

// a hallucinated / malformed line is rejected, not applied (lenient + safe)
const junk = resolve("teleport the thing sideways", scene);
check("malformed AI line is rejected (no-verb)", !junk.ok && (junk as any).reason === "no-verb");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
