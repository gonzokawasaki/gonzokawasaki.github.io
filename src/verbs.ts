// ---------------------------------------------------------------------------
// The verb schema — THE one definition that every consumer reads (spec §6: the
// parser, the chip UI, and later the AI validator + paste-bridge note all share
// this). Each verb is a THIN surface verb; each param carries the metadata the
// spec asks for: type · ui · required · default · ambiguity. The resolver fills
// these slots, the chips render+edit themselves from them, and apply.ts maps the
// thin verb onto a FAT op-tree node (the thin→fat bridge, all deterministic).
// ---------------------------------------------------------------------------
import { COLOR_OPTIONS } from "./palette";
import { LIBRARY_NAMES } from "./library";

export type ParamType = "enum" | "number" | "direction";
export type ParamUI = "picker" | "slider";
/** how the resolver should handle a missing/uncertain slot (spec §4) */
export type Ambiguity = "none" | "discrete" | "spatial";

export interface ParamSpec {
  key: string;
  label: string;
  type: ParamType;
  ui: ParamUI;
  required: boolean;
  default: number | string;
  ambiguity: Ambiguity;
  // enum / direction
  options?: string[];
  // number
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** discrete suggestion chips for a number (e.g. rotate 15 · 45 · 90) */
  suggest?: number[];
}

export interface VerbSpec {
  name: string;
  /** kid-facing one-liner, shown under the chips */
  summary: string;
  /** geometry verb → re-bakes via CSG2; transform verb → cheap, no re-bake */
  rebakes: boolean;
  /** needs a selected object (the "noun") to act on */
  needsSelection: boolean;
  params: ParamSpec[];
}

// Shapes available to add/cut. A "hole" defaults to a cylinder.
export const SHAPES = ["box", "sphere", "cylinder"] as const;
export type Shape = (typeof SHAPES)[number];

export const VERBS: Record<string, VerbSpec> = {
  add: {
    name: "add",
    summary: "make a new shape on the grid",
    rebakes: true,
    needsSelection: false,
    params: [
      { key: "shape", label: "shape", type: "enum", ui: "picker", required: true, default: "box", ambiguity: "none", options: [...SHAPES] },
      { key: "size", label: "size", type: "number", ui: "slider", required: false, default: 20, ambiguity: "none", min: 4, max: 60, step: 1, unit: "mm" },
      { key: "color", label: "color", type: "enum", ui: "picker", required: false, default: "auto", ambiguity: "none", options: COLOR_OPTIONS },
    ],
  },
  spawn: {
    name: "spawn",
    summary: "drop in a ready-made object (built from primitives)",
    rebakes: true,
    needsSelection: false,
    params: [
      { key: "object", label: "object", type: "enum", ui: "picker", required: true, default: "rabbit", ambiguity: "none", options: [...LIBRARY_NAMES] },
      { key: "color", label: "color", type: "enum", ui: "picker", required: false, default: "auto", ambiguity: "none", options: COLOR_OPTIONS },
    ],
  },
  subtract: {
    name: "subtract",
    summary: "cut a shape out of the selected object",
    rebakes: true,
    needsSelection: true,
    params: [
      { key: "shape", label: "shape", type: "enum", ui: "picker", required: true, default: "cylinder", ambiguity: "none", options: [...SHAPES] },
      { key: "radius", label: "radius", type: "number", ui: "slider", required: false, default: 4, ambiguity: "none", min: 1, max: 20, step: 0.5, unit: "mm" },
    ],
  },
  union: {
    name: "union",
    summary: "join a shape onto the selected object",
    rebakes: true,
    needsSelection: true,
    params: [
      { key: "shape", label: "shape", type: "enum", ui: "picker", required: true, default: "box", ambiguity: "none", options: [...SHAPES] },
      { key: "size", label: "size", type: "number", ui: "slider", required: false, default: 12, ambiguity: "none", min: 4, max: 40, step: 0.5, unit: "mm" },
    ],
  },
  move: {
    name: "move",
    summary: "slide the object along a direction",
    rebakes: false,
    needsSelection: true,
    params: [
      { key: "direction", label: "direction", type: "direction", ui: "picker", required: true, default: "up", ambiguity: "spatial", options: ["up", "down", "left", "right", "forward", "back"] },
      { key: "distance", label: "distance", type: "number", ui: "slider", required: false, default: 5, ambiguity: "none", min: -40, max: 40, step: 0.5, unit: "mm" },
    ],
  },
  rotate: {
    name: "rotate",
    summary: "turn the object around an axis",
    rebakes: false,
    needsSelection: true,
    params: [
      { key: "angle", label: "angle", type: "number", ui: "slider", required: false, default: 45, ambiguity: "discrete", min: -180, max: 180, step: 5, unit: "°", suggest: [15, 45, 90] },
      { key: "axis", label: "axis", type: "direction", ui: "picker", required: false, default: "y", ambiguity: "spatial", options: ["x", "y", "z"] },
    ],
  },
  scale: {
    name: "scale",
    summary: "grow or shrink the object",
    rebakes: false,
    needsSelection: true,
    params: [
      { key: "factor", label: "factor", type: "number", ui: "slider", required: false, default: 1.5, ambiguity: "none", min: 0.2, max: 3, step: 0.05, unit: "×" },
    ],
  },
};

export type VerbName = keyof typeof VERBS;

/** A resolved thin verb call — THE commit artifact (shown as chips, fed to apply.ts). */
export interface ResolvedVerb {
  verb: VerbName;
  /** param key → value, typed per the verb's ParamSpec */
  params: Record<string, number | string>;
}

/** fill any params the resolver didn't set with their schema defaults */
export function withDefaults(verb: VerbName, params: Record<string, number | string>): ResolvedVerb {
  const spec = VERBS[verb];
  const filled: Record<string, number | string> = {};
  for (const p of spec.params) filled[p.key] = params[p.key] ?? p.default;
  return { verb, params: filled };
}
