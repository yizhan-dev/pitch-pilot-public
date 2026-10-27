import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as THREE from 'three';
import wordSvg from '../../assets/brand/yizhan-06-horizontal-white.svg?raw';
import jostUrl from '../../assets/brand/fonts/jost-latin.woff2?url';
import { PitchSide } from './PitchSide';
import { withGoalBoards, boardLoopS } from './goalBoards';

import kickMarkUrl from '../../assets/brand/kick-mark-white.png?url';
import symbolUrl from '../../assets/brand/yizhan-06-symbol-white.svg?url';
import { liveBall } from '../liveBall';
import { GOAL, TOP_D, FILLET, netDepth } from './goalSpace';

const L = 105, W = 68;

// ---- goals, after a Premier League match goal: 7.32 m by 2.44 m, 12 cm white posts and crossbar; two curved rear
// supports from the top corners back and down to a ground frame 2 m behind the line; a white square-mesh net (12 cm
// mesh) draped over the supports, sagging a little between them. The net is a textured surface, not lines, so it
// reads as fine cord up close and as a soft white haze far away, with no shimmer.
/** The rear support's side profile in (d behind the line, y): a trapezoid, as on a match goal. The top runs back level
 *  to TOP_D, a straight stay slopes down to the ground frame at GOAL.depth, and both bends are small fillets. */
const SUPPORT: [number, number][] = (() => {
  const { h, depth } = GOAL, knee: [number, number] = [TOP_D, h], foot: [number, number] = [depth, 0];
  const sl = Math.hypot(foot[0] - knee[0], foot[1] - knee[1]), dir: [number, number] = [(foot[0] - knee[0]) / sl, (foot[1] - knee[1]) / sl];
  const pts: [number, number][] = [];
  for (let k = 0; k <= 8; k++) pts.push([(TOP_D - FILLET) * k / 8, h]);                       // level top
  for (let k = 1; k <= 8; k++) {                                                              // fillet at the knee
    const u = k / 8, a: [number, number] = [TOP_D - FILLET, h], b = knee, c: [number, number] = [knee[0] + dir[0] * FILLET, knee[1] + dir[1] * FILLET];
    pts.push([(1 - u) ** 2 * a[0] + 2 * u * (1 - u) * b[0] + u * u * c[0], (1 - u) ** 2 * a[1] + 2 * u * (1 - u) * b[1] + u * u * c[1]]);
  }
  for (let k = 1; k <= 16; k++) { const t = FILLET + (sl - FILLET) * k / 16; pts.push([knee[0] + dir[0] * t, knee[1] + dir[1] * t]); }   // straight stay
  return pts;
})();

function netTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64); g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 8); g.fillRect(0, 0, 8, 64);           // one mesh cell: cord along two edges (1.5 cm), knots where they cross
  g.beginPath(); g.arc(4, 4, 6, 0, 6.283); g.fill();
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function goalGeometry() {
  const { hw, h, mesh, sag } = GOAL;
  const prof = SUPPORT.map(([d, y]) => new THREE.Vector3(d, y, 0)), arc = [0];
  for (let k = 1; k < prof.length; k++) arc.push(arc[k - 1] + prof[k].distanceTo(prof[k - 1]));
  // the roof and back: the support profile swept across the goal, sagging between the supports (a parabola in z),
  // pushed along the profile's inward normal so the roof drops and the back bellies in slightly
  // Each net vertex also carries the way out of the goal there (aOut) and how free it is to move (aPin: 0 where it is
  // tied to the frame, the supports or the ground, 1 in open net), for the pocket a ball pushes into it.
  const NZ = 40, pos: number[] = [], uv: number[] = [], idx: number[] = [], out: number[] = [], pin: number[] = [];
  const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let k = 0; k < prof.length; k++) {
    const p = prof[k], tg = prof[Math.min(k + 1, prof.length - 1)].clone().sub(prof[Math.max(k - 1, 0)]).normalize();
    const o = new THREE.Vector3(-tg.y, tg.x, 0);
    if (o.x * (p.x - 0.7) + o.y * (p.y - 1.0) < 0) o.negate();
    const free = ss(0, 0.45, arc[k]) * ss(0, 0.12, arc[arc.length - 1] - arc[k]);
    const inward = new THREE.Vector3(-tg.y, tg.x, 0);                          // towards the inside of the goal
    if (inward.x * 1 + inward.y * 0 > 0 && p.y > 1.5) inward.negate();
    const fade = Math.min(1, arc[k] / 0.6) * Math.min(1, (arc[arc.length - 1] - arc[k]) / 0.4);
    for (let j = 0; j <= NZ; j++) {
      const z = -hw + (2 * hw) * j / NZ, s0 = sag * (1 - (z / hw) ** 2) * fade;
      pos.push(p.x - inward.x * s0 * 0, p.y - s0 * (p.y > 1.2 ? 1 : 0.4), z); uv.push(z / mesh, arc[k] / mesh);
      out.push(o.x, o.y, 0); pin.push(free * ss(0, 0.5, hw - Math.abs(z)));
    }
  }
  for (let k = 0; k < prof.length - 1; k++) for (let j = 0; j < NZ; j++) { const a = k * (NZ + 1) + j, b = a + NZ + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); top.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); top.setIndex(idx); top.computeVertexNormals();
  top.setAttribute('aOut', new THREE.Float32BufferAttribute(out, 3)); top.setAttribute('aPin', new THREE.Float32BufferAttribute(pin, 1));
  // the two side panels: the area under the support profile, from the post back to the ground frame, in ten rows so a
  // ball can push into them too
  const side = (z: number) => {
    const sp: number[] = [], su: number[] = [], si: number[] = [], so: number[] = [], sn: number[] = [], NY = 10;
    prof.forEach((p) => {
      for (let j = 0; j <= NY; j++) {
        const y = p.y * j / NY;
        sp.push(p.x, y, z); su.push(p.x / mesh, y / mesh); so.push(0, 0, Math.sign(z));
        sn.push(ss(0, 0.45, p.x) * ss(0, 0.12, y) * ss(0, 0.3, p.y - y));
      }
    });
    for (let k = 0; k < prof.length - 1; k++) for (let j = 0; j < NY; j++) { const a = k * (NY + 1) + j, b = a + NY + 1; si.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2)); g.setIndex(si); g.computeVertexNormals();
    g.setAttribute('aOut', new THREE.Float32BufferAttribute(so, 3)); g.setAttribute('aPin', new THREE.Float32BufferAttribute(sn, 1));
    return g;
  };
  const net = mergeGeometries([top, side(-hw), side(hw)]);
  // the frame: posts and crossbar (12 cm), the two rear supports and the ground frame (thinner)
  const tube = (pts: THREE.Vector3[], r: number) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5), 80, r, 10, false);
  const frame = mergeGeometries([
    new THREE.CylinderGeometry(GOAL.r, GOAL.r, h + GOAL.r, 16).translate(0, (h + GOAL.r) / 2, -hw),
    new THREE.CylinderGeometry(GOAL.r, GOAL.r, h + GOAL.r, 16).translate(0, (h + GOAL.r) / 2, hw),
    new THREE.CylinderGeometry(GOAL.r, GOAL.r, 2 * hw, 16).rotateX(Math.PI / 2).translate(0, h, 0),
  ]);
  const supports = mergeGeometries([
    tube(SUPPORT.map(([d, y]) => new THREE.Vector3(d, y, -hw)), 0.032), tube(SUPPORT.map(([d, y]) => new THREE.Vector3(d, y, hw)), 0.032),
    new THREE.CylinderGeometry(0.025, 0.025, 2 * hw, 10).rotateX(Math.PI / 2).translate(GOAL.depth, 0.025, 0),
    new THREE.CylinderGeometry(0.025, 0.025, GOAL.depth, 10).rotateZ(Math.PI / 2).translate(GOAL.depth / 2, 0.025, -hw),
    new THREE.CylinderGeometry(0.025, 0.025, GOAL.depth, 10).rotateZ(Math.PI / 2).translate(GOAL.depth / 2, 0.025, hw),
  ]);
  return { net, frame, supports };
}

/** a goal on the line x = side * L / 2, the net behind it, away from the pitch */
function Goal({ side }: { side: 1 | -1 }) {
  const geo = useMemo(goalGeometry, []);
  const netU = useMemo(() => ({ uBall: { value: new THREE.Vector3(0, -10, 0) }, uAmp: { value: 0 }, uHit: { value: new THREE.Vector3(0, -10, 0) }, uHitAmp: { value: 0 } }), []);
  useEffect(() => () => { geo.net.dispose(); geo.frame.dispose(); geo.supports.dispose(); }, [geo]);
  const mats = useMemo(() => ({
    // a little self-light, so the frame and net read bright white under floodlights as they do on television
    white: new THREE.MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.35, metalness: 0.05, emissive: '#ffffff', emissiveIntensity: 0.22 }),
    net: (() => {
      const m = new THREE.MeshStandardMaterial({ color: '#ffffff', map: netTexture(), emissive: '#ffffff', emissiveIntensity: 0.18, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, roughness: 0.9 });
      // when a mesh cell is only a few pixels wide, the cords would alias and the layers would moire; fade them into an
      // even haze of the same average density (about 25% cord) instead, which is how a net looks from a distance
      m.onBeforeCompile = (sh) => {
        // a ball in the goal pushes a pocket into the net round itself: every point of the net that the ball has gone
        // past (along the net's way out) moves out to just beyond the ball, fading with the distance to the side, and
        // less near the frame. uAmp is 1 while the ball is in the net, then rings down as the net springs back.
        // The ball's strike also throws the net out: a broad billow round the point of contact (about 1.3 m across), so
        // a shot into a corner, where the net is tied to the frame, still shakes the open net beside it; sized by the ball's
        // speed, which swings out and back as a damped spring (uHitAmp, metres, may go negative on the rebound).
        sh.uniforms.uBall = netU.uBall; sh.uniforms.uAmp = netU.uAmp; sh.uniforms.uHit = netU.uHit; sh.uniforms.uHitAmp = netU.uHitAmp;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aOut; attribute float aPin; uniform vec3 uBall, uHit; uniform float uAmp, uHitAmp;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            vec3 rel = uBall - position;
            float s = dot(rel, aOut); vec3 side = rel - s * aOut;
            vec3 hr = position - uHit;
            transformed += aOut * aPin * (max(0.0, s + 0.13) * exp(-dot(side, side) / 0.18) * uAmp + uHitAmp * exp(-dot(hr, hr) / 1.6));
          }`);
        sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
          #ifdef USE_MAP
            float netFw = max(length(fwidth(vMapUv)), 1e-4), netK = smoothstep(0.12, 0.25, netFw);   // mipmaps carry the mesh down to ~8 px cells; below that it turns to haze
            diffuseColor = mix(diffuseColor, vec4(diffuse, 0.25 * opacity), netK);
          #endif`);
      };
      m.customProgramCacheKey = () => 'net-haze-v7';
      return m;
    })(),
  }), [netU]);
  // the ball in the goal's own frame (d behind the line, up, across): in the net from the moment it crosses the line
  // under the bar until it leaves the goal or is lost; then the net springs back, overshooting a little (about 0.65 s a
  // swing, damping ratio about 0.35)
  const st = useRef({ inGoal: false, prevD: null as number | null, amp: 0, vel: 0, lb: new THREE.Vector3(), prev: new THREE.Vector3(), prevT: 0, hit: false, hx: 0, hv: 0 });
  useFrame((_, dt) => {
    const s = st.current, lb = s.lb, h = Math.min(dt, 0.05);
    const ok = liveBall.ok;
    if (ok) lb.set((liveBall.p.x - side * L / 2) * side, liveBall.p.y, liveBall.p.z);
    // the strike: the first time in a goal that the ball reaches the net, kick the billow by the ball's speed
    if (s.inGoal && !s.hit && ok && lb.x >= netDepth(lb.y) - 0.25) {
      const sp = liveBall.t > s.prevT ? lb.distanceTo(s.prev) / (liveBall.t - s.prevT) : 0;
      s.hit = true; netU.uHit.value.copy(lb); s.hx = 0; s.hv = Math.min(30, sp) * 0.38;
    }
    s.hv += (-100 * s.hx - 7 * s.hv) * h; s.hx += s.hv * h;
    netU.uHitAmp.value = s.hx;
    if (ok) { s.prev.copy(lb); s.prevT = liveBall.t; }
    const inside = ok && lb.x > -0.3 && lb.x < GOAL.depth + 2 && Math.abs(lb.z) < GOAL.hw + 0.4 && lb.y < GOAL.h + 0.4;
    if (!s.inGoal && ok && s.prevD !== null && s.prevD < 0 && lb.x >= 0 && Math.abs(lb.z) < GOAL.hw && lb.y < GOAL.h) { s.inGoal = true; s.hit = false; }
    if (s.inGoal && !inside) s.inGoal = false;
    if (s.inGoal) { netU.uBall.value.copy(lb); s.amp = 1; s.vel = 0; }
    else { s.vel += (-90 * s.amp - 6.5 * s.vel) * h; s.amp += s.vel * h; if (Math.abs(s.amp) < 1e-3 && Math.abs(s.vel) < 1e-3) s.amp = s.vel = 0; }
    netU.uAmp.value = s.amp;
    s.prevD = ok ? lb.x : null;
  });
  return (
    <group position={[side * L / 2, 0, 0]} scale={[side, 1, 1]}>
      <mesh geometry={geo.frame} material={mats.white} castShadow />
      <mesh geometry={geo.supports} material={mats.white} castShadow />
      <mesh geometry={geo.net} material={mats.net} renderOrder={2} />
    </group>
  );
}

// ---- LED perimeter boards: the YIZHAN signature along the touchlines, the slogan behind the goals.
// Black LED field, pure white content, as the identity guidelines require (src/assets/brand/README.md).
const PX = 128;                      // texture pixels per metre
const BOARD_H = 0.9, BOARD_T = 0.14, TILT = THREE.MathUtils.degToRad(10);
const SIG_TILE = 5, KICK_TILE = 6, SLOGAN_TILE = 10;  // metres of board per repeat: the signature 2.4 m wide, the KICK lockup about 4 m, the slogan about 6.5 m
const BENCH_GAP = 17;                // the main-side boards stop this far either side of halfway

function ledTexture(tileM: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => Promise<void> | void, onReady: () => void) {
  const c = document.createElement('canvas'); c.width = Math.round(tileM * PX); c.height = Math.round(BOARD_H * PX);
  const g = c.getContext('2d')!;
  g.fillStyle = '#000000'; g.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8;
  Promise.resolve(draw(g, c.width, c.height)).then(() => { t.needsUpdate = true; onReady(); });
  return t;
}

/** the master signature, scaled, centred: its visible symbol height is 0.5 m on a 0.9 m board */
function drawSignature(g: CanvasRenderingContext2D, w: number, h: number) {
  return new Promise<void>((res) => {
    const img = new Image();
    img.onload = () => { const H = 0.5 * PX, ar = img.width / img.height || 4.836; g.drawImage(img, (w - ar * H) / 2, (h - H) / 2, ar * H, H); res(); };
    img.onerror = () => res();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(wordSvg);
  });
}

/** Project KICK: the monogram (the pure icon, assets/brand/kick-mark-white.png) 0.5 m tall like the YIZHAN symbol,
 *  beside PROJECT KICK in Jost, tracked capitals (Yi, 2026-10-23: "I personally like Jost") */
async function drawKick(g: CanvasRenderingContext2D, w: number, h: number) {
  try { const f = new FontFace('Jost', `url(${jostUrl})`); await f.load(); document.fonts.add(f); } catch { /* the fallback face still reads */ }
  const img = await new Promise<HTMLImageElement | null>((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = kickMarkUrl; });
  g.font = `500 ${Math.round(0.42 * PX)}px Jost, "Helvetica Neue", Arial, sans-serif`;
  (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${Math.round(0.05 * PX)}px`;
  const text = 'PROJECT KICK', tw = g.measureText(text).width, ih = 0.5 * PX, iw = img ? ih * (img.width / img.height) : 0, gap = 0.28 * PX;
  const x0 = (w - (iw + gap + tw)) / 2;
  if (img) g.drawImage(img, x0, (h - ih) / 2, iw, ih);
  g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText(text, x0 + iw + gap, h * 0.53);
}

/** the slogan as set on yizhan.dev: Jost, sentence case, white */
async function drawSlogan(g: CanvasRenderingContext2D, w: number, h: number) {
  try { const f = new FontFace('Jost', `url(${jostUrl})`); await f.load(); document.fonts.add(f); } catch { /* the fallback face still reads */ }
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `500 ${Math.round(0.5 * PX)}px Jost, "Helvetica Neue", Arial, sans-serif`;
  g.fillText('Intelligence takes flight.', w / 2, h * 0.53);
}

/** Board runs: 4 m off the touchlines and 5.5 m behind the goal lines, square to the lines, as in a real ground. The corners
 *  stay open (UEFA allows gaps there), so the corner taker has room: the side boards stop at x = 53, the end boards at
 *  z = 33, about 4 m and 5.5 m from the flag, and the stand wall is set back at the corners (layout cornerSetback). */
const RUNS: { a: [number, number]; b: [number, number]; kind: 'side' | 'end' }[] = (() => {
  const zs = W / 2 + 4, xe = L / 2 + 5.5, xs = L / 2 + 0.5, ze = W / 2 - 1;
  return [
    // the main (+z) side breaks between the benches, which must see the whole pitch
    { a: [-xs, -zs], b: [xs, -zs], kind: 'side' }, { a: [xs, zs], b: [BENCH_GAP, zs], kind: 'side' }, { a: [-BENCH_GAP, zs], b: [-xs, zs], kind: 'side' },
    { a: [xe, -ze], b: [xe, ze], kind: 'end' }, { a: [-xe, ze], b: [-xe, -ze], kind: 'end' },
  ];
})();

function AdBoards() {
  const invalidate = useThree((st) => st.invalidate);
  // Every board runs the same three banners in turn (Yi, 2026-10-23: "yizhan -> projkick -> our slogan"): each holds
  // 4 s, then the next pushes it up and out over 0.5 s, all boards together, on the stadium's clock (paused, they hold).
  // (Before: the signature on the side boards, the slogan on the end boards, fixed.)
  const tex = useMemo(() => ({ sig: ledTexture(SIG_TILE, drawSignature, invalidate), kick: ledTexture(KICK_TILE, drawKick, invalidate), slogan: ledTexture(SLOGAN_TILE, drawSlogan, invalidate) }), [invalidate]);
  const white = useMemo(() => { const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); t.needsUpdate = true; return t; }, []);   // keeps the emissive map's uv path
  // The LED face sat 1 mm in front of the box: from the broadcast camera, 60-100 m away, the depth buffer cannot tell
  // them apart, and the white content blinked as the camera moved (Yi, 2026-10-21; measured: 1,223 pixels flipping
  // between renders 1 cm apart on the far boards). The box now stands 1 cm behind the face, and the face wins every
  // depth tie whatever the distance (polygon offset towards the camera).
  const led = { roughness: 0.6, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
  // the banners, then the goal message in coloured dots over them (goalBoards.ts)
  const banner = useMemo(() => ({
    // uAdT: the rotation's clock; uAdOff: a vertical shift of the whole rotation, banner heights (the goal message's exit
    // pushes the first banner in from below: goalBoards.ts); both set by the goal code's tick
    uniforms: { uAd0: { value: tex.sig }, uAd1: { value: tex.kick }, uAd2: { value: tex.slogan }, uAdT: { value: 0 }, uAdOff: { value: 0 } },
    // each board shows a whole number of each banner's tiles, the spare length dark at both ends (Yi, 2026-10-25: the
    // tiles were centred on the board, so a run of an even count, like the 36 m runs by the benches, ended on half a
    // PROJECT KICK); tiles keep their width, so the marks are never stretched. vAdA / vAdB: where each banner's tiles
    // start and end on this board, in metres from its left end (sig, kick, slogan)
    vdecl: 'attribute vec3 aAdA, aAdB; varying vec3 vAdA, vAdB;',
    vmain: 'vAdA = aAdA; vAdB = aAdB;',
    decl: `uniform sampler2D uAd0, uAd1, uAd2; uniform float uAdT, uAdOff; varying vec3 vAdA, vAdB;
      // q: metres from the board's left end, height 0..1; dx, dy: q's screen derivatives, taken where q is continuous. At
      // the push's seam the sampled height jumps by a whole banner, and derivatives taken there pick the coarsest mip
      // level: a grey line ran along the seam (Yi, 2026-10-23). Explicit gradients keep the sharp level.
      vec3 adTex(sampler2D m, float tile, float a, float b, vec2 q, vec2 dx, vec2 dy) {
        if (q.x < a || q.x > b) return vec3(0.0);
        return textureGrad(m, vec2((q.x - a) / tile, q.y), vec2(dx.x / tile, dx.y), vec2(dy.x / tile, dy.y)).rgb;
      }
      vec3 adSample(float k, vec2 q, vec2 dx, vec2 dy) {
        if (k < 0.5) return adTex(uAd0, ${SIG_TILE.toFixed(1)}, vAdA.x, vAdB.x, q, dx, dy);
        if (k < 1.5) return adTex(uAd1, ${KICK_TILE.toFixed(1)}, vAdA.y, vAdB.y, q, dx, dy);
        return adTex(uAd2, ${SLOGAN_TILE.toFixed(1)}, vAdA.z, vAdB.z, q, dx, dy);
      }`,
    frag: `{
        const float HOLD = 4.5, PUSH = 0.5;   // 4 s still, then a 0.5 s push (7 s still was too slow, Yi)
        float ph = uAdT / HOLD, cur = mod(floor(ph), 3.0), nxt = mod(cur + 1.0, 3.0), s = smoothstep(HOLD - PUSH, HOLD, fract(ph) * HOLD);
        vec2 q = vEmissiveMapUv, dx = dFdx(q), dy = dFdy(q); float y = q.y - s + uAdOff;   // the old banner rises out of the top, the next from below
        totalEmissiveRadiance *= y >= 1.0 ? vec3(0.0) : y >= 0.0 ? adSample(cur, vec2(q.x, y), dx, dy) : adSample(nxt, vec2(q.x, y + 1.0), dx, dy);
      }`,
  }), [tex]);
  const gb = useMemo(() => withGoalBoards(new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: white, emissiveIntensity: 1, ...led }), banner), [banner, white]);   // eslint-disable-line react-hooks/exhaustive-deps
  useFrame(() => gb.tick());   // the banners' clock and the goal message (goalBoards.ts)
  const mats = useMemo(() => ({
    led: gb.material,
    body: new THREE.MeshStandardMaterial({ color: '#16181c', roughness: 0.7, metalness: 0.2 }),
  }), [gb]);
  const boards = useMemo(() => RUNS.map((r) => {
    const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1], len = Math.hypot(dx, dz), mx = (r.a[0] + r.b[0]) / 2, mz = (r.a[1] + r.b[1]) / 2;
    // face the pitch: the plane's +z must point back towards the centre spot
    let nx = -dz / len, nz = dx / len; if (nx * -mx + nz * -mz < 0) { nx = -nx; nz = -nz; }
    const yaw = Math.atan2(nx, nz);
    // u in metres from the board's left end; per banner, the whole tiles that fit, centred (the spare length split between
    // the ends), so every banner sits symmetrically on every run and never ends on a part of a tile
    const face = new THREE.PlaneGeometry(len, BOARD_H), uv = face.getAttribute('uv') as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * len);
    const span = (tile: number) => { const n = Math.max(1, Math.floor(len / tile + 1e-6)), a = (len - n * tile) / 2; return [a, a + n * tile]; };
    const [s0, s1] = span(SIG_TILE), [k0, k1] = span(KICK_TILE), [l0, l1] = span(SLOGAN_TILE);
    face.setAttribute('aAdA', new THREE.Float32BufferAttribute(Array.from({ length: uv.count }, () => [s0, k0, l0]).flat(), 3));
    face.setAttribute('aAdB', new THREE.Float32BufferAttribute(Array.from({ length: uv.count }, () => [s1, k1, l1]).flat(), 3));
    // aGbS: the boards' loop coordinate (goalBoards.ts), from each vertex's place on the pitch
    const fp = face.getAttribute('position') as THREE.BufferAttribute, lx = Math.cos(yaw), lz = -Math.sin(yaw), aS: number[] = [];
    for (let k = 0; k < fp.count; k++) aS.push(boardLoopS(mx + lx * fp.getX(k), mz + lz * fp.getX(k)));
    face.setAttribute('aGbS', new THREE.Float32BufferAttribute(aS, 1));
    return { mx, mz, yaw, len, face, kind: r.kind };
  }), []);
  useEffect(() => () => { boards.forEach((b) => b.face.dispose()); tex.sig.dispose(); tex.kick.dispose(); tex.slogan.dispose(); white.dispose(); }, [boards, tex, white]);
  return (
    <group>
      {boards.map((b, k) => (
        <group key={k} position={[b.mx, 0, b.mz]} rotation={[0, b.yaw, 0]}>
          {/* leaning back 10 degrees, about its foot */}
          <group rotation-x={-TILT}>
            <mesh geometry={b.face} material={mats.led} position={[0, BOARD_H / 2, 0.001]} />
            <mesh material={mats.body} position={[0, BOARD_H / 2, -BOARD_T / 2 - 0.01]}><boxGeometry args={[b.len, BOARD_H, BOARD_T]} /></mesh>
          </group>
        </group>
      ))}
    </group>
  );
}

// ---- pitch-level furniture on the main (+z) side, after the UEFA stadium rules: covered benches either side of halfway,
// 5 m off the touchline; the fourth official's desk between them; the players' tunnel at halfway; technical areas marked
// 1 m from the touchline and 1 m beyond each bench.
const BENCH = { len: 11, depth: 2.6, front: W / 2 + 5, cx: 9.75, seats: 21 };

/** a modern dugout: white plinth, two stepped rows of seats under a curved clear canopy */
function Dugout({ x }: { x: number }) {
  const g = useMemo(() => {
    const L2 = BENCH.len / 2, zf = BENCH.front, zb = BENCH.front + BENCH.depth;
    // canopy section in (z, y): from the back, up and over, to a lip at the front
    const prof: [number, number][] = [[zb, 0.35], [zb, 1.7], [zb - 0.3, 2.25], [zb - 1.0, 2.5], [zb - 1.8, 2.4], [zf, 1.95]];
    const pos: number[] = [], idx: number[] = [];
    prof.forEach(([z, y]) => pos.push(-L2, y, z, L2, y, z));
    for (let k = 0; k < prof.length - 1; k++) { const a = 2 * k; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const shell = new THREE.BufferGeometry(); shell.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); shell.setIndex(idx); shell.computeVertexNormals();
    const end = new THREE.Shape(); end.moveTo(zf, 0.35); prof.forEach(([z, y]) => end.lineTo(z, y)); end.lineTo(zf, 0.35);
    const endGeo = new THREE.ShapeGeometry(end); endGeo.rotateY(-Math.PI / 2);   // shape x -> world z
    const lip = new THREE.CatmullRomCurve3(prof.map(([z, y]) => new THREE.Vector3(0, y, z)));
    const frame = new THREE.TubeGeometry(lip, 24, 0.045, 6, false);
    return { shell, endGeo, frame, zf, zb, L2 };
  }, []);
  useEffect(() => () => { g.shell.dispose(); g.endGeo.dispose(); g.frame.dispose(); }, [g]);
  const seat = useMemo(() => {
    const pan = new THREE.BoxGeometry(0.46, 0.08, 0.44), back = new THREE.BoxGeometry(0.46, 0.5, 0.06).translate(0, 0.27, 0.2);
    return mergeGeometries([pan, back]);
  }, []);
  const seats = useMemo(() => {
    const m = new THREE.InstancedMesh(seat, new THREE.MeshStandardMaterial({ color: '#2a2e35', roughness: 0.6 }), BENCH.seats * 2), M = new THREE.Matrix4();
    let k = 0;
    for (const [dz, y] of [[0.65, 0.8], [1.6, 1.15]] as const) for (let i = 0; i < BENCH.seats; i++) {
      M.makeTranslation(-BENCH.len / 2 + 0.5 + i * (BENCH.len - 1) / (BENCH.seats - 1), y, g.zf + dz); m.setMatrixAt(k++, M);
    }
    m.instanceMatrix.needsUpdate = true; return m;
  }, [seat, g]);
  const white = '#e8ebef';
  return (
    <group position={[x, 0, 0]}>
      <mesh position={[0, 0.175, g.zf + BENCH.depth / 2]}><boxGeometry args={[BENCH.len, 0.35, BENCH.depth]} /><meshStandardMaterial color={white} roughness={0.5} /></mesh>
      <mesh position={[0, 0.55, g.zf + 1.55]}><boxGeometry args={[BENCH.len - 0.2, 0.4, 1.0]} /><meshStandardMaterial color={white} roughness={0.5} /></mesh>
      <primitive object={seats} />
      <mesh geometry={g.shell}><meshStandardMaterial color="#dfe8f0" transparent opacity={0.2} roughness={0.05} metalness={0.1} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      {[-g.L2, g.L2].map((ex) => (
        <group key={ex} position={[ex, 0, 0]}>
          <mesh geometry={g.endGeo}><meshStandardMaterial color="#dfe8f0" transparent opacity={0.2} roughness={0.05} side={THREE.DoubleSide} depthWrite={false} /></mesh>
          <mesh geometry={g.frame}><meshStandardMaterial color={white} roughness={0.4} /></mesh>
        </group>
      ))}
    </group>
  );
}

/** the players' tunnel at halfway: a dark opening in the front wall and a white telescopic canopy */
function Tunnel() {
  const ribs = [0, 0.75, 1.5, 2.25, 3.0];
  const z0 = HY_WALL, z1 = HY_WALL - 3.0;
  return (
    <group>
      <mesh position={[0, 1.05, z0 - 0.02]} rotation-y={Math.PI}><planeGeometry args={[4.2, 2.1]} /><meshStandardMaterial color="#050608" roughness={1} /></mesh>
      <mesh position={[0, 0, (z0 + z1) / 2]} rotation={[-Math.PI / 2, 0, 0]} scale={[1, 1, 1.25]}>
        <cylinderGeometry args={[1.8, 1.8, z0 - z1, 24, 1, true, -Math.PI / 2, Math.PI]} />
        <meshStandardMaterial color="#f2f4f6" transparent opacity={0.55} roughness={0.4} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {ribs.map((dz) => (
        <mesh key={dz} position={[0, 0, z0 - dz]} scale={[1, 1.25, 1]}><torusGeometry args={[1.8, 0.05, 6, 24, Math.PI]} /><meshStandardMaterial color="#ffffff" roughness={0.4} /></mesh>
      ))}
    </group>
  );
}
const HY_WALL = 42.5;   // the bowl's front wall on the main side (layout HY)

function FourthOfficial() {
  return (
    <group position={[0, 0, BENCH.front - 0.6]}>
      <mesh position={[0, 0.38, 0]}><boxGeometry args={[1.6, 0.76, 0.6]} /><meshStandardMaterial color="#e8ebef" roughness={0.5} /></mesh>
      <mesh position={[0, 0.25, 0.55]}><boxGeometry args={[0.5, 0.5, 0.5]} /><meshStandardMaterial color="#2a2e35" roughness={0.6} /></mesh>
    </group>
  );
}

/** technical areas: dashed white lines on the grass, 1 m from the touchline and 1 m beyond each bench */
function TechnicalAreas() {
  const mesh = useMemo(() => {
    const dash = 0.6, gap = 0.4, w = 0.1, segs: [number, number, number, number][] = [];
    for (const cx of [-BENCH.cx, BENCH.cx]) {
      const x0 = cx - BENCH.len / 2 - 1, x1 = cx + BENCH.len / 2 + 1, z0 = W / 2 + 1, z1 = BENCH.front;
      segs.push([x0, z0, x1, z0], [x0, z0, x0, z1], [x1, z0, x1, z1]);
    }
    const pos: THREE.Matrix4[] = [];
    for (const [ax, az, bx, bz] of segs) {
      const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len, ang = Math.atan2(ux, uz);
      for (let t = 0; t < len; t += dash + gap) {
        const l = Math.min(dash, len - t), c = new THREE.Vector3(ax + ux * (t + l / 2), 0.012, az + uz * (t + l / 2));
        pos.push(new THREE.Matrix4().compose(c, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang), new THREE.Vector3(w, 1, l)));
      }
    }
    const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.004, 1), new THREE.MeshStandardMaterial({ color: '#eef1ea', roughness: 0.9 }), pos.length);
    pos.forEach((M, k) => m.setMatrixAt(k, M)); m.instanceMatrix.needsUpdate = true;
    return m;
  }, []);
  return <primitive object={mesh} />;
}

function Dugouts() {
  return <group><Dugout x={-BENCH.cx} /><Dugout x={BENCH.cx} /><FourthOfficial /><Tunnel /><TechnicalAreas /></group>;
}

// ---- corner flags, after Law 1 and match practice: a post 1.5 m tall with a rounded top, 3 cm across, white, on a short
// black spring collar at the ground; a cloth flag 47 x 32 cm (a common match size) hanging from the top of the post and
// stirring in a light breeze, the same breeze for all four. Clubs fly their colours and crest on the corner flags; ours
// is black with the YIZHAN symbol in white (the master artwork, with well over 0.25 H clear), and reads right way round
// from both sides.
const FLAG_W = 0.47, FLAG_H = 0.32, POST = 1.5;

function flagTexture() {
  const c = document.createElement('canvas'); c.width = 470; c.height = 320;
  const g = c.getContext('2d')!; g.fillStyle = '#000000'; g.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const img = new Image();
  // the symbol 150 px tall (viewBox 133.25 x 100), centred: 85 px clear above and below, far more than 0.25 H
  img.onload = () => { const h = 150, w = h * 1.332473; g.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h); t.needsUpdate = true; };
  img.src = symbolUrl;
  return t;
}

function flagMaterial() {
  const m = new THREE.MeshStandardMaterial({ map: flagTexture(), side: THREE.DoubleSide, roughness: 0.85 });
  const uniforms = { uTime: { value: 0 } };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    // the cloth hangs from the post edge (u = 0): it droops towards the free edge and ripples there, a slow wave running
    // out along it; the post edge stays put
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
      float u = uv.x, ph = uTime * 2.1 - u * 5.0;
      transformed.y -= 0.13 * u * u + 0.012 * u * sin(ph * 0.7);
      transformed.x *= 1.0 - 0.18 * u;
      transformed.z += u * (0.045 * sin(ph) + 0.015 * sin(ph * 2.3 + uv.y * 3.0));`);
    // seen from the back the print reads the right way round, as on a flag printed on both sides
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
      vec2 fuv = gl_FrontFacing ? vMapUv : vec2(1.0 - vMapUv.x, vMapUv.y);
      diffuseColor *= texture2D(map, fuv);`);
  };
  m.customProgramCacheKey = () => 'corner-flag-v1';
  return { m, uniforms };
}

function CornerFlags() {
  const flag = useMemo(flagMaterial, []);
  const geo = useMemo(() => new THREE.PlaneGeometry(FLAG_W, FLAG_H, 16, 8).translate(FLAG_W / 2, -FLAG_H / 2, 0), []);
  useEffect(() => () => { geo.dispose(); flag.m.dispose(); }, [geo, flag]);
  useFrame(({ clock }) => { flag.uniforms.uTime.value = clock.elapsedTime; });
  return (
    <group>
      {[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sz], i) => (
        <group key={i} position={[sx * L / 2, 0, sz * W / 2]}>
          <mesh position={[0, 0.06, 0]}><cylinderGeometry args={[0.022, 0.024, 0.12, 12]} /><meshStandardMaterial color="#111317" roughness={0.5} /></mesh>
          <mesh position={[0, POST / 2, 0]} castShadow><cylinderGeometry args={[0.015, 0.015, POST, 12]} /><meshStandardMaterial color="#f2f2f0" roughness={0.45} /></mesh>
          <mesh position={[0, POST, 0]}><sphereGeometry args={[0.017, 12, 8]} /><meshStandardMaterial color="#f2f2f0" roughness={0.45} /></mesh>
          {/* the breeze blows towards +x, so every flag streams the same way, just below the rounded top */}
          <mesh geometry={geo} material={flag.m} position={[0.016, POST - 0.03, 0]} castShadow />
        </group>
      ))}
    </group>
  );
}

/** The goal celebration's champagne fountains (players/Celebration.tsx) rise from 3 m behind the goal line, 5.5 m and
 *  11 m either side of the goal's centre (four per goal since 2026-10-23, two before); with nothing there they seemed
 *  to come out of the grass (Yi, 2026-10-22). A small black
 *  spark jet stands at each of those four points, as at real grounds: a low cabinet with a short nozzle, whose mouth is
 *  the fountain's origin, 0.32 m up (Celebration.tsx lowered from 1.2 m to match). Yi found the first two versions too
 *  big: a 0.66 m cabinet with the nozzle at 1.2 m, then a mast. */
const LAUNCH = { x: 52.5 + 3, z: [5.5, 11], top: 0.32 };   // two each side of each goal (Yi, 2026-10-23: four fountains)
function Launchers() {
  const mats = useMemo(() => ({
    body: new THREE.MeshStandardMaterial({ color: '#0e1013', roughness: 0.55, metalness: 0.35 }),
    plate: new THREE.MeshStandardMaterial({ color: '#2a2e35', roughness: 0.4, metalness: 0.5 }),
    mouth: new THREE.MeshStandardMaterial({ color: '#050506', roughness: 0.9 }),
  }), []);
  useEffect(() => () => { mats.body.dispose(); mats.plate.dispose(); mats.mouth.dispose(); }, [mats]);
  const units = [-1, 1].flatMap((sx) => [-1, 1].flatMap((sz) => LAUNCH.z.map((z) => [sx * LAUNCH.x, sz * z] as const)));
  return (
    <group>
      {units.map(([x, z]) => (
        <group key={`${x},${z}`} position={[x, 0, z]}>
          <mesh material={mats.body} position-y={0.1}><boxGeometry args={[0.24, 0.2, 0.24]} /></mesh>
          <mesh material={mats.plate} position-y={0.21}><boxGeometry args={[0.25, 0.02, 0.25]} /></mesh>
          <mesh material={mats.body} position-y={0.27}><cylinderGeometry args={[0.04, 0.05, 0.1, 12]} /></mesh>
          <mesh material={mats.mouth} position-y={LAUNCH.top + 0.001} rotation-x={-Math.PI / 2}><circleGeometry args={[0.028, 12]} /></mesh>
        </group>
      ))}
    </group>
  );
}

export function Furniture() {
  return <group><Goal side={-1} /><Goal side={1} /><AdBoards /><Dugouts /><CornerFlags /><PitchSide /><Launchers /></group>;
}
