import * as THREE from 'three';

/** The floodlights evenly spaced (Yi, 2026-10-23: "the top light seems not so evenly spaced"). The shell builder puts a
 *  lamp on every third sample of the roof opening's ring, and those samples crowd together at the corners: lamps were
 *  2.1 m apart on the straights and 0.3-1.7 m at the corners, so the corners read as bunched and the straights as sparse,
 *  and their halos summed into light and dark stripes on the opening's lip where the lamps were sparse. This keeps the
 *  same ring and puts `spacing`-metre steps along it by arc length, a whole number of lamps that is a multiple of four,
 *  the first where the ring crosses the +x axis, so the layout is symmetric about both axes. */
export function evenLamps(src: THREE.BufferGeometry, spacing = 1.5) {
  const p = src.getAttribute('position'), n = p.count, pts: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) pts.push(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)));
  // start exactly where the ring crosses the +x axis (z from - to +), so the arc length starts on the axis
  let i0 = 0, cross = pts[0].clone();
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    if (a.x > 0 && a.z <= 0 && b.z > 0) { i0 = (i + 1) % n; cross = a.clone().lerp(b, -a.z / (b.z - a.z)); break; }
  }
  const ring = [cross, ...pts.slice(i0), ...pts.slice(0, i0)], arc = [0];
  const m = ring.length;
  for (let i = 1; i <= m; i++) arc.push(arc[i - 1] + ring[i % m].distanceTo(ring[i - 1]));
  const L = arc[m], N = Math.max(4, 4 * Math.round(L / spacing / 4)), out: number[] = [];
  for (let k = 0, i = 0; k < N; k++) {
    const t = (k / N) * L; while (i < m - 1 && arc[i + 1] < t) i++;
    const f = (t - arc[i]) / ((arc[i + 1] - arc[i]) || 1), a = ring[i], b = ring[(i + 1) % m];
    out.push(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return g;
}

/** Each floodlight's visibility from the camera, so its halo (glare, drawn without the depth test, so the roof
 *  opening's lip never cuts it into strips) shows exactly when its lamp does. A lamp hangs 0.8 m outwards of the
 *  opening's edge and 0.3 m below the roof's underside (crystalBuild.ts lampPos), so:
 *  - from the opening's side (the camera more than 0.8 m inwards of the lamp, measured along the edge's inward normal)
 *    the line of sight clears the edge if it rises less than 0.3 m over those 0.8 m: a slope under 0.375;
 *  - from the roof's side, only from below the underside.
 *  Fades over a short band so a lamp never pops. Meant for a camera inside the stadium (Crystal.tsx decides); call with
 *  null to show every halo (the depth test then does the work, as outside). */
export function lampVisibility(lamps: THREE.BufferGeometry) {
  const p = lamps.getAttribute('position'), n = p.count, nx = new Float32Array(n), nz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n, b = (i + 1) % n, tx = p.getX(b) - p.getX(a), tz = p.getZ(b) - p.getZ(a), l = Math.hypot(tx, tz) || 1;
    let ix = -tz / l, iz = tx / l; if (ix * p.getX(i) + iz * p.getZ(i) > 0) { ix = -ix; iz = -iz; }   // towards the middle
    nx[i] = ix; nz[i] = iz;
  }
  const vis = new THREE.BufferAttribute(new Float32Array(n).fill(1), 1); vis.setUsage(THREE.DynamicDrawUsage);
  lamps.setAttribute('aVis', vis);
  const ss = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  let all = true;
  return (cam: THREE.Vector3 | null) => {
    const a = vis.array as Float32Array;
    if (!cam) { if (!all) { a.fill(1); vis.needsUpdate = true; all = true; } return; }
    all = false;
    for (let i = 0; i < n; i++) {
      const dx = cam.x - p.getX(i), dz = cam.z - p.getZ(i), dy = cam.y - p.getY(i), h = dx * nx[i] + dz * nz[i];
      a[i] = h > 0.8 ? 1 - ss(0.3, 0.45, dy / h) : 1 - ss(0.0, 0.3, dy);
    }
    vis.needsUpdate = true;
  };
}

/** true if (x, z) lies inside the ring of lamps in plan, i.e. over the roof opening (even-odd rule) */
export function insideLampRing(lamps: THREE.BufferGeometry) {
  const p = lamps.getAttribute('position'), n = p.count, xs = new Float32Array(n), zs = new Float32Array(n);
  for (let i = 0; i < n; i++) { xs[i] = p.getX(i); zs[i] = p.getZ(i); }
  return (x: number, z: number) => {
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) if ((zs[i] > z) !== (zs[j] > z) && x < ((xs[j] - xs[i]) * (z - zs[i])) / (zs[j] - zs[i]) + xs[i]) inside = !inside;
    return inside;
  };
}
