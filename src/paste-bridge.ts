// ---------------------------------------------------------------------------
// The paste-bridge — the simplest AI on-ramp, no key / no login / no install
// (session-state items 9 & 12). When the local lexicon hits its limit (counts,
// spacing, multi-object plans) we DON'T need an integrated LLM: we generate a
// self-contained, kid-readable prompt that TEACHES the verb grammar inside the
// paste itself, the student drops it into whatever chat AI they already have
// (school Copilot / ChatGPT / Claude), and pastes the reply back. The reply is
// just lines in the SAME thin-verb grammar the lexicon already parses — so the
// resolver validates every line before it touches the scene (the safety boundary
// holds for this producer too). The prompt is generated FROM the verb schema, so
// it can never drift out of sync — the schema's 4th consumer (parser, chips,
// validator, NOTE).
// ---------------------------------------------------------------------------
import { VERBS } from "./verbs";
import { VERB_SYNONYMS, LIBRARY_SYNONYMS } from "./lexicon";
import { LIBRARY_NAMES } from "./library";
import { PALETTE } from "./palette";

/** verb → the kid-words that resolve to it (for the cheat-sheet in the prompt) */
function synonymsFor(verb: string): string[] {
  const out: string[] = [];
  for (const [word, v] of Object.entries(VERB_SYNONYMS)) if (v === verb && word !== verb) out.push(word);
  return out;
}

/** one cheat-sheet line per verb the AI may use, with an example */
const EXAMPLES: Record<string, string> = {
  add: "add a red cube 24",
  spawn: "spawn a rabbit  (or snowman / rocket / robot)",
  subtract: "cut a hole r=4   (acts on the named/selected object)",
  union: "glue a box 10 on",
  move: "move up 5   ·   move the green cube right 10",
  rotate: "rotate 45 y",
  scale: "scale 1.5",
};

export interface PromptParts {
  request: string;
  sceneJSON: string;
}

/** build the portable AI note: role · grammar · current scene · request · contract */
export function buildPrompt({ request, sceneJSON }: PromptParts): string {
  const verbLines = Object.keys(VERBS).map((v) => {
    const syn = synonymsFor(v);
    const ex = EXAMPLES[v] ?? v;
    return `  • ${v}${syn.length ? `  (also: ${syn.join(", ")})` : ""}\n      e.g. ${ex}`;
  });

  const libObjects = LIBRARY_NAMES.join(", ");
  const libAliases = Object.entries(LIBRARY_SYNONYMS)
    .filter(([w, n]) => w !== n)
    .map(([w, n]) => `${w}→${n}`)
    .join(", ");
  const colors = Object.keys(PALETTE).join(", ");

  return `You are helping a student build a 3D model in a kids' CAD app.
Reply ONLY with simple commands the app understands — one per line, inside a
\`\`\` code block, nothing else (no explanation). The app parses each line and
will reject anything it can't read, so keep to the grammar below.

VERBS you can use:
${verbLines.join("\n")}

SHAPES for add/cut/glue: box (cube), sphere (ball), cylinder (rod). A "hole" is a cylinder.
READY-MADE OBJECTS for spawn: ${libObjects}${libAliases ? `  (aliases: ${libAliases})` : ""}.
COLORS: ${colors}.  (use on add/spawn, e.g. "add a blue sphere 20")
DIRECTIONS for move: up, down, left, right, forward, back.
REFER TO AN OBJECT by its colour (and shape): "move the green cube up", "cut a hole in the blue box".

CURRENT SCENE (the model so far — object ids, colours, position):
${sceneJSON}

THE STUDENT WANTS:
"${request}"

Now reply with ONLY the command lines in a \`\`\` code block, in the order they
should run. Keep each command simple (one verb). Example of a good reply:
\`\`\`
spawn a snowman
add a brown cylinder 8
move up 20
\`\`\``;
}

/**
 * Lenient extraction of command lines from an AI's reply. Pulls the fenced code
 * block if present (ignoring surrounding prose / apologies), strips bullets,
 * numbering, and backticks, and drops blank / comment lines. The resolver does
 * the actual validation per line — this just isolates the candidate commands.
 */
export function extractCommands(reply: string): string[] {
  let body = reply;
  const fence = reply.match(/```[a-zA-Z]*\n?([\s\S]*?)```/);
  if (fence) body = fence[1];
  return body
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/`/g, "").trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("//"));
}
