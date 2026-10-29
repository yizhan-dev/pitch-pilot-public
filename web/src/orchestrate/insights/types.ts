// One insight found in a clip: an entry of the catalogue, at a moment, with its players, the numbers that back it, its
// drawings and the ways a line may put it. Detectors (detect.ts) make them; plan.ts turns the chosen ones into beats.
import type { InsightId } from './catalogue';
import type { Actor, Fact } from '../types';
import type { DrawItem } from '../draw';

export interface Insight {
  /** '<entry>@<t>:<player>' */
  id: string;
  entry: InsightId;
  /** the moment the line lands on (clip s) */
  t: number;
  /** the span of the evidence, for the drawings */
  t0: number; t1: number;
  /** a short hold at `t` so the viewer sees the detail (brief pauses for animations are allowed) */
  hold?: number;
  /** the protagonist first */
  players: Actor[];
  facts: Fact[];
  draw: DrawItem[];
  /** the gist (neutral), and the same point as praise or as an improvement ("it would be better if ..."), with {n:i} names */
  say: { neutral: string; praise?: string; improve?: string };
  /** 0..1: how much it matters to this attack's story */
  salience: number;
  /** 0..1: how sure the detector is (margins against its thresholds) */
  confidence: number;
  why: string[];
}
