import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Joints } from '../data';
import type { Clock } from '../clock';
import { poseAt, poseIndex, jointOf, torsoFrame } from '../three/players/pose';
import { BLOBS, TORSO_N, pointOf, headFrame, handFrame, torsoSection } from '../three/players/body';
import { toonRamp, outlineMaterial } from '../three/players/Styles';
import type { Look } from '../three/players/looks';

// The cast's props (cast.ts): small toon meshes with the players' outline, carried by a joint of the figure each frame,
// and drapes (a scarf's ends, a lanyard) laid over the torso's own surface each frame, so they never sink into it.

/** where a prop is carried, and the frame its geometry is given in (metres; x across, y up, z forward):
 *  head: the head's centre and frame (scaled with the head); neck: the neck joint in the torso's frame;
 *  rHand / lHand: the fist's centre, y towards the fingers, x towards the thumb; hands: halfway between the fists,
 *  x from the left fist to the right, y up the spine */
export type Anchor = 'head' | 'neck' | 'rHand' | 'lHand' | 'hands';
export interface Carried {
  at: Anchor;
  geo: () => THREE.BufferGeometry;
  color: string;
  map?: () => THREE.Texture;
  off?: [number, number, number];
  rot?: [number, number, number];
}
/** a strip laid down the front of the torso: through `path` (h, a share of the way from the hips to the neck, and x,
 *  metres across, + towards the right shoulder), top first, wrapped round the chest's curve; past the chest's furthest
 *  point it hangs straight down rather than following the body back in, as cloth does. width and thick in metres; a
 *  map runs along it (v from the top) */
export interface Drape { drape: [number, number][]; width: number; thick: number; color: string; map?: () => THREE.Texture }
export type Prop = Carried | Drape;

const HEAD = BLOBS.find((b) => b.frame === 'head')!;
/** a drape's gap off the shirt, metres: the torso twists between its rings a little more than the drape follows */
const GAP = 0.006;
/** samples across a drape (it bends round the chest) and along each step of its path */
const ACROSS = 3, STEPS = 4;

/** a drape's path resampled into short steps, top first */
function resample(path: [number, number][]) {
  const out: [number, number][] = [path[0]];
  for (let i = 1; i < path.length; i++) for (let s = 1; s <= STEPS; s++) {
    const u = s / STEPS; out.push([path[i - 1][0] + (path[i][0] - path[i - 1][0]) * u, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * u]);
  }
  return out;
}

/** a slab n samples long and ACROSS wide, its front and back sheets joined at the sides and ends; positions set each frame */
function slabGeometry(n: number) {
  const m = ACROSS, g = new THREE.BufferGeometry(), idx: number[] = [], uv = new Float32Array(2 * n * m * 2);
  const F = (i: number, u: number) => i * m + u, B = (i: number, u: number) => n * m + i * m + u;
  for (let i = 0; i < n; i++) for (let u = 0; u < m; u++) {
    uv[F(i, u) * 2] = uv[B(i, u) * 2] = u / (m - 1); uv[F(i, u) * 2 + 1] = uv[B(i, u) * 2 + 1] = 1 - i / (n - 1);
  }
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, a, c, d);
  for (let i = 0; i < n - 1; i++) {
    for (let u = 0; u < m - 1; u++) { quad(F(i, u), F(i + 1, u), F(i + 1, u + 1), F(i, u + 1)); quad(B(i, u), B(i, u + 1), B(i + 1, u + 1), B(i + 1, u)); }
    quad(F(i, 0), B(i, 0), B(i + 1, 0), F(i + 1, 0)); quad(F(i, m - 1), F(i + 1, m - 1), B(i + 1, m - 1), B(i, m - 1));
  }
  for (let u = 0; u < m - 1; u++) { quad(F(0, u), F(0, u + 1), B(0, u + 1), B(0, u)); quad(F(n - 1, u), B(n - 1, u), B(n - 1, u + 1), F(n - 1, u + 1)); }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * n * m * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}

/** each figure p of J carries props[p]; looks give the head's size and the torso's (build, shape) */
export function Props({ J, clock, looks, props }: { J: Joints; clock: Clock; looks: Look[]; props: Prop[][] }) {
  const ix = useMemo(() => poseIndex(J), [J]), nJ = J.names.length;
  const pose = useMemo(() => new Float32Array(J.players * nJ * 3), [J.players, nJ]);
  const res = useMemo(() => {
    const ramp = toonRamp(), line = outlineMaterial(1.1, false), group = new THREE.Group();
    const items = props.map((list, p) => list.map((pr) => {
      const path = 'drape' in pr ? resample(pr.drape) : null;
      const geo = path ? slabGeometry(path.length) : (pr as Carried).geo(), map = pr.map?.();
      const mesh = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ color: pr.color, gradientMap: ramp, map: map ?? null }));
      const edge = new THREE.Mesh(geo, line);
      for (const m of [mesh, edge]) { m.matrixAutoUpdate = false; m.frustumCulled = false; m.castShadow = m === mesh; group.add(m); }
      const c = pr as Carried;
      const local = new THREE.Matrix4().compose(new THREE.Vector3(...(c.off ?? [0, 0, 0])), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(c.rot ?? [0, 0, 0]))), new THREE.Vector3(1, 1, 1));
      return { pr, p, mesh, edge, local, map, path };
    }));
    return { ramp, line, group, items: items.flat() };
  }, [props]);
  useEffect(() => () => {
    res.ramp.dispose(); res.line.dispose();
    for (const it of res.items) { it.mesh.geometry.dispose(); (it.mesh.material as THREE.Material).dispose(); it.map?.dispose(); }
  }, [res]);

  const tmp = useMemo(() => ({ T: new THREE.Matrix4(), H: new THREE.Matrix4(), A: new THREE.Matrix4(), S: new THREE.Matrix4(),
    a: new THREE.Vector3(), b: new THREE.Vector3(), x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3(),
    hip: new THREE.Vector3(), up: new THREE.Vector3(), rh: new THREE.Vector3(), rs: new THREE.Vector3(), rt: new THREE.Vector3(), fw: new THREE.Vector3(), c: new THREE.Vector3() }), []);
  useFrame(() => {
    if (!poseAt(J, ix, clock.t, pose)) return;
    const { T, H, A, S, a, b, x, y, z } = tmp;
    const fist = (p: number, s: 'r' | 'l', out: THREE.Vector3) => pointOf(pose, nJ, ix, p, [`${s}Wrist`, `${s}Hand`, 0.82], out);
    for (const it of res.items) {
      const p = it.p;
      if (it.path) { lay(it.path, it.pr as Drape, p, it.mesh.geometry); it.mesh.matrix.identity(); it.edge.matrix.identity(); it.mesh.matrixWorldNeedsUpdate = it.edge.matrixWorldNeedsUpdate = true; continue; }
      const at = (it.pr as Carried).at;
      torsoFrame(pose, nJ, ix, p, T);
      if (at === 'head') {
        headFrame(pose, nJ, ix, p, T, H);
        pointOf(pose, nJ, ix, p, HEAD.at, a).addScaledVector(y.setFromMatrixColumn(H, 1), HEAD.lift ?? 0);
        const k = looks[p]?.build.head ?? 1;
        A.copy(H).multiply(S.makeScale(k, k, k)).setPosition(a);
      } else if (at === 'neck') {
        pointOf(pose, nJ, ix, p, 'neck', a); A.copy(T).setPosition(a);
      } else if (at === 'hands') {
        fist(p, 'l', a); fist(p, 'r', b);
        x.subVectors(b, a).normalize(); y.setFromMatrixColumn(T, 1); y.addScaledVector(x, -y.dot(x)).normalize(); z.crossVectors(x, y);
        A.makeBasis(x, y, z).setPosition(a.add(b).multiplyScalar(0.5));
      } else {
        const s = at === 'rHand' ? 'r' : 'l';
        handFrame(pose, nJ, ix, p, s, A); A.setPosition(fist(p, s, a));
      }
      A.multiply(it.local);
      it.mesh.matrix.copy(A); it.edge.matrix.copy(A);
      it.mesh.matrixWorldNeedsUpdate = it.edge.matrixWorldNeedsUpdate = true;
    }
  });

  /** a drape's slab laid over figure p's torso, the sections placed as Styles.tsx places the torso's rings */
  function lay(path: [number, number][], d: Drape, p: number, geo: THREE.BufferGeometry) {
    const { hip, up, rh, rs, rt, fw, c, a } = tmp, look = looks[p], tw = look?.build.torso ?? 1;
    jointOf(pose, nJ, p, ix.midHip, hip); jointOf(pose, nJ, p, ix.neck, up).sub(hip);
    const Sl = up.length(); up.multiplyScalar(1 / Sl);
    jointOf(pose, nJ, p, ix.rHip, rh).sub(jointOf(pose, nJ, p, ix.lHip, a)).normalize();
    jointOf(pose, nJ, p, ix.rShoulder, rs).sub(jointOf(pose, nJ, p, ix.lShoulder, a)).normalize();
    const pos = geo.attributes.position.array as Float32Array, n = path.length, m = ACROSS, reach = new Float32Array(m).fill(-Infinity);
    path.forEach(([h, x0], i) => {
      const t = Math.min(1, Math.max(0, (h - 0.1) / 0.8)), k = t * t * (3 - 2 * t);
      rt.copy(rh).lerp(rs, k).normalize(); fw.crossVectors(up, rt).normalize();
      c.copy(hip).addScaledVector(up, h * Sl);
      const sec = torsoSection(h, tw, look?.shape);
      for (let u = 0; u < m; u++) {
        const xs = x0 + (u / (m - 1) - 0.5) * d.width, q = Math.min(1, Math.abs(xs) / sec.w);
        // the surface's depth across a superellipse section, then held at the furthest reached above (the hang)
        const zs = sec.front * (1 - q ** TORSO_N) ** (1 / TORSO_N);
        reach[u] = Math.max(reach[u], zs);
        for (const [layer, off] of [[0, GAP], [1, GAP + d.thick]] as const) {
          const o = ((layer * n + i) * m + u) * 3, zz = reach[u] + off;
          pos[o] = c.x + rt.x * xs + fw.x * zz; pos[o + 1] = c.y + rt.y * xs + fw.y * zz; pos[o + 2] = c.z + rt.z * xs + fw.z * zz;
        }
      }
    });
    geo.attributes.position.needsUpdate = true; geo.computeVertexNormals();
  }
  return <primitive object={res.group} />;
}
