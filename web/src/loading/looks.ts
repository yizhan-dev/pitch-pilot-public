// The loading scene's looks (chat 5's request, 2026-10-25: the first thing a judge sees, in the telestration's visual
// language, handing over to the line-up show's drone shot with the title in the middle). Canvas 2D only, so it paints
// at once without three.js. Each look draws one frame from: the clock `t` (s since it began), `shown` (the progress on
// screen, 0..1, never ahead of the real one), the exit `e` (0..1, null before it) and the name (may be empty). The exit
// makes the canvas transparent where the scene below should show.

export type LookKey = 'ring' | 'ringtilt' | 'pass' | 'hex';
export interface Frame { ctx: CanvasRenderingContext2D; W: number; H: number; t: number; shown: number; e: number | null; name: string }

const BLUE = '#6ab8ff', ORANGE = '#ff9560', WHITE = '#f2f4f7';
const FONT = "'Barlow Condensed', 'Arial Narrow', sans-serif";
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (x: number) => { const k = clamp(x); return k * k * (3 - 2 * k); };
const easeIn = (x: number) => { const k = clamp(x); return k * k * k; };
/** the selected ring's entrance (style.ts ringEnter): a zoom through a 106% blip over 0.37 s */
function ringEnter(age: number): [number, number] {
  const k = clamp(age / 0.37);
  const s = k < 0.7 ? 1.06 * smooth(k / 0.7) : 1.06 - 0.06 * smooth((k - 0.7) / 0.3);
  return [s, smooth(k / 0.5)];
}

/** the night behind everything: the drone shot's sky, darker at the edges */
function night(f: Frame) {
  const { ctx, W, H } = f, g = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.hypot(W, H) * 0.6);
  g.addColorStop(0, '#0f1a2e'); g.addColorStop(1, '#04070d');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

/** the name, letter-spaced, centred at (x, y), `px` tall caps */
function name(f: Frame, x: number, y: number, px: number, alpha: number) {
  if (!f.name || alpha <= 0.002) return;
  const { ctx } = f;
  ctx.save();
  ctx.globalAlpha = alpha; ctx.fillStyle = WHITE; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `600 ${px}px ${FONT}`;
  (ctx as unknown as { letterSpacing: string }).letterSpacing = `${(0.2 * px).toFixed(1)}px`;
  ctx.fillText(f.name.toUpperCase(), x + 0.1 * px, y);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------------- A
/** A, the ring: the selected player's double ring (TELE.ring's proportions: outer 0.95 with ten square-ended white dashes
 *  turning, inner 0.60 in the team colours), its inner band filling round with the progress from the home blue to the
 *  away orange (the title's two sides). Exit: the ring grows past the corners, the night cleared inside it, as the
 *  line-up show's teleport ring, so the stadium opens from the middle where the title builds */
function ring(f: Frame, tilt = 1) {
  const { ctx, W, H, t, shown, e } = f, s = Math.min(W, H), cx = W / 2, cy = H / 2, r0 = (tilt < 1 ? 0.2 : 0.13) * s;
  const [se, ae] = ringEnter(t - 0.1);
  const k0 = r0 / 0.95, grow = e === null ? 1 : 1 + easeIn(e) * Math.max(W / r0, H / (r0 * tilt));
  const k = k0 * se * grow, Ro = 0.95 * k, Wo = 0.29 * k, Ri = 0.6 * k, Wi = 0.167 * k;
  night(f);
  // A2 lies on the pitch, as the game's broadcast view sees the ring: everything drawn squashed `tilt` up and down
  ctx.save(); ctx.translate(cx, cy); ctx.scale(1, tilt); ctx.translate(-cx, -cy);
  if (e !== null) {
    // the night cleared inside the ring as it grows
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(0, Ri - Wi / 2), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  const fade = e === null ? 1 : 1 - smooth((e - 0.55) / 0.45);
  ctx.save();
  ctx.globalAlpha = ae * fade; ctx.lineCap = 'butt';
  // the outer dashes, turning (a turn every 6 s: the game's 20 s reads as still here)
  const spin = (t / 6) * Math.PI * 2, arc = (Math.PI * 2) / 10;
  ctx.strokeStyle = WHITE; ctx.lineWidth = Wo;
  for (let i = 0; i < 10; i++) { const a0 = spin + i * arc; ctx.beginPath(); ctx.arc(cx, cy, Ro, a0, a0 + arc * (11.16 / 15.08)); ctx.stroke(); }
  // the inner band: its track, then the progress round from the top, home blue to away orange
  ctx.lineWidth = Wi;
  ctx.strokeStyle = 'rgba(242, 244, 247, 0.14)';
  ctx.beginPath(); ctx.arc(cx, cy, Ri, 0, Math.PI * 2); ctx.stroke();
  const p = e === null ? shown : 1;
  if (p > 0.002) {
    const g = ctx.createConicGradient(-Math.PI / 2, cx, cy);
    g.addColorStop(0, BLUE); g.addColorStop(1, ORANGE);
    ctx.strokeStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, Ri, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
  // the name under it, gone first on the way out
  const na = smooth((t - 0.35) / 0.4) * (e === null ? 1 : 1 - smooth(e / 0.3));
  name(f, cx, cy + r0 * tilt + 0.065 * s + (tilt < 1 ? 0.02 * s : 0.035 * s), 0.036 * s, na * 0.92);
}

// ---------------------------------------------------------------------------------------------------------------- B
/** the kick-off line-ups on a 105 x 68 pitch (x along, y across; Pelicans on the left), as in the line-up show */
const PELICANS: [number, number][] = [[-49, 0], [-34, -24], [-37, -8], [-37, 8], [-34, 24], [-24, -7], [-24, 7], [-12, -22], [-13, 0], [-12, 22], [-1.5, 0]];
const WILDCATS: [number, number][] = [[49, 0], [34, 24], [37, 8], [37, -8], [34, -24], [22, 0], [20, -14], [20, 14], [9, 22], [9.5, 0], [9, -22]];
/** the pass chain, Pelicans' indices: the keeper to the centre spot, where the title builds */
const CHAIN = [0, 3, 6, 9, 8, 7, 10];

/** a white pitch_prism arrow from a to b (screen px), `w` wide, drawn on to `d` 0..1, its tail dissolving */
function arrow(ctx: CanvasRenderingContext2D, a: [number, number], b: [number, number], w: number, d: number, alpha: number) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  if (L < 1 || d <= 0) return;
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux, S = 3.1 * w, sp = 0.66, notch = 0.55;
  const tip = [a[0] + ux * L * d, a[1] + uy * L * d], back = [tip[0] - ux * S * notch, tip[1] - uy * S * notch];
  const g = ctx.createLinearGradient(a[0], a[1], back[0], back[1]);
  g.addColorStop(0, 'rgba(242, 244, 247, 0)'); g.addColorStop(Math.min(1, 0.34 / Math.max(d, 1e-3)), WHITE); g.addColorStop(1, WHITE);
  ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(a[0] + nx * w / 2, a[1] + ny * w / 2); ctx.lineTo(back[0] + nx * w / 2 + ux * 0.05 * S, back[1] + ny * w / 2 + uy * 0.05 * S);
  ctx.lineTo(back[0] - nx * w / 2 + ux * 0.05 * S, back[1] - ny * w / 2 + uy * 0.05 * S); ctx.lineTo(a[0] - nx * w / 2, a[1] - ny * w / 2);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = WHITE;
  const bx = Math.cos(sp) * S, by = Math.sin(sp) * S;
  ctx.beginPath();
  ctx.moveTo(tip[0], tip[1]);
  ctx.lineTo(tip[0] - ux * bx + nx * by, tip[1] - uy * bx + ny * by);
  ctx.lineTo(back[0], back[1]);
  ctx.lineTo(tip[0] - ux * bx - nx * by, tip[1] - uy * bx - ny * by);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

/** B, the first pass: the dark tactics board seen from above, both elevens at the kick-off in their colours (plain
 *  rings, as the marking hoops), and the Pelicans' passes, pitch_prism's white arrows, keeper to centre spot, one for
 *  each share of the progress. Exit: the board pushes in on the centre spot and fades, where the title builds */
function pass(f: Frame) {
  const { ctx, W, H, t, shown, e } = f;
  const m = Math.min((W * 0.86) / 105, (H * 0.74) / 68), cx = W / 2, cy = H * 0.47;
  const zoom = e === null ? 1 : 1 + 1.6 * easeIn(e), fade = e === null ? smooth(t / 0.4) : 1 - smooth(e / 0.85);
  // the night goes with the board on the way out, the stadium coming through
  ctx.save(); ctx.globalAlpha = e === null ? 1 : 1 - smooth(e / 0.85); night(f); ctx.restore();
  const P = (x: number, y: number): [number, number] => [cx + x * m * zoom, cy + y * m * zoom];
  ctx.save(); ctx.globalAlpha = fade;
  // the board and its markings, light grey on dark grey (Pitch.tsx's tactical board)
  const [x0, y0] = P(-52.5, -34), [x1, y1] = P(52.5, 34);
  ctx.fillStyle = '#090a0b'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.strokeStyle = 'rgba(107, 117, 133, 0.55)'; ctx.lineWidth = Math.max(1, 0.12 * m * zoom);
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.beginPath(); ctx.moveTo(...P(0, -34)); ctx.lineTo(...P(0, 34)); ctx.stroke();
  ctx.beginPath(); ctx.arc(...P(0, 0), 9.15 * m * zoom, 0, Math.PI * 2); ctx.stroke();
  for (const sg of [-1, 1]) {
    const [bx0, by0] = P(sg * 52.5, -20.16), [bx1, by1] = P(sg * (52.5 - 16.5), 20.16);
    ctx.strokeRect(Math.min(bx0, bx1), by0, Math.abs(bx1 - bx0), by1 - by0);
  }
  // the players, plain rings, coming in one after another
  const r = 1.7 * m * zoom;
  ctx.lineWidth = Math.max(1.5, 0.5 * m * zoom);
  [...PELICANS.map((p) => [p, BLUE] as const), ...WILDCATS.map((p) => [p, ORANGE] as const)].forEach(([p, c], i) => {
    const [se, ae] = ringEnter(t - 0.05 - 0.03 * i);
    if (ae <= 0.002) return;
    ctx.globalAlpha = fade * ae; ctx.strokeStyle = c;
    ctx.beginPath(); ctx.arc(...P(p[0], p[1]), r * se, 0, Math.PI * 2); ctx.stroke();
  });
  ctx.globalAlpha = fade;
  // the passes: pass i is drawn on as the progress crosses its share
  const n = CHAIN.length - 1;
  for (let i = 0; i < n; i++) {
    const d = clamp((shown * n - i) / 1);
    if (d <= 0) break;
    const a = P(...PELICANS[CHAIN[i]]), b = P(...PELICANS[CHAIN[i + 1]]), L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const cut = (r * 1.3) / L;
    arrow(ctx, [a[0] + (b[0] - a[0]) * cut, a[1] + (b[1] - a[1]) * cut], [b[0] - (b[0] - a[0]) * cut, b[1] - (b[1] - a[1]) * cut], 0.75 * m * zoom, d, 1);
  }
  ctx.restore();
  name(f, cx, y1 + (H - y1) * 0.5, 0.034 * Math.min(W, H), smooth((t - 0.5) / 0.4) * (e === null ? 0.9 : 0.9 * (1 - smooth(e / 0.3))));
}

// ---------------------------------------------------------------------------------------------------------------- C
const SQ3 = Math.sqrt(3);
/** C, the board: the game's hexagon change of pitch (Pitch.tsx: tiles closing like an iris, a light riding the edge, the
 *  seam lit as the wave passes), as the loader. The progress is a wave running out from the middle, lighting each tile's
 *  border as it passes; the name in the middle. Exit: the tiles open from the middle outward, each from its edge in to
 *  its centre with the light on the opening edge, the stadium showing through */
function hex(f: Frame) {
  const { ctx, W, H, t, shown, e } = f, s = Math.min(W, H), cx = W / 2, cy = H / 2;
  const S = 0.085 * s, maxR = Math.hypot(W, H) / 2 + S;
  const front = shown * maxR, band = 0.25 * maxR;
  const open = e === null ? -1 : e * (maxR + band);
  const LIGHT = [140, 219, 230];
  // rows of pointy-topped hexagons, S across the flats: R the corner radius, rows 1.5 R apart, every other one half a
  // tile across
  const R = S / SQ3, stepX = S, stepY = 1.5 * R;
  const corners = (x: number, y: number, rr: number) => { ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); } ctx.closePath(); };
  ctx.clearRect(0, 0, W, H);
  // before the exit the board is whole (no hairlines between the tiles)
  if (e === null) { ctx.fillStyle = '#090a0b'; ctx.fillRect(0, 0, W, H); }
  const rows = Math.ceil(H / stepY / 2) + 2, cols = Math.ceil(W / stepX / 2) + 2;
  for (let j = -rows; j <= rows; j++) for (let i = -cols; i <= cols; i++) {
    const x = cx + (i + (j & 1 ? 0.5 : 0)) * stepX, y = cy + j * stepY, d = Math.hypot(x - cx, y - cy);
    const jit = (Math.sin(i * 12.9898 + j * 78.233) * 43758.5453) % 1 * 0.08 * maxR;
    // the exit: this tile's opening, 0 shut to 1 open, the dark closing in to its centre
    const o = e === null ? 0 : smooth((open - d - jit) / band);
    const rin = R * (1 - o);
    if (rin > 0.5) {
      ctx.fillStyle = '#090a0b'; corners(x, y, rin * 1.015); ctx.fill();
    }
    // the border lit as the progress wave passes, then a faint seam left on the tiles it has reached
    const w = (front - d - jit) / band, lit = w > 0 ? Math.exp(-Math.pow((w - 0.15) / 0.25, 2)) : 0, kept = w > 0 ? 0.22 : 0.06;
    const a = Math.max(lit, kept) * (e === null ? smooth(t / 0.4) : 1 - o);
    if (a > 0.004) {
      ctx.strokeStyle = `rgba(${LIGHT[0]}, ${LIGHT[1]}, ${LIGHT[2]}, ${a.toFixed(3)})`; ctx.lineWidth = Math.max(1, 0.03 * S);
      corners(x, y, R * 0.97); ctx.stroke();
    }
    // the light riding the opening edge
    if (e !== null && o > 0.02 && o < 0.98) {
      ctx.strokeStyle = `rgba(${LIGHT[0]}, ${LIGHT[1]}, ${LIGHT[2]}, ${(Math.sin(Math.PI * o) * 0.85).toFixed(3)})`; ctx.lineWidth = Math.max(1, 0.04 * S);
      corners(x, y, rin); ctx.stroke();
    }
  }
  name(f, cx, cy, 0.05 * s, smooth((t - 0.3) / 0.4) * (e === null ? 0.95 : 0.95 * (1 - smooth(e / 0.25))));
}

export const LOOKS: Record<LookKey, (f: Frame) => void> = { ring: (f) => ring(f), ringtilt: (f) => ring(f, 0.42), pass, hex };
