import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import symbolSvg from '../../../assets/brand/yizhan-06-symbol-white.svg?raw';
import wordSvg from '../../../assets/brand/yizhan-06-horizontal-white.svg?raw';
import jostUrl from '../../../assets/brand/fonts/jost-latin.woff2?url';

// The big screen, drawn as dots (Yi, 2026-10-22: "I love halftone, since our audience is represented in this way too").
// One shader draws every direction under test (ScreenLab.tsx, /screen.html): the screen face is a grid of dots, each
// dot's size or state read from a content canvas at the dot's centre.
// - matrix:   a dot-matrix scoreboard; every dot the same size, on or off, the unlit ones faintly visible.
// - halftone: amplitude halftone; dot size follows the content's brightness, so soft edges and glows become
//             shrinking dots, as in print and as in our crowd.
// - portrait: a player spotlight; the player's portrait in halftone beside his number in dot matrix.
// - wave:     the idle screen; a slow wave runs through a field of small dots and the YIZHAN symbol stands in full dots.
// - flip:     a flip-dot board; white-and-black discs turn over in a sweep as the content changes (score, then mark).
// - replay:   the match picture itself in halftone, as a replay would be shown (a still from the broadcast view here).
// - tactics:  the screen mirrors the crowd: a top-down dot map of the pitch, A's players filled dots, B's rings.
// Black and white only, as the brand asks; content is placeholder (teams A and B, an invented shirt number).

export type ScreenDir = 'matrix' | 'halftone' | 'portrait' | 'wave' | 'flip' | 'replay' | 'tactics';
export const DIRS: { key: ScreenDir; label: string }[] = [
  { key: 'matrix', label: '点阵记分牌' }, { key: 'halftone', label: '网点渐变' }, { key: 'portrait', label: '网点肖像' },
  { key: 'wave', label: '呼吸网点' }, { key: 'flip', label: '翻点板' }, { key: 'replay', label: '网点回放' }, { key: 'tactics', label: '战术点图' },
];
export type ScreenParams = { dir: ScreenDir; w: number; h: number; pitch: number; dot: number; off: number; angle: number; gain: number };
// pitch 0.28 m: from the centre circle, 90 m away, a dot is still about four pixels, so the halftone reads as dots
export const SCREEN_DEFAULT: ScreenParams = { dir: 'matrix', w: 20, h: 4.4, pitch: 0.28, dot: 0.82, off: 0.06, angle: 0, gain: 1 };
const MODE: Record<ScreenDir, number> = { matrix: 0, halftone: 1, portrait: 2, wave: 3, flip: 4, replay: 5, tactics: 6 };

const loadImg = (src: string) => new Promise<HTMLImageElement | null>((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
const svg = (s: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
let fontReady: Promise<void> | null = null;
const jost = () => (fontReady ??= (async () => { try { const f = new FontFace('Jost', `url(${jostUrl})`); await f.load(); document.fonts.add(f); } catch { /* fallback */ } })());

/** Two canvases per direction, drawn at 100 px per metre: A, the content's brightness; B, where amplitude halftone applies
 *  (white) instead of on/off dots (black). The flip board uses B as its second frame instead. */
async function drawContent(dir: ScreenDir, w: number, h: number, portraitUrl: string, replayUrl: string) {
  const PX = 100, W = Math.round(w * PX), H = Math.round(h * PX);
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d')!; g.fillStyle = '#000'; g.fillRect(0, 0, W, H); return { c, g }; };
  const A = mk(), B = mk();
  await jost();
  const [sym, word] = await Promise.all([loadImg(svg(symbolSvg)), loadImg(svg(wordSvg))]);
  const score = (g: CanvasRenderingContext2D, x0: number, x1: number, glow = 0) => {
    // A 1:0 B, the clock at the right: about nine dots tall, which a 队 does not survive, so the teams are their letters
    const cy = H * 0.53; g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.shadowColor = '#fff'; g.shadowBlur = glow;
    const at = (m: number) => x0 + m * PX;                      // metres from x0
    g.font = `600 ${Math.round(2.9 * PX)}px Jost, sans-serif`;
    g.fillText('A', at(1.6), cy); g.fillText('1:0', at(5.2), cy); g.fillText('B', at(8.8), cy);
    g.font = `600 ${Math.round(2.8 * PX)}px Jost, sans-serif`; g.fillText('15:23', at(13.3), cy);
    void x1;
    g.shadowBlur = 0;
  };
  const symbol = (g: CanvasRenderingContext2D, cx: number, hM: number) => { if (!sym) return; const hh = hM * PX, ww = hh * (sym.width / sym.height || 1); g.drawImage(sym, cx - ww / 2, (H - hh) / 2, ww, hh); };
  if (dir === 'matrix') { symbol(A.g, 1.7 * PX, 3.0); score(A.g, 3.4 * PX, W); }
  if (dir === 'halftone') {
    // a soft light band behind the score: the dots grow towards it and shrink away; the text glows
    const grd = A.g.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, W * 0.55);
    grd.addColorStop(0, 'rgba(255,255,255,0.32)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); A.g.fillStyle = grd; A.g.fillRect(0, 0, W, H);
    symbol(A.g, 1.7 * PX, 3.0); score(A.g, 3.4 * PX, W, 0.35 * PX);
    B.g.fillStyle = '#fff'; B.g.fillRect(0, 0, W, H);
  }
  if (dir === 'portrait') {
    const img = await loadImg(portraitUrl), pw = Math.round(H * 0.79);
    if (img) { A.g.filter = 'contrast(1.35) brightness(1.35)'; A.g.drawImage(img, 0.4 * PX, 0, pw, H); A.g.filter = 'none'; }
    B.g.fillStyle = '#fff'; B.g.fillRect(0, 0, 0.4 * PX + pw, H);
    const x = 0.4 * PX + pw + 0.8 * PX, g = A.g; g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.font = `600 ${Math.round(3.8 * PX)}px Jost, sans-serif`; g.fillText('7', x, H * 0.54);
    g.font = `500 ${Math.round(2.4 * PX)}px Jost, sans-serif`; g.fillText('xG 0.39', x + 2.9 * PX, H * 0.54);
    symbol(g, W - 1.6 * PX, 2.6);
  }
  if (dir === 'wave') symbol(A.g, W / 2, 3.6);
  if (dir === 'replay') {
    const img = await loadImg(replayUrl);
    if (img) { const s = Math.max(W / img.width, H / img.height); A.g.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s); }
    B.g.fillStyle = '#fff'; B.g.fillRect(0, 0, W, H);
  }
  if (dir === 'tactics') {
    // the pitch 6.6 m by 4.3 m in the middle, its lines one fine dot wide; players at a moment of the clip (placeholder)
    const pw = 6.6 * PX, ph = 4.27 * PX, ox = (W - pw) / 2, oy = (H - ph) / 2, X = (x: number) => ox + (x / 105 + 0.5) * pw, Y = (y: number) => oy + (y / 68 + 0.5) * ph;
    const g = A.g; g.strokeStyle = 'rgba(255,255,255,0.42)'; g.lineWidth = 0.1 * PX;
    g.strokeRect(ox, oy, pw, ph); g.beginPath(); g.moveTo(X(0), Y(-34)); g.lineTo(X(0), Y(34)); g.stroke();
    g.beginPath(); g.arc(X(0), Y(0), (9.15 / 105) * pw, 0, Math.PI * 2); g.stroke();
    for (const sx of [-1, 1]) g.strokeRect(sx < 0 ? X(-52.5) : X(52.5 - 16.5), Y(-20.16), (16.5 / 105) * pw, (40.32 / 68) * ph);
    const a: [number, number][] = [[-48, 0], [-30, -20], [-32, -6], [-31, 7], [-29, 21], [-12, -14], [-14, 2], [-9, 15], [6, -24], [10, -4], [14, 18]];
    const b: [number, number][] = [[49, 0], [27, -18], [29, -5], [30, 8], [26, 20], [16, -10], [18, 5], [12, 22], [2, -14], [4, 10], [-6, -2]];
    g.fillStyle = '#fff'; for (const [x, y] of a) { g.beginPath(); g.arc(X(x), Y(y), 0.3 * PX, 0, Math.PI * 2); g.fill(); }
    g.lineWidth = 0.13 * PX; g.strokeStyle = '#fff'; for (const [x, y] of b) { g.beginPath(); g.arc(X(x), Y(y), 0.26 * PX, 0, Math.PI * 2); g.stroke(); }
    g.beginPath(); g.arc(X(8), Y(-2), 0.1 * PX, 0, Math.PI * 2); g.fill();
    B.g.fillStyle = '#fff'; B.g.fillRect(ox - 0.2 * PX, 0, pw + 0.4 * PX, H);
    symbol(g, 1.7 * PX, 3.0);
    g.textBaseline = 'middle'; g.textAlign = 'center'; g.font = `600 ${Math.round(2.6 * PX)}px Jost, sans-serif`; g.fillText('1:0', W - 3.0 * PX, H * 0.53);
  }
  if (dir === 'flip') {
    symbol(A.g, 1.7 * PX, 3.0); score(A.g, 3.4 * PX, W);
    symbol(B.g, W / 2, 3.6);                                     // the wordmark's strokes are thinner than a dot at this size
    void word;
  }
  const tex = (c: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; return t; };
  return { a: tex(A.c), b: tex(B.c) };
}

const vertex = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const fragment = `precision highp float;
  uniform sampler2D uA, uB; uniform vec2 uSize; uniform float uPitch, uDot, uOff, uAngle, uMode, uTime, uGain;
  varying vec2 vUv;
  float lum(sampler2D t, vec2 uv, float bias) { return texture2D(t, uv, bias).r; }
  void main(){
    vec2 m = vUv * uSize;                                   // metres on the screen face
    // the portrait's halftone takes dots at half the spacing, or a face is only a dozen dots tall
    bool fineMode = (uMode > 1.5 && uMode < 2.5) || uMode > 4.5;   // portrait, replay, tactics
    float pitch = fineMode && texture2D(uB, vUv).r > 0.5 ? 0.5 * uPitch : uPitch;
    float c = cos(uAngle), s = sin(uAngle);
    vec2 r = mat2(c, s, -s, c) * m;                         // the dot grid, rotated for a print-style 45 degree screen
    vec2 ctr = (floor(r / pitch) + 0.5) * pitch;
    vec2 cm = mat2(c, -s, s, c) * ctr, cuv = cm / uSize;    // the dot's centre, back on the face
    vec2 off = m - cm;
    float px = max(fwidth(m.x), fwidth(m.y));               // metres per screen pixel here
    float bias = log2(max(1.0, pitch * 100.0 * 0.5));       // sample the content averaged over about a dot
    float inside = step(0.0, cuv.x) * step(cuv.x, 1.0) * step(0.0, cuv.y) * step(cuv.y, 1.0);
    float A = lum(uA, cuv, bias) * inside, Bm = lum(uB, cuv, bias) * inside;
    float R = 0.5 * pitch * uDot, rad, lit, unlit = uOff, sx = 1.0;
    if (uMode < 2.5 || uMode > 4.5) {
      // matrix, halftone, portrait, replay, tactics: amplitude halftone where B is white, on/off dots elsewhere
      float am = step(0.5, Bm);
      float on = step(0.45, A);
      rad = mix(R, 1.3 * R * sqrt(clamp(A * uGain, 0.0, 1.0)), am);
      lit = mix(on, step(0.015, A * uGain), am);
      unlit = mix(uOff, 0.0, am);
    } else if (uMode < 3.5) {
      // wave: small dots breathing in a slow diagonal wave, fading at the edges; the symbol in full dots
      float edge = smoothstep(0.0, 1.5, min(min(cm.x, uSize.x - cm.x), min(cm.y, uSize.y - cm.y)));
      float wv = 0.5 + 0.5 * sin(dot(cm, vec2(0.42, 0.9)) * 1.1 - uTime * 1.3);
      float field = (0.16 + 0.34 * wv * wv) * edge;
      float k = max(field, step(0.45, A));
      rad = 1.2 * R * sqrt(k); lit = step(0.02, k); unlit = 0.0;
    } else {
      // flip: discs turn over in a sweep from left to right every 4 s, between the score (A) and the mark (B)
      float cyc = mod(uTime, 8.0), fromA = step(cyc, 4.0), tt = mod(cyc, 4.0);
      float p = clamp((tt - 0.12 * cm.x / uSize.x * 6.0) / 0.35, 0.0, 1.0);
      float oldV = mix(step(0.45, Bm), step(0.45, A), fromA), newV = mix(step(0.45, A), step(0.45, Bm), fromA);
      lit = p < 0.5 ? oldV : newV; sx = abs(cos(3.14159 * p));
      rad = R; unlit = uOff;
    }
    float d = length(off / vec2(max(sx, 0.05), 1.0));
    float cov = smoothstep(rad + 0.7 * px, rad - 0.7 * px, d) * inside;
    float v = cov * mix(unlit, 0.96, lit);
    // past about three pixels a dot, draw its average instead of the dot, so distant screens do not shimmer
    float avg = inside * 3.14159 * rad * rad * sx / (pitch * pitch) * mix(unlit, 0.96, lit);
    v = mix(avg, v, smoothstep(1.6 * px, 3.2 * px, pitch));
    gl_FragColor = vec4(vec3(0.018) + vec3(v), 1.0);
  }`;

/** The screen: the dot face and a dark frame, its face's centre at the origin facing +z. */
export function BigScreen({ p, portraitUrl, replayUrl, clip = [] }: { p: ScreenParams; portraitUrl: string; replayUrl: string; clip?: THREE.Plane[] }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uA: { value: null }, uB: { value: null }, uSize: { value: new THREE.Vector2(p.w, p.h) }, uPitch: { value: p.pitch }, uDot: { value: p.dot }, uOff: { value: p.off }, uAngle: { value: 0 }, uMode: { value: 0 }, uTime: { value: 0 }, uGain: { value: 1 } },
    vertexShader: vertex, fragmentShader: fragment, toneMapped: false, clippingPlanes: clip,
    // drawn after the floodlight haze (Haze.tsx, render order 3), which would otherwise wash the face brown: an LED face
    // outshines the haze in front of it
    transparent: true, depthWrite: true,
  }), []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true, made: { a: THREE.Texture; b: THREE.Texture } | null = null;
    drawContent(p.dir, p.w, p.h, portraitUrl, replayUrl).then((t) => { if (!live) { t.a.dispose(); t.b.dispose(); return; } made = t; mat.uniforms.uA.value = t.a; mat.uniforms.uB.value = t.b; });
    return () => { live = false; made?.a.dispose(); made?.b.dispose(); };
  }, [p.dir, p.w, p.h, portraitUrl, replayUrl, mat]);
  useEffect(() => {
    const u = mat.uniforms; u.uSize.value.set(p.w, p.h); u.uPitch.value = p.pitch; u.uDot.value = p.dot; u.uOff.value = p.off;
    u.uAngle.value = THREE.MathUtils.degToRad(p.angle); u.uMode.value = MODE[p.dir]; u.uGain.value = p.gain;
  }, [p, mat]);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ clock }) => { mat.uniforms.uTime.value = (window as unknown as { __screenT?: number }).__screenT ?? clock.elapsedTime; });
  return (
    <group>
      <mesh position-z={-0.14}><boxGeometry args={[p.w + 0.5, p.h + 0.4, 0.24]} /><meshStandardMaterial color="#16181c" roughness={0.7} clippingPlanes={clip} /></mesh>
      <mesh material={mat} renderOrder={4}><planeGeometry args={[p.w, p.h]} /></mesh>
    </group>
  );
}
