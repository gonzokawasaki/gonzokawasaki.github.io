// ---------------------------------------------------------------------------
// Click-select + highlight. The "noun" half of point-and-speak: clicking an
// object makes it the active reference. Picks only tagged object meshes.
// ---------------------------------------------------------------------------
import { HighlightLayer } from "@babylonjs/core/Layers/highlightLayer";
import "@babylonjs/core/Layers/effectLayerSceneComponent"; // side-effect: registers the layer's scene component (HighlightLayer throws without it)
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { SceneModel, SceneObject } from "./scene-model";

export class Selection {
  private hl: HighlightLayer;
  current: SceneObject | null = null;
  onChange: (obj: SceneObject | null) => void = () => {};

  constructor(private scene: Scene, private model: SceneModel, mainCam?: Camera) {
    this.hl = new HighlightLayer("hl", scene, mainCam ? ({ camera: mainCam } as any) : undefined);
  }

  select(obj: SceneObject | null) {
    this.hl.removeAllMeshes();
    this.current = obj;
    if (obj?.mesh) this.hl.addMesh(obj.mesh as Mesh, Color3.FromHexString("#ffcc33"));
    this.onChange(obj);
  }

  pickAt(x: number, y: number, cam: Camera): SceneObject | null {
    const pick = this.scene.pick(x, y, (m) => !!m.metadata?.objId, false, cam);
    if (pick?.hit && pick.pickedMesh) {
      const obj = this.model.find(pick.pickedMesh.metadata.objId);
      if (obj) {
        this.select(obj);
        return obj;
      }
    }
    this.select(null);
    return null;
  }

  /** re-apply highlight after a rebake replaced the mesh */
  refresh() {
    if (this.current) this.select(this.current);
  }
}
