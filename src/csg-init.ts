// ---------------------------------------------------------------------------
// Initialize Babylon CSG2 with a LOCALLY-served Manifold wasm (offline-safe).
// Babylon's default fetches manifold from unpkg at runtime; we instead load the
// installed manifold-3d package and hand Babylon the Manifold + Mesh classes,
// so the prototype works with no internet (matches the project's offline ethos).
// ---------------------------------------------------------------------------
import { InitializeCSG2Async } from "@babylonjs/core/Meshes/csg2";
import Module from "manifold-3d";
import manifoldWasmUrl from "manifold-3d/manifold.wasm?url";

export async function initCSG(): Promise<void> {
  // Emscripten module factory; locateFile points it at the Vite-served wasm.
  const wasm: any = await (Module as any)({ locateFile: () => manifoldWasmUrl });
  wasm.setup();
  await InitializeCSG2Async({
    manifoldInstance: wasm.Manifold,
    manifoldMeshInstance: wasm.Mesh,
  });
}
