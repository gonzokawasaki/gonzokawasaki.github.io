// ---------------------------------------------------------------------------
// cornerRadius cost probe (Stage 6 / 00_PROJECT_BRIEF §5).
// A rounded box = Minkowski sum of a box and a sphere, built as the union of:
//   3 overlapping boxes (core + 6 face slabs) + 12 edge cylinders + 8 corner spheres
// = 23 primitives, 22 unions. We measure that cost via stats.csgOps.
// It yields an EXACT constant-radius round, and only works because a parametric
// box knows where its edges are (does NOT generalize to arbitrary boolean output).
// ---------------------------------------------------------------------------
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { CSG2 } from "@babylonjs/core/Meshes/csg2";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { EvalStats } from "./evaluator";

export function makeRoundedBox(
  id: string, w: number, h: number, d: number, r: number, scene: Scene, stats: EvalStats,
): Mesh {
  r = Math.min(r, w / 2, h / 2, d / 2);
  if (r <= 0) return MeshBuilder.CreateBox(id, { width: w, height: h, depth: d }, scene);

  const parts: Mesh[] = [];
  const ix = w / 2 - r, iy = h / 2 - r, iz = d / 2 - r;

  // 3 boxes: core + the 6 face slabs
  parts.push(MeshBuilder.CreateBox(id + "_bx", { width: w, height: h - 2 * r, depth: d - 2 * r }, scene));
  parts.push(MeshBuilder.CreateBox(id + "_by", { width: w - 2 * r, height: h, depth: d - 2 * r }, scene));
  parts.push(MeshBuilder.CreateBox(id + "_bz", { width: w - 2 * r, height: h - 2 * r, depth: d }, scene));

  // 8 corner spheres
  for (const sx of [-ix, ix]) for (const sy of [-iy, iy]) for (const sz of [-iz, iz]) {
    const s = MeshBuilder.CreateSphere(id + "_s", { diameter: 2 * r, segments: 16 }, scene);
    s.position.set(sx, sy, sz);
    parts.push(s);
  }

  // 12 edge cylinders (4 along each axis). Babylon cylinders are Y-aligned by default.
  for (const cx of [-ix, ix]) for (const cz of [-iz, iz]) {            // along Y
    const c = MeshBuilder.CreateCylinder(id + "_cy", { diameter: 2 * r, height: h - 2 * r, tessellation: 16 }, scene);
    c.position.set(cx, 0, cz);
    parts.push(c);
  }
  for (const cy of [-iy, iy]) for (const cz of [-iz, iz]) {            // along X
    const c = MeshBuilder.CreateCylinder(id + "_cx", { diameter: 2 * r, height: w - 2 * r, tessellation: 16 }, scene);
    c.rotation.z = Math.PI / 2;
    c.position.set(0, cy, cz);
    parts.push(c);
  }
  for (const cx of [-ix, ix]) for (const cy of [-iy, iy]) {            // along Z
    const c = MeshBuilder.CreateCylinder(id + "_cz", { diameter: 2 * r, height: d - 2 * r, tessellation: 16 }, scene);
    c.rotation.x = Math.PI / 2;
    c.position.set(cx, cy, 0);
    parts.push(c);
  }

  // Union all 23 pieces.
  parts.forEach((p) => p.computeWorldMatrix(true));
  let acc = CSG2.FromMesh(parts[0]);
  for (let i = 1; i < parts.length; i++) {
    const next = CSG2.FromMesh(parts[i]);
    const merged = acc.add(next);
    stats.csgOps++;
    acc.dispose();
    next.dispose();
    acc = merged;
  }
  const mesh = acc.toMesh(id, scene);
  acc.dispose();
  parts.forEach((p) => p.dispose());
  return mesh;
}
