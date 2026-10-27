// The passing options at a pause (Yi, 2026-10-25: "make that cylindrical highlight lighting up our potential passing
// options ... #13 is at the back of the passer, and being in that situation, he is not one of the options, we should
// exclude him"): the teammates he could really play it to. Left out: the keepers; a man offside (beyond the second-last
// defender and the ball, in the other half); a man too far from goal to shoot (shot.ts, over 35 m: not the last pass
// before a shot); and any pass the models give less than a 20% chance of reaching him (OPTION_MIN_P). (A rule against men behind the
// passer was tried and dropped the same day: his body at the touch often faces the touchline, and at 15:49 it threw out
// every teammate, the real receiver who overlapped from behind among them.) Each one kept
// carries the pass tried for him (chain.ts tryPass: into his stride, the better kind), so the click plays it at once.
// And under pressure (an opponent within 2 m) he looks only at passes worth something: at least 30% of his best one
// (worth = the chance it reaches the man times his xG as he takes it). At 26:40 #2, a defender 0.9 m off, has #13
// (who had just passed it to him, out by the corner flag) at 0.03 against 0.11-0.13 for the other three; at 22:51 the
// man on the ball has time, and the right winger stays an option for a ball out wide (Yi's two-step example). The
// body's angle alone did not tell them apart: #13 was 89 degrees off the way #2 faced, #37 (whom Yi did pick) 98.
import { DT } from '../response/engine';
import type { XgFreezeModel } from '../response/xg';
import { tryPass, offsideAtStrike, type Tried } from './chain';
import type { Models, Scene0 } from './onball';

/** the gate on the chance by his name: 0.2 since 2026-10-27 (Yi; it was 0.3 under the response model's flatter chance:
 *  with Opta's ruler a hard but rewarding ball, 26:42's chip back to Whitfield at 21% and xG 0.57, must show) */
export const OPTION_MIN_P = 0.2, PRESSED_M = 2, WORTH_SHARE = 0.3;

/** the men worth trying at all (model indices), before the models are asked */
export function candidates(c: Scene0): number[] {
  const defs = c.now.slice(11, 22).map((q) => q[0]).sort((a, b) => b - a), line = Math.max(defs[1] ?? -Infinity, c.ball[4][0]);
  const out: number[] = [];
  for (let i = 0; i < 11; i++) {
    if (i === c.kicker || c.gk[i]) continue;
    if (c.now[i][0] > 0 && c.now[i][0] > line + 0.3) continue;   // offside
    out.push(i);
  }
  return out;
}

/** one man's option: the pass tried for him, kept if it reaches him often enough, he is not too far from goal, and he
 *  is not offside as the ball is struck (chain.ts offsideAtStrike) */
export function optionFor(M: Models, c: Scene0, xg: XgFreezeModel | null, i: number): Tried | null {
  const t = tryPass(M, c, xg, i);
  return t.p >= OPTION_MIN_P && t.no?.why !== 'far' && !offsideAtStrike(c, t.pass) ? t : null;
}
export const STEP_S = DT;

/** under pressure, only the passes worth a share of his best */
export function pressed(c: Scene0) {
  let d = Infinity;
  for (let i = 11; i < 22; i++) d = Math.min(d, Math.hypot(c.now[i][0] - c.now[c.kicker][0], c.now[i][1] - c.now[c.kicker][1]));
  return d < PRESSED_M;
}
export function keepWorth<T extends { worth: number }>(list: T[], underPressure: boolean): T[] {
  if (!underPressure || !list.length) return list;
  const best = Math.max(...list.map((o) => o.worth));
  return list.filter((o) => o.worth >= WORTH_SHARE * best);
}
