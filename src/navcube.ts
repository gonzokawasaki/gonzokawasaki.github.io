// ---------------------------------------------------------------------------
// The rotating orientation cube (the centerpiece nav gizmo). A small camera in
// a corner viewport renders six labeled, pickable faces on their own layer.
// The cube camera mirrors the main camera's orbit, so the cube turns as you do;
// clicking a face snaps the main camera to that view (shared mapping in nav.ts).
// ---------------------------------------------------------------------------
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Viewport } from "@babylonjs/core/Maths/math.viewport";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import "@babylonjs/core/Rendering/edgesRenderer"; // side-effect: adds Mesh.enableEdgesRendering
import type { Nav } from "./nav";
import type { Vec3 } from "./optree";

export const CUBE_LAYER = 0x20000000;

interface Face {
  label: string;
  normal: Vec3;
  color: string;
  pos: [number, number, number];
  rot: [number, number, number];
}

const FACES: Face[] = [
  { label: "FRONT",  normal: [0, 0, 1],  color: "#3d6fe0", pos: [0, 0, 0.5],  rot: [0, 0, 0] },
  { label: "BACK",   normal: [0, 0, -1], color: "#2f57b0", pos: [0, 0, -0.5], rot: [0, Math.PI, 0] },
  { label: "RIGHT",  normal: [1, 0, 0],  color: "#e07a3d", pos: [0.5, 0, 0],  rot: [0, Math.PI / 2, 0] },
  { label: "LEFT",   normal: [-1, 0, 0], color: "#b05f2f", pos: [-0.5, 0, 0], rot: [0, -Math.PI / 2, 0] },
  { label: "TOP",    normal: [0, 1, 0],  color: "#4fa84f", pos: [0, 0.5, 0],  rot: [-Math.PI / 2, 0, 0] },
  { label: "BOTTOM", normal: [0, -1, 0], color: "#3a803a", pos: [0, -0.5, 0], rot: [Math.PI / 2, 0, 0] },
];

export class NavCube {
  cam: ArcRotateCamera;
  private planes: Mesh[] = [];

  constructor(private scene: Scene, private mainCam: ArcRotateCamera, private nav: Nav) {
    this.cam = new ArcRotateCamera("cubeCam", mainCam.alpha, mainCam.beta, 3.4, Vector3.Zero(), scene);
    this.cam.layerMask = CUBE_LAYER;
    this.cam.viewport = new Viewport(0.865, 0.82, 0.125, 0.18); // top-right corner (smaller)
    this.cam.inputs.clear(); // cube camera is not user-controllable

    for (const f of FACES) {
      const p = MeshBuilder.CreatePlane(`cube_${f.label}`, { size: 1 }, this.scene);
      p.position.set(...f.pos);
      p.rotation.set(...f.rot);
      p.layerMask = CUBE_LAYER;
      p.material = this.faceMat(f.label);
      p.metadata = { cubeNormal: f.normal };
      // strong crisp black edges via Babylon's edge renderer (anti-aliased lines)
      // instead of a texture-painted border, which minifies/aliases at this size.
      p.enableEdgesRendering();
      p.edgesWidth = 5.0;
      p.edgesColor = new Color4(0, 0, 0, 1);
      this.planes.push(p);
    }
  }

  /** mirror the main camera each frame so the cube reflects current orientation */
  update() {
    this.cam.alpha = this.mainCam.alpha;
    this.cam.beta = this.mainCam.beta;
  }

  /** returns true if (x,y) px is inside the cube corner (and snaps view if a face was hit) */
  tryPick(x: number, y: number, w: number, h: number): boolean {
    const vp = this.cam.viewport;
    const left = vp.x * w, right = (vp.x + vp.width) * w;
    const top = (1 - (vp.y + vp.height)) * h, bottom = (1 - vp.y) * h;
    if (x < left || x > right || y < top || y > bottom) return false;

    const pick = this.scene.pick(x, y, (m) => !!m.metadata?.cubeNormal, false, this.cam);
    if (pick?.hit && pick.pickedMesh?.metadata?.cubeNormal) {
      this.nav.animateToNormal(pick.pickedMesh.metadata.cubeNormal as Vec3);
    }
    return true; // swallow clicks anywhere in the cube region
  }

  // Clean gizmo face: plain WHITE fill + a GREY label, painted into the texture
  // (zero render overhead). The face BORDER is intentionally NOT painted here —
  // it's drawn by the geometric edges renderer (strong, anti-aliased black) so
  // it stays crisp at the cube's small viewport size instead of a texture-baked
  // border that minifies/aliases ("unfeathered"). Self-lit (emissive +
  // disableLighting) so it renders flat/unlit and stays crisp at any orbit.
  private faceMat(label: string): StandardMaterial {
    const S = 128;
    const tex = new DynamicTexture(`tex_${label}`, { width: S, height: S }, this.scene, false);
    const ctx = tex.getContext() as any;

    // plain white face (no painted border — the edges renderer draws the frame)
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, S, S);

    // The plane's textured side faces the cube interior, so from outside we see
    // it through the back — which mirrors the glyphs left↔right. Pre-flip the
    // text horizontally here so it reads correctly on the visible (outer) face.
    ctx.save();
    ctx.translate(S, 0);
    ctx.scale(-1, 1);
    ctx.fillStyle = "#6b7079"; // grey label
    ctx.font = "bold 22px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, S / 2, S / 2);
    ctx.restore();
    tex.update();

    const mat = new StandardMaterial(`cubemat_${label}`, this.scene);
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;          // self-lit by the texture …
    mat.disableLighting = true;         // … so it renders flat (unlit), like a clean gizmo
    mat.specularColor = new Color3(0, 0, 0);
    mat.backFaceCulling = false;
    return mat;
  }
}
