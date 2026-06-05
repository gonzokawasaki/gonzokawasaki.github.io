// ---------------------------------------------------------------------------
// Scene backdrop: the 3D window is a plain white clearColor (set in main.ts) —
// no sky gradient. The only floor is a see-through blue line grid on the y=0
// plane. Core-only (no @babylonjs/materials dep) and tagged to the MAIN camera
// layer so it never bleeds into the orientation-cube viewport.
// ---------------------------------------------------------------------------
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import "@babylonjs/core/Meshes/Builders/linesBuilder"; // side-effect: registers CreateLineSystem
import type { Scene } from "@babylonjs/core/scene";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";

// default ArcRotateCamera layerMask; excludes the nav-cube cam (0x20000000)
const MAIN_LAYER = 0x0fffffff;

/** Plain uniform square grid on the y=0 plane — blue lines on the white window. */
export function addGrid(
  scene: Scene,
  { half = 150, step = 10 }: { half?: number; step?: number } = {},
): LinesMesh {
  const lines: Vector3[][] = [];
  for (let c = -half; c <= half; c += step) {
    lines.push([new Vector3(-half, 0, c), new Vector3(half, 0, c)]); // parallel to X
    lines.push([new Vector3(c, 0, -half), new Vector3(c, 0, half)]); // parallel to Z
  }

  const grid = MeshBuilder.CreateLineSystem("grid", { lines }, scene);
  grid.color = new Color3(0.0, 0.345, 0.745); // CADStudio primary blue (#0058be)
  grid.alpha = 0.32; // soft/airy on the white background
  grid.isPickable = false;
  grid.layerMask = MAIN_LAYER;
  grid.alwaysSelectAsActiveMesh = true; // it spans the scene; skip per-frame culling cost
  return grid;
}
