// ---------------------------------------------------------------------------
// Viewport navigation: Home + named views, animated. The normal→(alpha,beta)
// mapping is shared with the orientation cube so both agree on what "top" means.
// ---------------------------------------------------------------------------
import { Animation } from "@babylonjs/core/Animations/animation";
import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { Vec3 } from "./optree";

/** Babylon ArcRotateCamera: pos = r·(cosα·sinβ, cosβ, sinα·sinβ). Invert that. */
export function viewFromNormal(n: Vec3): [number, number] {
  const [x, y, z] = n;
  const beta = Math.acos(Math.max(-1, Math.min(1, y)));
  const alpha = Math.atan2(z, x);
  return [alpha, clampBeta(beta)];
}

const clampBeta = (b: number) => Math.max(0.001, Math.min(Math.PI - 0.001, b));

export const NAMED_VIEWS: Record<string, Vec3> = {
  front: [0, 0, 1], back: [0, 0, -1],
  right: [1, 0, 0], left: [-1, 0, 0],
  top: [0, 1, 0], bottom: [0, -1, 0],
  iso: [0.577, 0.577, 0.577],
};

export class Nav {
  private home: { alpha: number; beta: number; radius: number };
  constructor(private cam: ArcRotateCamera) {
    this.home = { alpha: cam.alpha, beta: cam.beta, radius: cam.radius };
  }
  goHome() {
    this.animate(this.home.alpha, this.home.beta, this.home.radius);
  }
  view(name: string) {
    const n = NAMED_VIEWS[name];
    if (n) {
      const [a, b] = viewFromNormal(n);
      this.animate(a, b);
    }
  }
  animateToNormal(n: Vec3) {
    const [a, b] = viewFromNormal(n);
    this.animate(a, b);
  }
  animate(alpha: number, beta: number, radius?: number) {
    tween(this.cam, "alpha", this.cam.alpha, nearest(this.cam.alpha, alpha));
    tween(this.cam, "beta", this.cam.beta, beta);
    if (radius !== undefined) tween(this.cam, "radius", this.cam.radius, radius);
  }
}

/** pick the target +/- 2π that is closest to current, so we never spin the long way */
function nearest(current: number, target: number): number {
  const TWO_PI = Math.PI * 2;
  let t = target;
  while (t - current > Math.PI) t -= TWO_PI;
  while (t - current < -Math.PI) t += TWO_PI;
  return t;
}

function tween(obj: any, prop: string, from: number, to: number) {
  Animation.CreateAndStartAnimation(`nav_${prop}_${Math.random()}`, obj, prop, 60, 18, from, to, Animation.ANIMATIONLOOPMODE_CONSTANT);
}
