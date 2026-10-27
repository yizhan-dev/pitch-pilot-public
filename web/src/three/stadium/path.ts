// Rounded-rectangle bowl path in data coordinates (metres, x along the pitch, y across),
// sampled at a fixed arc-length step, with outward normals. Three.js: (x, z, y).
export interface PathPt { x: number; y: number; nx: number; ny: number; s: number; corner: boolean; }

export function roundedRect(hx: number, hy: number, r: number, step: number): PathPt[] {
  const segs: { len: number; at: (u: number) => PathPt }[] = [];
  const line = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number) =>
    segs.push({ len: Math.hypot(x1 - x0, y1 - y0), at: (u) => ({ x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u, nx, ny, s: 0, corner: false }) });
  const arc = (cx: number, cy: number, a0: number, a1: number) =>
    segs.push({ len: r * Math.abs(a1 - a0), at: (u) => { const a = a0 + (a1 - a0) * u; return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a), s: 0, corner: true }; } });
  // counter-clockwise starting at the middle of the +y side
  line(0, hy, -(hx - r), hy, 0, 1); arc(-(hx - r), hy - r, Math.PI / 2, Math.PI);
  line(-hx, hy - r, -hx, -(hy - r), -1, 0); arc(-(hx - r), -(hy - r), Math.PI, 1.5 * Math.PI);
  line(-(hx - r), -hy, hx - r, -hy, 0, -1); arc(hx - r, -(hy - r), 1.5 * Math.PI, 2 * Math.PI);
  line(hx, -(hy - r), hx, hy - r, 1, 0); arc(hx - r, hy - r, 0, Math.PI / 2);
  line(hx - r, hy, 0, hy, 0, 1);
  const total = segs.reduce((a, b) => a + b.len, 0), n = Math.max(8, Math.round(total / step)), out: PathPt[] = [];
  for (let i = 0; i < n; i++) {
    let s = (i / n) * total, k = 0;
    while (k < segs.length - 1 && s > segs[k].len) { s -= segs[k].len; k++; }
    const p = segs[k].at(Math.min(1, s / segs[k].len));
    p.s = (i / n) * total; out.push(p);
  }
  return out;
}

/** A tier profile: points (d outward from the path, h up), drawn as a strip extruded around the path. */
export type Profile = { d: number; h: number; kind: 'seat' | 'riser' | 'wall' | 'fascia' | 'roof' | 'pitchwall' }[];

export function steps(d0: number, h0: number, rows: number, tread: number, rise: number): Profile {
  const p: Profile = [];
  let d = d0, h = h0;
  for (let i = 0; i < rows; i++) {
    p.push({ d, h, kind: 'riser' }); h += rise;
    p.push({ d, h, kind: 'seat' }); d += tread;
  }
  p.push({ d, h, kind: 'wall' });
  return p;
}

/** The path with extra samples at the given arc lengths (wrapped), so an extruded cut can end exactly there; the normal
 *  is blended across the segment the break falls in. src[k] is the original index each sample came from
 *  (an inserted one: the segment's start). Used to cut the vomitories out of the tiers. */
export function withBreaks(path: PathPt[], breaks: number[]): PathPt[] & { src?: number[] } {
  const n = path.length, per = path[1].s * n, out: PathPt[] & { src?: number[] } = [], src: number[] = [];
  const bs = breaks.map((b) => ((b % per) + per) % per).sort((x, y) => x - y);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const p = path[i], q = path[(i + 1) % n], s1 = i + 1 === n ? per : q.s;
    out.push(p); src.push(i);
    while (k < bs.length && bs[k] < p.s + 1e-6) k++;
    while (k < bs.length && bs[k] < s1 - 1e-6) {
      const f = (bs[k] - p.s) / (s1 - p.s);
      // the normal turns with the corner; blend and renormalise, or the inserted point's rows would kink sideways
      const nx = p.nx + (q.nx - p.nx) * f, ny = p.ny + (q.ny - p.ny) * f, l = Math.hypot(nx, ny);
      out.push({ x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, nx: nx / l, ny: ny / l, s: bs[k], corner: p.corner && q.corner }); src.push(-1 - i);
      k++;
    }
  }
  out.src = src;
  return out;
}
