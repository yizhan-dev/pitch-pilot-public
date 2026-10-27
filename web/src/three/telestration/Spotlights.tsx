// The spotlight (pitch_prism's locked design, freeze/spotlight.py, ported to real geometry; Yi, 2026-10-22: the pressed
// player is lit by a column of light rising from the ground instead of a ring): a light cylinder standing on the pitch
// over a player, drawn with light only. Constant width top to bottom, soft feathered walls (10% of the radius), brightest
// at the base and fading upwards as exp(-(h / 1.58 r)^1.15) with no top cap; a gentle additive glow (intensity 0.5,
// screen-added, no dim). In 3D the depth buffer stands the player inside it: the back wall behind him, the front wall
// over him. The base: the footprint lit as a disc, and a matte ring painted at 0.92 of the radius, its near arc crisp
// (0.82) and its far arc at 0.34 of that, as pitch paint without a glow. The entrance grows the whole column as one scale
// from a dot at the feet; the exit shrinks it. A small pool, set each frame from the store.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { TELE } from './style';

/** one column: the feet (scene x, z), the entrance's scale 0..1, an alpha */
export interface SpotReq { x: number; z: number; scale: number; alpha: number }
const POOL = 8, H = 9;   // columns (8: a carrier's passing options all lit, the What-if chat); the cylinder's height in units of the radius

const SCREEN = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcColorFactor } as const;

const WALL_V = /* glsl */ `
varying vec3 vW; varying vec3 vN;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;
const WALL_F = /* glsl */ `
precision highp float;
varying vec3 vW; varying vec3 vN;
uniform vec3 uCam, uColor; uniform float uR, uTau, uExp, uFeather, uInt, uAlpha;
void main() {
  // the column's silhouette is set by the horizontal angle between the wall's normal and the view: at a point whose
  // projection lies x from the axis, (r - |x|) / r = 1 - sin(phi); pitch_prism's wall = clamp((r - |x|) / feather)
  vec2 vh = normalize(uCam.xz - vW.xz), nh = normalize(vN.xz);
  float c = abs(dot(nh, vh)), edge = 1.0 - sqrt(max(0.0, 1.0 - c * c));
  float wall = clamp(edge / uFeather, 0.0, 1.0), vf = exp(-pow(max(vW.y, 0.0) / uTau, uExp));
  // the front and the back wall overlap everywhere inside: each screens half the light, so the two make L
  float L = clamp(wall * vf * uInt * uAlpha, 0.0, 0.999), a = 1.0 - sqrt(1.0 - L);
  gl_FragColor = vec4(uColor * a, 1.0);
}`;
const BASE_V = /* glsl */ `
varying vec2 vL;
void main() { vL = position.xy; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`;
const DISC_F = /* glsl */ `
precision highp float;
varying vec2 vL;
uniform vec3 uColor; uniform float uR, uFeather, uInt, uAlpha;
void main() {
  float d = length(vL), aa = max(fwidth(d), 1e-5);
  float lit = clamp((uR - d) / max(uFeather * uR, aa), 0.0, 1.0) * uInt * uAlpha * 0.7;
  gl_FragColor = vec4(uColor * lit, 1.0);
}`;
const RING_F = /* glsl */ `
precision highp float;
varying vec2 vL;
uniform vec3 uColor; uniform vec2 uNear; uniform float uRr, uCrisp, uFeath, uNearA, uFarK, uFeathA, uAlpha, uMinPx;
void main() {
  float d = length(vL), aa = max(fwidth(d), 1e-5);
  float hc = max(0.5 * uCrisp, 0.5 * uMinPx * aa), hf = max(0.5 * uFeath, uMinPx * aa);
  float cC = clamp(0.5 - (abs(d - uRr) - hc) / aa, 0.0, 1.0), cF = clamp(0.5 - (abs(d - uRr) - hf) / aa, 0.0, 1.0);
  // near (towards the camera) crisp and bright, far dimmer: it sits behind the light
  float k = mix(uFarK, 1.0, smoothstep(-0.12, 0.12, dot(normalize(vL + 1e-6), uNear)));
  float a = max(cC * uNearA, cF * uFeathA) * k * uAlpha;
  gl_FragColor = vec4(uColor * a, a);
}`;

export function Spotlights({ store }: { store: { list: SpotReq[] } }) {
  const res = useMemo(() => {
    const wallGeo = new THREE.CylinderGeometry(1, 1, H, 64, 1, true); wallGeo.translate(0, H / 2, 0);
    // the base's plane, laid on the grass by the meshes' rotation (its local x is the scene's x, its local y the -z)
    const plane = new THREE.PlaneGeometry(1, 1), base = new THREE.PlaneGeometry(2.4, 2.4);
    const items = Array.from({ length: POOL }, () => {
      const uW = { uCam: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color() }, uR: { value: 1 }, uTau: { value: 1 }, uExp: { value: 1.15 }, uFeather: { value: 0.1 }, uInt: { value: 0.5 }, uAlpha: { value: 1 } };
      const wall = new THREE.Mesh(wallGeo, new THREE.ShaderMaterial({ vertexShader: WALL_V, fragmentShader: WALL_F, uniforms: uW, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, toneMapped: false, ...SCREEN }));
      const uD = { uColor: uW.uColor, uR: { value: 1 }, uFeather: { value: 0.1 }, uInt: { value: 0.5 }, uAlpha: { value: 1 } };
      const disc = new THREE.Mesh(base, new THREE.ShaderMaterial({ vertexShader: BASE_V, fragmentShader: DISC_F, uniforms: uD, transparent: true, depthWrite: false, depthTest: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4, toneMapped: false, ...SCREEN }));
      const uRg = { uColor: uW.uColor, uNear: { value: new THREE.Vector2(0, 1) }, uRr: { value: 0.92 }, uCrisp: { value: 0.042 }, uFeath: { value: 0.084 }, uNearA: { value: 0.82 }, uFarK: { value: 0.34 }, uFeathA: { value: 0.24 }, uAlpha: { value: 1 }, uMinPx: { value: 1.2 } };
      const ring = new THREE.Mesh(base, new THREE.ShaderMaterial({ vertexShader: BASE_V, fragmentShader: RING_F, uniforms: uRg, transparent: true, depthWrite: false, depthTest: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4, toneMapped: false, premultipliedAlpha: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }));
      disc.rotation.x = ring.rotation.x = -Math.PI / 2;
      wall.renderOrder = 14; disc.renderOrder = 7; ring.renderOrder = 9;
      for (const m of [wall, disc, ring]) { m.frustumCulled = false; m.visible = false; }
      return { wall, disc, ring, uW, uD, uRg };
    });
    const group = new THREE.Group();
    items.forEach((it) => group.add(it.wall, it.disc, it.ring));
    return { group, items, wallGeo, plane, base, v: new THREE.Vector3() };
  }, []);
  useEffect(() => () => {
    res.wallGeo.dispose(); res.plane.dispose(); res.base.dispose();
    res.items.forEach((it) => [it.wall, it.disc, it.ring].forEach((m) => (m.material as THREE.Material).dispose()));
  }, [res]);
  useFrame(({ camera }) => {
    const S = TELE.spot;
    res.items.forEach((it, i) => {
      const q = store.list[i], on = !!q && q.scale > 0.002 && q.alpha > 0.002;
      it.wall.visible = it.disc.visible = it.ring.visible = on;
      if (!q || !on) return;
      const r = S.r * q.scale;
      it.wall.position.set(q.x, 0, q.z); it.wall.scale.set(r, r, r);
      it.disc.position.set(q.x, 0, q.z); it.disc.scale.set(r, r, 1);
      it.ring.position.set(q.x, 0, q.z); it.ring.scale.set(r, r, 1);
      it.uW.uCam.value.copy(camera.position); it.uW.uColor.value.set(S.color);
      it.uW.uR.value = r; it.uW.uTau.value = S.height * r; it.uW.uExp.value = S.fadeExp; it.uW.uFeather.value = S.feather; it.uW.uInt.value = S.intensity; it.uW.uAlpha.value = q.alpha;
      it.uD.uR.value = 1; it.uD.uFeather.value = S.feather; it.uD.uInt.value = S.intensity; it.uD.uAlpha.value = q.alpha;
      // the ring's near side: towards the camera, in the plane's own axes (local x = scene x, local y = -scene z)
      res.v.set(camera.position.x - q.x, 0, camera.position.z - q.z);
      const l = Math.hypot(res.v.x, res.v.z) || 1;
      it.uRg.uNear.value.set(res.v.x / l, -res.v.z / l);
      it.uRg.uRr.value = S.ringRatio; it.uRg.uCrisp.value = S.ringCrisp; it.uRg.uFeath.value = S.ringFeather;
      it.uRg.uNearA.value = S.ringNearA; it.uRg.uFarK.value = S.ringFarK; it.uRg.uFeathA.value = S.ringFeatherA; it.uRg.uAlpha.value = q.alpha;
    });
  });
  return <primitive object={res.group} />;
}
