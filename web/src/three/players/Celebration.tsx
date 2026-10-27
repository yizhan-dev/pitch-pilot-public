import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Clock } from '../../clock';

// The goal celebration from the Project KICK site (kick_site/assets/clip_renderer.js, fireworks()), ported from its 2D
// canvas to Three.js with the same closed-form motion, numbers and colours:
//  A. champagne: two fountains of 150 sparks each, 3 m behind the goal line just outside the posts, gold at the base
//     turning white above about 12 m, streaking up at 17-29 m/s under 15 m/s^2 gravity, fading out by 2.7 s;
//  B. fireworks: two points above the far stand, each firing seven times in the first 1.9 s: a white comet rising 13 m
//     in 0.12 s, then 46 sparks bursting outward 18 m and drooping, alternating two golds, fading as (1 - t)^1.4.
// Additive points of fixed pixel size, as on the site. The site's bursts rise from above its far stand's roofline; our
// roof is higher and the broadcast camera does not see over it, so ours rise from inside the bowl, over the far stand's
// upper rows, 20 m up. Data coordinates (x along the pitch, y across, z up) become Three.js (x, z, y).

const GOLD = new THREE.Color(1, 0.949, 0.229), COL1 = new THREE.Color('#ffff70'), COL2 = new THREE.Color('#fdebbd'), WHITE = new THREE.Color(1, 1, 1);
const CH_N = 150, STREAK = 8, FW_N = 46, BURSTS = [0.0, 0.15, 0.42, 0.72, 1.1, 1.5, 1.9];
const BASE = 20, BURST_Y = -44;     // the bursts' launch height and where across the pitch (the far stand)

const FW_DIR: number[][] = [], FW_SPD: number[] = [];
for (let i = 0; i < FW_N; i++) {
  const ii = i + 0.5, ph = Math.acos(1 - 2 * ii / FW_N), tt = Math.PI * (1 + Math.sqrt(5)) * ii;
  FW_DIR.push([Math.sin(ph) * Math.cos(tt), Math.sin(ph) * Math.sin(tt), Math.cos(ph)]); FW_SPD.push(0.75 + 0.25 * i / (FW_N - 1));
}
const CH = Array.from({ length: CH_N }, (_, i) => {
  const r2 = ((i * 37 + 13) % 100) / 100, r3 = ((i * 17 + 29) % 100) / 100, r4 = ((i * 89 + 5) % 100) / 100;
  return { ang: 0.05 + 0.28 * r2, spd: 17 + 12 * r3, yaw: (r4 - 0.5) * 1.1, life: 0.62 + 0.45 * r3, phase: ((i * 37) % 100) / 100 * 1.1, side: 0.2 + 0.25 * ((i * 13) % 100) / 100 };
});
/** the champagne fountains across the goal (data y, m): just outside each post, and one further out each side (Yi,
 *  2026-10-23: four instead of two); each stands on a launcher in stadium/Furniture.tsx */
const FOUNTAINS = [-11, -5.5, 5.5, 11];
const N = FOUNTAINS.length * CH_N * STREAK + 2 * BURSTS.length * (FW_N + 6);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (s: number) => { s = clamp(s, 0, 1); return s * s * (3 - 2 * s); };

const WORLD = 0.04;   // metres per unit of point size: a 4.2 px spark head is 0.17 m across up close; the pixel size
                      // holds beyond about 65 m in the broadcast view, so that view keeps its look

/** the celebration for a goal scored at the +x end, starting at goalT seconds on the clock */
export function Celebration({ clock, goalT, goalX = 52.5 }: { clock: Clock; goalT: number; goalX?: number }) {
  const res = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), alpha = new Float32Array(N), size = new Float32Array(N);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      // size is in pixels as the KICK site had it, right for the broadcast camera; closer than about 65 m a spark keeps
      // a real size instead (WORLD metres per unit of size) and grows as it nears, so a close view is not a sparse
      // dotted line (Yi, 2026-10-23). uFocal: the camera's focal length in device pixels.
      uniforms: { uDpr: { value: 1 }, uFocal: { value: 1000 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
      vertexShader: `attribute float alpha; attribute float size; uniform float uDpr, uFocal; varying vec3 vC; varying float vA;
        void main() { vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = min(20.0 * uDpr, max(size * uDpr, size * ${WORLD.toFixed(3)} * uFocal / -mv.z)); }`,   // at most 20 px: a few metres away they swelled into blobs
      fragmentShader: `varying vec3 vC; varying float vA;
        void main() { vec2 c = gl_PointCoord - 0.5; float r = dot(c, c); if (r > 0.25) discard; gl_FragColor = vec4(vC * vA * (1.0 - smoothstep(0.12, 0.25, r) * 0.6), 1.0); }`,
    });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false;
    return { g, m, pts, pos, col, alpha, size };
  }, []);
  useEffect(() => () => { res.g.dispose(); res.m.dispose(); }, [res]);

  useFrame(({ gl, size: vp, camera }) => {
    res.m.uniforms.uDpr.value = gl.getPixelRatio();
    res.m.uniforms.uFocal.value = (vp.height * gl.getPixelRatio() / 2) / Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov / 2));
    const tch = (clock.t - goalT) * 0.92, { pos, col, alpha, size } = res;
    alpha.fill(0);
    if (tch < 0 || tch > 4) { res.g.attributes.alpha.needsUpdate = true; return; }
    let n = 0;
    const put = (x: number, y: number, z: number, c: THREE.Color, a: number, px: number) => {
      pos[n * 3] = x; pos[n * 3 + 1] = z; pos[n * 3 + 2] = y; col[n * 3] = c.r; col[n * 3 + 1] = c.g; col[n * 3 + 2] = c.b; alpha[n] = a; size[n] = px; n++;
    };
    const xin = goalX > 0 ? -1 : 1, c = new THREE.Color();
    // A. champagne
    const CH_END = 2.7;
    if (tch <= CH_END) {
      const gbx = goalX - xin * 3, hgt = smooth(tch / 0.12), chF = clamp((CH_END - tch) / 0.4, 0, 1), G = 15;
      for (const fy of FOUNTAINS) {
        const ys = Math.sign(fy), P0 = [gbx, fy, 0.32];   // the mouth of a small spark jet on the grass (stadium/Furniture.tsx Launchers; Yi, 2026-10-22)
        for (const p of CH) {
          const a = (tch + p.phase) % p.life, spr = Math.sin(p.ang) * p.spd, vz = Math.cos(p.ang) * p.spd;
          const vx = xin * spr * p.side, vy = ys * spr * (0.3 + 0.5 * Math.abs(p.yaw)), lf = Math.max(0, 1 - a / p.life);
          for (let s = 0; s < STREAK; s++) {
            // the streak: its last 0.06 s, drawn as eight points (four until 2026-10-23: they came apart up close),
            // brightest at the head
            const aa = Math.max(0, a - 0.06 * s / (STREAK - 1));
            const wx = P0[0] + vx * aa * hgt, wy = P0[1] + vy * aa * hgt, wz = P0[2] + (vz * aa - 0.5 * G * aa * aa) * hgt;
            if (wz < 0.3) { n++; continue; }
            c.copy(GOLD).lerp(WHITE, clamp((wz - P0[2]) / 11, 0, 1));
            put(wx, wy, wz, c, lf * 0.95 * chF * (1 - 0.54 * s / (STREAK - 1)) * 0.6, 1.8 + 2.4 * lf);   // 0.6: twice the points, about the same light
          }
        }
      }
    } else n += FOUNTAINS.length * CH_N * STREAK;
    // B. fireworks above the far stand
    const centres = [[-40.5, BURST_Y, BASE], [40.5, BURST_Y, BASE]];
    BURSTS.forEach((bo, k) => centres.forEach((B, j) => {
      const tau = tch - bo, base = n;
      if (tau >= 0 && tau <= 1.63) {
        const B0 = B[0] + (((k * 7 + j * 13) % 5) - 2) * 3.4, B1 = B[1] + (((k * 11 + j * 5) % 5) - 2) * 2.4, B2 = B[2] + (((k * 5 + j * 17) % 4) - 1.5) * 3.2;
        if (tau <= 0.12) {
          const rz = 13 * (1 - Math.pow(1 - tau / 0.12, 2));
          for (let q = 0; q < 6; q++) { const tz = rz - 0.9 * q; if (tz < 0) break; put(B0, B1, B2 + tz, WHITE, Math.max(0, 1 - q / 6) * 0.9, 4.2); }
        } else {
          const tb = (tau - 0.12) / 1.51;
          for (let q = 0; q < FW_N; q++) {
            const d = FW_DIR[q], sp = FW_SPD[q];
            const bz = B2 + 13 + d[2] * sp * tb * 18 - 13 * tb * tb;
            if (bz < BASE - 10) { n++; continue; }
            put(B0 + d[0] * sp * tb * 18, B1 + d[1] * sp * tb * 18, bz, tb < 0.12 ? WHITE : q % 2 ? COL2 : COL1, clamp(Math.pow(1 - tb, 1.4), 0, 1), 5.8);
          }
        }
      }
      n = base + FW_N + 6;
    }));
    for (const k of ['position', 'color', 'alpha', 'size']) res.g.attributes[k].needsUpdate = true;
  });
  return <primitive object={res.pts} />;
}
