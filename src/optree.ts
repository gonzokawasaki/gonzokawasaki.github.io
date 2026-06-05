// ---------------------------------------------------------------------------
// The op-tree — THE source of truth (Prototype 1 minimal subset).
// Three fat node types cover the three verbs this slice exercises:
//   primitive (add) · boolean (union/subtract/intersect) · transform (move/rotate/scale)
// Stable ids (box.1, hole.1) so any node is addressable — exactly what the
// resolver/chips/AI will bind to later. See 03_VERB_LIST.md.
// ---------------------------------------------------------------------------

export type Vec3 = [number, number, number];

export interface PrimitiveNode {
  type: "primitive";
  id: string;
  kind: "box" | "sphere" | "cylinder";
  /** per-kind dims: box uses w/h/d, sphere uses d, cylinder uses d+h */
  size: { w?: number; h?: number; d?: number };
  /** box only — the parametric rounded-corner cheat (Minkowski box+sphere) */
  cornerRadius?: number;
}

export interface TransformNode {
  type: "transform";
  id: string;
  /** which thin verb wrote this node (provenance/legibility); evaluator applies all set fields */
  op?: "move" | "rotate" | "scale";
  translate?: Vec3;
  rotateDeg?: Vec3;
  scale?: Vec3;
  child: OpNode;
}

export interface BooleanNode {
  type: "boolean";
  id: string;
  mode: "union" | "subtract" | "intersect";
  a: OpNode;
  b: OpNode;
}

export type OpNode = PrimitiveNode | TransformNode | BooleanNode;

// --- Hand-authored example trees (Stage 3 / Stage 5 / Stage 6) ---------------

const box = (id: string, w: number, h: number, d: number, cornerRadius?: number): PrimitiveNode => ({
  type: "primitive", id, kind: "box", size: { w, h, d }, ...(cornerRadius ? { cornerRadius } : {}),
});

const holeAt = (id: string, x: number, z: number): TransformNode => ({
  type: "transform", id: `move.${id}`, op: "move", translate: [x, 0, z],
  child: { type: "primitive", id, kind: "cylinder", size: { d: 12, h: 24 } },
});

/** box subtract cylinder — the make-or-break slice */
export const plate1: OpNode = {
  type: "boolean", id: "plate.1", mode: "subtract",
  a: box("box.1", 40, 10, 40),
  b: holeAt("hole.1", 0, 0),
};

/** Stage 5: same plate, a SECOND hole added by editing data alone */
export const plate2: OpNode = {
  type: "boolean", id: "plate.2", mode: "subtract",
  a: {
    type: "boolean", id: "plate.1", mode: "subtract",
    a: box("box.1", 40, 10, 40),
    b: holeAt("hole.1", -10, 0),
  },
  b: holeAt("hole.2", 10, 0),
};

/** Stage 6: the cornerRadius cost probe — same two-hole plate, rounded box */
export const rounded: OpNode = {
  type: "boolean", id: "plate.2r", mode: "subtract",
  a: {
    type: "boolean", id: "plate.1r", mode: "subtract",
    a: box("box.1", 40, 10, 40, 3),
    b: holeAt("hole.1", -10, 0),
  },
  b: holeAt("hole.2", 10, 0),
};

export const presets: Record<string, OpNode> = { plate1, plate2, rounded };
