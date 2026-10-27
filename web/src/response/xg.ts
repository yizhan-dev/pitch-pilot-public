// Defender-aware expected goals in the browser: the same computation as engine/xg_freeze.py (a logistic regression,
// faded to 0 below a 3-degree view of the goal mouth), so moving a defender or the keeper changes a shooter's chance
// live. The model is engine/data/xg_freeze.json, fit on StatsBomb open-data shot freeze frames by
// probe/fit_xg_freeze.py (research use; credit StatsBomb with its logo in any published build).
// Coordinates are metres: pitch 105 x 68, origin at the centre spot, the shooting team attacks +x, goal centre (52.5, 0).
// Opponents are the defending team's outfield players; the keeper comes separately (null when his position is unknown;
// for an empty net pass his real, distant position). Feature definitions are in the JSON.
// No imports, and type annotations only, so node can run it directly for the parity test (web/scripts/xg_parity.ts).

export type XgPoint = readonly [number, number];

/** engine/data/xg_freeze.json (the fields used here) */
export interface XgFreezeModel {
  features: string[];
  intercept: number;
  weights: number[];
  params: {
    goal_x: number; post_y: number; body_half_width_m: number; keeper_half_width_m: number;
    pressure_radius_m: number; keeper_depth_free_m: number; keeper_depth_cap_m: number; angle_fade_rad: number;
  };
}

/** directions hidden by a body of the given half-width at (px, py), seen from the shooter, cut to the goal mouth */
function hidden(sx: number, sy: number, px: number, py: number, halfWidth: number, gateLo: number, gateHi: number): [number, number] {
  const vx = px - sx, vy = py - sy, r = Math.hypot(vx, vy);
  const theta = r > 0 ? Math.atan2(vy, vx) : 0, half = Math.atan2(halfWidth, r);
  return [Math.max(theta - half, gateLo), Math.min(theta + half, gateHi)];
}

/** the shot's technique, for a model fit with StatsBomb's labels (xg_shot.json, private/response/fit_xg_shot.py,
 *  2026-10-25): `volley` the ball struck off the ground (Volley, Half Volley, Overhead Kick), `firstTime` struck as it
 *  came; a model without those features ignores them */
export interface XgTech { volley?: boolean; firstTime?: boolean }

function allFeatures(P: XgFreezeModel['params'], shooter: XgPoint, header: boolean, opponents: readonly XgPoint[],
  keeper: XgPoint | null, setPiece: boolean, tech: XgTech = {}): Record<string, number> {
  const gx = P.goal_x, h = P.post_y, R = P.pressure_radius_m;
  const sx = Math.min(shooter[0], gx), sy = shooter[1];
  const dx = gx - sx, dy = sy, dist = Math.hypot(dx, dy);
  const ang = Math.abs(Math.atan2(dy + h, dx) - Math.atan2(dy - h, dx));
  const gateLo = Math.atan2(-h - sy, dx), gateHi = Math.atan2(h - sy, dx);
  const flat = ang <= 1e-9;               // on the goal line outside the posts: the mouth is a single direction

  const spans: [number, number][] = [];
  let touch = false, nearest = Infinity;
  for (const o of opponents) {
    const ox = Math.min(o[0], gx), oy = o[1];
    const s = hidden(sx, sy, ox, oy, P.body_half_width_m, gateLo, gateHi);
    if (s[1] > s[0]) spans.push(s);
    touch = touch || s[0] <= s[1];
    nearest = Math.min(nearest, Math.hypot(ox - sx, oy - sy));
  }
  spans.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  let hid = 0, end = -Infinity;
  for (const [lo, hi] of spans) { hid += Math.max(0, hi - Math.max(lo, end)); end = Math.max(end, hi); }
  const blocked = flat ? (touch ? 1 : 0) : hid / ang;

  let cover = 0, depth = 0, kpress = 0, noKeeper = 1;
  if (keeper) {
    const kx = Math.min(keeper[0], gx), ky = keeper[1];
    const [lo, hi] = hidden(sx, sy, kx, ky, P.keeper_half_width_m, gateLo, gateHi);
    cover = flat ? (lo <= hi ? 1 : 0) : Math.max(0, hi - lo) / ang;
    depth = Math.min(Math.max((gx - kx) - P.keeper_depth_free_m, 0), P.keeper_depth_cap_m - P.keeper_depth_free_m);
    kpress = Math.max(0, 1 - Math.hypot(kx - sx, ky - sy) / R);
    noKeeper = 0;
  }
  return {
    distance_m: dist, opening_angle_rad: ang, log1p_distance: Math.log1p(dist), header: header ? 1 : 0,
    set_piece: setPiece ? 1 : 0, blocked_fraction: blocked, pressure: Math.max(0, 1 - nearest / R),
    keeper_cover: cover, keeper_depth: depth, keeper_pressure: kpress, no_keeper: noKeeper,
    volley: tech.volley ? 1 : 0, first_time: tech.firstTime ? 1 : 0,
  };
}

/** the model's features, in model.features order */
export function xgFreezeFeatures(model: XgFreezeModel, shooter: XgPoint, header: boolean, opponents: readonly XgPoint[],
  keeper: XgPoint | null, setPiece = false, tech: XgTech = {}): number[] {
  const f = allFeatures(model.params, shooter, header, opponents, keeper, setPiece, tech);
  return model.features.map((k) => {
    if (!(k in f)) throw new Error(`xg.ts: unknown feature ${k}`);
    return f[k];
  });
}

/** the chance the shot scores: shooter (x, y), header or foot, outfield opponents, the keeper or null, direct free kick */
export function xgFreeze(model: XgFreezeModel, shooter: XgPoint, header: boolean, opponents: readonly XgPoint[],
  keeper: XgPoint | null, setPiece = false, tech: XgTech = {}): number {
  const f = allFeatures(model.params, shooter, header, opponents, keeper, setPiece, tech);
  let z = model.intercept;
  model.features.forEach((k, i) => {
    if (!(k in f)) throw new Error(`xg.ts: unknown feature ${k}`);
    z += model.weights[i] * f[k];
  });
  return (1 / (1 + Math.exp(-z))) * Math.min(1, f.opening_angle_rad / model.params.angle_fade_rad);
}
