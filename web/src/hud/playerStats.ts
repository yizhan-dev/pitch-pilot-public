// Per-player numbers for the player card, from the clip package. Players are indexed as in the package: attackers
// first, then defenders (the same order as makeLooks and settings.selected).
import type { ClipPkg } from './match';
import { tr } from '../i18n';
import { SHOT_TYPES } from '../football/events';

export const nAttOf = (pkg: ClipPkg) => pkg.frames[0]?.att.length ?? 11;
export const playersOf = (pkg: ClipPkg) => (pkg.frames[0] ? pkg.frames[0].att.length + pkg.frames[0].def.length : 22);

const posAt = (pkg: ClipPkg, k: number, p: number, nAtt: number) => (p < nAtt ? pkg.frames[k].att[p] : pkg.frames[k].def[p - nAtt]);

/** Instant stamina, 0-100, for every player at every frame (real, from the tracking). Speed over a 0.4 s window becomes
 *  an intensity, 0 at 2 m/s (walking) to 1 at 7 m/s (MA45's sprint band, 25.2 km/h); its moving average over about 8 s
 *  is the recent load, and the stamina is 100 x (1 - 0.75 x load). It drops in a sprint and comes back within seconds
 *  of slowing down. The average starts from the clip's first 8 s, so the opening frames are not artificially fresh. */
export function instantStamina(pkg: ClipPkg): Float32Array[] {
  const F = pkg.frames.length, fps = pkg.meta.fps, nAtt = nAttOf(pkg), P = playersOf(pkg), dt = 1 / fps, tau = 8, W = 2;
  return Array.from({ length: P }, (_, p) => {
    const I = new Float32Array(F);
    for (let k = 0; k < F; k++) {
      const a = Math.max(0, k - W), b = Math.min(F - 1, k + W), pa = posAt(pkg, a, p, nAtt), pb = posAt(pkg, b, p, nAtt);
      const v = b > a ? Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) / ((b - a) * dt) : 0;
      I[k] = Math.min(1, Math.max(0, (v - 2) / 5));
    }
    const warm = Math.min(F, Math.round(tau * fps));
    let L = 0; for (let k = 0; k < warm; k++) L += I[k] / warm;
    const out = new Float32Array(F);
    for (let k = 0; k < F; k++) { L += (I[k] - L) * (dt / tau); out[k] = 100 * (1 - 0.75 * L); }
    return out;
  });
}

/** a per-frame series at clock time t (seconds from the clip's start), interpolated */
export function sampleAt(series: Float32Array, t: number, fps: number) {
  const x = Math.min(series.length - 1, Math.max(0, t * fps)), k = Math.floor(x), f = x - k;
  return k + 1 < series.length ? series[k] * (1 - f) + series[k + 1] * f : series[k];
}

/** Match stamina, 0-100: EXAMPLE VALUES until the whole-match tracking pass exists (it needs every player's distance
 *  and high-speed distance from kick-off; see docs/plans/hud-notes.md). Each player loses a fixed share by full time,
 *  22-38 points for outfield players and 8-12 for keepers, a little faster late in the match. */
export function matchStaminaExample(p: number, keeper: boolean, matchClock: number) {
  const u = (Math.sin(p * 12.9898 + 78.233) * 43758.5453) % 1, frac = Math.abs(u);
  const drop = keeper ? 8 + 4 * frac : 22 + 16 * frac;
  return Math.max(5, 100 - drop * Math.pow(Math.min(1.1, matchClock / 5400), 1.15));
}

/** the bar's colour band: green from 60, yellow from 35, red below */
export const staminaBand = (v: number) => (v >= 60 ? 'ok' : v >= 35 ? 'warn' : 'bad');

/** speed in km/h at clock time t (seconds from the clip's start), over a 0.4 s window of the 10 Hz positions (real) */
export function speedAt(pkg: ClipPkg, p: number, t: number) {
  const F = pkg.frames.length, fps = pkg.meta.fps, nAtt = nAttOf(pkg), k = Math.min(F - 1, Math.max(0, Math.round(t * fps)));
  const a = Math.max(0, k - 2), b = Math.min(F - 1, k + 2);
  if (b <= a) return 0;
  const pa = posAt(pkg, a, p, nAtt), pb = posAt(pkg, b, p, nAtt);
  return (Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) / ((b - a) / fps)) * 3.6;
}

/** a rough role: 门将 from the package's keepers; the outfield players ranked by their mean depth in the clip, measured
 *  from their own goal (the attackers attack +x), the deepest four 后卫, the next four 中场, the most advanced 前锋. A guess
 *  from one clip's tracking, to choose the card's default stats; to be replaced by the line-ups when exported. */
export type Role = '门将' | '后卫' | '中场' | '前锋';
export function estimateRoles(pkg: ClipPkg, keepers: number[]): Role[] {
  const nAtt = nAttOf(pkg), P = playersOf(pkg), F = pkg.frames.length;
  const depth = Array.from({ length: P }, (_, p) => {
    let sx = 0; for (let k = 0; k < F; k++) sx += posAt(pkg, k, p, nAtt)[0];
    const x = sx / F; return p < nAtt ? x + 52.5 : 52.5 - x;
  });
  const roles: Role[] = Array.from({ length: P }, (_, p) => (keepers.includes(p) ? '门将' : '中场'));
  for (const team of [[0, nAtt], [nAtt, P]] as const) {
    const out = Array.from({ length: team[1] - team[0] }, (_, i) => team[0] + i).filter((p) => !keepers.includes(p)).sort((a, b) => depth[a] - depth[b]);
    const n = out.length, nDf = Math.round(n * 0.4), nFw = Math.round(n * 0.2);
    out.forEach((p, i) => { roles[p] = i < nDf ? '后卫' : i >= n - nFw ? '前锋' : '中场'; });
  }
  return roles;
}

export interface MatchStats {
  distanceKm: number; topSpeed: number; sprints: number; touches: number;
  /** completed, attempted */
  passes: [number, number]; keyPasses: number;
  /** completed, attempted */
  dribbles: [number, number];
  /** shots, on target (Yi: 射门 needs 射正 too) */
  shots: [number, number]; xg: number;
  /** won, attempted */
  tackles: [number, number]; interceptions: number; clearances: number;
  /** won, contested */
  aerials: [number, number];
  saves: number; claims: number;
  /** for the full table */
  highSpeedKm: number;
  /** distance by MA45's speed bands, km: walk, jog, run, high-speed run, sprint */
  bands: [number, number, number, number, number];
  assists: number; crosses: [number, number]; longBalls: [number, number]; blocks: number; fouls: number; fouled: number;
}

/** per-90 rates by role, [low, high]; a player's own rate is drawn between them from his index */
const RATES: Record<Role, Record<string, [number, number]>> = {
  门将: { m: [45, 60], top: [20, 24], spr: [0, 0], tch: [30, 42], pas: [25, 35], acc: [0.6, 0.8], key: [0, 0.1], drb: [0, 0], shot: [0, 0], tkl: [0, 0.2], int: [0.2, 0.6], clr: [0.5, 1.5], aer: [0.5, 1.5], sav: [2, 4], clm: [1, 2], ast: [0, 0], crs: [0, 0], lng: [6, 12], blk: [0, 0.2], fl: [0, 0.3], fld: [0.1, 0.4] },
  后卫: { m: [100, 115], top: [28, 33], spr: [15, 25], tch: [60, 80], pas: [45, 70], acc: [0.82, 0.92], key: [0.1, 0.5], drb: [0.3, 1], shot: [0.3, 0.6], tkl: [2, 4], int: [1.5, 3], clr: [3, 6], aer: [3, 6], sav: [0, 0], clm: [0, 0], ast: [0, 0.1], crs: [0.3, 2], lng: [3, 6], blk: [0.5, 1.2], fl: [0.8, 1.5], fld: [0.5, 1] },
  中场: { m: [110, 130], top: [28, 33], spr: [15, 30], tch: [60, 90], pas: [50, 80], acc: [0.8, 0.9], key: [1, 2], drb: [1.5, 3], shot: [1, 2], tkl: [2, 3.5], int: [1, 2], clr: [0.5, 1.5], aer: [1.5, 3], sav: [0, 0], clm: [0, 0], ast: [0.1, 0.3], crs: [0.5, 2.5], lng: [2, 5], blk: [0.3, 0.8], fl: [1, 1.8], fld: [1, 2] },
  前锋: { m: [100, 120], top: [29, 34], spr: [20, 35], tch: [35, 55], pas: [20, 35], acc: [0.7, 0.82], key: [1, 2], drb: [2, 5], shot: [2, 4], tkl: [0.5, 1.5], int: [0.2, 0.6], clr: [0.2, 0.5], aer: [3, 6], sav: [0, 0], clm: [0, 0], ast: [0.1, 0.4], crs: [0.3, 1.5], lng: [0.5, 1.5], blk: [0.1, 0.3], fl: [0.8, 1.6], fld: [1, 2.5] },
};

/** This match up to matchClock: EXAMPLE VALUES until the whole-match tracking pass and the synced events per package
 *  player exist (see docs/plans/hud-notes.md). Each player has fixed per-minute rates for his role, drawn from his index,
 *  so the numbers grow plausibly through the match and stay put when the clip is replayed. */
export function matchStatsExample(p: number, role: Role, matchClock: number): MatchStats {
  const r = (k: number) => Math.abs((Math.sin(p * 12.9898 + k * 78.233) * 43758.5453) % 1), min = Math.max(0, matchClock / 60), R = RATES[role];
  const pick = (key: string, k: number) => R[key][0] + (R[key][1] - R[key][0]) * r(k);
  const count = (key: string, k: number) => Math.floor((min * pick(key, k)) / 90 + r(k + 40) * 0.9);
  const share = (n: number, lo: number, hi: number, k: number) => Math.round(n * (lo + (hi - lo) * r(k)));
  const pas = count('pas', 2), drb = count('drb', 3), shot = count('shot', 4), tkl = count('tkl', 5), aer = count('aer', 6);
  const crs = count('crs', 21), lng = count('lng', 22), distanceKm = (min * pick('m', 1)) / 1000;
  // shares of distance by speed band; keepers mostly walk
  const raw = role === '门将' ? [0.6, 0.3, 0.08, 0.02, 0.005] : [0.25 + 0.1 * r(23), 0.3 + 0.08 * r(24), 0.18 + 0.07 * r(25), 0.06 + 0.04 * r(26), 0.03 + 0.03 * r(27)];
  const sum = raw.reduce((a, b) => a + b, 0), bands = raw.map((x) => (distanceKm * x) / sum) as MatchStats['bands'];
  return {
    distanceKm, topSpeed: pick('top', 7), sprints: count('spr', 8), touches: count('tch', 9),
    passes: [Math.round(pas * pick('acc', 10)), pas], keyPasses: count('key', 11),
    dribbles: [share(drb, 0.4, 0.6, 12), drb],
    shots: [shot, share(shot, 0.3, 0.5, 13)], xg: shot * (0.08 + 0.06 * r(14)),
    tackles: [share(tkl, 0.55, 0.75, 15), tkl], interceptions: count('int', 16), clearances: count('clr', 17),
    aerials: [share(aer, role === '后卫' ? 0.5 : 0.38, role === '后卫' ? 0.7 : 0.55, 18), aer],
    saves: count('sav', 19), claims: count('clm', 20),
    highSpeedKm: bands[3] + bands[4], bands,
    assists: count('ast', 28), crosses: [share(crs, 0.2, 0.35, 29), crs], longBalls: [share(lng, 0.45, 0.7, 30), lng],
    blocks: count('blk', 31), fouls: count('fl', 32), fouled: count('fld', 33),
  };
}

/** one entry of the card's stats. trend: -3..3, how far he stands from the usual for his role (arrows beside it) */
export interface StatEntry { label: string; value: string; unit?: string; trend: number }

export type StatKey = 'dist' | 'hsr' | 'spr' | 'top' | 'tch' | 'pas' | 'acc' | 'drb' | 'lng' | 'key' | 'ast' | 'shot' | 'xg' | 'tkl' | 'int' | 'clr' | 'aer' | 'sav' | 'con' | 'clm' | 'svp';

/** arrows from a z-score: one from 1.0, two from 1.6, three from 2.3, signed */
const arrows = (z: number) => { const a = Math.abs(z), n = a >= 2.3 ? 3 : a >= 1.6 ? 2 : a >= 1 ? 1 : 0; return Math.sign(z) * n; };
const mid = (r: [number, number]) => (r[0] + r[1]) / 2, half = (r: [number, number]) => (r[1] - r[0]) / 2;

/** Every entry the card can show, with its arrows (FM style, Yi 2026-10-22). The reference is the usual for his role
 *  (RATES): his match so far, against what a typical player in that role would have by now. Counts allow for chance
 *  (Poisson) as well as the spread between players, so a single early shot does not earn three arrows; no arrows on
 *  counts before 15 minutes. 失球 is the one where fewer is better. On example data the arrows are examples too. */
export function statCatalogue(role: Role, s: MatchStats, conceded: number, matchClock: number): Record<StatKey, StatEntry> {
  // keepers' running says nothing good or bad about them, so no arrows on their physical entries
  const R = RATES[role], min = Math.max(0, matchClock / 60), early = min < 15, gk = role === '门将';
  const count = (x: number, key: string) => {
    if (early || R[key][1] === 0) return 0;
    const e = (mid(R[key]) * min) / 90, sp = (half(R[key]) * min) / 90, sd = Math.sqrt(e + sp * sp) || 1;
    return arrows((x - e) / sd);
  };
  const rate = (x: number, m: number, sd: number) => arrows((x - m) / (sd || 1));
  const share = (a: number, b: number) => (b ? a / b : 0);
  const accSd = (n: number) => Math.sqrt(half(R.acc) ** 2 + (n ? (mid(R.acc) * (1 - mid(R.acc))) / n : 1));
  const goalsAgainst = (1.3 * min) / 90, saveShare = share(s.saves, s.saves + conceded);
  const E = (label: string, value: string, trend: number, unit?: string): StatEntry => ({ label, value, unit, trend });
  return {
    dist: E(tr('跑动距离', 'Distance'), s.distanceKm.toFixed(1), early || gk ? 0 : rate(s.distanceKm, (mid(R.m) * min) / 1000, (half(R.m) * min) / 1000), 'km'),
    // high-speed share of distance: about 12% for outfield players (keepers get no arrows here)
    hsr: E(tr('高速跑', 'High-speed'), s.highSpeedKm.toFixed(2), early || gk ? 0 : rate(s.highSpeedKm, (mid(R.m) * min * 0.12) / 1000, (mid(R.m) * min * 0.04) / 1000), 'km'),
    spr: E(tr('冲刺', 'Sprints'), String(s.sprints), gk ? 0 : count(s.sprints, 'spr')),
    top: E(tr('最高速度', 'Top speed'), s.topSpeed.toFixed(1), role === '门将' ? 0 : rate(s.topSpeed, mid(R.top), half(R.top)), 'km/h'),
    tch: E(tr('触球', 'Touches'), String(s.touches), count(s.touches, 'tch')),
    pas: E(tr('传球', 'Passes'), `${s.passes[0]}/${s.passes[1]}`, count(s.passes[1], 'pas')),
    acc: E(tr('成功率', 'Accuracy'), s.passes[1] ? String(Math.round(100 * share(...s.passes))) : '–', s.passes[1] < 5 ? 0 : rate(share(...s.passes), mid(R.acc), accSd(s.passes[1])), '%'),
    drb: E(tr('过人', 'Dribbles'), `${s.dribbles[0]}/${s.dribbles[1]}`, count(s.dribbles[0], 'drb')),
    lng: E(tr('长传', 'Long balls'), `${s.longBalls[0]}/${s.longBalls[1]}`, count(s.longBalls[1], 'lng')),
    key: E(tr('关键传球', 'Key passes'), String(s.keyPasses), count(s.keyPasses, 'key')),
    ast: E(tr('助攻', 'Assists'), String(s.assists), count(s.assists, 'ast')),
    // on target / all, as the other pairs read (passes completed / played): Shots 1/2 (Yi, 2026-10-23: "Shots (on target)
    // 1 (0)" ran too wide, worse with two digits)
    shot: E('Shots', `${s.shots[1]}/${s.shots[0]}`, count(s.shots[0], 'shot')),
    xg: E(tr('预期进球', 'xG'), s.xg.toFixed(2), early || R.shot[1] === 0 ? 0 : rate(s.xg, (mid(R.shot) * 0.11 * min) / 90, Math.sqrt((mid(R.shot) * 0.11 * min) / 90 * 0.3) || 1)),
    tkl: E(tr('抢断', 'Tackles'), `${s.tackles[0]}/${s.tackles[1]}`, count(s.tackles[0], 'tkl')),
    int: E(tr('拦截', 'Interceptions'), String(s.interceptions), count(s.interceptions, 'int')),
    clr: E(tr('解围', 'Clearances'), String(s.clearances), count(s.clearances, 'clr')),
    aer: E(tr('争顶', 'Aerials'), `${s.aerials[0]}/${s.aerials[1]}`, count(s.aerials[0], 'aer')),
    sav: E(tr('扑救', 'Saves'), String(s.saves), count(s.saves, 'sav')),
    con: E(tr('失球', 'Conceded'), String(conceded), early ? 0 : -arrows((conceded - goalsAgainst) / Math.sqrt(goalsAgainst || 1))),
    clm: E(tr('出击', 'Claims'), String(s.claims), count(s.claims, 'clm')),
    svp: E(tr('扑救率', 'Save rate'), s.saves + conceded ? String(Math.round(100 * saveShare)) : '–', s.saves + conceded < 3 ? 0 : rate(saveShare, 0.7, Math.sqrt(0.15 ** 2 + 0.21 / (s.saves + conceded))), '%'),
  };
}

/** the card's default eight keys, two columns by four rows, chosen by role (Yi: defenders and attackers differ); each a
 *  subset of the full stats' sixteen */
export const DEFAULT_KEYS: Record<Role, StatKey[]> = {
  前锋: ['dist', 'top', 'spr', 'tch', 'xg', 'shot', 'drb', 'key'],   // shots in the right column with top speed: the two longest English rows side by side overflowed the card
  中场: ['dist', 'top', 'spr', 'pas', 'key', 'shot', 'tkl', 'int'],
  后卫: ['dist', 'top', 'spr', 'pas', 'tkl', 'int', 'clr', 'aer'],
  门将: ['dist', 'top', 'sav', 'con', 'pas', 'clm', 'clr', 'tch'],
};

/** the full stats' four groups of four, by what the player is doing; keepers get 门将 in place of 进攻 */
export function fullGroups(role: Role): { title: string; keys: StatKey[] }[] {
  const keeper = role === '门将';
  return [
    { title: tr('跑动', 'Running'), keys: ['dist', 'hsr', 'spr', 'top'] },
    { title: tr('持球', 'On the ball'), keys: ['tch', 'pas', 'acc', keeper ? 'lng' : 'drb'] },
    keeper ? { title: tr('门将', 'Goalkeeping'), keys: ['sav', 'con', 'clm', 'svp'] } : { title: tr('进攻', 'Attack'), keys: ['key', 'ast', 'shot', 'xg'] },
    { title: tr('防守', 'Defence'), keys: ['tkl', 'int', 'clr', 'aer'] },
  ];
}

// ---- real data from the 3D side's export (2026-10-22): line-up, running, synced match events --------------------------

/** the side's shape in one phase, as the card needs it: MA33's label (e.g. '4-2-3-1 Off. FB'), the coarse formation
 *  (e.g. '4-5-1') and the role codes the side's players had in it */
export interface PhaseShape { label: string; formation: string; codes: Set<string> }

/** a position as eFootball writes it (Yi, 2026-10-23: short enough for the card, and the codes players know): GK, CB,
 *  LB, RB, DMF, CMF, LMF, RMF, AMF, LWF, RWF, CF (SS has no MA33 counterpart). From an Opta MA33 role code and the
 *  side's shape in that phase, since some codes depend on it: wide players (W) are wing forwards when theirs is the
 *  front line (a formation ending in 3 or 4: 4-3-3, 4-2-1-3, 4-2-4, 3-4-3), else wide midfielders (4-4-2, 4-2-3-1 as
 *  4-5-1; Yi, 2026-10-23: a 4-2-3-1's winger is RMF, a 4-2-1-3's RWF);
 *  a lone CM is the holding DMF; the pair CM.L/CM.R is a double pivot (DMF) in a 4-2-… or 3-2-… shape, else CMF;
 *  F.L/F.R beside a centre forward (F) are wing forwards, else a front two of CFs; wing-backs are LMF/RMF, as eFootball
 *  has no wing-back (its back-three formations put LMF/RMF on the flanks). Checked on every shape in the 41 clips */
export function efPosition(code: string, shape?: PhaseShape | null): string {
  const front = Number((shape?.formation ?? '').split('-').pop()) >= 3, pivot = /^\d-2-/.test(shape?.label ?? '');
  switch (code) {
    case 'CB': case 'CB.L': case 'CB.R': return 'CB';
    case 'FB.L': return 'LB';
    case 'FB.R': return 'RB';
    case 'WB.L': return 'LMF';
    case 'WB.R': return 'RMF';
    case 'CM': return 'DMF';
    case 'CM.L': case 'CM.R': return pivot && !shape?.codes.has('CM') ? 'DMF' : 'CMF';
    case 'CM.A': case 'CM.LA': case 'CM.RA': return 'AMF';
    case 'W.L': return front ? 'LWF' : 'LMF';
    case 'W.R': return front ? 'RWF' : 'RMF';
    case 'F.L': return shape?.codes.has('F') ? 'LWF' : 'CF';
    case 'F.R': return shape?.codes.has('F') ? 'RWF' : 'CF';
    case 'F': return 'CF';
    default: return code;
  }
}

/** a player's position from the export's line-up (Opta MA2 `position`/`side`, MA45 `detail`), as an eFootball code,
 *  and the stats group it uses. Left/Centre and Centre/Right are inner positions. The wide attacking midfielders take
 *  LMF/RMF, as efPosition gives a 4-2-3-1's wingers. null where the export has no line-up for him. */
export function roleFromLineup(e: { position: string; side: string; detail: string } | null | undefined): { label: string; role: Role } | null {
  if (!e) return null;
  const side = e.side === 'Left' ? 'L' : e.side === 'Right' ? 'R' : '';
  switch (e.detail || e.position) {
    case 'Goalkeeper': return { label: 'GK', role: '门将' };
    case 'Defender': return { label: side ? `${side}B` : 'CB', role: '后卫' };
    case 'Wing Back': return { label: side ? `${side}MF` : 'CMF', role: '后卫' };
    case 'Defensive Midfielder': return { label: 'DMF', role: '中场' };
    case 'Midfielder': return { label: side ? `${side}MF` : 'CMF', role: '中场' };
    case 'Attacking Midfielder': return { label: side ? `${side}MF` : 'AMF', role: '前锋' };
    case 'Striker': case 'Forward': return { label: 'CF', role: '前锋' };
    default: return null;
  }
}

/** the card's position for a stats group when nothing better is known (the estimate from the tracking) */
export const ROLE_POSITION: Record<Role, string> = { 门将: 'GK', 后卫: 'CB', 中场: 'CMF', 前锋: 'CF' };

/** a player's position from what he really played (the export's `roles`, Opta MA33, Yi 2026-10-22), as an eFootball
 *  code: the one in his side's phase in this clip, in possession for the attackers, out of it for the defenders. The
 *  other phase's position is not shown (Yi, 2026-10-23: a winger who presses beside the striker read "Out of
 *  possession: CF"; that belongs to 讲解, told in words). `shapes` is his side's shape in each phase. Stats group from
 *  the role. null where the export has none (keepers, a shirt the tracking mislabelled), so the line-up takes over. */
export function roleFromShape(r: { in: string | null; out: string | null } | null | undefined, attacking: boolean, shapes?: Partial<Record<'in' | 'out', PhaseShape>>): { label: string; role: Role } | null {
  if (!r) return null;
  const ph = attacking ? 'in' : 'out', code = r[ph];
  if (!code) return null;
  const role: Role = /^(CB|FB|WB)/.test(code) ? '后卫' : /^CM(\.L|\.R)?$/.test(code) ? '中场' : '前锋';
  return { label: efPosition(code, shapes?.[ph]), role };
}

/** a per-second cumulative series at clip time t (seconds), interpolated */
function atSecond(series: number[] | undefined, t: number, hz: number) {
  if (!series?.length) return 0;
  const x = Math.min(series.length - 1, Math.max(0, t * hz)), k = Math.floor(x), f = x - k;
  return k + 1 < series.length ? series[k] * (1 - f) + series[k + 1] * f : series[k];
}

const SHOTS = SHOT_TYPES;   // the shared list (../football/events.ts)
const ON_BALL = new Set(['Pass', 'BallTouch', 'TakeOn', 'BallRecovery', 'Clearance', 'Interception', 'Dispossessed', 'KeeperPickup', 'Save', ...SHOTS]);

/** This match up to clip time t, measured: distance and high-speed distance (above 20 km/h; about 8% under MA45's figure,
 *  speed bands not reconciled) from `run`, the counts from `match_events`. Assists are passes tagged Assist that a
 *  team-mate's goal follows within 20 s (a shot's IntentionalGoalAssist tag means the shot was assisted, not that the
 *  shooter assisted). Top speed (the fastest second so far) and sprints come from `run` too where the package has them
 *  (since 2026-10-28; Yi: it showed a fixed example from the first second); the speed bands stay `fallback` (examples). */
export function realStats(pkg: ClipPkg, p: number, t: number, fallback: MatchStats): MatchStats {
  const now = (pkg.clock0 ?? 0) + t, nAtt = nAttOf(pkg), all = pkg.match_events?.players ?? [];
  const ev = (all[p] ?? []).filter((e) => e[0] <= now);
  const count = (f: (e: (typeof ev)[number]) => boolean) => ev.filter(f).length;
  const pair = (f: (e: (typeof ev)[number]) => boolean): [number, number] => { const xs = ev.filter(f); return [xs.filter((e) => e[2] === 1).length, xs.length]; };
  const mates = all.filter((_, q) => (q < nAtt) === (p < nAtt));
  const goalsAfter = (c: number) => mates.some((pl) => pl.some((e) => e[1] === 'Goal' && e[0] > c && e[0] <= c + 20 && e[0] <= now));
  const shots = ev.filter((e) => SHOTS.has(e[1])), hz = pkg.run?.hz ?? 1;
  const tackles = count((e) => e[1] === 'Tackle'), tried = tackles + count((e) => e[1] === 'Attempted tackle');
  const dist = pkg.run ? atSecond(pkg.run.dist[p], t, hz) / 1000 : fallback.distanceKm;
  const hsr = pkg.run ? atSecond(pkg.run.hsr[p], t, hz) / 1000 : fallback.highSpeedKm;
  // the running maximum and the count change only at a second's mark: the value of the second reached, not a blend
  const step = (s: number[] | undefined) => (s?.length ? s[Math.min(s.length - 1, Math.max(0, Math.floor(t * hz)))] : null);
  const top = step(pkg.run?.top?.[p]), spr = step(pkg.run?.spr?.[p]);
  return {
    ...fallback,
    distanceKm: dist, highSpeedKm: hsr,
    topSpeed: top ?? fallback.topSpeed, sprints: spr ?? fallback.sprints,
    touches: count((e) => ON_BALL.has(e[1])),
    passes: pair((e) => e[1] === 'Pass'),
    keyPasses: count((e) => e[1] === 'Pass' && (e[4].includes('KeyPass') || e[4].includes('Assist'))),
    assists: count((e) => e[1] === 'Pass' && e[4].includes('Assist') && goalsAfter(e[0])),
    dribbles: pair((e) => e[1] === 'TakeOn'),
    shots: [shots.length, shots.filter((e) => e[1] === 'SavedShot' || e[1] === 'Goal').length],
    xg: shots.reduce((a, e) => a + (e[3] ?? 0), 0),
    tackles: [tackles, tried], interceptions: count((e) => e[1] === 'Interception'), clearances: count((e) => e[1] === 'Clearance'),
    aerials: pair((e) => e[1] === 'Aerial'),
    saves: count((e) => e[1] === 'Save'), claims: count((e) => e[1] === 'KeeperSweeper' || e[1] === 'Claim' || e[1] === 'Punch'),
    longBalls: pair((e) => e[1] === 'Pass' && e[4].includes('Longball')), crosses: pair((e) => e[1] === 'Pass' && e[4].includes('Cross')),
    blocks: count((e) => e[1] === 'BlockedPass'), fouls: count((e) => e[1] === 'Foul' && e[2] === 0), fouled: count((e) => e[1] === 'Foul' && e[2] === 1),
  };
}

/** Match stamina from the measured running (a PROPOSAL until Yi sets the formula): the load is 0.6 x distance over a typical
 *  full match plus 0.4 x high-speed distance over a typical full match (outfield 10.5 km and 0.8 km, keepers 5.5 km and
 *  0.05 km), and the bar loses 30 points per full match's load, so a typical player ends the 90 minutes near 70. */
export function matchStaminaReal(pkg: ClipPkg, p: number, keeper: boolean, t: number) {
  const hz = pkg.run?.hz ?? 1, d = atSecond(pkg.run?.dist[p], t, hz), h = atSecond(pkg.run?.hsr[p], t, hz);
  const [D, H] = keeper ? [5500, 50] : [10500, 800];
  return Math.max(5, Math.min(100, 100 - 30 * (0.6 * (d / D) + 0.4 * (h / H))));
}
