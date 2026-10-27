import * as THREE from 'three';
import { buildCrystalShell } from './crystalBuild';
import type { CrystalParams } from './crystalParams';

/** The height of the shell's underside above a point: the eave shoulder, the roof and its underside, as built for the
 *  given crystal. Used to fit the bowl's top tier under the roof. A 1 m height field of the lowest triangle corner in
 *  each cell (conservative), so a query is a lookup instead of a ray cast. Returns Infinity where nothing is above. */
export function shellCeiling(P: CrystalParams, hx: number, hy: number, rc: number, back: number) {
  const G = buildCrystalShell(P, hx, hy, rc, back);
  const CELL = 1, X0 = -170, Z0 = -150, NX = 340, NZ = 300, grid = new Float32Array(NX * NZ).fill(Infinity);
  // the roof's underside sits 1.4 m below its top surface (the separate underside mesh also skirts down the inside of the
  // facade, which must not count as ceiling)
  for (const [g, drop] of [[G.shoulder, 0], [G.roof, 1.4], [G.lip, 0]] as [THREE.BufferGeometry | null, number][]) {
    if (!g) continue;
    const pos = g.getAttribute('position'), idx = g.getIndex(), tri = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < tri; t++) {
      const v = [0, 1, 2].map((k) => (idx ? idx.getX(3 * t + k) : 3 * t + k));
      const xs = v.map((k) => pos.getX(k)), ys = v.map((k) => pos.getY(k)), zs = v.map((k) => pos.getZ(k)), y = Math.min(...ys) - drop;
      const i0 = Math.max(0, Math.floor((Math.min(...xs) - X0) / CELL)), i1 = Math.min(NX - 1, Math.floor((Math.max(...xs) - X0) / CELL));
      const j0 = Math.max(0, Math.floor((Math.min(...zs) - Z0) / CELL)), j1 = Math.min(NZ - 1, Math.floor((Math.max(...zs) - Z0) / CELL));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const c = j * NX + i; if (y < grid[c]) grid[c] = y; }
    }
  }
  const at = (x: number, z: number) => {
    const i = Math.floor((x - X0) / CELL), j = Math.floor((z - Z0) / CELL);
    let m = Infinity;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const ii = i + di, jj = j + dj; if (ii >= 0 && ii < NX && jj >= 0 && jj < NZ) m = Math.min(m, grid[jj * NX + ii]);
    }
    return m;
  };
  const dispose = () => { for (const g of Object.values(G)) if (g instanceof THREE.BufferGeometry) g.dispose(); };
  return { at, dispose };
}
