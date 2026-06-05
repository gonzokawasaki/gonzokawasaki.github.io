// ---------------------------------------------------------------------------
// The thin→fat adapter (spec §6.5) — DETERMINISTIC code, never an LLM. It takes
// a resolved thin verb (the commit artifact) and writes the matching FAT op-tree
// node, then re-bakes (geometry verbs) or re-applies the transform (cheap). This
// is the safety boundary: the resolver/LLM only ever emit thin verbs; this code
// is the only thing that mutates the op-tree.
//
// Each application snapshots a BASE so the op is re-appliable from scratch:
//   - editing a chip param  → re-apply from base (no accumulation)
//   - undo                  → restore base
// That makes "cut a hole, then drag the radius 3→5" a free, instant re-bake with
// no second resolution — the payoff the spec calls out.
// ---------------------------------------------------------------------------
import type { SceneModel, SceneObject, ObjTransform } from "./scene-model";
import { at } from "./scene-model";
import type { OpNode, Vec3 } from "./optree";
import { type ResolvedVerb } from "./verbs";
import { rgbOf } from "./palette";
import { LIBRARY, buildLibrary } from "./library";

const DIR_VEC: Record<string, Vec3> = {
  up: [0, 1, 0], down: [0, -1, 0], right: [1, 0, 0], left: [-1, 0, 0], forward: [0, 0, 1], back: [0, 0, -1],
};
const NEW_COLORS: Vec3[] = [[0.40, 0.55, 0.85], [0.36, 0.66, 0.40], [0.86, 0.52, 0.26], [0.70, 0.45, 0.80]];
let opCounter = 0;

/** the colour a created object should be: a named palette colour, else "auto" cycle */
function pickColor(param: unknown, autoIndex: number, fallback?: Vec3): Vec3 {
  const name = param == null ? "auto" : String(param);
  if (name !== "auto") {
    const rgb = rgbOf(name);
    if (rgb) return [...rgb];
  }
  return fallback ?? NEW_COLORS[autoIndex % NEW_COLORS.length];
}

export interface AppliedOp {
  verb: ResolvedVerb;
  obj: SceneObject;
  kind: "create" | "geometry" | "transform";
  baseTree?: OpNode; // geometry: object.tree before
  baseTransform?: ObjTransform; // transform: object.transform before
  rebakes: boolean;
}

const clone = <T>(x: T): T => structuredClone(x);

/** the primitive being added/cut, sized from the verb's params and the target bounds */
function shapeNode(id: string, shape: string, magnitude: number, span: { minY: number; maxY: number } | null): OpNode {
  if (shape === "cylinder") {
    // a cylinder cut/add: diameter from the param. If we know the target's vertical
    // span (a cut), make it tall enough to pierce clean through and centre it there.
    const h = span ? (span.maxY - span.minY) + 6 : magnitude * 2;
    const cy = span ? (span.minY + span.maxY) / 2 : 0;
    const cyl: OpNode = { type: "primitive", id, kind: "cylinder", size: { d: magnitude * 2, h } };
    return cy ? { type: "transform", id: `${id}.at`, op: "move", translate: [0, cy, 0], child: cyl } : cyl;
  }
  if (shape === "sphere") return { type: "primitive", id, kind: "sphere", size: { d: magnitude * 2 } };
  return { type: "primitive", id, kind: "box", size: { w: magnitude * 2, h: magnitude * 2, d: magnitude * 2 } };
}

/** local-space vertical extent of the target's baked geometry (for piercing cuts) */
function localSpan(obj: SceneObject): { minY: number; maxY: number } | null {
  const bb = obj.mesh?.getBoundingInfo().boundingBox;
  return bb ? { minY: bb.minimum.y, maxY: bb.maximum.y } : null;
}

/** First commit of a resolved verb. Returns the AppliedOp (so chips/undo can act on it). */
export function applyVerb(verb: ResolvedVerb, model: SceneModel, selection: SceneObject | null): AppliedOp {
  const id = ++opCounter;

  if (verb.verb === "add") {
    const shape = String(verb.params.shape);
    const obj: SceneObject = {
      id: `${shape}.${id}`,
      transform: at(0, 0, 0),
      tree: shapeNode(`${shape}.${id}`, shape, Number(verb.params.size) / 2, null),
      color: pickColor(verb.params.color, id),
      kind: shape,
    };
    model.add(obj);
    model.seatOnGround(obj);
    return { verb, obj, kind: "create", rebakes: true };
  }

  if (verb.verb === "spawn") {
    // a ready-made object: its op-tree is a brush sub-tree of primitives (library.ts)
    const name = String(verb.params.object);
    const def = LIBRARY[name];
    const obj: SceneObject = {
      id: `${name}.${id}`,
      transform: at(0, 0, 0),
      tree: buildLibrary(name),
      color: pickColor(verb.params.color, id, def.defaultColor),
      kind: name,
    };
    model.add(obj);
    model.seatOnGround(obj);
    return { verb, obj, kind: "create", rebakes: true };
  }

  const obj = selection!;
  if (verb.verb === "subtract" || verb.verb === "union") {
    const op: AppliedOp = { verb, obj, kind: "geometry", baseTree: clone(obj.tree), rebakes: true };
    rebuildGeometry(op, model);
    return op;
  }

  // transforms: snapshot, then apply from base (move/rotate are relative; scale sets)
  const op: AppliedOp = { verb, obj, kind: "transform", baseTransform: clone(obj.transform), rebakes: false };
  rebuildTransform(op, model);
  return op;
}

/** Re-apply an op from its base with the verb's CURRENT params (after a chip edit). */
export function reapply(op: AppliedOp, model: SceneModel) {
  if (op.kind === "create") {
    if (op.verb.verb === "spawn") {
      const name = String(op.verb.params.object);
      op.obj.tree = buildLibrary(name);
      op.obj.kind = name;
      op.obj.color = pickColor(op.verb.params.color, 0, LIBRARY[name].defaultColor);
    } else {
      const shape = String(op.verb.params.shape);
      op.obj.tree = shapeNode(op.obj.id, shape, Number(op.verb.params.size) / 2, null);
      op.obj.kind = shape;
      // keep an "auto" colour stable across edits; apply a named colour if chosen
      op.obj.color = pickColor(op.verb.params.color, 0, op.obj.color);
    }
    model.bake(op.obj);
    model.seatOnGround(op.obj);
  } else if (op.kind === "geometry") {
    rebuildGeometry(op, model);
  } else {
    rebuildTransform(op, model);
  }
}

/** Undo an op: restore its base (or remove the created object). */
export function undo(op: AppliedOp, model: SceneModel) {
  if (op.kind === "create") {
    model.remove(op.obj);
  } else if (op.kind === "geometry") {
    op.obj.tree = clone(op.baseTree!);
    model.bake(op.obj);
  } else {
    op.obj.transform = clone(op.baseTransform!);
    model.applyTransform(op.obj);
  }
}

function rebuildGeometry(op: AppliedOp, model: SceneModel) {
  const { verb, obj } = op;
  const base = clone(op.baseTree!);
  const mode = verb.verb === "subtract" ? "subtract" : "union";
  const magnitude = Number(verb.params.radius ?? verb.params.size) ; // half-extent / radius
  const shape = String(verb.params.shape);
  const span = mode === "subtract" ? localSpan(obj) : null;
  const opId = `${mode}.${obj.id}`;
  let b = shapeNode(`${mode}sh.${obj.id}`, shape, magnitude, span);
  if (mode === "union") {
    // sit the added shape on the object's top so it visibly pokes out
    const top = localSpan(obj)?.maxY ?? 0;
    b = { type: "transform", id: `${opId}.at`, op: "move", translate: [0, top, 0], child: b };
  }
  obj.tree = { type: "boolean", id: opId, mode, a: base, b } as OpNode;
  model.bake(obj);
}

function rebuildTransform(op: AppliedOp, model: SceneModel) {
  const { verb, obj } = op;
  const base = clone(op.baseTransform!);
  const t = obj.transform;
  if (verb.verb === "move") {
    const dir = DIR_VEC[String(verb.params.direction)] ?? [0, 0, 0];
    const d = Number(verb.params.distance);
    t.translate = [base.translate[0] + dir[0] * d, base.translate[1] + dir[1] * d, base.translate[2] + dir[2] * d];
  } else if (verb.verb === "rotate") {
    const axis = String(verb.params.axis);
    const i = axis === "x" ? 0 : axis === "z" ? 2 : 1;
    const r: Vec3 = [...base.rotateDeg];
    r[i] = base.rotateDeg[i] + Number(verb.params.angle);
    t.rotateDeg = r;
  } else if (verb.verb === "scale") {
    const f = Number(verb.params.factor);
    t.scale = [f, f, f];
  }
  model.applyTransform(obj);
}
