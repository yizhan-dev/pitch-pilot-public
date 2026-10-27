import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { MomentPkg } from '../types';
import type { Clock } from '../clock';

export function ballAt(pkg: MomentPkg, t: number): [number, number, number] | null {
  // the 25 Hz track where the package has one: touches and the ball in the net need it
  if (pkg.ball25) {
    const B = pkg.ball25.xyz, f = Math.min(B.length - 1.001, Math.max(0, t * pkg.ball25.fps)), i = Math.floor(f), a = B[i], b = B[i + 1];
    if (!a || !b) return a ?? b;
    const u = f - i;
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  }
  const f = Math.min(pkg.frames.length - 1.001, Math.max(0, t * pkg.meta.fps)), i = Math.floor(f), a = pkg.frames[i].ball, b = pkg.frames[i + 1].ball;
  if (!a || !b) return a ?? b;
  const u = f - i;
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

export function Ball({ pkg, clock }: { pkg: MomentPkg; clock: Clock }) {
  const ball = useRef<THREE.Mesh>(null), shadow = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const p = ballAt(pkg, clock.t);
    if (!ball.current || !shadow.current) return;
    ball.current.visible = shadow.current.visible = !!p;
    if (!p) return;
    ball.current.position.set(p[0], Math.max(0.11, p[2]), p[1]);
    shadow.current.position.set(p[0], 0.015, p[1]);
  });
  return (
    <group>
      <mesh ref={ball} castShadow><sphereGeometry args={[0.11, 20, 14]} /><meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.25} roughness={0.4} /></mesh>
      <mesh ref={shadow} rotation-x={-Math.PI / 2}><circleGeometry args={[0.16, 16]} /><meshBasicMaterial color="#000" transparent opacity={0.4} depthWrite={false} /></mesh>
    </group>
  );
}
