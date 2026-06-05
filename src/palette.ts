// ---------------------------------------------------------------------------
// The colour palette — a tiny, closed set of named colours so a kid can both
// MAKE a coloured object ("add a red cube") and REFER to one by colour
// ("move the green cube up"). Like the lexicon, it's deliberately bounded: a
// handful of names, deterministic. Two directions:
//   name → rgb   (apply.ts paints a new object the colour the kid asked for)
//   rgb  → name  (the resolver names an existing object's colour to match it)
// The seed-scene colours (blue plate, green block, orange post) are chosen to
// sit exactly on these palette entries so naming is unambiguous.
// ---------------------------------------------------------------------------
export type RGB = [number, number, number];

/** canonical colour name → diffuse RGB (0–1) */
export const PALETTE: Record<string, RGB> = {
  red: [0.85, 0.25, 0.25],
  orange: [0.86, 0.52, 0.26],
  yellow: [0.92, 0.8, 0.25],
  green: [0.36, 0.66, 0.4],
  blue: [0.4, 0.55, 0.85],
  purple: [0.7, 0.45, 0.8],
  pink: [0.9, 0.55, 0.7],
  brown: [0.55, 0.38, 0.24],
  white: [0.92, 0.92, 0.94],
  grey: [0.6, 0.6, 0.62],
  black: [0.18, 0.18, 0.2],
};

/** the colour names offered as a chip picker (plus "auto" = let the app choose) */
export const COLOR_OPTIONS = ["auto", ...Object.keys(PALETTE)];

/** name → rgb (undefined for unknown / "auto") */
export function rgbOf(name: string): RGB | undefined {
  return PALETTE[name];
}

/** rgb → nearest palette name (so an object's colour can be matched to a word) */
export function nearestColorName(rgb: RGB): string {
  let best = "grey";
  let bestD = Infinity;
  for (const [name, c] of Object.entries(PALETTE)) {
    const d = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}
