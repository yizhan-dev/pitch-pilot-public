// The what-if's steps, shared by the question card (the entry), the pitch (picking), the game shell (simulating and
// playing the branch) and the result card: off, pick (the viewer is choosing where the ball goes, or whose run changes
// and where he runs), computing, sim (the branch is playing), result (paused at its end, the card open). Two kinds:
// `pass`, the on-ball what-if (onball.ts), and `run`, the off-ball one (offball.ts, step 3).
import { store, useStore } from '../hud/draft';
import type { XY } from '../response/engine';
import type { Outcome } from './onball';
import type { NoShot, ShotEval } from './shot';
import type { BranchInfo } from './branch';

export type LandPhase = 'off' | 'pick' | 'computing' | 'sim' | 'result';
/** what really happened after the pause, drawn faintly over the simulation: the real ball (25 Hz from t0, the package's
 *  frame) and the real pass, from where it was struck to where it was received (null if he did not pass) */
export interface Ghost {
  t0: number; xyz: ([number, number, number] | null)[];
  pass: { from: XY; to: XY; receiver: number | null; done: boolean } | null;
  /** the runner's real run from the pause (the off-ball what-if), the package's frame, 10 Hz */
  run?: XY[];
}
/** what the run's result card reads (offball.ts RunResult, package indices): the real receiver's chance of receiving and
 *  keeping it and the nearest defender then, with the runner's real run and with the new one; the defender who moved
 *  most because of it; had the pass gone into the run, the runner's chance of receiving it; the run's length and time */
export interface RunInfo {
  receiver: number;
  base: { receive: number; keep: number; near: number }; now: { receive: number; keep: number; near: number };
  follower: { who: number; shift: number } | null;
  alt: { receive: number; loft: boolean } | null;
  len: number; dur: number;
}
export type WhatKind = 'pass' | 'run';
/** a pass of the chain done (chain.ts): from and to (package indices), when it was struck and taken (clip time),
 *  whether it was the real pass, lofted or not, his chance of receiving it, his xG as he took it (its xA = p × xg), and
 *  whether he chose it himself ("let him choose") */
export interface ChainStep { from: number; to: number; t0: number; tTouch: number; real: boolean; loft: boolean; p: number; xg: number; auto: boolean }
export interface LandState {
  phase: LandPhase;
  /** which what-if: where the ball goes, or a teammate's run */
  kind: WhatKind;
  /** the pause (clip time, the real clip's) and the player on the ball (package index) */
  t0: number; carrier: number;
  /** the picked point, in the package's frame, and whether the pass goes along the ground or lofted; `toWho`: the
   *  teammate clicked (package index), the pass then going into his stride (onball.ts leadPoint) */
  target: XY | null; loft: boolean; toWho: number | null;
  /** where the pass is met (the package's frame): the lane on the pitch ends there, the pass itself is aimed at `target`
   *  (at 90:10 a ball aimed at the far post is met 5 m earlier, in the goal area, and a lane to the target said otherwise) */
  meetAt: XY | null;
  /** the real play, and whether it is shown */
  ghost: Ghost | null; showReal: boolean;
  /** while picking: how far the passer would turn for the point under the pointer (degrees) and his time on the ball
   *  before the strike (steps) */
  aim: { turn: number; hold: number } | null;
  /** what can become of the pass (most likely first), the one being shown, and the branch's facts */
  outcomes: Outcome[]; shown: number; info: BranchInfo | null;
  /** the off-ball what-if: the runner (package index, null while choosing him), where he runs (package frame), the
   *  read-out under the pointer while picking (metres, seconds), the comparison, and whether the branch playing is the
   *  pass into his run (alt) rather than the real pass with his run */
  runner: number | null; runEnd: XY | null; runAim: { len: number; dur: number } | null; run: RunInfo | null; alt: boolean;
  /** the shot what-if (shot.ts): as the receiver takes the ball, his xG if he shot from there (package index, where he
   *  is, a header or not); and the shot that really came next, if one did, on the same model (with the feed's xG) */
  shot: { who: number; at: XY; xg: number; header: boolean; no: NoShot; eval: ShotEval } | null;
  /** the pass is picked for him (the viewer only names the man, A rather than B): along the ground or
   *  lofted, whichever is worth more (his chance of receiving it times his xG then); the other kind's numbers */
  choice: { loft: boolean; p: number; xg: number } | null;
  /** the pass was lofted because an opponent covered the ground lane (package index; chain.ts laneCovered) */
  lane: number | null;
  /** the teammate picked is his real choice (the man's real position in the real situation, and its xG): the real
   *  play to the real touch, nothing simulated; and for every pick, his real
   *  pass's receiver and that man's xG as he really took it, shown beside the pick as data (no verdict);
   *  offside: that pass was offside (no xG) */
  isReal: boolean; realPick: { who: number; xg: number; offside: boolean } | null;
  /** a shooting moment: the man on the ball really shot from here (no pass of his follows); the
   *  real shot's numbers are known while he picks (`realShot`), and his own column is lit: a click plays the real shot */
  atShot: boolean;
  /** the widget (AskCard.tsx): the right-hand card shown ("Details"); "Shoot" pressed at a pass moment:
   *  his xG if he shot from here (null while worked out) */
  details: boolean; shootHere: { xg: number; no: NoShot } | null | undefined;
  /** the branch playing is his shot from here (onball.ts shootFromHere), not a pass */
  isShot: boolean;
  /** the chain: the passes done before this one (two steps and more, xA and xG at each); `auto`: this
   *  pass was his own choice; `decision`: at his touch, what he would do himself (shooting's xG, the best pass's value);
   *  `thinking` while that is worked out */
  steps: ChainStep[]; auto: boolean; thinking: boolean;
  /** while picking: his realistic options (options.ts; package indices, where the pass meets each, lofted or not, the
   *  chance it reaches him, his xG then), null while they are worked out; and the one under the pointer */
  /** (xg: his shot's xG as he takes it, shown; worth: the chance it reaches him times that shot's worth, which ranks;
   *  chance: the pass's chance of reaching him by the models, by his name (WhatIfTags.tsx; for his real receiver too,
   *  the same ruler, though a click shows the real play), null with no pass to show: offside, or his own real shot) */
  options: { who: number; at: XY; meetAt: XY; loft: boolean; p: number; xg: number; worth: number; no: NoShot; real?: boolean; chance: number | null }[] | null; hoverWho: number | null; optionsDone: boolean;
  decision: { shoot: number; pass: { to: number; value: number; p: number; xg: number } | null; pick: 'shoot' | 'pass' } | null;
  realShot: { who: number; xg: number; opta: number | null; goal: boolean } | null | undefined;
  /** the package index of each of the model's players (the outcomes name the model's) */
  toPkg: number[];
}
export const LAND_OFF: LandState = {
  phase: 'off', kind: 'pass', t0: 0, carrier: -1, target: null, meetAt: null, loft: false, toWho: null, ghost: null, showReal: false, aim: null, outcomes: [], shown: 0, info: null, toPkg: [],
  runner: null, runEnd: null, runAim: null, run: null, alt: false, shot: null, realShot: undefined, choice: null, lane: null, isReal: false, realPick: null, atShot: false, details: false, shootHere: undefined, isShot: false, steps: [], auto: false, thinking: false, decision: null, options: null, hoverWho: null, optionsDone: false,
};
export const land = store<LandState>(LAND_OFF);
export const useLand = () => useStore(land);
/** every player's style while a what-if is open (ghosts without their trail while he picks and at the stop, with it
 *  while the pass plays), or null for the game's own (the toon players and the Show menu's style);
 *  three/Stage.tsx draws all players in it. The viewer's own settings are not touched. */
export const wiStyle = store<'ghost' | 'ghost-still' | null>(null);
/** a simulated play running back to its moment before the mode changes (useWhatIf.tsx): the widget and
 *  the marks are off meanwhile */
export const wiRewind = store<boolean>(false);
export const useWiRewind = () => useStore(wiRewind);
export const useWiStyle = () => useStore(wiStyle);

/** the players the What-if tags itself now (three/whatif/WhatIfTags.tsx): while he picks, the man on the ball and his
 *  options; while a pass plays and at its end, the passer and the receiver; none while a play runs back. The Show layer
 *  (three/layers/ShowLayer.tsx) skips them, so no name is printed twice. Worked out from
 *  the state, not from what was drawn, so the two layers agree in every frame whichever draws first */
export function wiTagged(out = new Set<number>()): Set<number> {
  const L = land.get();
  out.clear();
  if (L.kind !== 'pass' || L.carrier < 0 || wiRewind.get()) return out;
  if (L.phase === 'pick' || L.phase === 'computing') { out.add(L.carrier); for (const o of L.options ?? []) out.add(o.who); }
  else if (L.phase === 'sim' || L.phase === 'result') { out.add(L.carrier); if (L.info && L.info.who >= 0) out.add(L.info.who); }
  return out;
}

/** the pitch belongs to the What-if while one is open: picking (a target or a run), the pass worked out, the play and
 *  its stop, and the run back. The camera director (three/camera/Director.tsx) then leaves clicks, hovers
 *  and double clicks alone; drags still move the camera. (Not only while picking: at a stop a click on any man would
 *  select him and give him the turning ring, and no man on the pitch is to be clickable in a what-if) */
export const picking = () => land.get().phase !== 'off' || wiRewind.get();

/** why the pass waits: he faces away from it and turns with the ball first (onball.ts holdFor) */
export const turnLine = (turn: number, hold: number) =>
  `${turn >= 120 ? 'Behind him' : 'Across him'}: he turns ${Math.round(turn / 5) * 5}° with the ball first, ${(hold / 10).toFixed(1)}\u00a0s before the pass.`;
