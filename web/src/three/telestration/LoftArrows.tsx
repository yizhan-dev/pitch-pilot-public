// The lofted pass arrow (a pass can be ground or lofted), as a real path in the 3D
// scene (not a picture painted over the broadcast, as pitch_prism's on its
// fixed video, but a ball path in the 3D world that holds from any camera):
//  - the arc is the ball's own kind of path, a parabola `4H q(1-q)` in the upright plane from the passer's feet to where
//    it lands (the tip, on the grass);
//  - the arrow is a flat thing bent along it ('flat': the camera is at the side, and the tip must not be seen
//    face-on): the shaft a strip lying across the track, the head (pitch_prism's barbed head: tip, barb,
//    notch, barb) one rigid piece in the same strip on the arc's last stretch, pointing down the arc; from the side both
//    are seen edge-on, from above or behind the whole arrow; once landed the tip touches the grass nose-first, a dart
//    landing (LoftHead keeps the others: turned to the camera, upright in the arc's plane, both crossed);
//  - drawn on from the passer, the head flying along the arc at the front.
// (Before this, three rounds copied pitch_prism's 2D bend into the 3D scene and failed in its old ways; see
// telestration-notes.md §13.) Its ground cues (the shadow of the flat track, the landing ring) are Telestration's, on the
// ground strip. One mesh for every lofted arrow, depth tested (players stand in front of it), no depth writes, the
// canvas's multisampling for its edges.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

/** one lofted arrow: tail and tip on the ground (scene x, z), the arc's peak `H` m, the shaft `w` m wide, the head `S`
 *  m with its notch at `notch` of it and its barbs at `spread` rad, the tail dissolving over `tailFade` of the shaft;
 *  `t` 0..1 drawn from the tail, `alpha`, `rgb` */
export interface LoftReq { tail: [number, number]; tip: [number, number]; H: number; w: number; S: number; notch: number; spread: number; tailFade: number; t: number; alpha: number; rgb: [number, number, number]; head: LoftHead }
/** the head's options (the head was what looked wrong): 'flat' (the default) lying across the track, pitched
 *  along the arc, the shaft a flat strip with it; 'face' turned to the camera about the arc, the shaft too; 'plane'
 *  upright in the arc's own plane, its barbs above and below; 'cross' 'plane' and 'flat' together */
export type LoftHead = 'face' | 'plane' | 'flat' | 'cross';

const N = 48, MAX = 16, V_PER = (N + 1) * 2 + 6, I_PER = N * 6 + 15;

export function LoftArrows({ store }: { store: { list: LoftReq[] } }) {
  const res = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX * V_PER * 3), col = new Float32Array(MAX * V_PER * 4), idx = new Uint32Array(MAX * I_PER);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(idx, 1).setUsage(THREE.DynamicDrawUsage));
    // where it touches the grass (the tail, the landed tip): the ground layer's polygon offset keeps it from fighting the
    // pitch for depth
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.renderOrder = 12;
    return { geo, pos, col, idx, mat, mesh };
  }, []);
  useEffect(() => () => { res.geo.dispose(); res.mat.dispose(); }, [res]);

  useFrame((state) => {
    const cam = state.camera.position;
    let nv = 0, ni = 0;
    for (const r of store.list.slice(0, MAX)) {
      const dx = r.tip[0] - r.tail[0], dz = r.tip[1] - r.tail[1], L = Math.hypot(dx, dz);
      if (L < 0.5 || r.t <= 0 || r.alpha <= 0.002) continue;
      const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
      // the arc over the whole pass, tail to tip; its height and slope at s (metres along the ground)
      const height = (s: number) => { const q = s / L; return Math.max(0, 4 * r.H * q * (1 - q)); };
      const slope = (s: number) => (4 * r.H * (1 - (2 * s) / L)) / L;
      const vtx = (x: number, y: number, z: number, a: number) => {
        res.pos.set([x, y, z], nv * 3);
        res.col.set([r.rgb[0], r.rgb[1], r.rgb[2], a], nv * 4);
        return nv++;
      };
      // the side at a point with tangent (tx, ty, tz): across the tangent and the view, on the same side as the track's
      // own across direction (no flip along the arc)
      const sd = [0, 0, 0];
      const side = (px: number, py: number, pz: number, tx: number, ty: number, tz: number) => {
        const vx = cam.x - px, vy = cam.y - py, vz = cam.z - pz;
        let sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx;
        const l = Math.hypot(sx, sy, sz) || 1; sx /= l; sy /= l; sz /= l;
        if (sx * nx + sz * nz < 0) { sx = -sx; sy = -sy; sz = -sz; }
        sd[0] = sx; sd[1] = sy; sd[2] = sz;
      };
      // drawn from the passer: the tip at the reveal's front on the arc; the head's notch S x notch back along the arc
      // (by the tangent's horizontal share there), the shaft running into it
      const shown = L * r.t, S = Math.min(r.S, 0.6 * shown), k0 = slope(shown), c0 = 1 / Math.hypot(1, k0);
      const sN = Math.max(0, shown - S * r.notch * c0), h = r.w / 2;
      // the head: one rigid piece from the notch to the tip along the arc, turned to the camera about that line
      const tX = r.tail[0] + ux * shown, tY = height(shown), tZ = r.tail[1] + uz * shown;
      const nX = r.tail[0] + ux * sN, nY = height(sN), nZ = r.tail[1] + uz * sN;
      let ax = tX - nX, ay = tY - nY, az = tZ - nZ;
      const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
      const back = S * Math.cos(r.spread), wide = S * Math.sin(r.spread), bx = tX - ax * back, by = tY - ay * back, bz = tZ - az * back;
      const qX = tX - ax * S * r.notch, qY = tY - ay * S * r.notch, qZ = tZ - az * S * r.notch;
      // the flat head's shaft ends on the head's inner edges, a V into its notch, so shaft and head never overlap: one
      // outline, one coat of colour through the see-through (overlapped, the rectangle and the head showed as two
      // pieces; this way the arrow and its tail read as one thing); the other heads (and a head no wider than the shaft) keep the shaft running a little into the head
      const fit = r.head === 'flat' && wide > h * 1.01, fk = h / wide;
      const P1 = [qX + (bx + nx * wide - qX) * fk, qY + (by - qY) * fk, qZ + (bz + nz * wide - qZ) * fk];
      const P2 = [qX + (bx - nx * wide - qX) * fk, qY + (by - qY) * fk, qZ + (bz - nz * wide - qZ) * fk];
      const end = fit ? Math.max(0, (P1[0] - r.tail[0]) * ux + (P1[2] - r.tail[1]) * uz) : Math.min(shown, sN + 0.05 * S * c0), fadeM = Math.max(1e-3, r.tailFade * end);
      const v0 = nv;
      for (let i = 0; i <= N; i++) {
        const s = (end * i) / N, f = Math.min(1, s / fadeM), a = r.alpha * f * f * (3 - 2 * f);
        if (fit && i === N) { vtx(P2[0], P2[1], P2[2], a); vtx(P1[0], P1[1], P1[2], a); continue; }
        const px = r.tail[0] + ux * s, py = height(s), pz = r.tail[1] + uz * s, k = slope(s);
        if (r.head === 'flat') { sd[0] = nx; sd[1] = 0; sd[2] = nz; } else side(px, py, pz, ux, k, uz);
        vtx(px - sd[0] * h, py - sd[1] * h, pz - sd[2] * h, a); vtx(px + sd[0] * h, py + sd[1] * h, pz + sd[2] * h, a);
      }
      for (let i = 0; i < N; i++) { const a = v0 + i * 2; res.idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], ni); ni += 6; }
      const T = vtx(tX, tY, tZ, r.alpha), Nn = vtx(qX, qY, qZ, r.alpha);
      if (fit) { res.idx.set([v0 + N * 2 + 1, Nn, v0 + N * 2], ni); ni += 3; }   // the V between the shaft's end and the notch
      // one pair of barbs across the direction (cx, cy, cz)
      const barbs = (cx: number, cy: number, cz: number) => {
        const B1 = vtx(bx + cx * wide, by + cy * wide, bz + cz * wide, r.alpha), B2 = vtx(bx - cx * wide, by - cy * wide, bz - cz * wide, r.alpha);
        res.idx.set([T, B1, Nn, T, Nn, B2], ni); ni += 6;
      };
      if (r.head === 'face') { side(nX, nY, nZ, ax, ay, az); barbs(sd[0], sd[1], sd[2]); }
      // upright in the arc's plane: the up direction square to the head's axis
      if (r.head === 'plane' || r.head === 'cross') { const vx = -ax * ay, vy = 1 - ay * ay, vz = -az * ay, vl = Math.hypot(vx, vy, vz) || 1; barbs(vx / vl, vy / vl, vz / vl); }
      if (r.head === 'flat' || r.head === 'cross') barbs(nx, 0, nz);
    }
    for (const name of ['position', 'color'] as const) {
      const at = res.geo.getAttribute(name) as THREE.BufferAttribute;
      at.clearUpdateRanges(); at.addUpdateRange(0, nv * at.itemSize); at.needsUpdate = true;
    }
    const ix = res.geo.getIndex()!; ix.clearUpdateRanges(); ix.addUpdateRange(0, ni); ix.needsUpdate = true;
    res.geo.setDrawRange(0, ni);
    res.mesh.visible = ni > 0;
  });
  return <primitive object={res.mesh} />;
}
