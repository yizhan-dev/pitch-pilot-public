import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { PathPt } from './path';
import { addVomitories, soupGeometry, type VomTier } from './vomBuild';
import type { VomGate } from './layout';

/** the vomitories of the given tiers, one lit mesh for the boxes and one unlit for the passages (see vomBuild.ts) */
export function Vomitories({ path, clip, tiers }: { path: PathPt[]; clip: THREE.Plane[]; tiers: { tier: VomTier; gates: VomGate[] }[] }) {
  const g = useMemo(() => {
    const ext = { pos: [] as number[], col: [] as number[] }, int = { pos: [] as number[], col: [] as number[] };
    for (const t of tiers) addVomitories(path, t.gates, t.tier, ext, int);
    return { ext: soupGeometry(ext), int: soupGeometry(int) };
  }, [path, tiers]);
  useEffect(() => () => { g.ext.dispose(); g.int.dispose(); }, [g]);
  return (
    <group>
      <mesh geometry={g.ext}><meshStandardMaterial vertexColors roughness={0.9} side={THREE.DoubleSide} clippingPlanes={clip} /></mesh>
      <mesh geometry={g.int}><meshBasicMaterial vertexColors side={THREE.DoubleSide} clippingPlanes={clip} /></mesh>
    </group>
  );
}
