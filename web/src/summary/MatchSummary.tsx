import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { loadRoster, rosterLooks, type Roster } from '../lineup/roster';
import { Crest } from '../hud/crests';
import { TEAM_CODE, TEAM_LABEL } from '../hud/match';
import { closeSummary, heatBytes, loadSummary, VENUE, type MatchSummaryData, type Side } from './summary';
import { setSettings, useGameSettings } from '../game/settings';
import { tourOn, tourStep } from '../tour/tour';
import './summary.css';

// The match summary's panel (summary.ts): it drops from the top centre once the camera has risen to the drone, and turns
// through its pages by itself (PAGE_S each, held while the pointer is over it); the tabs pick a page, × or Esc closes.
// Pages: the match stats (技术统计), the passing networks, where the attacks went, the teams' heat maps, the player of the
// match, the running (the work rate went, Yi 2026-10-27: "not that interesting"). Every pitch is drawn with its team attacking left to right, the packages' frame (+y the near
// touchline, at the bottom).

const PAGE_S = 10;
/** the pages turn by themselves every PAGE_S: off for now (Yi, 2026-10-27: "let's remove the countdown for each page, at
 *  least for now ... so we won't have to keep clicking the same tab"); ?mscycle=1 turns it on */
const AUTO_TURN = new URLSearchParams(location.search).get('mscycle') === '1';
/** the panel is laid out at BASE_W (its tallest page about BASE_H) and scaled to the window (Yi, 2026-10-26: "the panel
 *  is too small, can we enlarge it?"): as large as fits beside a 32 px edge and under the top bar, at most MAX_SCALE.
 *  ?ms=<scale> tries another largest scale. TOP is summary.css's `top`, BASE_H its fixed height (Yi, 2026-10-27: "the
 *  panel is too high up, make it slightly lower", then "bigger and lower, so when we show for example passing network
 *  in more details": the bottom widgets stand aside while it is open, so it goes down to BOTTOM); with the venue strip
 *  under the pages (STRIP_H, summary.css .ms-strip) */
const STRIP_H = 28, BASE_W = 920, BASE_H = 540 + STRIP_H, TOP = 116, BOTTOM = 14, EDGE = 32;
const MAX_SCALE = (() => { const q = Number(new URLSearchParams(location.search).get('ms')); return q > 0 ? q : 1.5; })();
/** while the judges' tour runs, its last card sits under the panel (src/tour/): the panel leaves it TOUR_H, and on a
 *  short screen goes below its usual smallest scale to do so (back to it once the tour ends) */
const TOUR_H = 176;
const fitScale = () => Math.max(tourOn() ? 0.78 : 1, Math.min((innerWidth - 2 * EDGE) / BASE_W, (innerHeight - TOP - BOTTOM - (tourOn() ? TOUR_H : 0)) / BASE_H, MAX_SCALE));
const L = 105, W = 68;
const KIT: Record<Side, string> = { home: '#6ab8ff', away: '#ff9560' };     // the radar's lighter kit colours, for dark glass
const BANDS = ['Walking', 'Jogging', 'Running', 'High speed', 'Sprinting'];
// (the bands' speeds, 0-6, 6-15, 15-20, 20-25 and 25+ km/h, are left off: Yi, 2026-10-27, "for audience, they won't care")
const BAND_FILL = ['rgba(255,255,255,.2)', 'rgba(255,255,255,.38)', 'rgba(255,255,255,.62)', '#ffd166', '#ff6b4a'];
const SIDES: Side[] = ['home', 'away'];

interface Who { name: (pid: string) => string; short: (pid: string) => string; number: (pid: string) => number | null }

/** a pitch in metres, its team attacking right: `under` (the heat maps, a shading) beneath the lines, the children (the
 *  marks: shots, chips, names, arrows) over them (Yi, 2026-10-27: "I want the checkers of shots to be on top of pitch
 *  line"); both in the same metres. `vertical`: stood on end, the team attacking up (the player of the match's), the
 *  pitch's (x, y) on the screen at (y, -x) (VERT); `screen`: marks over it all in those screen metres, upright */
function Pitch({ children, under, screen, pad = 2.5, vertical }: { children?: ReactNode; under?: ReactNode; screen?: ReactNode; pad?: number; vertical?: boolean }) {
  const box = 16.5, boxW = 40.32, six = 5.5, sixW = 18.32;
  const [a, b] = vertical ? [W, L] : [L, W];
  return (
    <svg className={vertical ? 'ms-pitch vertical' : 'ms-pitch'} viewBox={`${-a / 2 - pad} ${-b / 2 - pad} ${a + 2 * pad} ${b + 2 * pad}`} preserveAspectRatio="xMidYMid meet">
      <g transform={vertical ? 'rotate(-90)' : undefined}>
      <rect x={-L / 2} y={-W / 2} width={L} height={W} className="ms-grass" />
      {under}
      <g className="ms-lines">
        <rect x={-L / 2} y={-W / 2} width={L} height={W} />
        <path d={`M0 ${-W / 2} V${W / 2}`} />
        <circle r={9.15} />
        {[-1, 1].map((s) => (
          <g key={s}>
            <rect x={s > 0 ? L / 2 - box : -L / 2} y={-boxW / 2} width={box} height={boxW} />
            <rect x={s > 0 ? L / 2 - six : -L / 2} y={-sixW / 2} width={six} height={sixW} />
            <path d={`M${s * (L / 2 - box)} -7.3 A9.15 9.15 0 0 ${s > 0 ? 0 : 1} ${s * (L / 2 - box)} 7.3`} />
          </g>
        ))}
      </g>
      {children}
      </g>
      {screen}
    </svg>
  );
}
/** a point of a pitch stood on end (Pitch's `vertical`), on the screen */
const VERT = ([x, y]: [number, number]): [number, number] => [y, -x];

/** a heat grid over the pitch as layered contours (Yi, 2026-10-27: "more like layered contour line, it looks more
 *  cartoonish", as football_metrics/physical_analysis.ipynb draws it: filled bands from 5% of the peak up; then "do
 *  not add white outline ..., and make it more layers"): the grid interpolated UP times finer, each pixel given its
 *  band's colour from `ramp` (0..1 to rgba) */
const BANDS_N = 10, BAND_FROM = 0.05, UP = 6;   // (the grid is 1 m since 2026-10-27)
let clipN = 0;
function Heat({ src, d, ramp }: { src: string | Uint8Array; d: MatchSummaryData; ramp: (v: number) => [number, number, number, number] }) {
  const clip = useMemo(() => `ms-clip-${++clipN}`, []);
  const href = useMemo(() => {
    const { nx, ny } = d.heat, v = typeof src === 'string' ? heatBytes(src) : src, W2 = nx * UP, H2 = ny * UP, c = document.createElement('canvas');
    c.width = W2; c.height = H2;
    const g = c.getContext('2d');
    if (!g) return '';   // (no 2D canvas: no heat, rather than an error)
    const img = g.createImageData(W2, H2);
    // each pixel's band (-1 below the first level), the grid's values at the cells' centres, bilinear between them
    const at = (i: number, j: number) => v[Math.min(ny - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))] / 255;
    const band = new Int8Array(W2 * H2);
    for (let py = 0; py < H2; py++) for (let px = 0; px < W2; px++) {
      const u = (px + 0.5) / UP - 0.5, w = (py + 0.5) / UP - 0.5, i = Math.floor(u), j = Math.floor(w), fu = u - i, fw = w - j;
      const val = (at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fw) + (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fw;
      band[py * W2 + px] = val < BAND_FROM ? -1 : Math.min(BANDS_N - 1, Math.floor(((val - BAND_FROM) / (1 - BAND_FROM)) * BANDS_N));
    }
    const fill = Array.from({ length: BANDS_N }, (_, b) => ramp((b + 1) / BANDS_N));
    for (let k = 0; k < W2 * H2; k++) {
      const b = band[k];
      if (b < 0) continue;
      const [r, gg, bb, a] = fill[b];
      img.data.set([r, gg, bb, a * 255], k * 4);
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL();
  }, [src, d, ramp]);
  const { x0, y0, cell, nx, ny } = d.heat;
  // on the pitch only (Yi, 2026-10-27: "these maps are slightly out of pitch")
  return (
    <g>
      <clipPath id={clip}><rect x={-L / 2} y={-W / 2} width={L} height={W} /></clipPath>
      <image href={href} x={x0} y={y0} width={nx * cell} height={ny * cell} preserveAspectRatio="none" className="ms-heat" clipPath={`url(#${clip})`} />
    </g>
  );
}
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** a team's ramp: clear, its kit colour, white at the peak */
const teamRamp = (side: Side) => {
  const k = hex(KIT[side]);
  return (v: number): [number, number, number, number] => {
    const w = Math.max(0, (v - 0.7) / 0.3);
    return [k[0] + (255 - k[0]) * w, k[1] + (255 - k[1]) * w, k[2] + (255 - k[2]) * w, Math.min(0.9, Math.pow(v, 0.9) * 1.1)];
  };
};
const RAMPS = { home: teamRamp('home'), away: teamRamp('away') };
/** the player of the match's map in green, as eFootball's old heat maps (Yi, 2026-10-27): deep green, lime, a pale top */
const GREEN = [[18, 92, 48], [46, 160, 72], [132, 214, 84], [226, 250, 190]];
const greenRamp = (v: number): [number, number, number, number] => {
  const x = Math.min(0.999, v) * (GREEN.length - 1), i = Math.floor(x), f = x - i, a = GREEN[i], b = GREEN[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, Math.min(0.92, Math.pow(v, 0.7) * 1.15)];
};

/** a team's head over its chart; `mirror` for the right-hand end of a chart both teams share (the crest rightmost, the
 *  name to its left: Yi, 2026-10-27, "so they are fully symmetrical") */
function TeamHead({ side, children, mirror }: { side: Side; children?: ReactNode; mirror?: boolean }) {
  return <div className={`ms-teamhead ${side}${mirror ? ' mirror' : ''}`}><Crest team={side} size={22} /><b>{TEAM_LABEL[side]}</b>{children && <span>{children}</span>}</div>;
}

// ---- the pages
/** the Statistics page's three groups of nine (Yi, 2026-10-27: "we can also put more things in there") */
const STAT_GROUPS = [['attack', 'Attack'], ['passing', 'Passing'], ['defence', 'Defence']] as const;
function StatsPage({ d }: { d: MatchSummaryData }) {
  // whole numbers as they are; xG to two places, anything else (possession, kilometres) to one
  const fmt = (s: { key: string }, v: number, unit?: string) => <>{Number.isInteger(v) && s.key !== 'ppda' ? v : v.toFixed(['xg', 'npxg', 'xt'].includes(s.key) ? 2 : 1)}{unit && <small>{unit.trim()}</small>}</>;
  const col = (list: MatchSummaryData['stats'], head: string) => (
    <div className="ms-stats-col">
      <h3 className="ms-stats-head">{head}</h3>
      {list.map((s) => {
        const total = s.home + s.away, h = total > 0 ? s.home / total : 0.5, lead = s.home === s.away ? null : (s.home > s.away) !== !!s.low ? 'home' : 'away';
        return (
          <div key={s.key} className="ms-stat">
            <b className={lead === 'home' ? 'lead' : undefined}>{fmt(s, s.home, s.unit)}</b>
            <span>{s.label}</span>
            <b className={lead === 'away' ? 'lead' : undefined}>{fmt(s, s.away, s.unit)}</b>
            <i className="ms-stat-bar"><i className="home" style={{ width: `${100 * h}%` }} /><i className="away" style={{ width: `${100 * (1 - h)}%` }} /></i>
          </div>
        );
      })}
    </div>
  );
  return <div className="ms-stats">{STAT_GROUPS.map(([g, head]) => <div key={g}>{col(d.stats.filter((s) => s.group === g), head)}</div>)}</div>;
}

// ---- the passing network as project_kick draws it (football_metrics/passing_network.ipynb, football_visuals/kick_style.py
// kick_checker; Yi, 2026-10-27: "use the exact design of our passing network ipynb, we show it like pie with cracks").
// Its sizes in StatsBomb units (120 long) turned into metres
// (the chips 1.4 times the notebook's, so the notch reads on the panel's smaller pitch)
const SB = L / 120, CHIP_K = 1.4, CHIP_R = [1.2 * SB * CHIP_K, 3.4 * SB * CHIP_K], EDGE_HALF = [0.15 * SB, 2.6 * SB];
// the chips in their team's colour, darker to lighter for more threat added (Yi, 2026-10-27: "pick the color
// corresponding to their team color"; the notebook's warm ramp made the Pelicans orange)
const TEAM_STOPS: Record<Side, string[]> = { home: ['#1d4a7a', '#4a9de6', '#c4e4ff'], away: ['#7a3414', '#ee7a3e', '#ffd6bc'] };
type RGB = [number, number, number];
const rgbOf = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
const css = (c: RGB) => `rgb(${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(',')})`;
const lum = (c: RGB) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const teamAt = (side: Side, t: number): RGB => {
  const S = TEAM_STOPS[side], x = Math.min(0.999, Math.max(0, t)) * (S.length - 1), i = Math.floor(x), f = x - i, a = rgbOf(S[i]), b = rgbOf(S[i + 1]);
  return a.map((v, k) => v + (b[k] - v) * f) as RGB;
};
/** the chip: a soft offset shadow, the rim (the base at half, a white edge), the body, a lighter cap (a light base: the
 *  body darker, the cap the base); a notch in the body's ring, in the rim's tone, pointing the way his failed passes
 *  went, as wide as their share (at most 60%); his number on it */
function Chip({ x, y, r, base, no, fail, share }: { x: number; y: number; r: number; base: RGB; no: number | null; fail: [number, number] | null; share: number }) {
  const lift = base.map((v) => v + (1 - v) * 0.34) as RGB;
  const [rim, main, hi] = lum(lift) - lum(base) < 0.1 ? [base.map((v) => v * 0.6), base.map((v) => v * 0.88), base] as RGB[] : [base.map((v) => v * 0.5) as RGB, base, lift];
  let notch: string | null = null;
  if (fail && share > 0) {
    const a = Math.atan2(fail[1], fail[0]), sw = Math.min(share, 0.6) * 2 * Math.PI, R = 0.86 * r, q = 0.62 * r, a0 = a - sw / 2, a1 = a + sw / 2, big = sw > Math.PI ? 1 : 0;
    const pt = (rad: number, t: number) => `${x + rad * Math.cos(t)} ${y + rad * Math.sin(t)}`;
    notch = `M${pt(R, a0)} A${R} ${R} 0 ${big} 1 ${pt(R, a1)} L${pt(q, a1)} A${q} ${q} 0 ${big} 0 ${pt(q, a0)} Z`;
  }
  const s = no === null ? '' : String(no);
  return (
    <g>
      <circle cx={x + 0.1 * r} cy={y + 0.14 * r} r={1.06 * r} fill="#000" opacity={0.28} />
      <circle cx={x} cy={y} r={r} fill={css(rim)} stroke="#fff" strokeWidth={1.1} vectorEffect="non-scaling-stroke" />
      <circle cx={x} cy={y} r={0.86 * r} fill={css(main)} />
      <circle cx={x} cy={y} r={0.62 * r} fill={css(hi)} />
      {notch && <path d={notch} fill={css(rim)} />}
      {s && <text x={x} y={y} dy="0.36em" className="ms-chip-no" style={{ fontSize: (r * (s.length < 2 ? 0.82 : 0.62)) / 0.72, fill: lum(main) > 0.7 ? '#1a1d22' : '#fff' }}>{s}</text>}
    </g>
  );
}
/** a node's footprint on the pitch, metres: its chip (radius r round x, y) with its name's pill under it (w wide, h
 *  tall, its top PILL_GAP under the chip) */
// the names in the small tier (summary.css --ms-t-small, --fs-xs's 11 px) over PPM, the pair pitches' pixels a metre at the
// base layout (the panel's 920 px less its 2 x 24 px padding and the 24 px between the two, over the pitch's 110 m;
// summary.css --ms-ppm)
const PPM = (BASE_W - 3 * 24) / 2 / (L + 5), PILL_FS = 11 / PPM, PILL_GAP = 0.9, SPREAD_GAP = 0.5;
interface Foot { id: string; x: number; y: number; r: number; w: number; h: number }
/** the nodes pushed apart until no chip or name sits over another (Yi, 2026-10-27: "if someone's checker is underneath
 *  another player, we separate them a bit, even that's not exactly accurate"): each footprint a box (as wide as the
 *  wider of chip and pill, from the chip's top to the pill's foot), two boxes that overlap pushed apart half each along
 *  the axis they overlap least on, again until none do; kept on the pitch */
function spread(feet: Foot[]): Map<string, [number, number]> {
  const P = feet.map((f) => ({ ...f, hw: Math.max(f.r, f.w / 2) + SPREAD_GAP / 2, top: f.r + SPREAD_GAP / 2, foot: f.r + PILL_GAP + f.h + SPREAD_GAP / 2 }));
  for (let it = 0; it < 200; it++) {
    let moved = false;
    for (let a = 0; a < P.length; a++) for (let b = a + 1; b < P.length; b++) {
      const A = P[a], B = P[b];
      const ox = Math.min(A.x + A.hw, B.x + B.hw) - Math.max(A.x - A.hw, B.x - B.hw);
      const oy = Math.min(A.y + A.foot, B.y + B.foot) - Math.max(A.y - A.top, B.y - B.top);
      if (ox <= 0 || oy <= 0) continue;
      moved = true;
      if (ox < oy) { const k = (A.x <= B.x ? -1 : 1) * ox / 2; A.x += k; B.x -= k; }
      else { const k = (A.y <= B.y ? -1 : 1) * oy / 2; A.y += k; B.y -= k; }
    }
    for (const q of P) { q.x = Math.min(L / 2 - q.hw, Math.max(-L / 2 + q.hw, q.x)); q.y = Math.min(W / 2 - q.foot, Math.max(-W / 2 + q.top, q.y)); }
    if (!moved) break;
  }
  return new Map(P.map((q) => [q.id, [q.x, q.y]]));
}
/** the network's legend (Yi, 2026-10-27: "make legends at bottom"): the chip's size, its shade, its notch, a link */
function NetworkLegend() {
  const mid = teamAt('home', 0.45);
  return (
    // the chips' three keys on the first line, alike as they are, the links' under them (Yi, 2026-10-27: "move the Where
    // his passes went astray to first line, because all three of them share the same visual traits")
    <div className="ms-legend ms-icon-legend ms-legend-rows">
      <div>
      <span><svg viewBox="-1.9 -1.1 3.8 2.2" aria-hidden="true"><Chip x={-1} y={0} r={0.5} base={mid} no={null} fail={null} share={0} /><Chip x={0.8} y={0} r={0.95} base={mid} no={null} fail={null} share={0} /></svg>More passes</span>
      <span><svg viewBox="-2.3 -0.85 4.6 1.7" aria-hidden="true">{[0.05, 0.5, 1].map((t, i) => <Chip key={i} x={-1.5 + 1.5 * i} y={0} r={0.6} base={teamAt('home', t)} no={null} fail={null} share={0} />)}</svg>More threat added (xT)</span>
      <span><svg viewBox="-1.2 -1.2 2.4 2.4" aria-hidden="true"><Chip x={0} y={0} r={1} base={mid} no={null} fail={[1, 0]} share={0.3} /></svg>Where his passes went astray</span>
      </div>
      <div><span><svg viewBox="0 -1 5 2" aria-hidden="true"><polygon points="0.2,-0.2 0.2,0.2 4.8,0.75 4.8,-0.75" className="ms-link" /></svg>Passes between two, wider where received</span></div>
    </div>
  );
}
function NetworkPage({ d, who }: { d: MatchSummaryData; who: Who }) {
  // one scale for both teams, as the notebook's panels share theirs
  const all = SIDES.flatMap((s) => d.network[s].nodes), maxN = Math.max(1, ...all.map((n) => n.n)), maxXt = Math.max(0.05, ...all.map((n) => n.xt));
  const dirMax = Math.max(1, ...SIDES.flatMap((s) => d.network[s].edges.map((e) => Math.max(e[2], e[3]))));
  const half = (v: number) => EDGE_HALF[0] + (EDGE_HALF[1] - EDGE_HALF[0]) * (v / dirMax);
  return (
    <div className="ms-stack">
    <div className="ms-pair">
      {SIDES.map((side) => {
        const net = d.network[side];   // (no line under it: Yi dropped "most passes between", 2026-10-27)
        const rOf = (n: { n: number }) => CHIP_R[0] + (CHIP_R[1] - CHIP_R[0]) * (n.n / maxN), pillW = (pid: string) => who.short(pid).length * PILL_FS * 0.56 + 1.6;
        // where each is drawn: his average pass spot, nudged off his neighbours; the links follow the chips
        const at = spread(net.nodes.map((n) => ({ id: n.pid, x: n.at[0], y: n.at[1], r: rOf(n), w: pillW(n.pid), h: PILL_FS * 1.45 })));
        const st = d.stats.find((s) => s.key === 'passes'), acc = d.stats.find((s) => s.key === 'pass_acc');
        return (
          <figure key={side} className="ms-fig">
            <TeamHead side={side}>{st && acc ? `${st[side]} passes · ${acc[side]}% accurate` : null}</TeamHead>
            <Pitch>
              {/* the links: a supply line from each end, as wide at a player as the passes he got from the other */}
              {net.edges.map(([a, b, ab, ba]) => {
                const p = at.get(a), q = at.get(b);
                if (!p || !q) return null;
                const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
                if (len === 0) return null;
                const ux = -(q[1] - p[1]) / len, uy = (q[0] - p[0]) / len, w1 = half(ba), w2 = half(ab);
                return <polygon key={`${a}${b}`} points={`${p[0] + ux * w1},${p[1] + uy * w1} ${p[0] - ux * w1},${p[1] - uy * w1} ${q[0] - ux * w2},${q[1] - uy * w2} ${q[0] + ux * w2},${q[1] + uy * w2}`} className="ms-link" />;
              })}
              {net.nodes.map((n) => {
                const [x, y] = at.get(n.pid) ?? n.at;
                return <Chip key={n.pid} x={x} y={y} r={rOf(n)} base={teamAt(side, Math.max(0, n.xt) / maxXt)} no={who.number(n.pid)} fail={n.fail} share={n.n > 0 ? 1 - n.ok / n.n : 0} />;
              })}
              {net.nodes.map((n) => {
                const [x, y] = at.get(n.pid) ?? n.at, r = rOf(n), name = who.short(n.pid), fs = PILL_FS, w = pillW(n.pid);
                return (
                  <g key={`${n.pid}-name`} className="ms-pill">
                    <rect x={x - w / 2} y={y + r + PILL_GAP} width={w} height={fs * 1.45} rx={fs * 0.5} />
                    <text x={x} y={y + r + PILL_GAP + fs * 0.72} dy="0.35em">{name}</text>
                  </g>
                );
              })}
            </Pitch>
          </figure>
        );
      })}
    </div>
      <NetworkLegend />
    </div>
  );
}

/** three rings at the map's sizes for xG 0.03, 0.25 and 0.7, side by side on one centre line (Yi, 2026-10-27: "make
 *  these three circle center aligned") */
function XgScale() {
  const rs = [0.03, 0.25, 0.7].map(SHOT_R), gap = 0.9, h = 2 * rs[2] + 0.4;
  let x = 0.2;
  const cs = rs.map((r) => { const cx = x + r; x += 2 * r + gap; return { cx, r }; });
  return (
    <svg viewBox={`0 0 ${x - gap + 0.2} ${h}`} aria-hidden="true">
      {cs.map((c, i) => <circle key={i} cx={c.cx} cy={h / 2} r={c.r} className="ms-xg-ring" />)}
    </svg>
  );
}

// ---- the shots (Yi, 2026-10-27: "maybe we should add a shot map? that is essential for match summary"): one pitch, the
// home team shooting right, the away team left; each shot as big as its xG, in FotMob's language (Yi: "a soccer ball
// means a goal, ... a filled circle means on target, and ... a ring, it means not on target"); the ball SVG Repo's
// (BallMark) (no line under the pitch: Yi dropped the best chance)
// (sizes kept close, Yi 2026-10-27: "the icons are too big ... normalize them a bit": 1.3 m for a 0.07, 2.7 m for a penalty)
const SHOT_R = (xg: number) => 0.7 + 2.3 * Math.sqrt(Math.min(1, xg));
/** the goal's ball: SVG Repo's "football-ball" (svgrepo.com/svg/171773, its "Football" collection, CC0; Yi, 2026-10-27,
 *  in place of Font Awesome's futbol, so that the credits need not name it): white, its patches and its ring the dark
 *  grey Yi chose, the ring thickened (BALL_RING, of its 496 box: "make the outline black ring to be thicker"); radius r
 *  round (x, y), solid, so what lies under it does not show through */
/** the shot map's ball as large as the one Yi approved (Font Awesome's, whose circle filled 228 of its 512 box, so it
 *  stood at 0.89 of its xG size); SVG Repo's fills its box, and drawn at the full size it read 12 % larger (Yi,
 *  2026-10-27: "these icons for shotmap is too big for the goals, verify if the size is correct") */
const BALL_ON_MAP = 228 / 256;
const SR_BALL = 'M271.942,209.614 L338.425,114.466 L257.523,39.026 L144.542,79.657 L148.303,186.135 Z M228.868,402.407 L289.71,465.777 L395.984,420.409 L413.34,326.511 L307.844,313.522 Z M15.731,336.798l1.343,1.644c36.151,92.23,125.889,157.571,230.934,157.571c136.976,0,248.006-111.029,248.006-248.007 C496.013,111.036,384.983,0,248.007,0C111.036,0,0,111.043,0,248.006c0,30.668,5.604,60.026,15.785,87.145L15.731,336.798z M12.93,248.006c0-31.32,6.209-61.204,17.38-88.564l58.667-72.789l15.206-24.383c39.792-30.883,89.68-49.339,143.833-49.339 c1.302,0,2.583,0.08,3.893,0.094l26.236,9.664l57.827,7.379c37.029,15.002,69.417,39.15,94.312,69.671l-9.63,41.932 l37.994,107.148l24.272,6.148c-3.727,126.418-107.619,228.106-234.905,228.106c-63.375,0-120.926-25.247-163.249-66.159 l45.626-39.192L86.849,265.485l-68.128-23.465l-1.575,50.047C14.42,277.797,12.93,263.077,12.93,248.006z';
const BALL_RING = 34;
/** inv: the other way round, the body near black, the patches and the ring white (the shot map's: Yi, 2026-10-27, "the
 *  black ring one is better", "but for that shot map, let's use the reverse one") */
function BallMark({ x, y, r, inv = false }: { x: number; y: number; r: number; inv?: boolean }) {
  return (
    <g className={inv ? 'ms-ballmark inv' : 'ms-ballmark'} transform={`translate(${x - r} ${y - r}) scale(${(2 * r) / 496})`}>
      {/* the white only as far as the ring's middle, so its edge never shows past the ring's (a white fringe round the
          ball where the two edges' smoothing met: Yi, 2026-10-27) */}
      <circle cx={248} cy={248} r={248 - BALL_RING / 2} className="ms-ball" />
      <path d={SR_BALL} className="ms-ball-ink" />
      <circle cx={248} cy={248} r={248 - BALL_RING / 2} className="ms-ball-ring" style={{ strokeWidth: BALL_RING }} />
    </g>
  );
}

function ShotsPage({ d }: { d: MatchSummaryData }) {
  const of = (side: Side) => d.shots.filter((s) => s.side === side);
  return (
    <div className="ms-shots">
      <div className="ms-shots-head">
        {/* the shots only: the xG and the goals are on the Statistics page (Yi, 2026-10-27) */}
        {SIDES.map((side) => <TeamHead key={side} side={side} mirror={side === 'away'}>{`${of(side).length} shots`}</TeamHead>)}
      </div>
      <figure className="ms-fig">
        <Pitch>
          {/* the big ones first, so the small sit on top; the goals over everything */}
          {[...d.shots].sort((a, b) => Number(a.how === 'goal') - Number(b.how === 'goal') || b.xg - a.xg).map((s, i) => {
            const k = s.side === 'home' ? 1 : -1, x = k * s.at[0], y = k * s.at[1], r = SHOT_R(s.xg), c = KIT[s.side];
            if (s.how === 'goal') return <BallMark key={i} x={x} y={y} r={Math.max(1.3, r) * BALL_ON_MAP} inv />;
            return s.how === 'saved'
              ? <circle key={i} cx={x} cy={y} r={r} className="ms-shot on" style={{ fill: c, stroke: 'rgba(6, 9, 15, .85)' }} />
              : <circle key={i} cx={x} cy={y} r={r} className="ms-shot off" style={{ fill: 'none', stroke: c }} />;
          })}
        </Pitch>
      </figure>
      <div className="ms-legend ms-legend-rows">
        <div>
          <span><svg className="ms-key-ball" viewBox="-1.1 -1.1 2.2 2.2" aria-hidden="true"><BallMark x={0} y={0} r={1} inv /></svg>Goal</span>
          <span><i className="ms-key-shot on" />On target</span><span><i className="ms-key-shot off" />Not on target</span>
        </div>
        {/* the size by xG, three of the map's own sizes (Yi, 2026-10-27: "we do need also the checker size for greater xG
            notation ... design it elegantly"), the deeper key on the second line ("if it is a more in depth legend,
            let's make it the second line") */}
        <div><span className="ms-xg-scale">Low xG<XgScale />High xG</span></div>
      </div>
    </div>
  );
}

/** the attacking third by channel (Yi, 2026-10-27): each arrow as thick as the team's share of its time on the ball
 *  there, as long as the threat it made there a minute (xT, `lanes.xt_min`; "make the more delta xT lane per minute
 *  having the longer arrow"), on one length for both teams; a legend under them */
const LANE_X0 = -6, LANE_LEN = [12, 46];
function LanesPage({ d }: { d: MatchSummaryData }) {
  const rate = d.lanes.xt_min, top = Math.max(1e-6, ...SIDES.flatMap((s) => rate?.[s] ?? [0]));
  const len = (side: Side, i: number) => LANE_LEN[0] + (LANE_LEN[1] - LANE_LEN[0]) * Math.max(0, (rate?.[side][i] ?? top) / top);
  const arrow = (y: number, t: number, x1: number) => `M${LANE_X0} ${y - t / 2} H${x1} V${y - t / 2 - 2} L${x1 + 7} ${y} L${x1} ${y + t / 2 + 2} V${y + t / 2} H${LANE_X0} Z`;
  return (
    <div className="ms-stack">
      <div className="ms-pair">
        {SIDES.map((side) => {
          const sh = d.lanes[side], best = sh.indexOf(Math.max(...sh));
          return (
            <figure key={side} className="ms-fig">
              {/* the passes played forward (Yi, 2026-10-27: "find something more related to directions here"; the time
                  in the final third went to the heat maps); the pitch in its three lanes, no third shaded ("do not
                  highlight the final third, but divide the pitch just into three lanes") */}
              <TeamHead side={side}>{d.lanes.fwd ? `${d.lanes.fwd[side]} forward passes` : null}</TeamHead>
              <Pitch under={<g className="ms-lane-div">{[-1, 1].map((k) => <path key={k} d={`M${-L / 2} ${(k * W) / 6} H${L / 2}`} />)}</g>}>
                {sh.map((v, i) => {
                  const y = (i - 1) * (W / 3), t = 1.2 + v * 13;
                  return (
                    <g key={i} className={i === best ? 'ms-lane best' : 'ms-lane'}>
                      <path d={arrow(y, t, LANE_X0 + len(side, i))} style={{ fill: KIT[side] }} />
                      <text x={-14} y={y} dy="0.35em" className="ms-lane-pct">{Math.round(v * 100)}%</text>
                    </g>
                  );
                })}
              </Pitch>
            </figure>
          );
        })}
      </div>
      <div className="ms-legend ms-icon-legend ms-rows-1">
        <span><svg viewBox="0 -1.6 6 3.2" aria-hidden="true"><path d="M0 -0.3 H4.6 V-0.8 L6 0 L4.6 0.8 V0.3 H0 Z" className="ms-key-arrow" /></svg><svg viewBox="0 -1.6 6 3.2" aria-hidden="true"><path d="M0 -1 H4.6 V-1.5 L6 0 L4.6 1.5 V1 H0 Z" className="ms-key-arrow" /></svg>Thicker: more of the time on the ball</span>
        <span><svg viewBox="0 -1.2 4 2.4" aria-hidden="true"><path d="M0 -0.5 H2.6 V-1 L4 0 L2.6 1 V0.5 H0 Z" className="ms-key-arrow" /></svg><svg viewBox="0 -1.2 8 2.4" aria-hidden="true"><path d="M0 -0.5 H6.6 V-1 L8 0 L6.6 1 V0.5 H0 Z" className="ms-key-arrow" /></svg>Longer: more threat a minute (xT)</span>
      </div>
    </div>
  );
}

/** the team heat maps (Yi, 2026-10-27: no line, no note, no caption; "add legend at the end for both team, one at left
 *  one at right"): each map's own bands, Less to More, under it on its outer side */
function HeatPage({ d }: { d: MatchSummaryData }) {
  return (
    <div className="ms-pair">
      {SIDES.map((side) => (
        <figure key={side} className="ms-fig">
          {/* (the time in the final third, from the attacks' page: Yi, 2026-10-27) */}
          <TeamHead side={side}>{`${Math.round(d.lanes.third_s[side] / 60)} min on the ball in the final third`}</TeamHead>
          <Pitch under={<Heat src={d.heat.team[side]} d={d} ramp={RAMPS[side]} />} />
          {/* centred under its map (Yi, 2026-10-27) */}
          <div className="ms-heat-key">
            <span>Less</span>
            {Array.from({ length: 5 }, (_, i) => { const [r, g, b, a] = RAMPS[side]((2 * i + 1) / 10); return <i key={i} style={{ background: `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${a})` }} />; })}
            <span>More</span>
          </div>
        </figure>
      ))}
    </div>
  );
}

/** the assist's boot: SVG Repo's "soccer-shoe" (svgrepo.com/svg/165557, its "Playing Football" collection, CC0; Yi,
 *  2026-10-27, in place of game-icons' running-shoe), its toe to the left as Yi had the last one ("the side view of a
 *  player kicking the ball from right to left"), turned 45 degrees counter-clockwise (Yi); its 950 box, the shoe's
 *  middle at (475, 485). Credited in credits/Credits.tsx */
const SR_SHOE = 'M579.606,310.743c22.431,12.207,53.546,23.819,90.668,25.008c-31.055-35.324-48.619-56.02-48.858-56.302 c-20.445-23.045-38.111-24.443-68.896-1.377c-6.6,4.948-15.673,12.123-26.271,20.882 C541.767,296.824,559.559,299.852,579.606,310.743z M9.94,624.987c14.194,4.4,28.546,8.298,43.007,11.712c0.168,0.04,0.338,0.075,0.506,0.115l10.221,44.917 c1.271,5.584,6.943,10.11,12.669,10.11h37.42c5.726,0,11.398-4.526,12.669-10.11l6.939-30.496 c20.967,2.767,42.033,4.848,63.132,6.414l5.799,24.111c1.339,5.567,7.067,10.081,12.793,10.081h40.73 c5.726,0,11.454-4.514,12.793-10.081l4.887-20.322c22.155,0.617,44.319,0.877,66.482,0.844 c105.966-0.155,211.698-7.297,317.573-10.523l7.215,30.001c1.339,5.567,7.065,10.081,12.793,10.081h40.729 c5.727,0,11.454-4.514,12.794-10.081l7.76-32.27c13.209-0.396,26.771-0.814,40.212-1.238l8.059,33.508 c1.339,5.567,7.067,10.081,12.793,10.081h40.73c5.727,0,11.454-4.514,12.793-10.081l8.712-36.227 c16.755-0.563,30.47-1.034,39.186-1.336c5.724-0.197,11.497-4.86,12.857-10.424c7.498-30.67,32.592-123.771,35.222-171.387 c0.396-7.132,0.584-13.93,0.584-20.425c0-10.64-0.552-20.341-1.493-29.415c-36.024,34.489-104.094,76.611-168.821,101.266 c-79.291,30.215-138.492,54.754-165.224,93.795c-11.795,0.712-23.786,1.446-35.96,2.201l-72.467,4.857 c-2.575,0.179-5.156,0.357-7.736,0.536c13.323-15.3,56.258-57.677,137.811-78.085c96.536-24.131,246.343-75.307,309.882-142.375 c-1.711-9.366-7.045-17.846-9.616-25.594c-28.88,23.297-102.8,74.586-229.001,109.307 c-131.758,36.224-244.775,60.566-302.212,142.772c-35.062,1.978-70.38,3.504-105.877,4.082 c13.512-19.387,80.645-104.656,236.217-134.292c169.358-32.255,307.492-72.341,392.416-142.479 c-8.834-17.855-17.844-30.617-27.702-42.479c-13.469-16.206-36.022-50.783-60.62-47.709c-12.471,1.56-18.627,12.18-24.087,22.188 c-6.247,11.451-13.163,22.193-22.261,31.634c-17.868,18.541-41.451,31.514-65.96,38.957 c-58.327,17.709-126.868-3.122-157.286-20.279c-19.919-11.253-48.055-17.134-68.337-3.721c-6.951,4.597-12.743,10.59-18.894,16.148 c-2.048,1.849-4.198,3.674-6.38,5.492l31.89,40.629c4.354,5.4,3.456,13.344-1.953,17.668c-5.429,4.333-13.355,3.456-17.689-1.974 l-32.243-41.058c-9.397,6.535-73.573,41.547-85.385,46.831l22.272,40.086c3.604,5.89,1.745,13.648-4.176,17.271 c-5.941,3.625-13.667,1.756-17.322-4.188l-24.152-43.144c-22,9.034-44.371,17.011-66.768,24.989 c-9.664,3.441-19.277,7.147-29.145,9.968c-13.074,3.736-26.146,7.476-39.231,11.176c-16.55,4.68-33.087,9.405-49.671,13.964 c-11.055,3.039-22.133,5.842-33.278,8.531c-26.108,6.297-52.498,12.453-77.741,21.742c-16.683,6.14-35.423,14.146-44.43,30.505 C3.439,548.901,0,559.275,0,567.505c0,0.593,0.032,28.36,0.05,43.962C0.057,617.193,4.47,623.292,9.94,624.987z';
function CleatMark({ x, y, r }: { x: number; y: number; r: number }) {
  const k = (2 * r) / 950;
  return <path d={SR_SHOE} transform={`translate(${x} ${y}) rotate(-45) scale(${k}) translate(-475 -485)`} className="ms-cleat" />;
}
/** the goals map's marks, screen metres: the ball's radius, the boot's half width */
const MARK_BALL = 2.0, MARK_CLEAT = 2.0;   // (smaller, both: Yi 2026-10-27; the boot's half length, as it is long and low)

/** the player of the match (Yi, 2026-10-27: "show his assist and goal map ..., so we will have two vertical pitch, and
 *  then player profile (slightly thinner than right now)"): where he played, then his goals and his assists, both
 *  pitches on end with his team attacking up, then his card */
function KeyPage({ d, who, portrait }: { d: MatchSummaryData; who: Who; portrait?: (pid: string) => string | null }) {
  if (!d.key) return null;
  const pid = d.key.pid, p = d.players[pid], b64 = d.heat.player[pid], photo = portrait?.(pid) ?? null;
  const fact = (v: ReactNode, k: string) => <div className="ms-fact"><b>{v}</b><span>{k}</span></div>;
  const goals = d.shots.filter((s) => s.pid === pid && s.how === 'goal'), assists = (d.assists ?? []).filter((a) => a.pid === pid);
  return (
    <div className="ms-key">
      <figure className="ms-fig">
        <Pitch vertical under={b64 && <Heat src={b64} d={d} ramp={greenRamp} />} />
        <div className="ms-heat-key">
          <span>Less</span>
          {Array.from({ length: 5 }, (_, i) => { const [r, g, b, a] = greenRamp((2 * i + 1) / 10); return <i key={i} style={{ background: `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${a})` }} />; })}
          <span>More</span>
        </div>
      </figure>
      <figure className="ms-fig">
        <Pitch
          vertical
          screen={
            <g>
              {/* (no line from the boot to where the pass went: Yi, 2026-10-27, "it makes the scene a bit messy") */}
              {/* (no chances-created arrows: Yi, 2026-10-27, tried and dropped) */}
              {assists.map((a, i) => { const [x, y] = VERT(a.at); return <CleatMark key={`c${i}`} x={x} y={y} r={MARK_CLEAT} />; })}
              {goals.map((s, i) => { const [x, y] = VERT(s.at); return <BallMark key={`g${i}`} x={x} y={y} r={MARK_BALL} />; })}
            </g>
          }
        />
        <div className="ms-legend">
          <span><svg className="ms-key-ball" viewBox="-1.1 -1.1 2.2 2.2" aria-hidden="true"><BallMark x={0} y={0} r={1} /></svg>{goals.length === 1 ? 'Goal' : 'Goals'}</span>
          <span><svg className="ms-key-cleat" viewBox="-1.2 -1.2 2.4 2.4" aria-hidden="true"><CleatMark x={0} y={0} r={1.05} /></svg>{assists.length === 1 ? 'Assist' : 'Assists'}</span>
        </div>
      </figure>
      <div className={`ms-key-card ${p.side}`}>
        {/* his toon portrait, as the player card's (Yi, 2026-10-27: "for POTM, make sure we include his photo") */}
        {photo && <div className="ms-key-photo"><img src={photo} alt="" /></div>}
        <div className="ms-key-name"><Crest team={p.side} size={34} /><span className="ms-key-no">{who.number(pid) ?? ''}</span><b>{who.name(pid)}</b></div>
        <div className="ms-facts">
          {fact(p.rating?.toFixed(1) ?? '–', 'Rating')}
          {fact(p.goals, p.goals === 1 ? 'Goal' : 'Goals')}
          {fact(p.assists, p.assists === 1 ? 'Assist' : 'Assists')}
          {fact(p.shots, 'Shots')}
          {fact(p.xg?.toFixed(2) ?? '–', 'xG')}
          {fact(p.dist ? (p.dist / 1000).toFixed(1) : '–', 'km run')}
          {fact(p.top_kmh?.toFixed(1) ?? '–', 'Top km/h')}
          {fact(p.sprints ?? '–', 'Sprints')}
        </div>
      </div>
    </div>
  );
}

/** the furthest runners, each as a bar by speed band (the Physicals' right side, the top RUN_N: Yi, 2026-10-27, "we do not
 *  need to show that long list, just make it shorter") */
const RUN_N = 10;   // (as many as the left side's height holds: Yi, 2026-10-27, "for right side we can show more players")
function RunRows({ d, who }: { d: MatchSummaryData; who: Who }) {
  const runners = Object.entries(d.players).flatMap(([pid, p]) => (!p.keeper && p.dist && p.bands ? [{ pid, p, dist: p.dist, bands: p.bands }] : []))
    .sort((a, b) => b.dist - a.dist).slice(0, RUN_N);
  const max = runners[0]?.dist ?? 1;
  return (
    <div className="ms-run-rows">
      {runners.map(({ pid, p, dist, bands }) => (
        <div key={pid} className="ms-run-row">
          {/* his shirt number in his team's colour, as his tag on the pitch has it, in place of a dot (Yi, 2026-10-27) */}
          <span className="ms-run-who"><b className={`ms-run-no ${p.side}`}>{who.number(pid) ?? ''}</b>{who.short(pid)}</span>
          <span className="ms-run-bar" style={{ width: `${(100 * dist) / max}%` }}>
            {bands.map((m, i) => <i key={i} style={{ flexGrow: m, background: BAND_FILL[i] }} title={`${BANDS[i]}: ${(m / 1000).toFixed(2)} km`} />)}
          </span>
          <b className="ms-run-km">{(dist / 1000).toFixed(1)} km</b>
        </div>
      ))}
    </div>
  );
}

// ---- the physicals (Yi, 2026-10-27: "for physical data, it is very important, let's divide it into several sub plots ...
// from audience's perspective, what do we want to know?"): each team's intensity through the match with the goals on it;
// where on the pitch it ran and how fast; the furthest runners. One page (the Team | Players switch went, Yi).
const SMOOTH_HALF = 2;   // the intensity's rolling mean: 5 minutes, centred, cut at a half's ends
/** a half's high-speed metres a minute: each minute's metres over its length (a half's last, short minute dropped
 *  under 30 s), then the rolling mean */
function perMinute(v: number[], secs: number): number[] {
  const out = v.map((m, i) => { const len = Math.min(60, secs - i * 60); return len >= 30 ? (m * 60) / len : NaN; }).filter((x) => !Number.isNaN(x));
  return out.map((_, i) => { const a = Math.max(0, i - SMOOTH_HALF), b = Math.min(out.length, i + SMOOTH_HALF + 1); let s = 0; for (let k = a; k < b; k++) s += out[k]; return s / (b - a); });
}
const INT_W = 808, INT_H = 64, INT_GAP = 16, INT_FOOT = 16;   // (lower, as lines: Yi, 2026-10-27)
/** the intensity: each team's line in its colour over one baseline (Yi, 2026-10-27: "show both team as blue and orange
 *  line, together above the surface"), minute by minute, one scale; the halves apart; a ball where each goal went in,
 *  on its scorer's line ("we can use soccer ball in this graph to suggest the score change point") */
type Physical = NonNullable<MatchSummaryData['physical']>;
function IntensityChart({ d, P }: { d: MatchSummaryData; P: Physical }) {
  const I = P.intensity;
  const h = ['1', '2'] as const;
  const series = Object.fromEntries(SIDES.map((s) => [s, h.map((k) => perMinute(I[s][k], I.secs[k]))])) as Record<Side, number[][]>;
  const n = h.map((_, i) => Math.max(series.home[i].length, series.away[i].length));
  const top = Math.max(1, ...SIDES.flatMap((s) => series[s].flat()));
  const ppm = (INT_W - INT_GAP) / (n[0] + n[1]), y0 = INT_H, amp = INT_H - 8;
  const xOf = (half: number, m: number) => (half === 0 ? 0 : n[0] * ppm + INT_GAP) + m * ppm;
  const yOf = (v: number) => y0 - amp * (v / top);
  const line = (side: Side, half: number) => series[side][half].map((x, i) => `${i ? 'L' : 'M'}${xOf(half, i + 0.5)} ${yOf(x)}`).join(' ');
  const under = (side: Side, half: number) => { const v = series[side][half]; return v.length ? `${line(side, half)} L${xOf(half, v.length - 0.5)} ${y0} L${xOf(half, 0.5)} ${y0} Z` : ''; };
  // (the second half's 45' left to HT)
  const ticks: [number, number, string][] = [[0, 0, "0'"], [0, 15, "15'"], [0, 30, "30'"], [0, 45, "45'"], [1, 15, "60'"], [1, 30, "75'"], [1, 45, "90'"]];
  const goals = d.shots.filter((s) => s.how === 'goal').map((s) => {
    const half = (s.half ?? (s.min > 45 ? 2 : 1)) - 1, m = Math.min(n[half] - 1, Math.max(0, half === 0 ? s.min : s.min - 45));
    const v = series[s.side][half][Math.round(m)] ?? 0;
    return { x: xOf(half, m + 0.5), y: Math.max(6, yOf(v) - 8), key: `${s.side}${s.min}` };
  });
  // two goals a minute or so apart (54', 55'): the later one stacked over the earlier, not on it
  goals.sort((a, b) => a.x - b.x).forEach((g, i) => { const p = goals[i - 1]; if (p && Math.abs(g.x - p.x) < 12) g.y = p.y - 12; });
  return (
    <div className="ms-int">
      <div className="ms-int-teams">{SIDES.map((s) => <div key={s} className={`ms-teamhead ${s}`}><i className={`ms-int-key ${s}`} /><Crest team={s} size={16} /><b>{TEAM_CODE[s]}</b></div>)}</div>
      <svg viewBox={`0 0 ${INT_W} ${INT_H + INT_FOOT}`} aria-label="High-speed running a minute, each team">
        {ticks.filter(([, m]) => m > 0 && m < 45).map(([half, m]) => <path key={`g${half}${m}`} d={`M${xOf(half, m)} 0 V${INT_H}`} className="ms-int-grid" />)}
        {h.map((_, i) => SIDES.map((s) => <path key={`u${s}${i}`} d={under(s, i)} className={`ms-int-under ${s}`} />))}
        {h.map((_, i) => <path key={`axis${i}`} d={`M${xOf(i, 0)} ${y0} H${xOf(i, n[i])}`} className="ms-int-axis" />)}
        {h.map((_, i) => SIDES.map((s) => <path key={`l${s}${i}`} d={line(s, i)} className={`ms-int-line ${s}`} />))}
        {goals.map((g) => <BallMark key={g.key} x={g.x} y={g.y} r={6} />)}
        {ticks.map(([half, m, t]) => <text key={`t${half}${m}`} x={Math.min(xOf(half, m), xOf(half, n[half]))} y={INT_H + 12} className={m === 0 ? 'start' : m === 45 ? 'end' : ''}>{t}</text>)}
        <text x={n[0] * ppm + INT_GAP / 2} y={INT_H + 12} className="ht">HT</text>
      </svg>
    </div>
  );
}
const PPM_MINI = 222 / (L + 5);   // (summary.css .ms-thirds: each pitch as wide as its head, the bands' bars under both)
/** where a team ran: its distance by third of the pitch, attacking right (the arrow), each third as dark as its share
 *  (Yi, 2026-10-27: no thirds' names on the pitch, "simply draw an arrow to show the attacking direction") */
function TeamRun({ P, side }: { P: Physical; side: Side }) {
  const t = P.thirds[side], sum = t.reduce((a, b) => a + b, 0) || 1, total = P.bands[side].reduce((x, y) => x + y, 0) || 1;
  // (the head's total is MA45's, as the Statistics page has it; the thirds only share it out)
  return (
    <figure className="ms-fig ms-thirds" style={{ '--ms-ppm': PPM_MINI } as CSSProperties}>
      <TeamHead side={side}>{`${(total / 1000).toFixed(1)} km · ${P.sprints[side]} sprints`}</TeamHead>
      <Pitch under={t.map((m, i) => <rect key={i} x={-L / 2 + (i * L) / 3} y={-W / 2} width={L / 3} height={W} style={{ fill: KIT[side], opacity: 0.1 + 0.7 * (m / sum) }} />)}>
        {t.map((m, i) => <text key={i} x={-L / 2 + ((i + 0.5) * L) / 3} y={0} dy="0.35em" className="ms-third-pct">{Math.round((100 * m) / sum)}%</text>)}
        <path d="M-16 17 H13 V14.6 L18 18 L13 21.4 V19 H-16 Z" className="ms-third-arrow" />
      </Pitch>
    </figure>
  );
}
/** how fast a team ran: its distance by speed band as one bar of shares (MA45), the two teams' one under the other across
 *  both pitches (Yi, 2026-10-27: "two long ones spanning two pitches, and stack them vertically") */
function BandsRow({ P, side }: { P: Physical; side: Side }) {
  const b = P.bands[side], total = b.reduce((x, y) => x + y, 0) || 1;
  return (
    <div className="ms-bands-row">
      <span className={`ms-teamhead ${side}`}><Crest team={side} size={16} /><b>{TEAM_CODE[side]}</b></span>
      <div className="ms-bands-bar">{b.map((m, i) => { const p = (100 * m) / total; return <i key={i} className={i < 2 ? 'dark' : undefined} style={{ flexGrow: m, background: BAND_FILL[i] }} title={`${BANDS[i]}: ${(m / 1000).toFixed(1)} km`}>{p >= 5 ? `${Math.round(p)}%` : ''}</i>; })}</div>
    </div>
  );
}
/** the physicals on one page (Yi, 2026-10-27: no Team | Players switch, no headings over the plain charts): the
 *  intensity across the top; each team's pitch and speed bands, the bands' legend; the furthest runners */
function PhysicalPage({ d, who }: { d: MatchSummaryData; who: Who }) {
  const P = d.physical;
  if (!P) return null;
  return (
    <div className="ms-phys">
      <section>
        <p className="ms-stats-head">Intensity · metres a minute above 20 km/h</p>
        <IntensityChart d={d} P={P} />
      </section>
      <div className="ms-phys-row">
        <section>
          <div className="ms-phys-pair">{SIDES.map((s) => <TeamRun key={s} P={P} side={s} />)}</div>
          <div className="ms-bands-rows">{SIDES.map((s) => <BandsRow key={s} P={P} side={s} />)}</div>
          <div className="ms-legend">{BANDS.map((b, i) => <span key={b}><i style={{ background: BAND_FILL[i] }} />{b}</span>)}</div>
        </section>
        <RunRows d={d} who={who} />
      </div>
    </div>
  );
}

type Portrait = (pid: string) => string | null;
// the tabs by their full names (Yi, 2026-10-27: "Statistics, Shot map, Passing Network, Attacking Direction, Heat map, POTM, Physicals")
const PAGES: { key: string; label: string; draw: (d: MatchSummaryData, who: Who, portrait?: Portrait) => ReactNode }[] = [
  { key: 'stats', label: 'Statistics', draw: (d) => <StatsPage d={d} /> },
  { key: 'shots', label: 'Shotmap', draw: (d) => <ShotsPage d={d} /> },
  { key: 'network', label: 'Passing Network', draw: (d, w) => <NetworkPage d={d} who={w} /> },
  { key: 'lanes', label: 'Attacking Direction', draw: (d) => <LanesPage d={d} /> },
  { key: 'heat', label: 'Heatmap', draw: (d) => <HeatPage d={d} /> },
  { key: 'key', label: 'POTM', draw: (d, w, ph) => <KeyPage d={d} who={w} portrait={ph} /> },
  { key: 'run', label: 'Physicals', draw: (d, w) => <PhysicalPage d={d} who={w} /> },
];
/** each page's one line: what it shows, in plain words (no title: the tab names it) */
const SUB: Record<string, string> = {};   // (the Physicals' line went with its Team and Players views, Yi 2026-10-27)

export function MatchSummary({ portrait }: { portrait?: Portrait }) {
  const [d, setD] = useState<MatchSummaryData | null>(null);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [page, setPage] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [scale, setScale] = useState(fitScale);
  useEffect(() => { const on = () => setScale(fitScale()); window.addEventListener('resize', on); const off = tourStep.subscribe(on); return () => { window.removeEventListener('resize', on); off(); }; }, []);
  const hold = useRef(false), bar = useRef<HTMLElement>(null);
  // nobody selected while it is open (Yi, 2026-10-27: "at this page, any selected players will be deselected")
  const { selected } = useGameSettings();
  useEffect(() => { if (selected !== null) setSettings({ selected: null }); }, [selected]);
  useEffect(() => { loadSummary().then(setD); loadRoster().then(setRoster); }, []);
  // the pages turn by themselves, held while the pointer is over the panel; the bar fills toward the next
  useEffect(() => {
    if (!AUTO_TURN) return;
    let raf = 0, last = performance.now(), run = 0;
    const tick = (now: number) => {
      if (!hold.current) run += now - last;
      last = now;
      if (run >= PAGE_S * 1000) { run = 0; setPage((p) => (p + 1) % PAGES.length); }
      if (bar.current) bar.current.style.transform = `scaleX(${run / (PAGE_S * 1000)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [page]);
  const who = useMemo<Who>(() => {
    const by = new Map((roster?.players ?? []).map((p) => [p.pid, p])), looks = roster ? rosterLooks(roster) : null;
    return {
      name: (pid) => by.get(pid)?.name ?? '',
      short: (pid) => { const n = by.get(pid)?.name ?? ''; const w = n.split(' '); return by.get(pid)?.nat === 'cn' ? w[0] : w[w.length - 1]; },
      number: (pid) => looks?.get(pid)?.number ?? null,
    };
  }, [roster]);
  const close = () => { setLeaving(true); window.setTimeout(closeSummary, 260); };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); e.preventDefault(); e.stopImmediatePropagation(); }
      else if (e.key === 'ArrowRight') setPage((p) => (p + 1) % PAGES.length);
      else if (e.key === 'ArrowLeft') setPage((p) => (p + PAGES.length - 1) % PAGES.length);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });
  const P = PAGES[page];
  return (
    <div className={`ms hud-glass${leaving ? ' leaving' : ''}`} style={{ '--ms-s': scale } as CSSProperties} role="dialog" aria-label="Match summary" onPointerEnter={() => { hold.current = true; }} onPointerLeave={() => { hold.current = false; }}>
      <header className="ms-head">
        <div className="ms-score">
          <Crest team="home" size={30} /><b className="ms-code">{TEAM_CODE.home}</b>
          <b className="ms-final">{d ? `${d.final[0]} – ${d.final[1]}` : ''}</b>
          <b className="ms-code">{TEAM_CODE.away}</b><Crest team="away" size={30} />
        </div>
        <span className="ms-ft">Full time</span>
        <button type="button" className="ms-close" aria-label="Close the match summary" onClick={close}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M1 1 L13 13 M13 1 L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </header>
      <nav className="ms-tabs" role="tablist">
        {PAGES.map((p, i) => <button key={p.key} type="button" role="tab" aria-selected={i === page} className={i === page ? 'on' : undefined} onClick={() => setPage(i)}>{p.label}</button>)}
      </nav>
      {SUB[P.key] && <p className="ms-sub">{SUB[P.key]}</p>}
      <div key={P.key} className={`ms-body ms-body-${P.key}`}>{d ? P.draw(d, who, portrait) : <p className="ms-wait">Loading the match</p>}</div>
      {AUTO_TURN && <i className="ms-progress"><i ref={bar} /></i>}
      {/* the venue, the time, the weather: a thin strip under the pages, no gap; text only, as "Full time" is (Yi, 2026-10-27) */}
      <footer className="ms-strip" aria-label="Venue">{`${VENUE.name}  |  Kick-off ${VENUE.kickoff}  |  ${VENUE.weather}, ${VENUE.tempC}°C`}</footer>
    </div>
  );
}
