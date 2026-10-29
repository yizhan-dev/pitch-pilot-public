// Pitch control, restyled (research doc 5, "Pitch control"; the agreed scope's "pitch control restyle with the 0.5
// frontier"): the same model (Spearman, src/response/outcomes.ts), on a 2 m grid, drawn smoothly (bicubic Catmull-Rom
// sampling of the grid in the shader, no cells), each side's ground as a faint wash in its team colour that strengthens
// with the margin of control, and the 0.5 contour (where control changes hands) as a crisp line of light, its distance
// in metres as (v - 0.5) / |grad v| (the gradient from the screen derivatives). Clipped to the pitch. It enters as a
// ring spreading from the ball, the frontier drawn behind it. The caller computes the grid and the reveal.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { TELE } from './style';

export const CTRL_NX = 54, CTRL_NZ = 35;   // grid points over the pitch, x every 105/53 m, z every 68/34 m

/** written by the telestration: the grid (row-major, z rows of x), whether it changed, the reveal's centre (scene x,
 *  z) and radius (m), an alpha, the colours and the surface (0 grass .. 1 board) */
export interface ControlState {
  on: boolean; grid: Float32Array; dirty: boolean; cx: number; cz: number; reveal: number; alpha: number;
  att: [number, number, number]; def: [number, number, number]; line: [number, number, number]; k: number;
}
export const newControlState = (): ControlState => ({ on: false, grid: new Float32Array(CTRL_NX * CTRL_NZ).fill(0.5), dirty: true, cx: 0, cz: 0, reveal: 0, alpha: 1, att: [0.4, 0.7, 1], def: [1, 0.55, 0.3], line: [1, 1, 1], k: 0 });

const VERT = /* glsl */ `
varying vec2 vXZ;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vXZ = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FRAG = /* glsl */ `
precision highp float;
precision highp sampler2D;
varying vec2 vXZ;
uniform sampler2D uV; uniform vec2 uN;
uniform vec3 uAtt, uDef, uLine; uniform vec2 uC; uniform float uReveal, uAlpha, uWashA, uLineHW, uMinPx, uGlow, uGlowM, uBand, uLineOn;
float tap(int i, int j) { return texelFetch(uV, ivec2(clamp(i, 0, int(uN.x) - 1), clamp(j, 0, int(uN.y) - 1)), 0).r; }
float cr(float a, float b, float c, float d, float t) {
  return b + 0.5 * t * (c - a + t * (2.0 * a - 5.0 * b + 4.0 * c - d + t * (3.0 * (b - c) + d - a)));
}
float sampleV(vec2 xz) {
  vec2 g = (xz - vec2(-52.5, -34.0)) / vec2(105.0, 68.0) * (uN - 1.0);
  vec2 f0 = floor(g), f = g - f0; int i = int(f0.x), j = int(f0.y);
  float r[4];
  for (int m = 0; m < 4; m++) r[m] = cr(tap(i - 1, j - 1 + m), tap(i, j - 1 + m), tap(i + 1, j - 1 + m), tap(i + 2, j - 1 + m), f.x);
  return clamp(cr(r[0], r[1], r[2], r[3], f.y), 0.0, 1.0);
}
void main() {
  // the pitch only, with a soft edge
  vec2 dp = vec2(length(vec2(dFdx(vXZ.x), dFdy(vXZ.x))), length(vec2(dFdx(vXZ.y), dFdy(vXZ.y))));
  float inPitch = clamp((52.5 - abs(vXZ.x)) / max(dp.x, 1e-3) + 0.5, 0.0, 1.0) * clamp((34.0 - abs(vXZ.y)) / max(dp.y, 1e-3) + 0.5, 0.0, 1.0);
  float v = sampleV(vXZ), m = abs(v - 0.5) * 2.0;
  // the reveal: a ring spreading from the ball
  float rv = clamp((uReveal - length(vXZ - uC)) / 3.0, 0.0, 1.0);
  // the frontier: the distance to v = 0.5 in metres, through the gradient from the screen derivatives
  mat2 J = mat2(dFdx(vXZ), dFdy(vXZ));
  vec2 gv = inverse(transpose(J)) * vec2(dFdx(v), dFdy(v));
  float dl = abs(v - 0.5) / max(length(gv), 1e-4);
  // the wash: the controlling side's colour, deeper the surer its control (|v - 0.5| x 2), faint where it is contested,
  // over the whole pitch (a player cannot stand on ground nobody controls; an earlier version showed only
  // the contested ground and left each side's own territory blank)
  vec3 tc = v > 0.5 ? uAtt : uDef;
  float wa = uWashA * pow(m, uBand) * inPitch * rv;
  float aE = max(length(vec2(dFdx(dl), dFdy(dl))), 1e-5);
  float hw = max(uLineHW, 0.5 * uMinPx * aE), cl = uLineOn * clamp(0.5 - (dl - hw) / aE, 0.0, 1.0) * inPitch * clamp((uReveal - 2.0 - length(vXZ - uC)) / 3.0, 0.0, 1.0);
  float sg = max(uGlowM, min(2.0 * aE, 2.0 * uGlowM)), glow = uLineOn * exp(-pow(max(dl - hw, 0.0) / sg, 2.0)) * uGlow * inPitch * rv;
  vec3 rgb = uLine * cl + tc * wa * (1.0 - cl);
  float a = cl + wa * (1.0 - cl);
  rgb += uLine * glow * (1.0 - a);
  gl_FragColor = vec4(rgb * uAlpha, a * uAlpha);
}`;

export function ControlLayer({ store }: { store: { s: ControlState } }) {
  const res = useMemo(() => {
    const data = new Float32Array(CTRL_NX * CTRL_NZ).fill(0.5);
    const tex = new THREE.DataTexture(data, CTRL_NX, CTRL_NZ, THREE.RedFormat, THREE.FloatType);
    tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.needsUpdate = true;
    const u = {
      uV: { value: tex }, uN: { value: new THREE.Vector2(CTRL_NX, CTRL_NZ) }, uAtt: { value: new THREE.Color() }, uDef: { value: new THREE.Color() }, uLine: { value: new THREE.Color() },
      uC: { value: new THREE.Vector2() }, uReveal: { value: 0 }, uAlpha: { value: 1 }, uWashA: { value: 0.3 }, uLineHW: { value: 0.06 }, uMinPx: { value: 1.5 }, uGlow: { value: 0.35 }, uGlowM: { value: 0.25 }, uBand: { value: 0.7 }, uLineOn: { value: 0 },
    };
    const geo = new THREE.PlaneGeometry(108, 71); geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: u, transparent: true, depthWrite: false, depthTest: true, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, premultipliedAlpha: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    }));
    mesh.renderOrder = 6; mesh.frustumCulled = false; mesh.visible = false;
    return { data, tex, u, geo, mesh };
  }, []);
  useEffect(() => () => { res.tex.dispose(); res.geo.dispose(); (res.mesh.material as THREE.Material).dispose(); }, [res]);
  useFrame(() => {
    const S = store.s, C = TELE.control, u = res.u;
    res.mesh.visible = S.on && S.alpha > 0.002;
    if (!res.mesh.visible) return;
    if (S.dirty) { res.data.set(S.grid); res.tex.needsUpdate = true; S.dirty = false; }
    u.uAtt.value.setRGB(...S.att); u.uDef.value.setRGB(...S.def); u.uLine.value.setRGB(...S.line);
    u.uC.value.set(S.cx, S.cz); u.uReveal.value = S.reveal; u.uAlpha.value = S.alpha;
    u.uWashA.value = S.k > 0.5 ? C.washA.board : C.washA.grass; u.uLineHW.value = C.lineHW; u.uMinPx.value = TELE.minPx; u.uGlow.value = C.glow; u.uGlowM.value = C.glowM; u.uBand.value = C.bandM; u.uLineOn.value = C.line ? 1 : 0;
  });
  return <primitive object={res.mesh} />;
}
