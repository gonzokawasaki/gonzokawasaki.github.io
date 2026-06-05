// ---------------------------------------------------------------------------
// The local lexicon — the offline, deterministic dialect of the verb schema
// (session-state items 2 & 9: a few KB of synonyms, no model). It maps a kid's
// word to a canonical thin verb / shape / direction. Two producers, one grammar:
// this lexicon and (later) the LLM both emit the SAME thin verb calls. The
// lexicon is the PRIMARY path — instant, consistent, a better teacher than a
// stochastic model (item 10), and it works with no key on a locked-down network.
// ---------------------------------------------------------------------------
import type { VerbName, Shape } from "./verbs";

/** synonym → canonical thin verb. The word "hole" implies subtract+cylinder. */
export const VERB_SYNONYMS: Record<string, VerbName> = {
  // create
  add: "add", make: "add", new: "add", place: "add", drop: "add", create: "add", put: "add",
  // booleans
  union: "union", glue: "union", join: "union", merge: "union", weld: "union", fuse: "union", attach: "union", stick: "union",
  subtract: "subtract", cut: "subtract", carve: "subtract", drill: "subtract", bore: "subtract", remove: "subtract", scoop: "subtract", hole: "subtract",
  intersect: "intersect" as VerbName, // recognized so it doesn't read as "unknown"; apply.ts may not handle yet
  // transforms
  move: "move", shift: "move", slide: "move", nudge: "move",
  rotate: "rotate", turn: "rotate", spin: "rotate", swivel: "rotate", tip: "rotate",
  scale: "scale", resize: "scale", grow: "scale", shrink: "scale", bigger: "scale", smaller: "scale",
};

/** synonym → canonical shape (the noun being created/cut) */
export const SHAPE_SYNONYMS: Record<string, Shape> = {
  box: "box", cube: "box", block: "box", brick: "box",
  sphere: "sphere", ball: "sphere", orb: "sphere", dome: "sphere",
  cylinder: "cylinder", rod: "cylinder", pipe: "cylinder", tube: "cylinder", post: "cylinder", peg: "cylinder", pin: "cylinder",
};

/** the word "hole" carries its own default shape regardless of verb match order */
export const HOLE_WORDS = new Set(["hole", "drill", "bore"]);

/**
 * Special-object library names (00_PROJECT_BRIEF §4). A library noun ("rabbit")
 * is its own thing: it resolves to the `spawn` verb (place a ready-made object),
 * not to `add` (a bare primitive). Synonyms let "bunny" find the rabbit.
 */
export const LIBRARY_SYNONYMS: Record<string, string> = {
  rabbit: "rabbit", bunny: "rabbit", hare: "rabbit",
  snowman: "snowman",
  rocket: "rocket", spaceship: "rocket", ship: "rocket",
  robot: "robot", bot: "robot", droid: "robot",
};

/**
 * Colour word → canonical palette name (see palette.ts). Used two ways: on a
 * create verb it paints the new object ("add a red cube"); on a verb acting on
 * an existing object it names the TARGET ("move the green cube up").
 */
export const COLOR_WORDS: Record<string, string> = {
  red: "red", orange: "orange", yellow: "yellow", green: "green", blue: "blue",
  purple: "purple", violet: "purple", pink: "pink", brown: "brown",
  white: "white", grey: "grey", gray: "grey", black: "black",
  silver: "grey", gold: "yellow",
};

/** direction word → canonical (world axes anchored to the orientation-cube faces) */
export const DIRECTION_SYNONYMS: Record<string, string> = {
  up: "up", down: "down",
  right: "right", left: "left",
  forward: "forward", front: "forward", fwd: "forward",
  back: "back", backward: "back", backwards: "back",
};

/** axis letters for rotate */
export const AXIS_WORDS = new Set(["x", "y", "z"]);

/**
 * Composition / reasoning signals (session-state item 14, trigger 3): words that
 * mean the request needs GENERATION (quantities, spacing, patterns) a lexicon
 * can't do. Their presence forces an escalation even if a verb was recognized.
 */
export const COMPOSITION_WORDS = new Set([
  "evenly", "spaced", "spacing", "around", "pattern", "grid", "array",
  "each", "every", "all", "corner", "corners", "edge", "edges", "between",
  "row", "rows", "column", "columns", "symmetric", "mirror", "mirrored",
]);

/** number words so "four holes" trips the plural-count composition trigger */
export const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
};

/** strip a leading article/filler so "a cube"/"the hole" tokenize cleanly */
export const STOPWORDS = new Set(["a", "an", "the", "of", "from", "out", "in", "to", "into", "on", "onto", "it", "this", "that", "by", "with", "please"]);
