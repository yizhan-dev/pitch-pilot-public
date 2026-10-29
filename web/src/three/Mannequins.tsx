import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Joints } from '../data';
import { KIT, TEAM_KIT, playerTeam, type Team } from './coords';
import type { Clock } from '../clock';

type Part = 'shirt' | 'shorts' | 'socks' | 'skin' | 'boot';
// [from joint, to joint, radius m, part]
const BONES: [string, string, number, Part][] = [
  ['neck', 'midHip', 0.15, 'shirt'], ['rShoulder', 'lShoulder', 0.085, 'shirt'], ['rHip', 'lHip', 0.1, 'shorts'],
  ['rShoulder', 'rElbow', 0.055, 'shirt'], ['rElbow', 'rWrist', 0.042, 'skin'],
  ['lShoulder', 'lElbow', 0.055, 'shirt'], ['lElbow', 'lWrist', 0.042, 'skin'],
  ['rHip', 'rKnee', 0.075, 'shorts'], ['rKnee', 'rAnkle', 0.055, 'socks'],
  ['lHip', 'lKnee', 0.075, 'shorts'], ['lKnee', 'lAnkle', 0.055, 'socks'],
  ['rHeel', 'rBigToe', 0.045, 'boot'], ['lHeel', 'lBigToe', 0.045, 'boot'],
  ['neck', 'nose', 0.05, 'skin'],
];
const PARTS: Part[] = ['shirt', 'shorts', 'socks', 'skin', 'boot'];
// rounded joints: [joint, radius m, part]
const BALLS: [string, number, Part][] = [
  ['rShoulder', 0.07, 'shirt'], ['lShoulder', 0.07, 'shirt'], ['rElbow', 0.048, 'skin'], ['lElbow', 0.048, 'skin'],
  ['rHip', 0.085, 'shorts'], ['lHip', 0.085, 'shorts'], ['rKnee', 0.062, 'socks'], ['lKnee', 0.062, 'socks'],
  ['rAnkle', 0.05, 'socks'], ['lAnkle', 0.05, 'socks'], ['rWrist', 0.04, 'skin'], ['lWrist', 0.04, 'skin'],
  ['midHip', 0.13, 'shorts'], ['neck', 0.1, 'shirt'],
];
const UP = new THREE.Vector3(0, 1, 0);

/** attacking: the team of players 0..nAtt-1, so each team wears its own kit (coords.ts) */
export function Mannequins({ joints, clock, attacking = 'home' }: { joints: Joints; clock: Clock; attacking?: Team }) {
  const idx = useMemo(() => Object.fromEntries(joints.names.map((n, i) => [n, i])), [joints]);
  const counts = useMemo(() => {
    const c: Record<Part, number> = { shirt: 0, shorts: 0, socks: 0, skin: 0, boot: 0 };
    for (const b of BONES) c[b[3]] += joints.players;
    return c;
  }, [joints]);
  const ballCounts = useMemo(() => {
    const c: Record<Part, number> = { shirt: 0, shorts: 0, socks: 0, skin: 0, boot: 0 };
    for (const b of BALLS) c[b[2]] += joints.players;
    return c;
  }, [joints]);
  const ballRefs = useRef<Record<string, THREE.InstancedMesh | null>>({});
  const refs = useRef<Record<string, THREE.InstancedMesh | null>>({});
  const head = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 10), []);
  const ballGeo = useMemo(() => new THREE.SphereGeometry(1, 12, 8), []);
  const headGeo = useMemo(() => new THREE.SphereGeometry(1, 16, 12), []);
  const tmp = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), d: new THREE.Vector3() }), []);

  useEffect(() => {
    const color = new THREE.Color();
    for (const part of PARTS) {
      const mesh = refs.current[part];
      if (!mesh) continue;
      let n = 0;
      for (const b of BONES) {
        if (b[3] !== part) continue;
        for (let p = 0; p < joints.players; p++) {
          const team = TEAM_KIT[playerTeam(p, joints.nAtt, attacking)];
          color.set(part === 'skin' ? KIT.skin : part === 'boot' ? KIT.boot : team[part]);
          mesh.setColorAt(n++, color);
        }
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const part of PARTS) {
      const mesh = ballRefs.current[part];
      if (!mesh) continue;
      let n = 0;
      for (const b of BALLS) {
        if (b[2] !== part) continue;
        for (let p = 0; p < joints.players; p++) {
          const team = TEAM_KIT[playerTeam(p, joints.nAtt, attacking)];
          color.set(part === 'skin' ? KIT.skin : part === 'boot' ? KIT.boot : team[part]);
          mesh.setColorAt(n++, color);
        }
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }, [joints, attacking]);

  useFrame(() => {
    const { data, players, fps, frames } = joints, nJ = joints.names.length;
    const fpos = Math.min(frames - 1.001, Math.max(0, clock.t * fps));
    const i0 = Math.floor(fpos), f = fpos - i0, i1 = i0 + 1;
    const J = (p: number, j: number, out: THREE.Vector3) => {
      const a = ((i0 * players + p) * nJ + j) * 3, b = ((i1 * players + p) * nJ + j) * 3;
      const x = data[a] + (data[b] - data[a]) * f, y = data[a + 1] + (data[b + 1] - data[a + 1]) * f, z = data[a + 2] + (data[b + 2] - data[a + 2]) * f;
      return out.set(x, z, y);
    };
    const counters: Record<Part, number> = { shirt: 0, shorts: 0, socks: 0, skin: 0, boot: 0 };
    for (const [ja, jb, r, part] of BONES) {
      const mesh = refs.current[part];
      if (!mesh) continue;
      for (let p = 0; p < players; p++) {
        J(p, idx[ja], tmp.a); J(p, idx[jb], tmp.b);
        const n = counters[part]++;
        if (!Number.isFinite(tmp.a.x) || !Number.isFinite(tmp.b.x)) { tmp.m.makeScale(0, 0, 0); mesh.setMatrixAt(n, tmp.m); continue; }
        tmp.d.subVectors(tmp.b, tmp.a);
        const len = Math.max(0.01, tmp.d.length());
        tmp.q.setFromUnitVectors(UP, tmp.d.normalize());
        tmp.s.set(r, len, r);
        tmp.a.add(tmp.b).multiplyScalar(0.5);
        tmp.m.compose(tmp.a, tmp.q, tmp.s);
        mesh.setMatrixAt(n, tmp.m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    const bc: Record<Part, number> = { shirt: 0, shorts: 0, socks: 0, skin: 0, boot: 0 };
    for (const [jn, r, part] of BALLS) {
      const mesh = ballRefs.current[part];
      if (!mesh) continue;
      for (let p = 0; p < players; p++) {
        J(p, idx[jn], tmp.a);
        tmp.m.compose(tmp.a, tmp.q.identity(), tmp.s.set(r, r, r));
        mesh.setMatrixAt(bc[part]++, tmp.m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (head.current) {
      for (let p = 0; p < players; p++) {
        J(p, idx.lEar, tmp.a); J(p, idx.rEar, tmp.b); tmp.a.add(tmp.b).multiplyScalar(0.5);
        J(p, idx.nose, tmp.b); tmp.a.lerp(tmp.b, 0.35);
        tmp.m.compose(tmp.a, tmp.q.identity(), tmp.s.set(0.12, 0.135, 0.12));
        head.current.setMatrixAt(p, tmp.m);
      }
      head.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      {PARTS.map((part) => (
        <instancedMesh key={part} ref={(m) => { refs.current[part] = m; }} args={[geo, undefined, counts[part]]} castShadow frustumCulled={false}>
          <meshStandardMaterial roughness={part === 'boot' ? 0.5 : 0.75} metalness={0} />
        </instancedMesh>
      ))}
      {PARTS.filter((p) => ballCounts[p] > 0).map((part) => (
        <instancedMesh key={`b-${part}`} ref={(m) => { ballRefs.current[part] = m; }} args={[ballGeo, undefined, ballCounts[part]]} castShadow frustumCulled={false}>
          <meshStandardMaterial roughness={0.75} metalness={0} />
        </instancedMesh>
      ))}
      <instancedMesh ref={head} args={[headGeo, undefined, joints.players]} castShadow frustumCulled={false}>
        <meshStandardMaterial color={KIT.skin} roughness={0.8} />
      </instancedMesh>
    </group>
  );
}
