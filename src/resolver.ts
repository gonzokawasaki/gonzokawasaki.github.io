// ---------------------------------------------------------------------------
// The resolver (Tier-1 fast-path, spec §2). Turns a typed phrase + the current
// scene (selection AND the list of objects) into a single thin verb call — or a
// VISIBLE escalation when it knows it's out of depth (session-state item 14). No
// LLM here: an escalation in this prototype is shown, not sent (the paste-bridge
// is the AI on-ramp, see paste-bridge.ts). The lexicon is closed and
// deterministic, so the same phrase always resolves the same way.
//
// Two reference channels for the NOUN (the object a verb acts on):
//   1. the click (ctx.hasSelection)          — point-and-speak
//   2. a colour / shape word in the phrase    — "move the GREEN CUBE up"
// Either satisfies a verb that needs a target; (2) sets `target` on the result
// so the caller can select that object before applying.
// ---------------------------------------------------------------------------
import { VERBS, withDefaults, type ResolvedVerb, type VerbName } from "./verbs";
import {
  VERB_SYNONYMS, SHAPE_SYNONYMS, DIRECTION_SYNONYMS, AXIS_WORDS,
  COMPOSITION_WORDS, NUMBER_WORDS, HOLE_WORDS,
  LIBRARY_SYNONYMS, COLOR_WORDS,
} from "./lexicon";
import { nearestColorName } from "./palette";

export type EscalationReason = "empty" | "no-verb" | "needs-selection" | "no-target" | "composition";

export type Resolution =
  | { ok: true; verb: ResolvedVerb; target?: string }
  | { ok: false; reason: EscalationReason; message: string };

/** a minimal view of a scene object the resolver needs to match colour/kind references */
export interface SceneRef {
  id: string;
  color: [number, number, number];
  kind?: string; // friendly noun: "box" | "sphere" | "cylinder" | "rabbit" | …
}

export interface ResolveContext {
  hasSelection: boolean;
  /** the current scene, so "the green cube" can be resolved to an object id */
  objects?: SceneRef[];
}

/** verbs that act on an existing object (the noun) rather than creating one */
const TARGET_VERBS = new Set<VerbName>(["subtract", "union", "move", "rotate", "scale"]);
/** of those, the ones with no `shape` param, so a bare shape word means the target */
const TRANSFORM_VERBS = new Set<VerbName>(["move", "rotate", "scale"]);

/** split into clean tokens: lowercase, break on whitespace AND `=`, strip units */
function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[=]/g, " ") // "r=4" → "r 4"
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** parse a token as a number, tolerating trailing units (45°, 5mm, 1.5x) */
function asNumber(tok: string): number | null {
  const m = tok.match(/^(-?\d+(?:\.\d+)?)(?:°|deg|mm|cm|x|×)?$/);
  return m ? parseFloat(m[1]) : null;
}

/** look a token up in a table, trying simple plural forms (holes→hole, boxes→box) */
function lookupNoun<T>(tok: string, table: Record<string, T> | Set<string>): T | boolean | undefined {
  const has = (k: string) => (table instanceof Set ? (table.has(k) ? true : undefined) : table[k]);
  return has(tok) ?? (tok.endsWith("s") ? has(tok.slice(0, -1)) : undefined) ?? (tok.endsWith("es") ? has(tok.slice(0, -2)) : undefined);
}

/** find the object a colour (+ optional kind) refers to; undefined if none */
function matchByColor(color: string, kindHint: string | undefined, objects: SceneRef[]): string | undefined {
  let cands = objects.filter((o) => nearestColorName(o.color) === color);
  if (kindHint && cands.length > 1) {
    const narrowed = cands.filter((o) => o.kind === kindHint);
    if (narrowed.length) cands = narrowed;
  }
  return cands[0]?.id;
}

/** find the object a bare kind refers to ("the cube") when no colour is given */
function matchByKind(kind: string, objects: SceneRef[]): string | undefined {
  return objects.filter((o) => o.kind === kind)[0]?.id;
}

export function resolve(input: string, ctx: ResolveContext): Resolution {
  const tokens = tokenize(input);
  if (tokens.length === 0) return { ok: false, reason: "empty", message: "" };

  // --- collect signals across the whole phrase (with positions) ---------------
  const numbers: number[] = [];
  const verbHits: { i: number; word: string; verb: VerbName }[] = [];
  const shapeHits: { i: number; shape: string }[] = [];
  const colorHits: { i: number; name: string }[] = [];
  const libHits: { i: number; name: string }[] = [];
  let direction: string | undefined;
  let axis: string | undefined;
  let sawHole = false;
  let sawNumberWord = false;
  let sawCompositionWord = false;

  tokens.forEach((tok, i) => {
    const n = asNumber(tok);
    if (n !== null) { numbers.push(n); return; }
    if (VERB_SYNONYMS[tok]) verbHits.push({ i, word: tok, verb: VERB_SYNONYMS[tok] });
    const sh = lookupNoun(tok, SHAPE_SYNONYMS) as string | undefined;
    if (sh) shapeHits.push({ i, shape: sh });
    const lib = lookupNoun(tok, LIBRARY_SYNONYMS) as string | undefined;
    if (lib) libHits.push({ i, name: lib });
    if (COLOR_WORDS[tok]) colorHits.push({ i, name: COLOR_WORDS[tok] });
    if (DIRECTION_SYNONYMS[tok]) direction = DIRECTION_SYNONYMS[tok];
    if (AXIS_WORDS.has(tok)) axis = tok;
    if (lookupNoun(tok, HOLE_WORDS)) sawHole = true;
    if (COMPOSITION_WORDS.has(tok)) sawCompositionWord = true;
    if (NUMBER_WORDS[tok] !== undefined) sawNumberWord = true;
    // STOPWORDS and unrecognised words are simply ignored
  });

  // --- escalation trigger: composition / reasoning (item 14, trigger 3) -------
  // A lexicon can't generate quantities/positions or run multi-object plans.
  // "four holes", "evenly", two verbs, or two ready-made objects in one breath
  // need real reasoning → hand off (visibly, to the paste-bridge / an AI).
  const distinctVerbs = new Set(verbHits.map((v) => v.verb));
  const sawNoun = shapeHits.length > 0 || sawHole || libHits.length > 0;
  if (sawCompositionWord || (sawNumberWord && sawNoun) || distinctVerbs.size > 1 || libHits.length > 1) {
    return {
      ok: false,
      reason: "composition",
      message: "this needs reasoning (counts / spacing / multiple objects) — send it to your AI",
    };
  }

  // --- a library noun ("rabbit") → the spawn verb (a ready-made object) -------
  if (libHits.length === 1) {
    const params: Record<string, number | string> = { object: libHits[0].name };
    if (colorHits.length) params.color = colorHits[0].name;
    return { ok: true, verb: withDefaults("spawn", params) };
  }

  // --- find the verb ----------------------------------------------------------
  // bare directional shorthand: "up 5" == "move up 5"
  let chosen = verbHits[0];
  if (!chosen && direction) chosen = { i: -1, word: direction, verb: "move" };
  if (!chosen) {
    return { ok: false, reason: "no-verb", message: `couldn't find an action in "${input.trim()}"` };
  }
  const verb = chosen.verb;
  const spec = VERBS[verb];
  if (!spec) {
    return { ok: false, reason: "no-verb", message: `"${chosen.word}" isn't wired up yet in this prototype` };
  }

  // --- resolve the TARGET (the noun) from colour / kind words ------------------
  // Only for verbs that act on an existing object. A shape word adjacent to a
  // colour word ("green cube") is the target's KIND and is consumed there, so it
  // isn't mistaken for the cutter/created shape ("cut a hole in the green box").
  let target: string | undefined;
  let consumedShapeIndex = -1;
  if (TARGET_VERBS.has(verb) && ctx.objects?.length) {
    if (colorHits.length) {
      const ci = colorHits[0].i;
      const adj = shapeHits.find((s) => Math.abs(s.i - ci) === 1);
      if (adj) consumedShapeIndex = adj.i;
      target = matchByColor(colorHits[0].name, adj?.shape, ctx.objects);
    } else if (TRANSFORM_VERBS.has(verb) && shapeHits.length) {
      // no colour, but a transform names a shape → match the object by kind
      consumedShapeIndex = shapeHits[0].i;
      target = matchByKind(shapeHits[0].shape, ctx.objects);
    }
  }

  // selection is satisfied by a click OR a resolved colour/kind target
  const hasNoun = !!target || ctx.hasSelection;
  if (spec.needsSelection && !hasNoun) {
    if (colorHits.length) {
      return { ok: false, reason: "no-target", message: `couldn't find a ${colorHits[0].name} object — is it that colour?` };
    }
    return { ok: false, reason: "needs-selection", message: `click an object first, then say "${input.trim()}"` };
  }

  // --- slot-fill per verb -----------------------------------------------------
  const params: Record<string, number | string> = {};

  // the shape being created / used as a cutter is the first NON-consumed one
  const createShape = shapeHits.find((s) => s.i !== consumedShapeIndex)?.shape;

  if (spec.params.some((p) => p.key === "shape")) {
    if (createShape) params.shape = createShape;
    else if (sawHole) params.shape = "cylinder"; // "hole" → a round hole
  }
  if (verb === "add" && colorHits.length) {
    params.color = colorHits[0].name; // "add a red cube" → paint it red
  }
  if (verb === "move") {
    if (direction) params.direction = direction;
    if (numbers.length) params.distance = numbers[0];
  } else if (verb === "rotate") {
    if (numbers.length) params.angle = numbers[0];
    if (axis) params.axis = axis;
  } else if (verb === "scale") {
    if (numbers.length) params.factor = numbers[0];
    else if (chosen.word === "shrink" || chosen.word === "smaller") params.factor = 0.66;
    // "grow"/"bigger"/bare "scale" fall through to the 1.5 default
  } else {
    // add / subtract / union: the lone number is the size/radius param
    const numParam = spec.params.find((p) => p.type === "number");
    if (numParam && numbers.length) params[numParam.key] = numbers[0];
  }

  return { ok: true, verb: withDefaults(verb, params), target };
}
