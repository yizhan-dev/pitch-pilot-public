// A top-down sketch of one beat for the debug view and the storyboard: the pitch, every player and the ball at a
// clip time, and the beat's drawings in the telestration's meaning colours (white the ball and passes, amber runs,
// team colours for units, blocks and marking). It is a diagram of the plan, not the telestration itself: it also
// sketches the primitives the telestration session has not built yet (pass and run arrows), so Yi can judge the plan
// before they exist. Returns an SVG string (no DOM), so a page or a script can use it.
import type { Geo, XY } from './geom';
import { unitsAt, nearestOpp } from './geom';
import type { DrawItem } from './draw';

const ATT = '#6ab8ff', DEF = '#ff9560', AMBER = '#ffb23f', WHITE = '#f4f6f8';
const W = 105, H = 68, M = 3;

const f1 = (x: number) => x.toFixed(1);
const pt = (q: XY) => `${f1(q[0])},${f1(q[1])}`;

/** the part of the pitch a beat is about: every point its drawings touch, its protagonist and the ball, padded by
 *  7 m, at least 42 m wide, in the pitch's own proportions (the whole pitch when it draws nothing) */
export function focusBox(g: Geo, items: DrawItem[], t: number, select: number | null): [number, number, number, number] {
  const pts: XY[] = [];
  const add = (q: XY | null | undefined) => { if (q) pts.push(q); };
  for (const it of items) {
    if (it.kind === 'pass') { if (Array.isArray(it.from)) add(it.from as XY); if (Array.isArray(it.to)) add(it.to as XY); }
    else if (it.kind === 'run') for (let tt = it.path.from; tt <= it.path.to + 1e-6; tt += 0.5) add(g.pos(it.path.player, tt));
    else if (it.kind === 'zone' && it.poly) it.poly.forEach(add);
    else if (it.kind === 'shot') { add(g.pos(it.shooter ?? 0, it.at ?? t)); add([52.5, -4]); add([52.5, 4]); }
    else if (it.kind === 'marking' && it.focus !== null && it.focus !== undefined) { add(g.pos(it.focus, it.at ?? t)); const m = nearestOpp(g, it.focus, it.at ?? t); if (m) add(g.pos(m.player, it.at ?? t)); }
    else if (it.kind === 'units' || it.kind === 'hull') for (let p = g.nAtt; p < g.P; p++) if (p !== g.defKeeper) add(g.pos(p, it.at ?? t));
  }
  if (!pts.length) return [-W / 2 - M, -H / 2 - M, W / 2 + M, H / 2 + M];
  if (select !== null) add(g.pos(select, t));
  const b = g.ball(t); if (b) add([b[0], b[1]]);
  const x0 = Math.min(...pts.map((q) => q[0])) - 7, x1 = Math.max(...pts.map((q) => q[0])) + 7, y0 = Math.min(...pts.map((q) => q[1])) - 7, y1 = Math.max(...pts.map((q) => q[1])) + 7;
  const asp = (W + 2 * M) / (H + 2 * M);
  let w = Math.max(42, x1 - x0, (y1 - y0) * asp), h = w / asp;
  w = Math.min(w, W + 2 * M); h = Math.min(h, H + 2 * M);
  const cx = Math.min(W / 2 + M - w / 2, Math.max(-W / 2 - M + w / 2, (x0 + x1) / 2)), cy = Math.min(H / 2 + M - h / 2, Math.max(-H / 2 - M + h / 2, (y0 + y1) / 2));
  return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
}

export function schematic(g: Geo, items: DrawItem[], t: number, label: (p: number) => string, select: number | null, px = 460, box = focusBox(g, items, t, select)): string {
  const out: string[] = [];
  const [bx0, by0, bx1, by1] = box, hpx = Math.round((px * (by1 - by0)) / (bx1 - bx0)), k = (bx1 - bx0) / (W + 2 * M);
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f1(bx0)} ${f1(by0)} ${f1(bx1 - bx0)} ${f1(by1 - by0)}" width="${px}" height="${hpx}" font-family="Inter, 'Noto Sans SC', sans-serif">`);
  out.push(`<defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${WHITE}"/></marker>`
    + `<marker id="ahA" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${AMBER}"/></marker>`
    + `<pattern id="zeb" patternUnits="userSpaceOnUse" width="1.6" height="1.6" patternTransform="rotate(45)"><rect width="0.8" height="1.6" fill="${ATT}" fill-opacity="0.32"/></pattern>`
    + `<pattern id="zebD" patternUnits="userSpaceOnUse" width="1.6" height="1.6" patternTransform="rotate(45)"><rect width="0.8" height="1.6" fill="${DEF}" fill-opacity="0.22"/></pattern></defs>`);
  // the pitch
  out.push(`<rect x="${-W / 2 - M}" y="${-H / 2 - M}" width="${W + 2 * M}" height="${H + 2 * M}" fill="#14301f"/>`);
  const line = 'stroke="#ffffff" stroke-opacity="0.35" stroke-width="0.25" fill="none"';
  out.push(`<rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" ${line}/><line x1="0" y1="${-H / 2}" x2="0" y2="${H / 2}" ${line}/><circle r="9.15" ${line}/>`);
  for (const s of [-1, 1]) {
    out.push(`<rect x="${s > 0 ? W / 2 - 16.5 : -W / 2}" y="-20.16" width="16.5" height="40.32" ${line}/><rect x="${s > 0 ? W / 2 - 5.5 : -W / 2}" y="-9.16" width="5.5" height="18.32" ${line}/>`);
    out.push(`<line x1="${s * W / 2}" y1="-3.66" x2="${s * W / 2}" y2="3.66" stroke="#ffffff" stroke-width="0.8"/>`);
  }
  out.push(`<text x="${f1(bx1 - 1.2 * k)}" y="${f1(by0 + 2.6 * k)}" font-size="${f1(2.2 * k)}" fill="#9fb3a6" text-anchor="end">进攻方向 →</text>`);

  const pos = (p: number, tt: number) => g.pos(p, tt);
  const timeOf = (it: DrawItem) => ('at' in it && typeof it.at === 'number' ? it.at : t);
  // drawings under the players: zones, blocks, units, marking
  for (const it of items) {
    if (it.kind === 'zone' && it.poly) out.push(`<polygon points="${it.poly.map(pt).join(' ')}" fill="url(#zeb)" stroke="${ATT}" stroke-width="0.35"/>`);
    else if (it.kind === 'hull') {
      const tt = timeOf(it), q: XY[] = [];
      for (let p = g.nAtt; p < g.P; p++) if (p !== g.defKeeper) { const x = pos(p, tt); if (x) q.push(x); }
      out.push(`<polygon points="${hull(q).map(pt).join(' ')}" fill="url(#zebD)" stroke="${DEF}" stroke-width="0.35"/>`);
    } else if (it.kind === 'units') {
      const tt = timeOf(it), u = unitsAt(g, it.side, tt);
      for (const k of ['back', 'mid', 'front'] as const) {
        const q = u[k].map((p) => pos(p, tt)).filter((x): x is XY => !!x).sort((a, b) => a[1] - b[1]);
        if (q.length >= 2) out.push(`<polyline points="${q.map(pt).join(' ')}" fill="none" stroke="${it.side === 'def' ? DEF : ATT}" stroke-width="0.45" stroke-opacity="0.9"/>`);
      }
    } else if (it.kind === 'marking' && it.focus !== null && it.focus !== undefined) {
      const tt = timeOf(it), a = pos(it.focus, tt), m = nearestOpp(g, it.focus, tt);
      const b = m ? pos(m.player, tt) : null;
      if (a && b) out.push(`<line x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}" stroke="${DEF}" stroke-width="1.6" stroke-linecap="round" stroke-opacity="0.45"/><text x="${f1((a[0] + b[0]) / 2)}" y="${f1((a[1] + b[1]) / 2 - 1.6)}" font-size="2" fill="${DEF}" text-anchor="middle">${m!.d.toFixed(1)} m</text>`);
    } else if (it.kind === 'shot') {
      const sh = it.shooter ?? 0, tt = timeOf(it), s = pos(sh, tt);
      if (s) out.push(`<polygon points="${pt(s)} 52.5,-3.66 52.5,3.66" fill="${WHITE}" fill-opacity="0.16" stroke="${WHITE}" stroke-width="0.25"/>`);
    }
  }
  // the players at t
  for (let p = 0; p < g.P; p++) {
    const q = pos(p, t); if (!q) continue;
    const att = p < g.nAtt, sel = p === select;
    if (sel) out.push(`<circle cx="${f1(q[0])}" cy="${f1(q[1])}" r="2.1" fill="none" stroke="${WHITE}" stroke-width="0.4"/>`);
    out.push(`<circle cx="${f1(q[0])}" cy="${f1(q[1])}" r="1.15" fill="${att ? ATT : DEF}" stroke="#0b0f15" stroke-width="0.25"/>`);
    out.push(`<text x="${f1(q[0])}" y="${f1(q[1] + 0.62)}" font-size="1.45" font-weight="700" fill="#0b0f15" text-anchor="middle">${label(p)}</text>`);
  }
  // arrows over the players: runs (amber dashes along the tracked path), passes (white; a what-if dashed and faint)
  for (const it of items) {
    if (it.kind === 'run') {
      const q: XY[] = [];
      for (let tt = it.path.from; tt <= it.path.to + 1e-6; tt += 0.2) { const x = pos(it.path.player, tt); if (x) q.push(x); }
      if (q.length >= 2) out.push(`<polyline points="${q.map(pt).join(' ')}" fill="none" stroke="${AMBER}" stroke-width="0.6" stroke-dasharray="1.4 0.9" marker-end="url(#ahA)"/>`);
    } else if (it.kind === 'pass') {
      const a = it.from as XY, b = it.to as XY;
      if (Array.isArray(a) && Array.isArray(b)) {
        const mid: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const lofted = it.loft !== undefined, c: XY = lofted ? [mid[0] - ((b[1] - a[1]) / L) * L * 0.12, mid[1] + ((b[0] - a[0]) / L) * L * 0.12] : mid;
        out.push(`<path d="M${pt(a)} Q${pt(c)} ${pt(b)}" fill="none" stroke="${WHITE}" stroke-width="${it.whatif ? 0.45 : 0.55}" ${it.whatif ? 'stroke-dasharray="1.2 0.8" stroke-opacity="0.75"' : ''} marker-end="url(#ah)"/>`);
      }
    } else if (it.kind === 'spotlight' && 'player' in it.at) {
      const q = pos(it.at.player, t); if (q) out.push(`<circle cx="${f1(q[0])}" cy="${f1(q[1])}" r="3" fill="${WHITE}" fill-opacity="0.12" stroke="${WHITE}" stroke-width="0.3"/>`);
    }
  }
  // the ball
  const b = g.ball(t);
  if (b) out.push(`<circle cx="${f1(b[0])}" cy="${f1(b[1])}" r="0.75" fill="${WHITE}" stroke="#0b0f15" stroke-width="0.2"/>`);
  out.push('</svg>');
  return out.join('');
}

function hull(pts: XY[]): XY[] {
  const s = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (s.length < 3) return s;
  const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: XY[] = [], hi: XY[] = [];
  for (const p of s) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of [...s].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}
