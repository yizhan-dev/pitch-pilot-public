/** Marching squares on a regular grid: line segments where values cross `level`.
 * Grid cell (r, c) sits at x = x0 + c, y = y0 + r (metres). */
export function contourSegments(values: ArrayLike<number>, w: number, h: number, level: number, x0: number, y0: number): number[] {
  const out: number[] = [];
  const v = (r: number, c: number) => values[r * w + c];
  const lerp = (a: number, b: number) => (level - a) / (b - a);
  for (let r = 0; r < h - 1; r++) for (let c = 0; c < w - 1; c++) {
    const a = v(r, c), b = v(r, c + 1), d = v(r + 1, c), e = v(r + 1, c + 1);
    const pts: [number, number][] = [];
    if ((a < level) !== (b < level)) pts.push([c + lerp(a, b), r]);
    if ((b < level) !== (e < level)) pts.push([c + 1, r + lerp(b, e)]);
    if ((d < level) !== (e < level)) pts.push([c + lerp(d, e), r + 1]);
    if ((a < level) !== (d < level)) pts.push([c, r + lerp(a, d)]);
    for (let i = 0; i + 1 < pts.length; i += 2) out.push(x0 + pts[i][0], y0 + pts[i][1], x0 + pts[i + 1][0], y0 + pts[i + 1][1]);
  }
  return out;
}
