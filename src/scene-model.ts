// ---------------------------------------------------------------------------
// The scene model — THE source of truth for Prototype 2.
// The scene is a LIST of top-level objects. Each object = { root transform +
// geometry subtree }. Geometry is baked once (CSG2); the root transform is
// applied to that baked mesh, so moving/rotating/scaling an object NEVER
// re-bakes — only changing its geometry (radius, cornerRadius, …) does.
// Gizmo, slider, and text all edit object.transform (truth); the mesh is derived.
// ---------------------------------------------------------------------------
import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { evaluate, type EvalStats } from "./evaluator";
import type { OpNode, Vec3 } from "./optree";

const DEG = Math.PI / 180;
export const OBJ_LAYER = 0x0fffffff; // main-scene objects (default mask)

export interface ObjTransform {
  translate: Vec3;
  rotateDeg: Vec3;
  scale: Vec3;
}

export interface SceneObject {
  id: string;
  transform: ObjTransform;
  tree: OpNode; // geometry subtree — source of truth for shape
  color: Vec3;
  /** friendly noun for language reference ("box" | "sphere" | "rabbit" …) */
  kind?: string;
  mesh?: Mesh; // derived (baked); never truth
}

export class SceneModel {
  objects: SceneObject[] = [];
  constructor(private scene: Scene) {}

  add(obj: SceneObject) {
    this.objects.push(obj);
    this.bake(obj);
  }

  find(id: string): SceneObject | undefined {
    return this.objects.find((o) => o.id === id);
  }

  /** remove an object and dispose its baked mesh (used to undo a create) */
  remove(obj: SceneObject) {
    obj.mesh?.dispose();
    obj.mesh = undefined;
    const i = this.objects.indexOf(obj);
    if (i >= 0) this.objects.splice(i, 1);
  }

  /** geometry subtree → baked mesh (CSG2), tagged + transformed */
  bake(obj: SceneObject): EvalStats {
    if (obj.mesh) {
      obj.mesh.dispose();
      obj.mesh = undefined;
    }
    const stats: EvalStats = { primitives: 0, csgOps: 0 };
    const mesh = evaluate(obj.tree, this.scene, stats);
    mesh.id = obj.id;
    mesh.metadata = { objId: obj.id };

    const mat = new StandardMaterial(`mat_${obj.id}`, this.scene);
    mat.diffuseColor = new Color3(...obj.color);
    mat.specularColor = new Color3(0.2, 0.2, 0.2);
    mesh.material = mat;

    obj.mesh = mesh;
    this.applyTransform(obj);
    return stats;
  }

  /** model transform → baked mesh (cheap; no CSG) */
  applyTransform(obj: SceneObject) {
    const m = obj.mesh;
    if (!m) return;
    const t = obj.transform;
    m.position.copyFromFloats(...t.translate);
    if (!m.rotationQuaternion) m.rotationQuaternion = new Quaternion();
    Quaternion.FromEulerAnglesToRef(t.rotateDeg[0] * DEG, t.rotateDeg[1] * DEG, t.rotateDeg[2] * DEG, m.rotationQuaternion);
    m.scaling.copyFromFloats(...t.scale);
  }

  /**
   * Placement convention: seat the object so the lowest point of its baked
   * geometry rests on the y=0 grid. We don't hand-derive "the bottom" — we ask
   * Babylon for the mesh's world-space bounding box (which already accounts for
   * the current rotation/scale and any carved holes/bevels) and lift the object
   * by however far its minimum dips below 0. One-time placement, not a constant
   * clamp — so `move up 5` / a gizmo drag can still lift it off the floor after.
   */
  seatOnGround(obj: SceneObject) {
    const m = obj.mesh;
    if (!m) return;
    m.computeWorldMatrix(true); // refresh boundingBox.minimumWorld for the current transform
    const minY = m.getBoundingInfo().boundingBox.minimumWorld.y;
    const t = obj.transform;
    t.translate = [t.translate[0], round(t.translate[1] - minY), t.translate[2]];
    this.applyTransform(obj);
  }

  /** baked mesh (after a gizmo drag) → model transform (truth) */
  syncTransformFromMesh(obj: SceneObject) {
    const m = obj.mesh;
    if (!m) return;
    const t = obj.transform;
    t.translate = [round(m.position.x), round(m.position.y), round(m.position.z)];
    const q = m.rotationQuaternion ?? Quaternion.FromEulerVector(m.rotation);
    const e = q.toEulerAngles();
    t.rotateDeg = [round(e.x / DEG), round(e.y / DEG), round(e.z / DEG)];
    t.scale = [round(m.scaling.x), round(m.scaling.y), round(m.scaling.z)];
  }

  /** plain object for the live JSON panel (truth only — no derived mesh) */
  toJSON() {
    return {
      scene: this.objects.map((o) => ({ id: o.id, transform: o.transform, tree: o.tree })),
    };
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// --- convenience builders for the seed scene --------------------------------
export const identity = (): ObjTransform => ({ translate: [0, 0, 0], rotateDeg: [0, 0, 0], scale: [1, 1, 1] });
export const at = (x: number, y: number, z: number): ObjTransform => ({ translate: [x, y, z], rotateDeg: [0, 0, 0], scale: [1, 1, 1] });
