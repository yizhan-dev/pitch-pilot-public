// The offside wall (pitch_prism's locked design, ported to real geometry): a translucent vertical plane across the
// pitch at the offside line, brightest at the base and fading up (alpha 0.34 at the base, x0.62 at mid-height, x0.16 at
// the top; white and 4 m tall, where pitch_prism's was blue and 2 m), depth tested so players behind it are tinted through it and players in front are not.
// Its crisp base line is drawn on the grass by the ground layer. The entrance is driven by the caller: the wall is
// revealed outwards from the defender who sets the line (as the base line sweeps to both touchlines) and rises out of it.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { TELE } from './style';

/** one wall: the line's x (scene), the line-setter's z where the reveal starts, how far either way it reaches (m), the
 *  height's share risen 0..1, an alpha; `rip`: up to three ripples spreading over the wall from where a body touches it
 *  (the close-up's), each [z, height, seconds since it began, strength 0..1] */
export interface WallReq { x: number; z0: number; reach: number; rise: number; alpha: number; rip?: [number, number, number, number][] }
const POOL = 2, HALF_W = 34;

const VERT = /* glsl */ `
varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FRAG = /* glsl */ `
precision highp float;
varying vec3 vW;
uniform vec3 uColor; uniform float uH, uRise, uZ0, uReach, uAlpha, uBase, uMid, uTop;
uniform vec4 uRip[3]; uniform vec4 uRipK;   // ripples: z, height, seconds, strength; the rings' period, speed, width, reach
// rings spreading over the wall from a touch, a new one every period, thin and bright, fading as they grow, with a
// soft glow on the touch itself
float ripple(vec4 R, vec2 p) {
  if (R.w <= 0.001 || R.z < 0.0) return 0.0;
  float r = length(p - R.xy), s = 0.0;
  for (int n = 0; n < 3; n++) {
    float tn = mod(R.z, uRipK.x) + float(n) * uRipK.x;
    if (tn > R.z) continue;
    float rad = uRipK.y * tn, w = uRipK.z * (1.0 + 0.6 * tn);
    s += exp(-pow((r - rad) / w, 2.0)) * exp(-tn / uRipK.w);
  }
  return R.w * (s + 0.8 * exp(-pow(r / 0.14, 2.0)));
}
void main() {
  float h = vW.y / max(uH * uRise, 1e-4);
  if (h > 1.0) discard;
  // the locked fade: 1 at the base, uMid at mid-height, uTop at the top, linear between
  float k = h < 0.5 ? mix(1.0, uMid, h / 0.5) : mix(uMid, uTop, (h - 0.5) / 0.5);
  // revealed outwards from the line-setter, a soft metre at the front
  float rv = clamp((uReach - abs(vW.z - uZ0)) / 1.0 + 0.5, 0.0, 1.0);
  // a soft top edge while it rises, so it grows rather than slides
  float top = 1.0 - smoothstep(0.85, 1.0, h);
  float a = uBase * k * rv * top * uAlpha;
  // the ripples ride over the fade: as bright at shoulder height as at the base
  vec2 p = vec2(vW.z, vW.y);
  a += (ripple(uRip[0], p) + ripple(uRip[1], p) + ripple(uRip[2], p)) * 0.55 * rv * top * uAlpha;
  a = min(a, 0.9);
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor * a, a);
}`;

export function OffsideWalls({ store }: { store: { list: WallReq[] } }) {
  const res = useMemo(() => {
    const geo = new THREE.PlaneGeometry(2 * HALF_W, 1, 1, 1);
    geo.rotateY(Math.PI / 2); geo.translate(0, 0.5, 0);           // across the pitch (along z), from the grass up
    const items = Array.from({ length: POOL }, () => {
      const u = { uColor: { value: new THREE.Color() }, uH: { value: 2 }, uRise: { value: 1 }, uZ0: { value: 0 }, uReach: { value: 99 }, uAlpha: { value: 1 }, uBase: { value: 0.34 }, uMid: { value: 0.62 }, uTop: { value: 0.16 },
        uRip: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] }, uRipK: { value: new THREE.Vector4(0.9, 1.8, 0.07, 1.6) } };
      const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: u, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, toneMapped: false, premultipliedAlpha: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }));
      mesh.renderOrder = 12; mesh.frustumCulled = false; mesh.visible = false;
      return { mesh, u };
    });
    const group = new THREE.Group(); items.forEach((it) => group.add(it.mesh));
    return { geo, items, group };
  }, []);
  useEffect(() => () => { res.geo.dispose(); res.items.forEach((it) => (it.mesh.material as THREE.Material).dispose()); }, [res]);
  useFrame(() => {
    const O = TELE.offside;
    res.items.forEach((it, i) => {
      const q = store.list[i];
      it.mesh.visible = !!q && q.rise > 0.001 && q.alpha > 0.002;
      if (!q || !it.mesh.visible) return;
      it.mesh.position.set(q.x, 0, 0); it.mesh.scale.set(1, O.heightM * q.rise, 1);
      const u = it.u;
      u.uColor.value.set(O.color); u.uH.value = O.heightM; u.uRise.value = q.rise; u.uZ0.value = q.z0; u.uReach.value = q.reach; u.uAlpha.value = q.alpha;
      u.uBase.value = O.baseA; u.uMid.value = O.midK; u.uTop.value = O.topK;
      const Rp = O.var.rip;
      u.uRipK.value.set(Rp.periodS, Rp.speed, Rp.widthM, Rp.fadeS);
      for (let j = 0; j < 3; j++) { const r = q.rip?.[j]; if (r) u.uRip.value[j].set(r[0], r[1], r[2], r[3]); else u.uRip.value[j].set(0, 0, -1, 0); }
    });
  });
  return <primitive object={res.group} />;
}
