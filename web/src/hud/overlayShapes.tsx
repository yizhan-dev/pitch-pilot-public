import type { XgFreezeModel } from '../response/xg';
import type { ClipPkg } from './match';
import { momentAt, threatAt, offsideX, type Move, type XY } from './analysis';
import { INKS, type Stroke, type AnnotKey } from './draft';
import type { PassState } from './passProb';

// What the 战术 annotations, 画板's strokes and auto lines and 观赛's speed rings put on the pitch, described once as simple
// shapes in pitch metres (x along, y across, y down the screen from above), and drawn twice: as SVG on the HUD preview's
// stand-in pitch (ShapesSvg) and onto a canvas laid on the 3D pitch in ?ui=game (drawShapes, PitchOverlay3D.tsx), so the
// two never drift apart (2026-10-23, wiring the draft into the game).

export type Shape =
  | { kind: 'arrow'; pts: XY[]; color: string; width: number; dash?: number[]; alpha?: number }
  | { kind: 'line'; pts: XY[]; color: string; width: number; dash?: number[]; alpha?: number }
  | { kind: 'polygon'; pts: XY[]; fill?: string; stroke?: string; width?: number; dash?: number[]; alpha?: number }
  | { kind: 'circle'; at: XY; r: number; fill?: string; stroke?: string; width?: number; dash?: number[]; alpha?: number }
  | { kind: 'tag'; at: XY; text: string; color?: string; alpha?: number };

export const COLOR = { white: '#f2f4f7', good: '#4fe0b0', bad: '#ff6b5e', gold: '#ffd166', orange: '#ff9560', blue: '#6ab8ff' } as const;
const W = 68;
const DASH = [1.1, 0.8];
const signed = (v: number, digits = 2) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;
/** a chain's older items fade: the newest at full strength, the oldest at a third */
const chainAlpha = (i: number, n: number) => 0.35 + (0.65 * (i + 1)) / n;

type MomentT = ReturnType<typeof momentAt>;
const arrow = (from: XY, to: XY, color: string, opts: { width?: number; dash?: boolean; alpha?: number } = {}): Shape =>
  ({ kind: 'arrow', pts: [from, to], color, width: opts.width ?? 0.38, dash: opts.dash ? DASH : undefined, alpha: opts.alpha });
const tag = (at: XY, text: string, color?: string, alpha?: number): Shape => ({ kind: 'tag', at, text, color, alpha });

/** threat: the last n passes and carries (or the latest), each an arrow with its ΔxT. Off the Tactics marks since Yi's
 *  2026-10-25 cut; kept for the pen's showing options (Yi: "we can add xT as one showing option there") */
export function threatShapes(all: Move[], t: number, chain: boolean): Shape[] {
  const out: Shape[] = [], list = threatAt(all, t, chain ? 5 : 1);
  list.forEach((x, i) => {
    const alpha = chain ? chainAlpha(i, list.length) : 1, color = x.dxt >= 0 ? COLOR.good : COLOR.bad;
    out.push(arrow(x.from, x.to, color, { dash: x.carry, alpha }), tag([x.to[0], x.to[1] - 1.9], signed(x.dxt, 3), color, alpha));
  });
  return out;
}

/** the 战术 mode's annotation of the moment (analysis.ts gives the numbers). The name and the selection are no longer
 *  used (they served the runs' SOG / SGG, retired 2026-10-24) but stay in the signature for the HUD preview's call.
 *  `real`: the pass probability from the What-if's model (passProb.ts); the HUD preview leaves it out and keeps the
 *  stand-in */
export function annotationShapes(pkg: ClipPkg, t: number, key: AnnotKey, sub: string, m: MomentT, all: Move[], xg: XgFreezeModel | null, _name: (p: number) => string, _selected: number | null, real?: PassState): Shape[] {
  const out: Shape[] = [];
  // the offside line is chat 1's item (TacticsItems.tsx), not a canvas shape
  if (key === 'pass' && real) {
    // The pass probability is drawn by chat 1's passing network with a tag over each team-mate's head (TacticsItems.tsx,
    // telestration-notes.md item 5; Yi 2026-10-25: the lines looked terrible). Here only a temporary check for Yi's eye,
    // ?ptags=1: each team-mate's chance on the grass beside him, no lines
    const from = real.carrier !== null ? m.pos[real.carrier] : null;
    if (from && real.opts) for (const o of real.opts) out.push(tag([o.at[0], o.at[1] - 2.4], o.offside ? 'Offside' : `${Math.min(99, Math.round(o.prob * 100))}%`, o.offside ? 'rgba(242, 244, 247, .6)' : undefined));
  }
  return out;
}

/** 画板's auto lines, from the data at this moment: the offside line, the defending back line, the selected player's field
 *  of view and his last 3 s */
export function aidShapes(pkg: ClipPkg, t: number, m: MomentT, on: string[], selected: number | null): Shape[] {
  const out: Shape[] = [], dashed = [0.9, 0.6];
  if (on.includes('offside')) { const x = offsideX(m); out.push({ kind: 'line', pts: [[x, -W / 2], [x, W / 2]], color: COLOR.gold, width: 0.22, dash: dashed }); }
  if (on.includes('line')) {
    const keepers = new Set(pkg.keepers ?? []);
    const back = m.pos.map((p, i) => ({ p, i })).filter((x) => x.i >= m.nAtt && !keepers.has(x.i)).sort((a, b) => b.p[0] - a.p[0]).slice(0, 4).sort((a, b) => a.p[1] - b.p[1]);
    out.push({ kind: 'line', pts: back.map((x) => x.p), color: 'rgba(242, 244, 247, .75)', width: 0.22, dash: dashed });
  }
  if (selected !== null && on.includes('fov')) {
    const [x, y] = m.pos[selected], v = m.vel[selected], heading = Math.atan2(v[1], v[0]), r = 14, half = Math.PI / 6, arc: XY[] = [[x, y]];
    for (let k = 0; k <= 12; k++) { const a = heading - half + (2 * half * k) / 12; arc.push([x + r * Math.cos(a), y + r * Math.sin(a)]); }
    out.push({ kind: 'polygon', pts: arc, fill: 'rgba(242, 244, 247, .1)', stroke: 'rgba(242, 244, 247, .4)', width: 0.12 });
  }
  if (selected !== null && on.includes('trail')) {
    const pts: XY[] = [];
    for (let k = 30; k >= 0; k--) pts.push(momentAt(pkg, t - k * 0.1).pos[selected]);
    out.push({ kind: 'line', pts, color: 'rgba(106, 184, 255, .8)', width: 0.22 });
  }
  return out;
}

/** one drawn stroke; a circled player's ring follows him */
export function strokeShapes(stroke: Stroke, m: MomentT, alpha = 1): Shape[] {
  const color = INKS.find((x) => x.key === stroke.ink)?.css ?? COLOR.white;
  const first = stroke.pts[0], last = stroke.pts[stroke.pts.length - 1];
  switch (stroke.tool) {
    case 'pass': return [{ kind: 'arrow', pts: [first, last], color, width: 0.45, alpha }];
    case 'run': return [{ kind: 'arrow', pts: stroke.pts, color, width: 0.42, dash: DASH, alpha }];
    case 'dribble': {
      const dx = last[0] - first[0], dy = last[1] - first[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, waves = Math.max(2, Math.round(len / 1.6)), pts: XY[] = [first];
      for (let i = 1; i <= waves * 4; i++) { const f = i / (waves * 4), w = Math.sin(f * waves * Math.PI * 2) * 0.6 * (f < 0.9 ? 1 : (1 - f) * 10); pts.push([first[0] + dx * f + nx * w, first[1] + dy * f + ny * w]); }
      return [{ kind: 'arrow', pts, color, width: 0.38, alpha }];
    }
    case 'circle': { const at = stroke.player !== undefined ? m.pos[stroke.player] ?? first : first; return [{ kind: 'circle', at, r: 2.6, stroke: color, width: 0.4, dash: [1.2, 0.6], alpha }]; }
    case 'zone': {
      const x0 = Math.min(first[0], last[0]), x1 = Math.max(first[0], last[0]), y0 = Math.min(first[1], last[1]), y1 = Math.max(first[1], last[1]);
      return [{ kind: 'polygon', pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], fill: `${color}24`, stroke: color, width: 0.3, dash: [1, 0.6], alpha }];
    }
    case 'measure': {
      const metres = Math.hypot(last[0] - first[0], last[1] - first[1]);
      return [
        { kind: 'line', pts: [first, last], color, width: 0.25, alpha },
        { kind: 'circle', at: first, r: 0.35, fill: color, alpha }, { kind: 'circle', at: last, r: 0.35, fill: color, alpha },
        tag([(first[0] + last[0]) / 2, (first[1] + last[1]) / 2 - 1.4], `${metres.toFixed(1)} m`, undefined, alpha),
      ];
    }
    default: return [{ kind: 'line', pts: stroke.pts, color, width: 0.38, alpha }];
  }
}

/** FIFA speed bands, as the 3D layer's speed rings (km/h) */
export const SPEED_BANDS: [number, string][] = [[7, '#8a93a3'], [15, '#e8ebef'], [20, '#67b0ff'], [25, '#ffc94d'], [Infinity, '#ff5a52']];
export const speedColor = (kmh: number) => (SPEED_BANDS.find(([limit]) => kmh < limit) ?? SPEED_BANDS[SPEED_BANDS.length - 1])[1];

// ---- the arrowhead both renderers draw: a filled triangle at the end, along the last segment
const HEAD_LENGTH = 1.1, HEAD_HALF_WIDTH = 0.55;
function arrowHead(pts: XY[], width: number): XY[] {
  const end = pts[pts.length - 1], before = pts[Math.max(0, pts.length - 2)];
  const dx = end[0] - before[0], dy = end[1] - before[1], len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
  const size = Math.max(1, width / 0.38), back: XY = [end[0] - ux * HEAD_LENGTH * size, end[1] - uy * HEAD_LENGTH * size];
  return [end, [back[0] - uy * HEAD_HALF_WIDTH * size, back[1] + ux * HEAD_HALF_WIDTH * size], [back[0] + uy * HEAD_HALF_WIDTH * size, back[1] - ux * HEAD_HALF_WIDTH * size]];
}
/** a label's box width, metres */
const tagWidth = (text: string) => Math.max(2.4, text.length * 0.86 + 1.2);

// ---- SVG, for the preview's stand-in pitch
const points = (pts: XY[]) => pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
export function ShapesSvg({ shapes }: { shapes: Shape[] }) {
  return (
    <g className="hud-stage-annot">
      {shapes.map((s, i) => {
        const dash = 'dash' in s && s.dash ? s.dash.join(' ') : undefined;
        switch (s.kind) {
          case 'arrow': return (
            <g key={i} opacity={s.alpha}>
              <polyline points={points(s.pts)} fill="none" stroke={s.color} strokeWidth={s.width} strokeDasharray={dash} strokeLinecap="round" strokeLinejoin="round" />
              <polygon points={points(arrowHead(s.pts, s.width))} fill={s.color} />
            </g>
          );
          case 'line': return <polyline key={i} points={points(s.pts)} fill="none" stroke={s.color} strokeWidth={s.width} strokeDasharray={dash} strokeLinecap="round" strokeLinejoin="round" opacity={s.alpha} />;
          case 'polygon': return <polygon key={i} points={points(s.pts)} fill={s.fill ?? 'none'} stroke={s.stroke} strokeWidth={s.width} strokeDasharray={dash} opacity={s.alpha} />;
          case 'circle': return <circle key={i} cx={s.at[0]} cy={s.at[1]} r={s.r} fill={s.fill ?? 'none'} stroke={s.stroke} strokeWidth={s.width} strokeDasharray={dash} opacity={s.alpha} />;
          case 'tag': {
            const w = tagWidth(s.text);
            return (
              <g key={i} transform={`translate(${s.at[0].toFixed(2)} ${s.at[1].toFixed(2)})`} className="hud-stage-tag" opacity={s.alpha}>
                <rect x={-w / 2} y="-1.25" width={w} height="2.1" rx=".35" />
                <text y=".38" style={s.color ? { fill: s.color } : undefined}>{s.text}</text>
              </g>
            );
          }
        }
      })}
    </g>
  );
}

// ---- canvas, for the overlay on the 3D pitch: the context is already scaled to metres with the pitch centre at 0, 0
function tracePath(ctx: CanvasRenderingContext2D, pts: XY[], close = false) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  if (close) ctx.closePath();
}
/** turned: the view looks from the other touchline (coords.ts viewSign), so a tag's text turns end for end about its
 *  point to read upright from there */
export function drawShapes(ctx: CanvasRenderingContext2D, shapes: Shape[], fade = 1, turned = false) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const s of shapes) {
    ctx.save();
    ctx.globalAlpha = fade * (s.alpha ?? 1);
    ctx.setLineDash('dash' in s && s.dash ? s.dash : []);
    switch (s.kind) {
      case 'arrow':
        ctx.strokeStyle = s.color; ctx.lineWidth = s.width; tracePath(ctx, s.pts); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle = s.color; tracePath(ctx, arrowHead(s.pts, s.width), true); ctx.fill();
        break;
      case 'line':
        ctx.strokeStyle = s.color; ctx.lineWidth = s.width; tracePath(ctx, s.pts); ctx.stroke();
        break;
      case 'polygon':
        tracePath(ctx, s.pts, true);
        if (s.fill) { ctx.fillStyle = s.fill; ctx.fill(); }
        if (s.stroke) { ctx.strokeStyle = s.stroke; ctx.lineWidth = s.width ?? 0.2; ctx.stroke(); }
        break;
      case 'circle':
        ctx.beginPath(); ctx.arc(s.at[0], s.at[1], s.r, 0, Math.PI * 2);
        if (s.fill) { ctx.fillStyle = s.fill; ctx.fill(); }
        if (s.stroke) { ctx.strokeStyle = s.stroke; ctx.lineWidth = s.width ?? 0.2; ctx.stroke(); }
        break;
      case 'tag': {
        const w = tagWidth(s.text);
        let [x, y] = s.at;
        if (turned) { ctx.translate(x, y); ctx.rotate(Math.PI); x = 0; y = 0; }
        ctx.fillStyle = 'rgba(8, 12, 20, .78)'; ctx.strokeStyle = 'rgba(255, 255, 255, .18)'; ctx.lineWidth = 0.08;
        ctx.beginPath(); ctx.roundRect(x - w / 2, y - 1.25, w, 2.1, 0.35); ctx.fill(); ctx.stroke();
        ctx.fillStyle = s.color ?? COLOR.white; ctx.font = "600 1.25px 'Barlow Condensed', sans-serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(s.text, x, y + 0.38);
        break;
      }
    }
    ctx.restore();
  }
}
