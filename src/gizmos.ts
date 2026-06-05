// ---------------------------------------------------------------------------
// Direct manipulation (the mouse requirement). Babylon GizmoManager moves the
// SELECTED object's mesh; on drag we read the mesh back into the model
// transform (the truth) and notify. Moving never re-bakes — it's just the
// object's root transform. Gizmos live in their own utility layer, so dragging
// a handle never triggers object picking/deselection.
// ---------------------------------------------------------------------------
import { GizmoManager } from "@babylonjs/core/Gizmos/gizmoManager";
import type { Scene } from "@babylonjs/core/scene";
import type { SceneModel, SceneObject } from "./scene-model";

export type GizmoMode = "select" | "move" | "rotate" | "scale";

export class Gizmos {
  mgr: GizmoManager;
  mode: GizmoMode = "move";
  onEdit: () => void = () => {};
  private target: SceneObject | null = null;

  constructor(scene: Scene, private model: SceneModel) {
    this.mgr = new GizmoManager(scene);
    this.mgr.usePointerToAttachGizmos = false; // attachment is driven by Selection
    this.setMode("move");
  }

  setMode(mode: GizmoMode) {
    this.mode = mode;
    this.mgr.positionGizmoEnabled = mode === "move";
    this.mgr.rotationGizmoEnabled = mode === "rotate";
    this.mgr.scaleGizmoEnabled = mode === "scale";
    this.wire();
  }

  attach(obj: SceneObject | null) {
    this.target = obj;
    this.mgr.attachToMesh(obj?.mesh ?? null);
  }

  private wire() {
    const sync = () => {
      if (this.target) {
        this.model.syncTransformFromMesh(this.target); // mesh → truth
        this.onEdit();
      }
    };
    const g = this.mgr.gizmos;
    for (const gizmo of [g.positionGizmo, g.rotationGizmo, g.scaleGizmo]) {
      if (!gizmo) continue;
      // clear() avoids duplicate handlers when the mode is toggled repeatedly
      gizmo.onDragObservable.clear();
      gizmo.onDragEndObservable.clear();
      gizmo.onDragObservable.add(sync);
      gizmo.onDragEndObservable.add(sync);
    }
  }
}
