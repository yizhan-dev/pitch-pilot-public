import * as THREE from 'three';

// The outside at night (Yi, 2026-10-27: "for the entry intro, and general pitch from drone perspective for example, make
// the view look more like at night shall we? now it is too white"). k runs from 0 in the bowl to 1 far out (the game's
// drone views, the line-up show's opening). Out there the night's fog used to be pushed away (700 to 2600 m) so the
// grounds read, and the floodlit pitch's lights lit the shell and the plaza like day. Now the fog closes in just past
// the stadium, so the grounds fade into the dark, and the sky light and the fills dim, so the shell and the plaza sit
// under their own lamps (unlit glows, untouched) while the pitch keeps its floodlit glow. Yi picked B, the darker
// (2026-10-27: "I like B"); ?night=a the lighter, ?night=0 as before (for comparisons). The lights it dims carry a name: night-amb (the sky light), night-key, night-fill.
const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('night') : null;
/** each level: the share of its light each role keeps far out, the fog's start and end past the camera's distance, and
 *  the grounds' tone (the plaza, its steps, the land round it: they were a light stone grey, linear 0.42, which the
 *  floodlights lift to near white) */
const LEVELS = {
  a: { amb: 0.4, key: 0.6, fill: 0.35, near: 90, far: 650, ground: 0.38 },
  b: { amb: 0.25, key: 0.45, fill: 0.2, near: 60, far: 480, ground: 0.24 },
};
export const NIGHT = Q === '0' ? null : LEVELS[Q === 'a' ? 'a' : 'b'];
/** what the grounds' colours are multiplied by (Landscape.tsx, Pitch.tsx's land): fixed, as only the outside sees them */
export const GROUND_TONE = NIGHT ? NIGHT.ground : 1;
const ROLES = { 'night-amb': 'amb', 'night-key': 'key', 'night-fill': 'fill' } as const;

const lightsOf = new WeakMap<THREE.Scene, { l: THREE.Light; role: 'amb' | 'key' | 'fill'; base: number }[]>();
function lights(scene: THREE.Scene) {
  let list = lightsOf.get(scene);
  if (!list || list.some((x) => !x.l.parent)) {
    const found: typeof list = [];
    scene.traverse((o) => { const role = ROLES[o.name as keyof typeof ROLES]; if (role && (o as THREE.Light).isLight) found.push({ l: o as THREE.Light, role, base: (o as THREE.Light).intensity }); });
    lightsOf.set(scene, (list = found));
  }
  return list;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** the night outside, each frame: k 0..1 (in the bowl .. far out), dist the camera's distance from the centre spot,
 *  inside the fog's own near and far */
export function nightOutside(scene: THREE.Scene, k: number, dist: number, inside: { near: number; far: number }) {
  const fog = scene.fog as THREE.Fog | null;
  if (fog) {
    if (NIGHT) { fog.near = lerp(inside.near, dist + NIGHT.near, k); fog.far = lerp(inside.far, dist + NIGHT.far, k); }
    else { fog.near = lerp(inside.near, 700, k); fog.far = lerp(inside.far, 2600, k); }
  }
  if (!NIGHT) return;
  for (const x of lights(scene)) x.l.intensity = x.base * lerp(1, NIGHT[x.role], k);
}
