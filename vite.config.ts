import { defineConfig } from "vite";

// manifold-3d is an Emscripten module; let it load its own .wasm instead of
// having esbuild pre-bundle it (which mangles the wasm loader).
export default defineConfig({
  optimizeDeps: { exclude: ["manifold-3d"] },
});
