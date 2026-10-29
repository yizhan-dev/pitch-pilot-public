import * as THREE from 'three';
import { GOAL_FX } from './goalFx';

// The pitch-side LED boards' goal message (the team-colour version of seven; page
// review/goal-boards/; all seven: <private-workspace>). After a
// goal every 10 cm of board is one round LED showing GOOOAAAALLL!!! in a 5 x 7 pixel font, then a block of solid team
// colour, repeated (four chevrons <<<< there looked bad, so plain colour):
// - blink, 0-1.5 s: it stands still and blinks three times, twice a second (within the 3 flashes a second that WCAG
//   2.3.1 allows);
// - ticker, from 1.5 s: it runs right to left round the whole loop of boards, easing up to 14 m/s over 0.6 s, the
//   letters in the team's colour (home blue, away orange) with a white pixel shadow;
// - exit, from 5 s: the ticker stops, blinks twice as it began, and YIZHAN pushes up from below the dark board; the
//   banners then rotate from YIZHAN (they kept turning underneath before, so the first one often arrived half-way
//   through its hold or its push). This one of four (page review/goal-exit/; the others, a push, a
//   dissolve and a team-colour wipe: <private-workspace>); the first
//   version cross-faded dots and banner for a second, and the clips' loop cut it off abruptly.
// The YIZHAN marks on the boards stay black and white; the goal message is not a mark.
const T_END = 5.0;
const REVEAL = T_END + 1.0;   // when YIZHAN starts showing again, seconds after the goal

// 5 x 7 pixel font, rows top to bottom
const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'], G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'], O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'], ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};
/** a message as a 7-row bitmap texture, one texel per dot, one blank column between letters */
function bitmap(msg: string) {
  const cols: number[][] = [];
  for (const ch of msg) { const g = FONT[ch] ?? FONT[' ']; for (let c = 0; c < 5; c++) cols.push(g.map((r) => +r[c])); cols.push([0, 0, 0, 0, 0, 0, 0]); }
  const w = cols.length, data = new Uint8Array(w * 7 * 4);
  cols.forEach((col, x) => col.forEach((on, r) => { const k = ((6 - r) * w + x) * 4; data[k] = data[k + 1] = data[k + 2] = on * 255; data[k + 3] = 255; }));
  const t = new THREE.DataTexture(data, w, 7); t.magFilter = t.minFilter = THREE.NearestFilter; t.wrapS = THREE.RepeatWrapping; t.needsUpdate = true;
  return { tex: t, cols: w };
}
// the unit: the shout, a gap, a 2.4 m block of solid team colour, a gap
const TEXT = 'GOOOAAAALLL!!!', MSG = TEXT + ' '.repeat(8), BLOCK0 = (TEXT.length + 2) * 6, BLOCK_W = 24;

/** the boards' loop coordinate in metres, reading left to right as seen from the pitch: the far side (+x), the east end
 *  (+z), the main side (-x), the west end (-z); the corners' gaps count as about 6.7 m each */
export function boardLoopS(x: number, z: number) {
  const c = 6.7, side = 106, end = 66;
  if (z < -36) return x + 53;
  if (x > 56) return side + c + (z + 33);
  if (z > 36) return side + end + 2 * c + (53 - x);
  return 2 * side + end + 3 * c + (33 - z);
}

const GLSL = `
  uniform float uGbT, uGbCols; uniform sampler2D uGbMsg; uniform vec3 uGbTeam;
  varying float vGbS, vGbY;
  float gbFont(float col, float row) {
    if (row < 0.0 || row > 6.0) return 0.0;
    return texture2D(uGbMsg, vec2((mod(col, uGbCols) + 0.5) / uGbCols, (row + 0.5) / 7.0)).r;
  }
  // the message's rgb at board point (s, y), metres; t: seconds after the goal; frozen: stop scrolling at this time
  vec3 gbMessage(float s, float y, float t, float frozen, out vec2 cell) {
    const float pitch = 0.1, BLINK = 1.5, RAMP = 0.6, SPEED = 14.0;
    vec2 g = vec2(s, y) / pitch, f = fract(g) - 0.5; cell = floor(g);
    float tt = clamp(min(t, frozen) - BLINK, 0.0, 1e4), run = tt < RAMP ? 0.5 * SPEED * tt * tt / RAMP : SPEED * (tt - 0.5 * RAMP);
    float col = cell.x + floor(run / pitch), row = cell.y - 1.0, k = mod(col, uGbCols);
    float lit = gbFont(col, row), shadow = (1.0 - lit) * gbFont(col - 1.0, row + 1.0);
    float block = step(${BLOCK0.toFixed(1)}, k) * step(k, ${(BLOCK0 + BLOCK_W - 1).toFixed(1)}) * step(0.0, row) * step(row, 6.0);
    vec3 team = min(vec3(1.0), uGbTeam * 1.25);
    vec3 c = team * max(lit, block) + vec3(0.9) * shadow;
    float px = max(fwidth(g.x), fwidth(g.y)), dotA = smoothstep(0.42 + px, 0.42 - px, length(f));
    vec3 v = max(c, vec3(0.05)) * dotA;                       // unlit dots glow faintly
    return mix(v, max(c, vec3(0.05)) * 0.55, smoothstep(0.22, 0.45, px));   // under about 3 px a dot, its average: no moire
  }
  // rgb of this point of a board, and how much of the board the goal message takes over
  vec4 gbColour() {
    float t = uGbT; if (t < 0.0 || t > 11.0) return vec4(0.0);
    const float END = ${T_END.toFixed(1)};
    float blinkIn = t < 1.5 ? step(fract(t * 2.0), 0.6) : 1.0;
    // the exit: stop, blink twice, then the banners push in (tick)
    vec2 cell; vec3 c = gbMessage(vGbS, vGbY, t, END, cell);
    c *= t < END ? 1.0 : step(fract((t - END) * 2.0), 0.6) * step(t, END + 1.0);
    float a = 1.0 - step(END + 1.0, t);
    float m = smoothstep(0.0, 0.05, t);
    return vec4(c * blinkIn, a * m);
  }`;

/** add the goal message to a board's LED material (its emissive); the board's geometry carries aGbS (boardLoopS).
 *  pre: shader code that sets the boards' own content first (Furniture.tsx's rotating banners: their uniforms uAdT, the
 *  rotation's clock, and uAdOff, its vertical shift, are set here): declarations, the fragment code run right after the
 *  emissive map, and its uniforms; vdecl / vmain: vertex code for attributes the content needs (each board's banner
 *  extents) */
export function withGoalBoards(m: THREE.MeshStandardMaterial, pre?: { decl: string; frag: string; uniforms: Record<string, { value: unknown }>; vdecl?: string; vmain?: string }) {
  const msg = bitmap(MSG);
  const u = { uGbT: { value: -1 }, uGbCols: { value: msg.cols }, uGbMsg: { value: msg.tex }, uGbTeam: { value: new THREE.Color('#3987e5') } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, pre?.uniforms ?? {});
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\nattribute float aGbS; varying float vGbS, vGbY;\n${pre?.vdecl ?? ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvGbS = aGbS; vGbY = uv.y * 0.9;\n${pre?.vmain ?? ''}`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${pre?.decl ?? ''}\n${GLSL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${pre?.frag ?? ''}\n{ vec4 gc = gbColour(); totalEmissiveRadiance = mix(totalEmissiveRadiance, gc.rgb, gc.a); }`);
  };
  m.customProgramCacheKey = () => 'goal-boards';
  const adT = pre?.uniforms.uAdT as { value: number } | undefined, adOff = pre?.uniforms.uAdOff as { value: number } | undefined;
  return {
    material: m,
    tick: () => {
      const since = GOAL_FX.since;
      u.uGbT.value = since; u.uGbTeam.value.set(GOAL_FX.team === 'WILDCATS' ? '#d95926' : '#3987e5');   // the kits: home blue, away orange
      // the banners restart at YIZHAN when they come back after a goal; before any goal they run on the clock
      const back = GOAL_FX.clock - GOAL_FX.last - REVEAL;
      if (adT) adT.value = Number.isFinite(GOAL_FX.last) ? Math.max(0, back) : GOAL_FX.clock;
      // after the blinks YIZHAN pushes up from below, 0.5 s
      const pushIn = Math.min(1, Math.max(0, (since - REVEAL) / 0.5));
      const sm = pushIn * pushIn * (3 - 2 * pushIn);
      if (adOff) adOff.value = since >= 0 && since < 12 ? 1 - sm : 0;
    },
  };
}
