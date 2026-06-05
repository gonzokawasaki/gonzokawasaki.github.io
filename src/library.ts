// ---------------------------------------------------------------------------
// The special-object library — "predefined shapes" authored as op-tree subtrees
// of PRIMITIVES + BOOLEANS, exactly as the brief decided (00_PROJECT_BRIEF §4):
// a library shape IS a brush, not a baked GLB import. Each builder returns a
// plain OpNode the evaluator already understands (box/sphere/cylinder + transform
// + union), so a rabbit is "just" a union of spheres and cylinders — robust
// (Manifold welds it watertight), parametric, AI-legible, and on-thesis
// (complexity = composition). GLB import stays the escape hatch, not the default.
// ---------------------------------------------------------------------------
import type { OpNode, PrimitiveNode, TransformNode, Vec3 } from "./optree";
import type { RGB } from "./palette";

// --- tiny authoring helpers -------------------------------------------------
const sphere = (id: string, d: number): PrimitiveNode => ({ type: "primitive", id, kind: "sphere", size: { d } });
const cyl = (id: string, d: number, h: number): PrimitiveNode => ({ type: "primitive", id, kind: "cylinder", size: { d, h } });
const box = (id: string, w: number, h: number, d: number): PrimitiveNode => ({ type: "primitive", id, kind: "box", size: { w, h, d } });

/** wrap a node in a transform (any of translate / rotateDeg / scale) */
function place(id: string, child: OpNode, translate?: Vec3, rotateDeg?: Vec3, scale?: Vec3): TransformNode {
  return { type: "transform", id, ...(translate ? { translate } : {}), ...(rotateDeg ? { rotateDeg } : {}), ...(scale ? { scale } : {}), child };
}

/** fold a list of parts into a single union tree (a brush sub-tree) */
function unionAll(id: string, parts: OpNode[]): OpNode {
  return parts.reduce((acc, p, i) => (acc ? ({ type: "boolean", id: `${id}.u${i}`, mode: "union", a: acc, b: p } as OpNode) : p));
}

// --- the objects ------------------------------------------------------------

/** a rabbit: ellipsoid body + head, two tall ears, a tail and two flat feet */
function rabbit(): OpNode {
  return unionAll("rabbit", [
    place("rb.body", sphere("rb.body0", 22), [0, 13, 0], undefined, [1, 1.1, 1.25]),
    place("rb.head", sphere("rb.head0", 15), [0, 26, 8]),
    place("rb.earL", cyl("rb.earL0", 5, 18), [-4, 36, 7], [10, 0, 14]),
    place("rb.earR", cyl("rb.earR0", 5, 18), [4, 36, 7], [10, 0, -14]),
    place("rb.tail", sphere("rb.tail0", 8), [0, 12, -13]),
    place("rb.footL", sphere("rb.footL0", 9), [-6, 3, 11], undefined, [1.3, 0.55, 1.7]),
    place("rb.footR", sphere("rb.footR0", 9), [6, 3, 11], undefined, [1.3, 0.55, 1.7]),
  ]);
}

/** a snowman: three stacked spheres + a carrot nose (a horizontal cylinder) */
function snowman(): OpNode {
  return unionAll("snowman", [
    place("sm.base", sphere("sm.base0", 26), [0, 13, 0]),
    place("sm.mid", sphere("sm.mid0", 19), [0, 32, 0]),
    place("sm.head", sphere("sm.head0", 14), [0, 47, 0]),
    place("sm.nose", cyl("sm.nose0", 3.5, 9), [0, 47, 8], [90, 0, 0]),
  ]);
}

/** a rocket: cylinder body, a dome nose (squashed sphere) and four fins */
function rocket(): OpNode {
  const fin = (id: string, x: number, z: number): OpNode => place(id, box(`${id}0`, 3, 12, 11), [x, 6, z]);
  return unionAll("rocket", [
    place("rk.body", cyl("rk.body0", 14, 32), [0, 18, 0]),
    place("rk.nose", sphere("rk.nose0", 14), [0, 34, 0], undefined, [1, 1.4, 1]),
    fin("rk.finR", 8, 0),
    fin("rk.finL", -8, 0),
    place("rk.finF", box("rk.finF0", 11, 12, 3), [0, 6, 8]),
    place("rk.finB", box("rk.finB0", 11, 12, 3), [0, 6, -8]),
  ]);
}

/** a robot: box torso + head, cylinder arms and legs */
function robot(): OpNode {
  return unionAll("robot", [
    place("ro.body", box("ro.body0", 18, 22, 11), [0, 23, 0]),
    place("ro.head", box("ro.head0", 13, 11, 11), [0, 39, 0]),
    place("ro.armR", cyl("ro.armR0", 5, 16), [12, 24, 0], [0, 0, 90]),
    place("ro.armL", cyl("ro.armL0", 5, 16), [-12, 24, 0], [0, 0, 90]),
    place("ro.legR", cyl("ro.legR0", 6, 14), [5, 7, 0]),
    place("ro.legL", cyl("ro.legL0", 6, 14), [-5, 7, 0]),
  ]);
}

export interface LibraryDef {
  name: string;
  glyph: string; // shown on the Shape Library tile
  defaultColor: RGB; // used when the kid doesn't name a colour
  build: () => OpNode;
}

/** the registry — one entry per special object */
export const LIBRARY: Record<string, LibraryDef> = {
  rabbit: { name: "rabbit", glyph: "🐰", defaultColor: [0.92, 0.92, 0.94], build: rabbit },
  snowman: { name: "snowman", glyph: "⛄", defaultColor: [0.95, 0.96, 0.98], build: snowman },
  rocket: { name: "rocket", glyph: "🚀", defaultColor: [0.85, 0.25, 0.25], build: rocket },
  robot: { name: "robot", glyph: "🤖", defaultColor: [0.6, 0.6, 0.62], build: robot },
};

export const LIBRARY_NAMES = Object.keys(LIBRARY);

/** build a fresh op-tree subtree for a named library object (throws if unknown) */
export function buildLibrary(name: string): OpNode {
  const def = LIBRARY[name];
  if (!def) throw new Error(`unknown library object: ${name}`);
  return def.build();
}
