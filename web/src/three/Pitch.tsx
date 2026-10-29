import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { L, W } from './coords';
import { GROUND_TONE } from './stadium/night';
import { lowHas, useQuality } from './quality';

// Grass runs to the front of the stands, 8.5 m beyond the touchlines and goal lines.
const MARGIN = 8.5;

// Everything is drawn in the fragment shader from pitch coordinates (metres, origin at the centre spot),
// so the lines stay sharp at player eye height and the grass detail fades out with distance instead of shimmering.
const GRASS_GLSL = /* glsl */ `
varying vec2 vPitch; varying vec3 vGrassWorld;
uniform vec3 uLight, uDark, uWear, uLine; uniform float uGlow;
// The tactical mode's board: plain dark grey with the markings in light grey, no hexagons once there.
// The change from the grass to the board and back (chosen from six hexagon designs, their refinements and a
// particle version: "edge in", 5 m tiles): a wave runs out from uOrigin (under the ball when the mode
// changed); as it reaches a tile, the tile's border lights and the board closes in from the edge to the centre like an
// iris, a light ring riding the closing edge. uMode is the progress, uReach how far the wave runs.
uniform float uMode, uReach; uniform vec2 uOrigin;
// the loading pulse on the board (a clip change in place, game/clipSwap.ts; the earlier hexagon
// loading style): the tiles' borders light in rings running out from the centre spot, one every PULSE_S s, while the
// next clip loads; uPulse its strength 0..1, uPulseT its clock in seconds
uniform float uPulse, uPulseT;

float hexDist(vec2 p) { p = abs(p); return max(dot(p, vec2(0.5, 0.8660254)), p.x); }
vec4 hexTile(vec2 uv) { const vec2 r = vec2(1.0, 1.7320508), h = r * 0.5; vec2 a = mod(uv, r) - h, b = mod(uv - h, r) - h; vec2 gv = dot(a, a) < dot(b, b) ? a : b; return vec4(gv, uv - gv); }

float gHash(vec2 p) {
  uvec2 q = uvec2(ivec2(floor(p)) + 32768) * uvec2(1597334673u, 3812015801u);
  uint n = (q.x ^ q.y) * 1597334673u;
  return float(n) * (1.0 / 4294967295.0);
}
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1, 0)), u.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), u.x), u.y);
}
// visible weight of a detail layer with cell size s, given fw metres per pixel
float gFade(float s, float fw) { return 1.0 - smoothstep(0.35 * s, 1.3 * s, fw); }
// coverage of a line of half width hw at distance d, antialiased over aa metres; thinner than a pixel, it fades
// instead of breaking up
float gLine(float d, float hw, float aa) { float e = max(hw, 0.6 * aa); return clamp((e - d) / aa + 0.5, 0.0, 1.0) * (hw / e); }
float gSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
// The antialiasing width of a line is the pixel's footprint on the grass across that line: the screen derivatives of
// the pitch position projected on the line's normal. At grazing angles a pixel spans metres along the view and
// centimetres across it; the old width (the pixel's largest footprint, either way) smeared every line running along
// the view, the touchline an assistant referee looks down. fwidth of the distance itself fails at the
// line's centre, where the distance folds, and broke far lines into dashes.
float gAA(vec2 n, vec2 dx, vec2 dy) { return max(length(vec2(dot(n, dx), dot(n, dy))), 1e-5); }

float gMarkings(vec2 p) {
  const float HW = 0.06;                      // 12 cm lines
  vec2 q = abs(p);                            // the markings are symmetric about both axes
  vec2 dx = dFdx(p), dy = dFdy(p);
  vec2 sg = vec2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0), qx = dx * sg, qy = dy * sg;   // q's derivatives
  float ax = gAA(vec2(1.0, 0.0), dx, dy), ay = gAA(vec2(0.0, 1.0), dx, dy);                       // lines across x, along x
  float c = 0.0;
  c = max(c, gLine(gSeg(q, vec2(0.0, 34.0), vec2(52.5, 34.0)), HW, ay));     // touchlines
  c = max(c, gLine(gSeg(q, vec2(52.5, 0.0), vec2(52.5, 34.0)), HW, ax));     // goal lines
  c = max(c, gLine(gSeg(q, vec2(0.0, 0.0), vec2(0.0, 34.0)), HW, ax));       // halfway line
#ifdef GRASS_FAST
  // (the rest only where it can show: a line's coverage is exactly 0 beyond its half width plus 1.1 of its AA width,
  // and that width is at most the pixel's footprint, |dx| + |dy|; so a group farther than mg is skipped with no change
  // to a single pixel, the derivatives taken above, outside the branches)
  float mg = 0.13 + 2.0 * (length(dx) + length(dy));
  if (length(p) < 9.15 + mg) {
#endif
  vec2 nc = p / max(length(p), 1e-4);
  c = max(c, gLine(abs(length(p) - 9.15), HW, gAA(nc, dx, dy)));            // centre circle
  c = max(c, gLine(length(p), 0.13, gAA(nc, dx, dy)));                      // centre spot
#ifdef GRASS_FAST
  }
  if (q.x < 32.35 - mg) return c;                                           // the penalty area's side starts at 32.35 (the arc)
#endif
  c = max(c, gLine(gSeg(q, vec2(36.0, 20.16), vec2(52.5, 20.16)), HW, ay));  // penalty area
  c = max(c, gLine(gSeg(q, vec2(36.0, 0.0), vec2(36.0, 20.16)), HW, ax));
  c = max(c, gLine(gSeg(q, vec2(47.0, 9.16), vec2(52.5, 9.16)), HW, ay));    // goal area
  c = max(c, gLine(gSeg(q, vec2(47.0, 0.0), vec2(47.0, 9.16)), HW, ax));
  vec2 ps = q - vec2(41.5, 0.0), np = ps / max(length(ps), 1e-4);
  float ap = gAA(np, qx, qy);
  c = max(c, gLine(length(ps), 0.13, ap));                                   // penalty spot
  float arc = gLine(abs(length(ps) - 9.15), HW, ap);                         // penalty arc, outside the area only
  c = max(c, arc * (1.0 - smoothstep(36.0 - HW, 36.0 + HW, q.x)));
  vec2 pc = q - vec2(52.5, 34.0);
  float corner = gLine(abs(length(pc) - 1.0), HW, gAA(pc / max(length(pc), 1e-4), qx, qy));   // corner arcs
  c = max(c, corner * step(q.x, 52.5) * step(q.y, 34.0));
  // optional distance marks (Law 1): off the field of play, 9.15 m from the corner arc, at right angles to the lines
  c = max(c, gLine(gSeg(q, vec2(52.5 + HW, 34.0 - 10.15), vec2(52.5 + 0.35, 34.0 - 10.15)), HW, ay));
  c = max(c, gLine(gSeg(q, vec2(52.5 - 10.15, 34.0 + HW), vec2(52.5 - 10.15, 34.0 + 0.35)), HW, ax));
  return c;
}

vec3 grass(vec2 p, vec3 wp) {
  vec2 fw2 = fwidth(p);
  float fw = max(max(fw2.x, fw2.y), 1e-5);    // metres per pixel
  vec3 V = normalize(cameraPosition - wp);
#ifdef GRASS_FAST
  // (the board first: where the hexagons have closed, the grass under it is not worked out at all, the board taking the
  // markings only, so it comes out the same to the bit. The tactical board, the clip change's board and most of the
  // pitch while the hexagons turn are such pixels; the hexagon intro alone lagged, the whole
  // grass being worked out under a closed board. Every derivative is taken here, before any pixel returns)
  float mk = gMarkings(p);
  vec3 board = mix(vec3(0.034, 0.037, 0.043), vec3(0.42, 0.46, 0.52), mk * 0.8);   // dark grey; light grey markings
  const float S = 5.0;
  float wave = max(18.0, 0.4 * uReach);
  vec4 hx = vec4(0.0); float phiRaw = 0.0, hd = 0.0, aw = 1e-4;
  if (uMode > 0.001) {
    hx = hexTile(p / S);
    phiRaw = (uMode * (uReach + wave) - length(hx.zw * S - uOrigin)) / wave + (gHash(hx.zw * 7.0 + 3.0) - 0.5) * 0.25;
    hd = hexDist(hx.xy); aw = max(fwidth(hd), 1e-4);
    if (phiRaw >= 1.0) {
      if (uPulse <= 0.001) return board;
      float dC = length(hx.zw * S), run = 16.0, period = 1.15, ring = mod(uPulseT, period) / period * (uReach + run) - dC;
      float tile = exp(-pow(ring / run * 2.6, 2.0)) * step(-run, ring);
      float pw = 0.05 / S, pseam = 1.0 - smoothstep(pw, pw + aw, 0.5 - hd);
      return board + vec3(0.5, 0.8, 0.85) * uPulse * tile * (pseam * 0.55 + 0.03);
    }
  }
#endif

  // Mowing: 14 bands across the length, each mown towards +y or -y (pitch y is world -z).
  // A band looks light when the viewer looks along the lay of the blades and dark when the tips point at him,
  // so the contrast is strongest from the broadcast side and flips from the opposite stand.
  // Mowing as a groundsman marks it: 5.5 m bands measured out from each goal line, so the goal area is one band and
  // the penalty area three; the remainder makes one 6 m band centred on the halfway line. The two halves mirror.
  const float BW = 5.5, HALF = 52.5, EDGE = 49.5;           // 9 bands of 5.5 m from each goal line, then the middle band
#ifdef GRASS_LOW
  float px = p.x + HALF, d = min(px, 2.0 * HALF - px);
#else
  float px = p.x + HALF + (gNoise(p * vec2(0.5, 0.12)) - 0.5) * 0.12, d = min(px, 2.0 * HALF - px);
#endif
  float band = d < EDGE ? sin(3.14159 * d / BW) : -sin(0.5 * 3.14159 * clamp((d - EDGE) / (HALF - EDGE), 0.0, 1.0));
  float k = max(0.11, 3.14159 * fw / BW);
  float dir = mix(-1.0, 1.0, smoothstep(-k, k, band));
  float lay = clamp(dir * V.z * 1.9, -1.0, 1.0);
  float sf = 0.5 + 0.5 * (0.78 * lay + 0.22 * dir);
  // a faint cross cut along the length (10 bands across the width) gives the checked look of a match-day pitch
  float by = (p.y + 34.0) / 6.8;
  float k2 = max(0.11, 3.14159 * fw / 6.8);
  float dir2 = mix(-1.0, 1.0, smoothstep(-k2, k2, sin(3.14159 * by)));
  float lay2 = clamp(-dir2 * V.x * 1.9, -1.0, 1.0);
  sf = clamp(sf + 0.16 * (0.7 * lay2 + 0.3 * dir2), 0.0, 1.0);
  // outside the field of play the run-off is one plain tone, with no mowing pattern, as on match pitches
  vec2 ap = abs(p); float ea = fw * 1.5 + 1e-4;
  float inField = (1.0 - smoothstep(HALF, HALF + ea, ap.x)) * (1.0 - smoothstep(34.0, 34.0 + ea, ap.y));
  sf = mix(0.5, sf, inField);
  vec3 col = mix(uDark, uLight, sf);

  // Variation at several scales: patches, tufts, clumps, blades (stretched along the lay).
  float big = 0.6 * gNoise(p / 11.0) + 0.4 * gNoise(p / 3.4 + 17.0) - 0.5;
  col *= 1.0 + big * 0.16;
  col = mix(col, col * vec3(1.07, 1.05, 0.82), smoothstep(0.12, 0.45, big) * 0.45);
  // Light wear in the goalmouths and on the spots (its shape here, its noise below).
  vec2 q = abs(p);
  float wear = max(0.85 * (1.0 - smoothstep(0.25, 1.0, length((q - vec2(49.6, 0.0)) / vec2(5.5, 4.2)))),
               0.6 * (1.0 - smoothstep(0.2, 1.0, min(length(q - vec2(41.5, 0.0)) / 1.3, length(p) / 1.5))));
#ifdef GRASS_FAST
  // (a layer whose weight is 0 here, faded out with distance or outside the worn patches, is not worked out: the result
  // is the same to the bit, as multiplying by 1.0 or mixing by 0.0 leaves the colour as it was)
  float f85 = gFade(0.85, fw), f16 = gFade(0.16, fw), f016 = gFade(0.016, fw);
#ifndef GRASS_LOW
  if (f85 > 0.0) col *= 1.0 + (gNoise(p / 0.85 + 5.0) - 0.5) * 0.08 * f85;
#endif
  float clump = f16 > 0.0 || wear > 0.0 ? gNoise(p / 0.16 + 11.0) - 0.5 : 0.0;
  col *= 1.0 + clump * 0.12 * f16;
#ifndef GRASS_LOW
  if (f016 > 0.0) col *= 1.0 + (gNoise(p * vec2(1.0 / 0.016, 1.0 / 0.06) + 3.0) - 0.5) * 0.26 * f016;
#endif
  if (wear > 0.0) wear *= smoothstep(0.4, 0.85, 0.55 * gNoise(p / 0.55 + 31.0) + 0.55 * gNoise(p / 2.1 + 7.0));
#else
#ifndef GRASS_LOW
  col *= 1.0 + (gNoise(p / 0.85 + 5.0) - 0.5) * 0.08 * gFade(0.85, fw);
#endif
  float clump = gNoise(p / 0.16 + 11.0) - 0.5;
  col *= 1.0 + clump * 0.12 * gFade(0.16, fw);
#ifndef GRASS_LOW
  col *= 1.0 + (gNoise(p * vec2(1.0 / 0.016, 1.0 / 0.06) + 3.0) - 0.5) * 0.26 * gFade(0.016, fw);
#endif
  wear *= smoothstep(0.4, 0.85, 0.55 * gNoise(p / 0.55 + 31.0) + 0.55 * gNoise(p / 2.1 + 7.0));
#endif
  col = mix(col, uWear * (0.9 + 0.2 * clump), wear * 0.3);

  // Grass sheen at grazing angles: lighter and a little less saturated far away.
  float gr = pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, mix(vec3(lum), col, 0.7) * 1.25, gr * 0.45);

  // Paint, slightly uneven.
#ifndef GRASS_FAST
  float mk = gMarkings(p);
#endif
#ifdef GRASS_LOW
  float paint = 0.95;
#elif defined(GRASS_FAST)
  float paint = 0.95;   // (only where there is paint)
  if (mk > 0.0) paint = 0.9 + 0.1 * gNoise(p / 0.05 + 23.0) * gFade(0.05, fw) + 0.05 * (1.0 - gFade(0.05, fw));
#else
  float paint = 0.9 + 0.1 * gNoise(p / 0.05 + 23.0) * gFade(0.05, fw) + 0.05 * (1.0 - gFade(0.05, fw));
#endif
  vec3 face = mix(col, uLine * paint, mk * 0.92);
#ifndef GRASS_FAST
  vec3 board = mix(vec3(0.034, 0.037, 0.043), vec3(0.42, 0.46, 0.52), mk * 0.8);   // dark grey; light grey markings
#endif

  if (uMode <= 0.001) return face;
  // hexagons: S across the flats; each tile's progress phi from its centre's distance behind the wave, a little
  // jitter per tile; line widths fixed in metres. The derivative is taken before the branches. Smoothness (too
  // stiff with 5 m tiles otherwise): the wave runs only as far as this change's farthest corner (uReach), and its band is wide,
  // so several rings of tiles close at once, each over about half a second, easing in and out; the border fades in and
  // out, a soft light rides the closing edge, and the grass left inside dims as it closes, so the last of it fades
#ifndef GRASS_FAST
  const float S = 5.0;
  float wave = max(18.0, 0.4 * uReach);
  vec4 hx = hexTile(p / S);
  float phiRaw = (uMode * (uReach + wave) - length(hx.zw * S - uOrigin)) / wave + (gHash(hx.zw * 7.0 + 3.0) - 0.5) * 0.25;
  float hd = hexDist(hx.xy), aw = max(fwidth(hd), 1e-4);
#endif
  if (phiRaw <= 0.0) return face;
  if (phiRaw >= 1.0) {
    if (uPulse <= 0.001) return board;
    // rings of lit tile borders running out from the centre, each tile lit as a ring passes its centre, a soft glow inside it
    // a ring of lit hexagon edges running out from the centre spot, as the flip's front does: about two tiles wide
    float dC = length(hx.zw * S), run = 16.0, period = 1.15, ring = mod(uPulseT, period) / period * (uReach + run) - dC;
    float tile = exp(-pow(ring / run * 2.6, 2.0)) * step(-run, ring);
    float pw = 0.05 / S, pseam = 1.0 - smoothstep(pw, pw + aw, 0.5 - hd);
    return board + vec3(0.5, 0.8, 0.85) * uPulse * tile * (pseam * 0.55 + 0.03);
  }
  float phi = phiRaw * phiRaw * phiRaw * (phiRaw * (phiRaw * 6.0 - 15.0) + 10.0), bump = sin(3.14159265 * phi);
  float seamW = 0.06 / S, seam = 1.0 - smoothstep(seamW, seamW + aw, 0.5 - hd);           // the tile's border
  float lit = smoothstep(0.0, 0.15, phiRaw) * (1.0 - smoothstep(0.3, 0.75, phiRaw));
  float rin = 0.5 * (1.0 - phi), dark = smoothstep(rin - aw, rin + aw, hd), edge = abs(hd - rin);   // the board, closing in
  float rw = 0.036 / S, rim = (1.0 - smoothstep(rw, rw + aw, edge)) * bump;               // the light on its edge
  float halo = exp(-pow(edge / 0.07, 2.0)) * (1.0 - dark) * bump;
  return mix(face * (1.0 - 0.35 * phi), board, dark) + vec3(0.55, 0.86, 0.9) * (rim * 0.85 + seam * 0.6 * lit + halo * 0.12);
}
`;

/** low: the low graphics tier's grass (three/quality.ts): Lambert lighting, and half the layers of noise (the jitter of
 *  the mowing bands, the 85 cm patches, the blades and the paint's unevenness left out; the stripes, the patches, the
 *  clumps, the wear and the markings as they are) */
function grassMaterial(glow: number, low = false) {
  const m: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial = low ? new THREE.MeshLambertMaterial() : new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0 });
  const uniforms = {
    uLight: { value: new THREE.Color('#3d7036') }, uDark: { value: new THREE.Color('#30602d') },
    uWear: { value: new THREE.Color('#6f7353') }, uLine: { value: new THREE.Color('#eef1ea') }, uGlow: { value: glow },
    uMode: { value: 0 }, uOrigin: { value: new THREE.Vector2() }, uReach: { value: 75 }, uPulse: { value: 0 }, uPulseT: { value: 0 },
  };
  m.userData.grass = uniforms;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPitch; varying vec3 vGrassWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPitch = position.xy; vGrassWorld = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + (low ? '#define GRASS_LOW\n' : '') + '#define GRASS_FAST\n' + GRASS_GLSL)
      // (the low tier: the standard material's faint grey sheen, which Lambert lacks, as a lift of the colour, the grass
      // and the board alike: about 0.02 of linear light under the night's lights, measured from the broadcast view)
      .replace('#include <map_fragment>', `vec3 grassCol = grass(vPitch, vGrassWorld); diffuseColor.rgb = grassCol${low ? ' + vec3(0.015)' : ''};`)
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = grassCol * uGlow;');
  };
  m.customProgramCacheKey = () => `grass-v21${low ? '-low' : ''}-fast`;
  return m;
}

/** the ground round the stadium as a disc 1300 m across (within the 1400 m sky), its colour by distance from the centre:
 *  the octagon's light grey (linear 0.42, 0.43, 0.44, Landscape.tsx's plain ground) at its edge, easing to the night's
 *  near black by about 380 m (the floodlights lift whatever is not dark: 900 m, then 520 m, left the whole 远景 frame
 *  light grey, a studio rather than a night) */
function landGeometry() {
  const g = new THREE.RingGeometry(0, 1300, 128, 72), pos = g.getAttribute('position'), col = new Float32Array(pos.count * 3);
  const near = new THREE.Color().setRGB(0.42, 0.43, 0.44).multiplyScalar(GROUND_TONE), far = new THREE.Color().setRGB(0.005, 0.006, 0.009), c = new THREE.Color();   // (toned for the night outside: stadium/night.ts)
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i)), u = THREE.MathUtils.smoothstep(r, 150, 380);
    c.copy(near).lerp(far, Math.pow(u, 0.6)).toArray(col, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** glow: emissive share of the grass colour, standing in for even floodlighting (0 = lit only by scene lights) */
/** surround: a dark ground plane all round, for scenes that have no ground of their own */
/** ground: instead, the stadium's ground carried on to the horizon (the game, for aerialNear and aerialFar: the
 *  light grey octagon ended in a black void, the stadium out of nowhere): the octagon's own grey and finish from its
 *  edge, then darker and darker, the night by about 380 m */
/** mode: the tactical mode's change of pitch, driven by the caller every frame: current, the hexagons' progress 0
 *  (grass) to 1 (the board); origin, where it starts (pitch metres, y = minus the scene's z); reach, how far the wave
 *  runs (metres, to the farthest corner of the grass from origin) */
/** pulse, pulseT: the loading pulse's strength (0..1) and clock (s), on the board while a clip changes in place */
export interface PitchMode { current: number; origin: THREE.Vector2; reach: number; pulse?: number; pulseT?: number }
export function Pitch({ glow = 0, surround = true, ground = false, mode }: { glow?: number; surround?: boolean; ground?: boolean; mode?: PitchMode }) {
  const low = useQuality().tier === 'low' && lowHas('pitch');
  const mat = useMemo(() => grassMaterial(glow, low), [glow, low]);
  useEffect(() => () => mat.dispose(), [mat]);
  const land = useMemo(() => (ground ? landGeometry() : null), [ground]);
  useEffect(() => () => land?.dispose(), [land]);
  useFrame(() => {
    if (!mode) return;
    const u = mat.userData.grass as Record<'uMode' | 'uReach' | 'uPulse' | 'uPulseT', { value: number }> & { uOrigin: { value: THREE.Vector2 } };
    u.uMode.value = mode.current; u.uOrigin.value.copy(mode.origin); u.uReach.value = mode.reach; u.uPulse.value = mode.pulse ?? 0; u.uPulseT.value = mode.pulseT ?? 0;
  });
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow material={mat}>
        <planeGeometry args={[L + 2 * MARGIN, W + 2 * MARGIN]} />
      </mesh>
      {land ? (
        // well below the grass and the stadium's ground, so they never fight for depth at a distance
        // (drawn after everything opaque: under the grass and behind the stands it was
        // shaded and then covered, about a sixth of the frame; drawn last, the depth test turns those pixels away first.
        // Opaque, so the picture is the same)
        <mesh rotation-x={-Math.PI / 2} position-y={-0.3} geometry={land} renderOrder={10}>
          <meshStandardMaterial vertexColors roughness={0.9} metalness={0} />
        </mesh>
      ) : surround && (
        <mesh rotation-x={-Math.PI / 2} position-y={-0.3}>
          <planeGeometry args={[L + 900, W + 900]} />
          <meshStandardMaterial color="#0a0c14" roughness={1} />
        </mesh>
      )}
    </group>
  );
}
