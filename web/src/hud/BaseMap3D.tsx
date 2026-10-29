import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { Clock } from '../clock';
import type { Loaded } from '../data';
import { useGameSettings, scriptBoard } from '../game/settings';
import { attackingOf, playerTeam, type Team } from '../three/coords';
import type { ClipPkg } from './match';
import { TELE } from '../three/telestration/style';
import { useSpace, spaceMap, PC_BANDS, Q_FULL, MAP_GOLD, XT_PALE, XT_ALPHA, XT_FLOOR, XT_HEAT, XT_COLOUR } from './space';
import { drawMode, base, playbackPlaying, useStore } from './draft';
import { holderSideAt } from './passProb';
import { xtGrid, XT_NX, XT_NY, XT_RANGE } from './analysis';

// The 战术 mode's base map (pitch control as a contour map, or Q for an Explain board, or one of the two grids), drawn on the GPU, as a canvas
// texture read low-resolution and stepped, even with more bands. It was painted into
// the pitch overlay's canvas (16 px a metre) and stretched over the grass, so a close camera saw its pixels and the bands'
// steps. Here the export's 53 x 35 cells go to the GPU as a small texture, and every screen pixel samples them smoothly
// (Catmull-Rom, 16 taps) and works out its band, the band edges anti-aliased by the pixel's own footprint (fwidth): smooth
// at any zoom, and the CPU only blends the two 10 Hz frames. Bands: PC_BANDS a side (24, chosen over 6 and 12). A plane just under the overlay's canvas (marks and strokes stay
// on top), fading in with the board as the canvas does. Mounted by PitchOverlay3D.
// The grids (for a commentator to talk over): only the division, no zone picked out and no words on the grass
// (no zone highlighted, just the division of the pitch). Solid lines drawn only where the pitch has no
// line of its own, so they read as its markings carried on (the dashed first version crossed and doubled them and looked
// shabby), their edges anti-aliased by the pixel's footprint and never thinner than the marks' 1.5 px:
// - five lanes, positional play's: the boxes' and goal areas' sides carried up the pitch (wing, half-space, centre), the
//   boxes' lines carried out to the touchlines; with halfway, 5 x 4 = 20 zones
// - the 18 zones, 6 along and 3 across, the bands on the boxes' lines (16.5, 18, 18 m a half, not 17.5 m each, which put a
//   line 1 m from the box's), so zone 14 is the central one just outside the box
// The xT map, the xT trained and described in project_kick's xT.ipynb:
// project_kick's expected-threat surface (hud/analysis.ts XT, 16 x 12 cells, the notebook's model_utils/xt_surface.npy, equal
// to the engine's copy), turned for the side on the ball (passProb.ts holderSideAt; the last side while nobody has it), in
// the colourway's ramp on a log scale from XT_FLOOR to the highest cell (space.ts: a linear scale shows nothing but the box,
// and from the lowest cell the own half turns olive). To compare by eye, temporary: ?xtlook=cells (the model's cells with a
// one-pixel seam) against the default smooth look (bilinear between the cells' centres); ?xtcolour=heat against gold.

const L = 105, W = 68;
/** just under the overlay's canvas (0.035 m), over GameLayers (0.03) */
const LIFT_M = 0.034;
/** the base map's refresh while playing, per second (the export is 10 Hz; paused: at once for each new moment) */
const PLAYING_HZ = 15;
/** the xT map's look, still to be chosen (a temporary switch, see above; the colourway is space.ts's XT_COLOUR) */
const XT_LOOK = new URLSearchParams(location.search).get('xtlook') === 'cells' ? 0 : 1;
/** the laws' box (16.5 m deep, 40.32 m wide) and goal area (5.5 m deep, 18.32 m wide), metres */
const BOX_X = L / 2 - 16.5, BOX_HALF = 20.16, SIX_X = L / 2 - 5.5, SIX_HALF = 9.16;
/** the grids' look: the marks' blue line with their halo (style.ts: blue is "anything else"). Preferred
 *  over white paint at 45% like the pitch's own markings, which left with its ?grid=paint switch */
const gridLook = { ink: TELE.color.blue.board, halfW: 0.05, alpha: 0.8, glow: TELE.glow.strength * TELE.glow.gain.board, sigma: TELE.glow.sigma };
/** the kits' lighter tones, as the canvas drew them */
const LIGHT: Record<Team, [number, number, number]> = { home: [106, 184, 255], away: [255, 149, 96] };

/** an sRGB colour as the shader wants it (linear) */
const linear = (c: [number, number, number]) => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
/** the heat ramp as GLSL: a mix between each pair of stops */
const HEAT_GLSL = XT_HEAT.slice(1).map((s, i) => {
  const a = XT_HEAT[i], ca = linear(a.rgb), cb = linear(s.rgb), v = (c: THREE.Color, al: number) => `vec4(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)}, ${al.toFixed(2)})`;
  return `  if (t < ${s.t.toFixed(2)}) return mix(${v(ca, a.a)}, ${v(cb, s.a)}, (t - ${a.t.toFixed(2)}) / ${(s.t - a.t).toFixed(2)});`;
}).join('\n') + `\n  return ${(() => { const l = XT_HEAT[XT_HEAT.length - 1], c = linear(l.rgb); return `vec4(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)}, ${l.a.toFixed(2)})`; })()};`;

const vertexShader = /* glsl */ `
out vec2 vPitch;
void main() {
  vPitch = vec2(position.x, -position.y);   // the plane is turned flat: local +y is pitch -y
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragmentShader = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
uniform sampler2D uData;
uniform vec4 uGrid;        // x0, y0, w, h of the cells' grid, metres
uniform vec2 uSize;        // nx, ny
uniform int uMode;         // 0 pitch control in bands, 1 Q, 2 the five lanes, 3 the 18 zones, 4 the xT map
uniform float uBands, uFade, uQFull;
uniform vec3 uAtt, uDef, uOn;   // uOn: Q's colour
uniform vec4 uGeom;        // the box's and the goal area's lines from the centre, their half widths, metres
uniform vec3 uInk;         // the grids' colour
uniform vec4 uLook;        // the grids' line: half width (m), alpha, the halo's alpha at its edge and its sigma (m)
uniform float uMinPx;
uniform vec2 uXtRange;     // the xT map's floor and its highest cell
uniform int uXtLook, uXtColour;   // the xT map: 0 cells / 1 smooth; 0 gold / 1 heat
uniform vec3 uOnHi;        // the gold's pale top
in vec2 vPitch;
const float PITCH_W = ${W.toFixed(1)};
// a grid line's ink at distance d from it (metres): uLook.x a side but never under uMinPx pixels across (held there, it
// fades instead), the edges anti-aliased by the pixel's footprint, then the halo
float lineInk(float d) {
  float px = max(fwidth(d), 1e-5), h = max(uLook.x, 0.5 * uMinPx * px);
  float core = (1.0 - smoothstep(h - 0.5 * px, h + 0.5 * px, d)) * uLook.y * uLook.x / h;
  float g = max(d - h, 0.0) / uLook.w;
  return max(core, uLook.z * exp(-0.5 * g * g));
}
float cellAt(int i, int j) {
  ivec2 s = ivec2(uSize);
  return texelFetch(uData, ivec2(clamp(i, 0, s.x - 1), clamp(j, 0, s.y - 1)), 0).r;
}
float cr(float t, float a, float b, float c, float d) {
  return 0.5 * (2.0 * b + (c - a) * t + (2.0 * a - 5.0 * b + 4.0 * c - d) * t * t + (3.0 * (b - c) + d - a) * t * t * t);
}
float sampleCells(vec2 p) {
  vec2 f = floor(p), t = p - f;
  int x = int(f.x), y = int(f.y);
  float r0 = cr(t.x, cellAt(x - 1, y - 1), cellAt(x, y - 1), cellAt(x + 1, y - 1), cellAt(x + 2, y - 1));
  float r1 = cr(t.x, cellAt(x - 1, y), cellAt(x, y), cellAt(x + 1, y), cellAt(x + 2, y));
  float r2 = cr(t.x, cellAt(x - 1, y + 1), cellAt(x, y + 1), cellAt(x + 1, y + 1), cellAt(x + 2, y + 1));
  float r3 = cr(t.x, cellAt(x - 1, y + 2), cellAt(x, y + 2), cellAt(x + 1, y + 2), cellAt(x + 2, y + 2));
  return clamp(cr(t.y, r0, r1, r2, r3), 0.0, 1.0);
}
// a band's strength: the band round 50/50 clear, then stronger outwards (the canvas version's |share - 0.5| x 2 x 0.55 at
// each band's middle)
float bandAlpha(float k) { return k < 0.5 ? 0.0 : min(k + 0.5, uBands) / uBands * 0.55; }
// an xT cell's strength: 0 at the floor and below, 1 at the highest cell, log in between
float xtRamp(float v) { return clamp((log(max(v, 1e-6)) - log(uXtRange.x)) / (log(uXtRange.y) - log(uXtRange.x)), 0.0, 1.0); }
// the heat colourway (space.ts XT_HEAT, linear colour and alpha)
vec4 heat(float t) {
${HEAT_GLSL}
}
void main() {
  vec3 colour;
  float alpha;
  if (uMode == 2 || uMode == 3) {
    float ax = abs(vPitch.x), ay = abs(vPitch.y);
    float boxOut = lineInk(abs(ax - uGeom.x)) * step(uGeom.z, ay), line;   // the box's line carried out to the touchline
    if (uMode == 2) {
      line = max(boxOut, max(lineInk(abs(ay - uGeom.z)) * step(ax, uGeom.x),      // the box's sides carried up the pitch
                             lineInk(abs(ay - uGeom.w)) * step(ax, uGeom.y)));    // the goal area's
    } else {
      line = max(boxOut, max(lineInk(abs(ax - 0.5 * uGeom.x)),                      // halfway to the box
                             lineInk(abs(ay - PITCH_W / 6.0))));                    // the thirds across
    }
    gl_FragColor = vec4(uInk, line * uFade);
    #include <colorspace_fragment>
    return;
  }
  vec2 p = vec2((vPitch.x - uGrid.x) / uGrid.z * uSize.x - 0.5, (vPitch.y - uGrid.y) / uGrid.w * uSize.y - 0.5);
  if (uMode == 4) {
    // the cells' centres at whole p. Cells: cell k round p = k, blending into the next over the last pixel before the seam;
    // smooth: bilinear between the centres (flat past the outer ones)
    vec2 pp = uXtLook == 0 ? p + 0.5 : p, k = floor(pp), f = pp - k;
    int i = int(k.x), j = int(k.y);
    float a00 = xtRamp(cellAt(i, j)), a10 = xtRamp(cellAt(i + 1, j)), a01 = xtRamp(cellAt(i, j + 1)), a11 = xtRamp(cellAt(i + 1, j + 1));
    vec2 b = uXtLook == 0 ? smoothstep(1.0 - max(fwidth(pp), vec2(1e-4)), vec2(1.0), f) : f;
    float t = mix(mix(a00, a10, b.x), mix(a01, a11, b.x), b.y);
    vec4 c = uXtColour == 0 ? vec4(mix(uOn, uOnHi, smoothstep(0.7, 1.0, t)), t * ${XT_ALPHA.toFixed(2)}) : heat(t);
    gl_FragColor = vec4(c.rgb, c.a * uFade);
    #include <colorspace_fragment>
    return;
  }
  float v = sampleCells(p);
  if (uMode == 0) {
    float c = abs(v - 0.5) * 2.0 * uBands, k = floor(c), fw = max(fwidth(c), 1e-4);
    // the band edge one pixel wide: the last pixel of a band blends into the next
    alpha = mix(bandAlpha(k), bandAlpha(k + 1.0), smoothstep(1.0 - fw, 1.0, c - k));
    colour = v >= 0.5 ? uAtt : uDef;
  } else {
    alpha = min(1.0, v / uQFull) * 0.7;
    colour = uOn;
  }
  gl_FragColor = vec4(colour, alpha * uFade);
  #include <colorspace_fragment>
}`;


export function BaseMap3D({ data, clock, mode }: { data: Loaded; clock: Clock; mode?: { current: number } }) {
  const pkg = data.pkg as unknown as ClipPkg;
  const { mode: gameMode } = useGameSettings();
  const drawing = useStore(drawMode), selectedBase = useStore(base), playing = useStore(playbackPlaying);
  const shown = drawing ? 'draw' : gameMode, on = shown === 'tactics' && !!selectedBase;
  // an Explain script may ask for the same map on its board (game/settings.ts scriptBoard.base: exactly
  // the pitch control the Tactics mode shows); the data is loaded for the whole mode
  const scripted = gameMode === 'explain';
  const space = useSpace(pkg, (on && selectedBase === 'pc') || scripted);
  const nAtt = pkg.frames[0]?.att.length ?? 11, attacking = attackingOf(pkg.meta as { attacking?: string });
  const attackTeam = playerTeam(0, nAtt, attacking), defenceTeam = playerTeam(nAtt, nAtt, attacking);

  const nx = space?.head.pc.nx ?? 53, ny = space?.head.pc.ny ?? 35;
  const tex = useMemo(() => {
    const t = new THREE.DataTexture(new Float32Array(nx * ny), nx, ny, THREE.RedFormat, THREE.FloatType);
    t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter; t.unpackAlignment = 1; t.needsUpdate = true;
    return t;
  }, [nx, ny]);
  useEffect(() => () => tex.dispose(), [tex]);
  // the xT map's cells, for the side on the ball: the clip's attackers as the grid stands (attacking +x), else mirrored
  const xtTex = useMemo(() => {
    const t = new THREE.DataTexture(new Float32Array(XT_NX * XT_NY), XT_NX, XT_NY, THREE.RedFormat, THREE.FloatType);
    t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter; t.unpackAlignment = 1; t.needsUpdate = true;
    return t;
  }, []);
  useEffect(() => () => xtTex.dispose(), [xtTex]);
  const xtSide = useRef<1 | 2>(1), xtUploaded = useRef<0 | 1 | 2>(0);
  const material = useMemo(() => new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader, fragmentShader, transparent: true, depthWrite: false, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    uniforms: {
      uData: { value: null }, uGrid: { value: new THREE.Vector4(-L / 2, -W / 2, L, W) }, uSize: { value: new THREE.Vector2(53, 35) },
      uMode: { value: 0 }, uBands: { value: PC_BANDS }, uFade: { value: 0 }, uQFull: { value: Q_FULL },
      uAtt: { value: new THREE.Color() }, uDef: { value: new THREE.Color() }, uOn: { value: linear(MAP_GOLD) },
      uXtRange: { value: new THREE.Vector2(XT_FLOOR, XT_RANGE.max) }, uXtLook: { value: XT_LOOK }, uXtColour: { value: XT_COLOUR === 'heat' ? 1 : 0 },
      uOnHi: { value: linear(XT_PALE) },
      uGeom: { value: new THREE.Vector4(BOX_X, SIX_X, BOX_HALF, SIX_HALF) },
      uInk: { value: new THREE.Color(gridLook.ink) }, uMinPx: { value: TELE.minPx },
      uLook: { value: new THREE.Vector4(gridLook.halfW, gridLook.alpha, gridLook.glow, gridLook.sigma) },
    },
  }), []);
  useEffect(() => () => material.dispose(), [material]);
  const meshRef = useRef<THREE.Mesh>(null);
  useEffect(() => { if (meshRef.current) meshRef.current.raycast = () => undefined; }, []);   // clicks go through to the pitch
  const last = useRef('');
  useEffect(() => { last.current = ''; }, [selectedBase, space, tex]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const fade = mode ? THREE.MathUtils.smoothstep(mode.current, 0.8, 1) : 1;
    const which = on ? selectedBase : scripted ? scriptBoard.base : null, grid = which === 'lanes' || which === 'zones', xt = which === 'xt';
    if (!which || (!grid && !xt && !space) || fade <= 0) { mesh.visible = false; return; }
    const u = material.uniforms;
    u.uFade.value = fade;
    if (grid) { u.uMode.value = which === 'lanes' ? 2 : 3; last.current = ''; xtUploaded.current = 0; mesh.visible = true; return; }
    const t = clock.t, key = `${which}:${playing || (!on && scripted) ? Math.round(t * PLAYING_HZ) : t}`;
    if (xt) {
      // the side on the ball, read as often as the map refreshes; the last side while nobody has it
      if (key !== last.current) { last.current = key; xtSide.current = holderSideAt(pkg, t) ?? xtSide.current; }
      if (xtUploaded.current !== xtSide.current) {
        (xtTex.image.data as unknown as Float32Array).set(xtGrid(xtSide.current === 1)); xtTex.needsUpdate = true; xtUploaded.current = xtSide.current;
        u.uData.value = xtTex; u.uGrid.value.set(-L / 2, -W / 2, L, W); u.uSize.value.set(XT_NX, XT_NY); u.uMode.value = 4;
      }
      mesh.visible = true; return;
    }
    if (!space) { mesh.visible = false; return; }   // (for the types)
    xtUploaded.current = 0;
    if (key !== last.current) {
      last.current = key;
      const cells = spaceMap(space, which, t);
      if (!cells) { mesh.visible = false; return; }   // the ball was not tracked
      (tex.image.data as unknown as Float32Array).set(cells.subarray(0, nx * ny));
      tex.needsUpdate = true;
      const g = space.head.pc;
      u.uData.value = tex; u.uGrid.value.set(g.x0, g.y0, g.w, g.h); u.uSize.value.set(g.nx, g.ny);
      u.uMode.value = which === 'pc' ? 0 : 1;
      u.uAtt.value.copy(linear(LIGHT[attackTeam])); u.uDef.value.copy(linear(LIGHT[defenceTeam]));
    }
    mesh.visible = true;
  });

  return (
    <mesh ref={meshRef} rotation-x={-Math.PI / 2} position-y={LIFT_M} renderOrder={5} material={material} visible={false}>
      <planeGeometry args={[L, W]} />
    </mesh>
  );
}
