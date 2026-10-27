// The vision cone's fan of light (Yi, 2026-10-23: as if the view came out of the player's head): a faint surface from
// his eyes sloping down to the grass `land` m out, then lying on it to `len` m, as wide as his central view; additive
// white, strongest at his eyes and fading with distance and towards its sides, drawn only as far as his sight has
// spread (`reach`), with a brighter band at that front. One quad grid; the shape is made in the vertex shader.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

/** one fan: his eyes (scene x, up, z), where his head points (scene x, z, unit), the half-angle (radians), how far it
 *  reaches now (m), its alpha, where it lands on the grass and how long it is (m) */
export interface BeamReq { eye: [number, number, number]; dir: [number, number]; half: number; reach: number; alpha: number; land: number; len: number }

const VERT = /* glsl */ `
uniform vec3 uEye; uniform vec2 uDir; uniform float uHalf, uLand, uLen;
varying vec2 vUV; varying float vS;
void main() {
  float th = (uv.x - 0.5) * 2.0 * uHalf, s = uv.y * uLen;
  vec2 d = vec2(uDir.x * cos(th) - uDir.y * sin(th), uDir.x * sin(th) + uDir.y * cos(th));
  float h = max(0.03, uEye.y * (1.0 - s / uLand));
  vec3 p = vec3(uEye.x + d.x * s, h, uEye.z + d.y * s);
  vUV = uv; vS = s;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const FRAG = /* glsl */ `
precision highp float;
uniform float uReach, uAlpha;
varying vec2 vUV; varying float vS;
void main() {
  float side = 1.0 - smoothstep(0.6, 1.0, abs(vUV.x - 0.5) * 2.0);
  float shown = 1.0 - smoothstep(uReach - 1.5, uReach, vS);
  float front = exp(-pow((vS - uReach) / 1.2, 2.0)) * 0.8;
  float a = uAlpha * side * (exp(-vS / 7.0) * shown + front * step(vS, uReach + 3.0)) * smoothstep(0.0, 0.4, vS);
  if (a < 0.002) discard;
  gl_FragColor = vec4(vec3(a), a);
}`;

export function VisionBeam({ store }: { store: { list: BeamReq[] } }) {
  const res = useMemo(() => {
    const u = { uEye: { value: new THREE.Vector3() }, uDir: { value: new THREE.Vector2(1, 0) }, uHalf: { value: 1 }, uLand: { value: 12 }, uLen: { value: 26 }, uReach: { value: 0 }, uAlpha: { value: 0 } };
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: u, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 48, 64), mat);
    mesh.frustumCulled = false; mesh.renderOrder = 13; mesh.visible = false;
    return { mesh, u };
  }, []);
  useEffect(() => () => { res.mesh.geometry.dispose(); (res.mesh.material as THREE.Material).dispose(); }, [res]);
  useFrame(() => {
    const b = store.list[0];
    res.mesh.visible = !!b && b.alpha > 0.002 && b.reach > 0.05;
    if (!b || !res.mesh.visible) return;
    const u = res.u;
    u.uEye.value.set(...b.eye); u.uDir.value.set(...b.dir); u.uHalf.value = b.half; u.uLand.value = b.land; u.uLen.value = b.len; u.uReach.value = b.reach; u.uAlpha.value = b.alpha;
  });
  return <primitive object={res.mesh} />;
}
