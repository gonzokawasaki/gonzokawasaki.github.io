// ---------------------------------------------------------------------------
// The evaluator — the critical glue (Stage 4).
//   evaluate(opTree) → one baked Babylon display mesh.
// THE HARD RULE: this never writes anything back into the op-tree. CSG2 is the
// evaluator, the JSON is the truth. Intermediate primitive meshes are disposed;
// only the final baked mesh survives and is handed to the renderer.
// ---------------------------------------------------------------------------
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CSG2 } from "@babylonjs/core/Meshes/csg2";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { OpNode, PrimitiveNode, TransformNode, BooleanNode } from "./optree";
import { makeRoundedBox } from "./roundedBox";

export interface EvalStats {
  primitives: number;
  csgOps: number;
}

const DEG = Math.PI / 180;

export function evaluate(node: OpNode, scene: Scene, stats: EvalStats): Mesh {
  switch (node.type) {
    case "primitive":
      return makePrimitive(node, scene, stats);
    case "transform":
      return applyTransform(node, scene, stats);
    case "boolean":
      return applyBoolean(node, scene, stats);
    default:
      throw new Error(`unknown node type: ${(node as any).type}`);
  }
}

function makePrimitive(node: PrimitiveNode, scene: Scene, stats: EvalStats): Mesh {
  stats.primitives++;
  const s = node.size;
  switch (node.kind) {
    case "box":
      if (node.cornerRadius && node.cornerRadius > 0) {
        return makeRoundedBox(node.id, s.w!, s.h!, s.d!, node.cornerRadius, scene, stats);
      }
      return MeshBuilder.CreateBox(node.id, { width: s.w!, height: s.h!, depth: s.d! }, scene);
    case "sphere":
      return MeshBuilder.CreateSphere(node.id, { diameter: s.d!, segments: 24 }, scene);
    case "cylinder":
      return MeshBuilder.CreateCylinder(node.id, { diameter: s.d!, height: s.h!, tessellation: 32 }, scene);
    default:
      throw new Error(`unknown primitive kind: ${(node as any).kind}`);
  }
}

function applyTransform(node: TransformNode, scene: Scene, stats: EvalStats): Mesh {
  const mesh = evaluate(node.child, scene, stats);
  if (node.translate) mesh.position = new Vector3(...node.translate);
  if (node.rotateDeg) mesh.rotation = new Vector3(node.rotateDeg[0] * DEG, node.rotateDeg[1] * DEG, node.rotateDeg[2] * DEG);
  if (node.scale) mesh.scaling = new Vector3(...node.scale);
  mesh.computeWorldMatrix(true); // baked into CSG2 via the world matrix
  return mesh;
}

function applyBoolean(node: BooleanNode, scene: Scene, stats: EvalStats): Mesh {
  const meshA = evaluate(node.a, scene, stats);
  const meshB = evaluate(node.b, scene, stats);
  meshA.computeWorldMatrix(true);
  meshB.computeWorldMatrix(true);

  const csgA = CSG2.FromMesh(meshA);
  const csgB = CSG2.FromMesh(meshB);
  const result =
    node.mode === "subtract" ? csgA.subtract(csgB)
    : node.mode === "union" ? csgA.add(csgB)
    : csgA.intersect(csgB);
  stats.csgOps++;

  const out = result.toMesh(node.id, scene);

  // dispose every intermediate — only `out` survives
  csgA.dispose();
  csgB.dispose();
  result.dispose();
  meshA.dispose();
  meshB.dispose();
  return out;
}
