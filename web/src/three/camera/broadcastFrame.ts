// The broadcast camera's framing (a pan-tilt head that turns and zooms rather than a camera that shifts; a shifting
// one lost the taker at a corner, and near the goal the space in front of the man on the ball): a head fixed in the main stand over the halfway line, as a TV match's main
// camera, that only pans, tilts and zooms. Each moment names the points the shot must hold, each inside its own share of
// the frame (the ball well inside, where it is heading, the room in front of the man on the ball, the goal he attacks
// once it is near, the men round the ball), and the aim and zoom are solved as the narrowest shot that holds them all,
// centred as near the play's focus as that allows. Camera/Director.tsx adds the operator's lazy follow on top; the
// pre-match show (lineup/LineupShow.tsx) uses the same solve for its last shot when it runs on its own.
// Scene axes: x along the pitch, y up, z across (the package's y); the main stand is on +z.

/** the head: over the halfway line in the main stand, 26 m beyond the near touchline (z 34) and 24 m up */
export const HEAD = { x: 0, y: 24, z: 60 } as const;

/** a point the shot must hold: scene metres, and the share of the half-frame it may reach from the centre (0..1) */
export interface FramePoint { x: number; y: number; z: number; m: number }
/** a shot from the head: pan (radians from looking straight across, -z, towards +x), tilt (down), and the zoom as the
 *  tangent of half the horizontal angle */
export interface Aim { yaw: number; pitch: number; w: number }

/** how wide the shot goes, in priority order: never tighter than `min` metres across at the focus; as wide as the play
 *  near it is spread up to `spreadDeg` (the lens's vertical angle: near the main stand the same metres take a wider
 *  lens); the men round the ball and the box only while the lens stays within `menDeg`; the room ahead and the goal
 *  within `wantDeg` (always at a corner, or with the ball within GOAL_CLOSE_M of the goal); the ball and its heading
 *  always, up to `hard` metres. A tier dropped comes back once it fits `backDeg` under its limit. The old rail camera
 *  went to about 34 degrees */
export const WIDTH = { min: 30, spreadDeg: 28, menDeg: 32, wantDeg: 36, backDeg: 3, hard: 96 };
/** the shares of the half-frame (from the centre): the ball, where it is in LEAD_S, the room ahead and the goal, the men */
export const SHARE = { ball: 0.72, heading: 0.9, ahead: 0.9, goal: 0.94, men: 0.92 };
const LEAD_S = 0.7, AHEAD_M = 14, NEAR_M = 12, GOAL_NEAR_M = 32, GOAL_CLOSE_M = 22, GOAL_X = 52.5, POST_Z = 3.66, BAR_Y = 2.44;
const BOX = { x: 16.5 + 2, z: 20.16 + 2 }, THREE_DEG = 180 / Math.PI;

type V = { x: number; y: number; z: number };
const f = { x: 0, y: 0, z: 0 }, r = { x: 0, y: 0, z: 0 }, u = { x: 0, y: 0, z: 0 };
/** the camera's axes for an aim, no roll: forward f, right r, up u */
export function axes(yaw: number, pitch: number) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  f.x = sy * cp; f.y = -sp; f.z = -cy * cp;
  r.x = cy; r.y = 0; r.z = sy;
  u.x = r.y * f.z - r.z * f.y; u.y = r.z * f.x - r.x * f.z; u.z = r.x * f.y - r.y * f.x;
  return { f, r, u };
}
/** a point in the aim's tangent coordinates (x right, y up; the frame's edges at ±w and ±w / aspect); null behind it */
export function tanOf(p: V, out: { x: number; y: number }): boolean {
  const dx = p.x - HEAD.x, dy = p.y - HEAD.y, dz = p.z - HEAD.z, d = dx * f.x + dy * f.y + dz * f.z;
  if (d < 1) return false;
  out.x = (dx * r.x + dy * r.y + dz * r.z) / d; out.y = (dx * u.x + dy * u.y + dz * u.z) / d;
  return true;
}
const aimAt = (p: V): [number, number] => [Math.atan2(p.x - HEAD.x, HEAD.z - p.z), Math.atan2(HEAD.y - p.y, Math.hypot(p.x - HEAD.x, HEAD.z - p.z))];
const distTo = (p: V) => Math.hypot(p.x - HEAD.x, p.y - HEAD.y, p.z - HEAD.z);

const tx: number[] = [], ty: number[] = [], q = { x: 0, y: 0 };
/** the narrowest shot holding every point inside its share, centred on `focus` as far as that allows, its width
 *  between wMin and wMax (tangents); past wMax, centred between the extremes */
export function fitFrame(pts: FramePoint[], focus: V, aspect: number, wMin: number, wMax: number): Aim {
  let [yaw, pitch] = aimAt(focus), w = wMin;
  for (let it = 0; it < 3; it++) {
    axes(yaw, pitch);
    let n = 0;
    for (const p of pts) { if (tanOf(p, q)) { tx[n] = q.x; ty[n] = q.y; n++; } else { tx[n] = ty[n] = NaN; n++; } }
    const fx = tanOf(focus, q) ? q.x : 0, fy = tanOf(focus, q) ? q.y : 0;
    // the narrowest width: over every pair, their spread over their shares (the vertical in the frame's own units)
    let need = wMin;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j || Number.isNaN(tx[i]) || Number.isNaN(tx[j])) continue;
      const s = pts[i].m + pts[j].m;
      need = Math.max(need, (tx[i] - tx[j]) / s, ((ty[i] - ty[j]) / s) * aspect);
    }
    w = Math.min(need, wMax);
    const wv = w / aspect;
    // where the centre may go so that each point keeps to its share; the focus's place if it is in there
    let lx = -Infinity, hx = Infinity, ly = -Infinity, hy = Infinity;
    for (let i = 0; i < n; i++) {
      if (Number.isNaN(tx[i])) continue;
      const m = pts[i].m;
      lx = Math.max(lx, tx[i] - m * w); hx = Math.min(hx, tx[i] + m * w);
      ly = Math.max(ly, ty[i] - m * wv); hy = Math.min(hy, ty[i] + m * wv);
    }
    const cx = lx <= hx ? Math.min(hx, Math.max(lx, fx)) : (lx + hx) / 2, cy = ly <= hy ? Math.min(hy, Math.max(ly, fy)) : (ly + hy) / 2;
    // turn the aim onto that centre
    const dx = f.x + cx * r.x + cy * u.x, dy = f.y + cx * r.y + cy * u.y, dz = f.z + cx * r.z + cy * u.z;
    yaw = Math.atan2(dx, -dz); pitch = Math.atan2(-dy, Math.hypot(dx, dz));
  }
  return { yaw, pitch, w };
}

/** what the shot is of at a moment: the ball (x, z, height) and its velocity on the ground (m/s); the bodies (hips,
 *  scene axes), the first nAtt the attackers; `dirAtt` the way the attackers attack in these axes (+1 or -1); `side` who
 *  had the ball last (+1 the attackers, -1 the defenders, 0 not known), kept by the caller over the frames */
export interface ShotIn {
  ball: [number, number, number]; vel: [number, number]; bodies: readonly V[]; nAtt: number; dirAtt: 1 | -1; side: number; aspect: number;
  /** the tiers dropped last time (0 none, 1 the men, 2 the men, the room ahead and the goal), kept by the caller */
  tier: number;
}
/** the shot wanted at a moment, before the operator's lag: its aim; the points it holds (`hard`) and the ones that may
 *  never leave the frame (`must`: the ball and its heading), for the camera's guard; the ground point it centres; who
 *  has the ball now and the tiers dropped (the caller keeps them as `side` and `tier`) */
export function broadcastShot(s: ShotIn): { aim: Aim; hard: FramePoint[]; must: FramePoint[]; focus: V; side: number; tier: number } {
  const [bx, bz, bh] = s.ball, [vx, vz] = s.vel, B = s.bodies;
  // the man on the ball (within 2.5 m, the ball not flying past), else who had it last
  let carrier = -1, best = 2.5 ** 2;
  const speed = Math.hypot(vx, vz);
  if (speed < 12) B.forEach((h, i) => { const d = (h.x - bx) ** 2 + (h.z - bz) ** 2; if (d < best) { best = d; carrier = i; } });
  const side = carrier < 0 ? s.side : carrier < s.nAtt ? 1 : -1;
  const dir = side === 0 ? 0 : side > 0 ? s.dirAtt : -s.dirAtt;
  const must: FramePoint[] = [{ x: bx, y: Math.max(0.11, bh), z: bz, m: SHARE.ball }];
  const want: FramePoint[] = [], soft: FramePoint[] = [];
  // where the ball is heading, on the pitch and a little beyond
  const clampX = (x: number) => Math.min(GOAL_X + 3, Math.max(-GOAL_X - 3, x)), clampZ = (z: number) => Math.min(37, Math.max(-37, z));
  must.push({ x: clampX(bx + vx * LEAD_S), y: 0.3, z: clampZ(bz + vz * LEAD_S), m: SHARE.heading });
  // the room in front of the man on the ball, towards the goal he attacks
  if (carrier >= 0 && dir !== 0) want.push({ x: clampX(bx + dir * AHEAD_M), y: 0, z: bz * 0.8, m: SHARE.ahead });
  // the goal he attacks once it is near, with the penalty area's men (a corner: the taker by the flag and the box)
  // (a corner first: the flag is 34 m from the goal, past GOAL_NEAR_M)
  let keepGoal = false;
  const goal = (gx: number, keep: boolean) => {
    want.push({ x: gx, y: 0, z: -POST_Z, m: SHARE.goal }, { x: gx, y: 0, z: POST_Z, m: SHARE.goal }, { x: gx, y: BAR_Y, z: 0, m: SHARE.goal });
    for (const h of B) if (Math.abs(h.x - gx) < BOX.x && Math.abs(h.z) < BOX.z) soft.push({ x: h.x, y: 1, z: h.z, m: SHARE.men });
    keepGoal = keep || Math.hypot(bx - gx, bz) < GOAL_CLOSE_M;
  };
  const gAtt = dir * GOAL_X, nearest = bx >= 0 ? GOAL_X : -GOAL_X;
  const corner = Math.abs(Math.abs(bx) - GOAL_X) < 2.5 && Math.abs(Math.abs(bz) - 34) < 2.5 && speed < 2;
  if (corner) goal(nearest, true);
  else if (dir !== 0 && Math.hypot(bx - gAtt, bz) < GOAL_NEAR_M) goal(gAtt, false);
  else if (Math.hypot(bx - nearest, bz) < GOAL_CLOSE_M) goal(nearest, false);
  // the men round the ball, and the focus: mostly the ball, partly them, a little towards where it is going
  let sx = 0, sz = 0, n = 0;
  for (const h of B) {
    const d2 = (h.x - bx) ** 2 + (h.z - bz) ** 2;
    if (d2 < NEAR_M ** 2) soft.push({ x: h.x, y: 1, z: h.z, m: SHARE.men });
    if (d2 < 400) { sx += h.x; sz += h.z; n++; }
  }
  const cx = n ? sx / n : bx, cz = n ? sz / n : bz;
  const lead = Math.max(-7, Math.min(7, vx * 0.6 + dir * 4));
  const focus = { x: 0.65 * bx + 0.35 * cx + lead, y: 0, z: 0.65 * bz + 0.35 * cz + Math.max(-3, Math.min(3, vz * 0.3)) };
  // as wide as the play near the focus is spread (40 to 66 m), never tighter than WIDTH.min
  let lo = Infinity, hi = -Infinity;
  for (const h of B) if (Math.abs(h.x - focus.x) < 28) { lo = Math.min(lo, h.x); hi = Math.max(hi, h.x); }
  const spread = Number.isFinite(lo) ? Math.min(66, Math.max(40, (hi - lo) * 1.15 + 16)) : 52;
  // the narrowest shot of everything; then, while it is too wide, without the men, then without the room ahead and the goal
  const D = distTo(focus), tanOfDeg = (d: number) => Math.tan(d / THREE_DEG / 2) * s.aspect;
  const wMin = Math.max(WIDTH.min / 2 / D, Math.min(spread / 2 / D, tanOfDeg(WIDTH.spreadDeg))), wMax = WIDTH.hard / 2 / D;
  const deg = (a: Aim) => THREE_DEG * 2 * Math.atan(a.w / s.aspect);
  const back = (k: number) => (s.tier >= k ? WIDTH.backDeg : 0);
  let tier = 0, hard = [...must, ...want], aim = fitFrame([...hard, ...soft], focus, s.aspect, wMin, wMax);
  if (soft.length && deg(aim) > WIDTH.menDeg - back(1)) { tier = 1; aim = fitFrame(hard, focus, s.aspect, wMin, wMax); }
  if (want.length && !keepGoal && deg(aim) > WIDTH.wantDeg - back(2)) { tier = 2; hard = must; aim = fitFrame(hard, focus, s.aspect, wMin, wMax); }
  return { aim, hard, must, focus, side, tier };
}

/** the ground point at the middle of a shot (scene x, z) */
export function groundOf(aim: Aim): [number, number] {
  axes(aim.yaw, aim.pitch);
  const k = f.y < -1e-3 ? HEAD.y / -f.y : 200;
  return [HEAD.x + f.x * k, HEAD.z + f.z * k];
}
