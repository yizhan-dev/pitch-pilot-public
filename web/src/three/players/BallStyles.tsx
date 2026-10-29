import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { markFigure } from './Styles';
import type { MomentPkg } from '../../types';
import type { Clock } from '../../clock';
import { ballAt } from '../Ball';
import { liveBall } from '../liveBall';
import { holdInNet } from '../stadium/goalSpace';
import logoUrl from '../../assets/brand/yizhan-06-symbol-black.svg?url';

// Candidate ball styles. The ball is 22 cm across (size 5). It rolls with its motion: on the ground the spin follows the
// speed exactly; in the air the tracking gives no spin, so it keeps the last one. The modern ball carries the YIZHAN
// symbol inside the oval of graphic on two opposite panels, as a maker's mark sits on a match ball: the black master
// artwork, centred in the oval's white interior, the panel pattern untouched.

export type BallStyle = 'glow' | 'classic' | 'modern' | 'data';
const R = 0.11;
const LOGO_ASPECT = 133.2473 / 100;                       // the symbol's viewBox
// The symbol sits upright at the centre of the oval of graphic on the +z panel (black) and the -z panel (grey). The
// ovals come from the warp in panelMaterial and lie off the panel axes. Sampling the same formula gives
// the centre of each oval's white interior, and the largest upright symbol there with 0.25 H clear, 0.239 rad tall;
// the symbol is 0.23 rad (2.5 cm tall, 3.4 cm wide).
const LOGO_H = 0.23;
const OVALS = [{ c: [0.2472, -0.2262, 0.9422], side: 1 }, { c: [-0.2432, 0.224, -0.9438], side: -1 }].map(({ c, side }) => {
  const n = new THREE.Vector3(...c).normalize(), t = new THREE.Vector3(side, 0, 0);
  t.addScaledVector(n, -t.dot(n)).normalize();
  return { n, t };
});

/** the black symbol, rasterized from the master SVG; only its coverage is used. One for the page: every ball's material
 *  shares it (a material's dispose leaves its shader's textures, so one made per ball stayed on the GPU after each clip
 *  change, about 10 MB each) */
let logo: THREE.CanvasTexture | null = null;
function logoTexture() {
  if (logo) return logo;
  const c = document.createElement('canvas'); c.width = 2048; c.height = Math.round(2048 / LOGO_ASPECT);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 8;
  const img = new Image();
  img.onload = () => { c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); t.needsUpdate = true; };
  img.src = logoUrl;
  return (logo = t);
}

/** the 32 panel centres of the classic ball: the icosahedron's 12 vertices (pentagons) and 20 face centres (hexagons) */
function classicCentres() {
  const g = new THREE.IcosahedronGeometry(1, 0), pos = g.getAttribute('position'), v: THREE.Vector3[] = [], f: THREE.Vector3[] = [];
  for (let k = 0; k < pos.count; k++) { const p = new THREE.Vector3().fromBufferAttribute(pos, k).normalize(); if (!v.some((q) => q.distanceTo(p) < 1e-3)) v.push(p); }
  for (let k = 0; k < pos.count; k += 3) f.push(new THREE.Vector3().fromBufferAttribute(pos, k).add(new THREE.Vector3().fromBufferAttribute(pos, k + 1)).add(new THREE.Vector3().fromBufferAttribute(pos, k + 2)).normalize());
  g.dispose();
  return { pent: v, hex: f };
}

/** a panelled ball: the panels are the sphere's Voronoi cells around the given centres, with dark seams between them */
function panelMaterial(kind: 'classic' | 'modern') {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: kind === 'modern' ? 0.32 : 0.5 });
  const { pent, hex } = classicCentres();
  const cls = kind === 'classic';
  // modern: six warped panels, as in today's thermally bonded balls, each carrying a sweep of graphic
  const six = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((a) => new THREE.Vector3(...a));
  const centres = cls ? [...pent, ...hex] : six;
  const logo = cls ? null : logoTexture();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uC = { value: centres };
    if (logo) { sh.uniforms.uLogo = { value: logo }; sh.uniforms.uLc = { value: OVALS.map((o) => o.n) }; sh.uniforms.uLt = { value: OVALS.map((o) => o.t) }; }
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vObj; uniform vec3 uC[${centres.length}];${cls ? '' : '\n      uniform sampler2D uLogo; uniform vec3 uLc[2], uLt[2];'}`).replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 n = normalize(vObj);
        ${cls ? '' : '// a gentle twist makes the six panels pinwheel instead of meeting as a cube\n n = normalize(vec3(n.x + 0.32 * sin(3.0 * n.y), n.y + 0.32 * sin(3.0 * n.z), n.z + 0.32 * sin(3.0 * n.x)));'}
        float b1 = -2.0, b2 = -2.0; int i1 = 0;
        for (int k = 0; k < ${centres.length}; k++) { float d = dot(n, uC[k]); if (d > b1) { b2 = b1; b1 = d; i1 = k; } else if (d > b2) b2 = d; }
        float seam = 1.0 - smoothstep(0.004, 0.012, b1 - b2);
        vec3 c = vec3(1.0);
        ${cls ? 'if (i1 < 12) c = vec3(0.06);'
        : `float band = smoothstep(0.84, 0.86, b1) - smoothstep(0.9, 0.92, b1);
           c = mix(c, (i1 % 2 == 0) ? vec3(0.07, 0.08, 0.1) : vec3(0.55, 0.58, 0.62), band);
           // the symbol inside the two ovals, laid by angle round the oval's centre so it keeps its proportions
           vec3 n0 = normalize(vObj); float ink = 0.0;
           const vec2 LW = vec2(${(LOGO_H * LOGO_ASPECT).toFixed(4)}, ${LOGO_H.toFixed(4)});
           for (int s = 0; s < 2; s++) {
             vec3 cc = uLc[s], tt = uLt[s], bb = cross(cc, tt);
             float d = dot(n0, cc);
             if (d > 0.5) {
               vec2 uv = vec2(atan(dot(n0, tt), d), atan(dot(n0, bb), d)) / LW + 0.5;
               if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) ink = max(ink, texture2D(uLogo, uv).a);
             }
           }
           c = mix(c, vec3(0.0), ink);`}
        diffuseColor.rgb *= mix(c, vec3(0.18), seam);
      }`);
  };
  m.customProgramCacheKey = () => `ball-${kind}-v8`;
  return m;
}

export function StyledBall({ pkg, clock, style, spin: rolls = true, faceLogo = false }: { pkg: MomentPkg; clock: Clock; style: BallStyle; spin?: boolean; faceLogo?: boolean }) {
  const ball = useRef<THREE.Mesh>(null), shadow = useRef<THREE.Mesh>(null), stem = useRef<THREE.Mesh>(null), ring = useRef<THREE.Mesh>(null);
  // the ball marks the stencil as the players do, so its own trail stays under it (Styles.tsx markFigure)
  const mat = useMemo(() => markFigure(style === 'classic' || style === 'modern' ? panelMaterial(style)
    : new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: style === 'data' ? 0.6 : 0.25, roughness: 0.4 })), [style]);
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => () => { liveBall.ok = false; }, []);
  // the trail: the last 1.2 s of the ball's path, as a fading line
  const TRAIL = 36;
  const trail = useMemo(() => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    const a = new Float32Array(TRAIL); for (let k = 0; k < TRAIL; k++) a[k] = 1 - k / (TRAIL - 1); g.setAttribute('alpha', new THREE.BufferAttribute(a, 1));
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(1.0, 0.92, 0.55, vA * 0.9); }' });
    const l = new THREE.Line(g, m); l.frustumCulled = false; return l;
  }, []);
  useEffect(() => () => { trail.geometry.dispose(); (trail.material as THREE.Material).dispose(); }, [trail]);
  const spin = useMemo(() => ({ q: new THREE.Quaternion(), axis: new THREE.Vector3(), w: 0, last: null as THREE.Vector3 | null, t: -1 }), []);
  useFrame(() => {
    const p = ballAt(pkg, clock.t);
    for (const r of [ball, shadow, stem, ring]) if (r.current) r.current.visible = !!p;
    liveBall.ok = !!p; liveBall.t = clock.t; if (p) holdInNet(liveBall.p.set(p[0], Math.max(R, p[2]), p[1]));
    trail.visible = !!p && style === 'data';
    if (!p || !ball.current || !shadow.current) return;
    const at = holdInNet(new THREE.Vector3(p[0], Math.max(R, p[2]), p[1]));
    ball.current.position.copy(at); shadow.current.position.set(at.x, 0.012, at.z);
    // roll: on the ground the spin axis is horizontal, square to the motion, and the rate is speed / radius
    if (rolls && spin.last && clock.t !== spin.t) {
      const dt = clock.t - spin.t, v = at.clone().sub(spin.last);
      if (dt > 0 && dt < 0.5) {
        if (at.y < R + 0.05) { spin.axis.set(v.z, 0, -v.x); const d = Math.hypot(v.x, v.z); spin.w = d / R / dt; if (d > 1e-5) spin.axis.normalize(); }
        if (spin.axis.lengthSq() > 0.5) spin.q.premultiply(new THREE.Quaternion().setFromAxisAngle(spin.axis, spin.w * dt));
      }
    }
    spin.last = at; spin.t = clock.t; ball.current.quaternion.copy(spin.q);
    // for looking at the mark: turn the first oval's centre towards +z, where the ballFront camera stands
    if (faceLogo) ball.current.quaternion.setFromUnitVectors(OVALS[0].n, new THREE.Vector3(0, 0, 1));
    if (style === 'data' && stem.current && ring.current) {
      const h = at.y; stem.current.visible = h > 0.4; stem.current.position.set(at.x, h / 2, at.z); stem.current.scale.set(1, h, 1);
      ring.current.position.set(at.x, 0.02, at.z);
      const arr = trail.geometry.attributes.position.array as Float32Array;
      for (let k = 0; k < TRAIL; k++) { const q = ballAt(pkg, Math.max(0, clock.t - k / 30)); if (q) { arr[k * 3] = q[0]; arr[k * 3 + 1] = Math.max(R, q[2]); arr[k * 3 + 2] = q[1]; } }
      trail.geometry.attributes.position.needsUpdate = true;
    }
  });
  return (
    <group>
      <mesh ref={ball} castShadow material={mat}><sphereGeometry args={[R, 48, 32]} /></mesh>
      <mesh ref={shadow} rotation-x={-Math.PI / 2}><circleGeometry args={[0.15, 20]} /><meshBasicMaterial color="#000" transparent opacity={0.35} depthWrite={false} /></mesh>
      {style === 'data' && <>
        <mesh ref={stem}><cylinderGeometry args={[0.012, 0.012, 1, 6]} /><meshBasicMaterial color="#ffe98a" transparent opacity={0.7} /></mesh>
        <mesh ref={ring} rotation-x={-Math.PI / 2}><ringGeometry args={[0.32, 0.4, 32]} /><meshBasicMaterial color="#ffe98a" transparent opacity={0.8} depthWrite={false} /></mesh>
        <primitive object={trail} />
      </>}
    </group>
  );
}
