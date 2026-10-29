// Fernández and Bornn (2018) pitch control and space occupation / generation, ported from the notebook
// (<private-workspace>, cells 12, 18, 54-56, 62, 70) for the HUD preview's
// draft of the 战术 mode (the space family uses this model; precalculated at export from the 50 Hz tracking
// later, computed here from the clip's 10 Hz positions meanwhile). Pitch metres, attackers attacking +x.
// One placeholder: the notebook's space value V is a network trained on where the defenders stand for a given ball
// position; here V is that network's training target at this moment (the defenders' summed influence, capped at 1), so
// V and Q = PC x V show 示例 until the network is ported.

export type XY = [number, number];

/** how far ahead of a player his influence is centred: half a second along his velocity (eq. 21) */
const INFLUENCE_LOOKAHEAD_SECONDS = 0.5;
/** the speed at which a player's influence is fully stretched along his run (eq. 18's 13 m/s) */
const MAX_INFLUENCE_SPEED_MPS = 13;
/** the stretch is capped below 1, so the influence never collapses across the run (the notebook's 1 - srat > 0) */
const MAX_SPEED_RATIO = 0.9;
/** the influence radius: 4 m beside the ball, growing with the square of the distance to it, at most 10 m (eq. 19) */
const MIN_INFLUENCE_RADIUS_M = 4, MAX_INFLUENCE_RADIUS_M = 10, RADIUS_GROWTH_PER_M2 = 3 / 180;
const influenceRadius = (distanceToBall: number) => Math.min(RADIUS_GROWTH_PER_M2 * distanceToBall * distanceToBall + MIN_INFLUENCE_RADIUS_M, MAX_INFLUENCE_RADIUS_M);

/** one player's influence at a point, 0..1: a Gaussian stretched along his velocity and shifted ahead of him (eqs. 12-21),
 *  normalised to 1 at its peak */
export function influence(playerPosition: XY, velocity: XY, ballPosition: XY, point: XY): number {
  const speedSquared = velocity[0] * velocity[0] + velocity[1] * velocity[1];
  const speedRatio = Math.min(MAX_SPEED_RATIO, speedSquared / (MAX_INFLUENCE_SPEED_MPS * MAX_INFLUENCE_SPEED_MPS));
  const radius = influenceRadius(Math.hypot(ballPosition[0] - playerPosition[0], ballPosition[1] - playerPosition[1]));
  const alongRun = (1 + speedRatio) * radius * 0.5, acrossRun = (1 - speedRatio) * radius * 0.5;
  const heading = Math.atan2(velocity[1], velocity[0] + 1e-7), cos = Math.cos(heading), sin = Math.sin(heading);
  const dx = point[0] - (playerPosition[0] + INFLUENCE_LOOKAHEAD_SECONDS * velocity[0]);
  const dy = point[1] - (playerPosition[1] + INFLUENCE_LOOKAHEAD_SECONDS * velocity[1]);
  // into the player's own frame (Cov = R S S R^T), where the Gaussian's axes are along and across his run
  const along = (dx * cos + dy * sin) / alongRun, across = (-dx * sin + dy * cos) / acrossRun;
  return Math.exp(-0.5 * (along * along + across * across));
}

/** a team's share of each point: the logistic of its summed influence minus the other side's (cell 55) */
export function control(team: XY[], teamVelocities: XY[], opponents: XY[], opponentVelocities: XY[], ballPosition: XY, points: XY[]): Float32Array {
  const share = new Float32Array(points.length);
  points.forEach((point, i) => {
    let ours = 0, theirs = 0;
    for (let k = 0; k < team.length; k++) ours += influence(team[k], teamVelocities[k], ballPosition, point);
    for (let k = 0; k < opponents.length; k++) theirs += influence(opponents[k], opponentVelocities[k], ballPosition, point);
    share[i] = 1 / (1 + Math.exp(-(ours - theirs)));
  });
  return share;
}

/** the space value stand-in: the defending side's summed influence, capped at 1 (cells 30-31, the network's target) */
export function value(defenders: XY[], defenderVelocities: XY[], ballPosition: XY, points: XY[]): Float32Array {
  const density = new Float32Array(points.length);
  points.forEach((point, i) => {
    let sum = 0;
    for (let k = 0; k < defenders.length; k++) sum += influence(defenders[k], defenderVelocities[k], ballPosition, point);
    density[i] = Math.min(1, sum);
  });
  return density;
}

/** a moment of the clip: positions (attackers first) and velocities, the ball, and whether the ball was tracked (when it
 *  was not, `ball` is a placeholder that no measure may use) */
export interface Moment { pos: XY[]; vel: XY[]; ball: XY; hasBall: boolean; nAtt: number }

/** player i's quality of owned space, Q_i = PC x V at his feet (cell 56) */
export function quality(moment: Moment, player: number): number {
  const attacker = player < moment.nAtt, at = moment.pos[player], all = moment.pos.length;
  const [teamFrom, teamTo] = attacker ? [0, moment.nAtt] : [moment.nAtt, all];
  const [oppFrom, oppTo] = attacker ? [moment.nAtt, all] : [0, moment.nAtt];
  const team = moment.pos.slice(teamFrom, teamTo), teamVel = moment.vel.slice(teamFrom, teamTo);
  const opponents = moment.pos.slice(oppFrom, oppTo), opponentVel = moment.vel.slice(oppFrom, oppTo);
  return control(team, teamVel, opponents, opponentVel, moment.ball, [at])[0] * value(opponents, opponentVel, moment.ball, [at])[0];
}

/** the notebook's threshold, per frame at 50 Hz over a 50-frame window: a change in Q of more than 0.05 over the window */
export const EPS_Q = 0.001 * 50;

export interface Occupation { p: number; dq: number; kind: 'gain' | 'loss' }
/** space occupation over a window: each attacker's change in Q from its start to its end; a gain (SOG) or a loss (SOL)
 *  where it passes the threshold (cell 62). Nothing when either end lacks the ball */
export function occupation(start: Moment, end: Moment): Occupation[] {
  if (!start.hasBall || !end.hasBall) return [];
  const events: Occupation[] = [];
  for (let player = 0; player < end.nAtt; player++) {
    const dq = quality(end, player) - quality(start, player);
    if (dq > EPS_Q) events.push({ p: player, dq, kind: 'gain' });
    else if (dq < -EPS_Q) events.push({ p: player, dq, kind: 'loss' });
  }
  return events;
}

/** the marking distance and the pull that make a space-generation event (cell 70) */
export const SG_MARKING_DISTANCE_M = 5, SG_MIN_PULL_M = -1;

export interface Generation { gen: number; rec: number; def: number; dq: number }
/** space generation over a window (cell 70): a defender who marked the receiver at the start ends marking the generator,
 *  away from the receiver, having closed on the generator; its gain (SGG) is the receiver's change in Q when it passes the
 *  threshold (cell 76). Nothing when either end lacks the ball */
export function generation(start: Moment, end: Moment, markingDistance = SG_MARKING_DISTANCE_M, minPull = SG_MIN_PULL_M): Generation[] {
  if (!start.hasBall || !end.hasBall) return [];
  const distance = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const events: Generation[] = [], receiverGain = new Map<number, number>();
  for (let generator = 0; generator < end.nAtt; generator++) for (let receiver = 0; receiver < end.nAtt; receiver++) {
    if (receiver === generator) continue;
    for (let defender = end.nAtt; defender < end.pos.length; defender++) {
      const markedReceiver = distance(start.pos[receiver], start.pos[defender]) <= markingDistance;
      const nowMarksGenerator = distance(end.pos[generator], end.pos[defender]) <= markingDistance;
      const leftReceiver = distance(end.pos[receiver], end.pos[defender]) > markingDistance;
      const closedOnGenerator = distance(end.pos[generator], end.pos[defender]) - distance(start.pos[generator], start.pos[defender]) < minPull;
      if (!(markedReceiver && nowMarksGenerator && leftReceiver && closedOnGenerator)) continue;
      let dq = receiverGain.get(receiver);
      if (dq === undefined) { dq = quality(end, receiver) - quality(start, receiver); receiverGain.set(receiver, dq); }
      if (dq >= EPS_Q) events.push({ gen: generator, rec: receiver, def: defender, dq });
    }
  }
  return events.sort((a, b) => b.dq - a.dq);
}
