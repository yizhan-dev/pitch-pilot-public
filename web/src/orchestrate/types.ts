// The 讲解 orchestrator's output: the beat plan of one clip (docs/plans/orchestrator-notes.md). A clip goes in, a list of
// beats comes out: what the story of the attack is, which moments matter, what to draw at each, what the line must say.
// It is the hand-off to the narration (lines per beat) and to the script player (when to draw); `toCues` (plan.ts)
// compiles it to the narration's own cue format, so there is one timeline, not two.
// Players are package indices (attackers first, then defenders), the same as Telestration's items and the cues.
import type { DrawItem } from './draw';
import type { InsightId } from './insights/catalogue';
import type { ViewMode } from '../game/settings';

export type BeatKind =
  | 'intro'        // the story in one line, at the start: who attacks, from where, how long
  | 'build-up'     // the patient passing before the attack goes forward (often fast-forwarded)
  | 'line-break'   // a pass through or over the opponent's lines (Opta MA36 lineBreakingPass, else our geometry)
  | 'run'          // the off-ball run that made a key pass possible: the receiver's own, or a decoy's
  | 'final-pass'   // the last pass before the shot (Opta KeyPass / Assisted)
  | 'shot'         // the strike, frozen on the boot's contact, with the shooter's xG
  | 'what-if'      // what could have been: the better-placed teammate, by the defender-aware xG
  | 'outcome'      // how it ended: saved, scored, missed, blocked, lost
  | 'insight';     // an entry of the insight library (insights/catalogue.ts), found by its detector

/** what the number means and where it came from (never shown as is; the narration quotes it) */
export type FactSrc = 'opta' | 'tracking' | 'xg' | 'pitch-control' | 'first-touch' | 'rule';
export interface Fact { key: string; value: number | string; unit?: string; src: FactSrc; note?: string }

export type Role = 'passer' | 'receiver' | 'runner' | 'decoy' | 'shooter' | 'mate' | 'keeper' | 'marker' | 'carrier' | 'beaten';
export interface Actor { player: number; role: Role }

export interface Beat {
  /** stable across runs of the same clip: kind and the moment, e.g. 'line-break@24.80' */
  id: string;
  kind: BeatKind;
  /** the moment the beat is about: the touch its line lands on (clip seconds, from the ball's 25 Hz track) */
  at: number;
  /** clip seconds the beat covers while the clock runs; a held beat has t0 = t1 = at */
  t0: number; t1: number;
  /** a held beat: the clock stops at `at` for this many real seconds (held beats at one `at` play in order) */
  /** the grey board while this beat runs, from t0 to t1 (the Explain mode: game/settings.ts scriptBoard; 80:17's pitch
   *  control, Yi 2026-10-26) */
  board?: boolean;
  /** the Tactics mode's base map on that board (hud/BaseMap3D.tsx: 'pc' pitch control in its 24 bands a side, 'q') */
  base?: 'pc' | 'q';
  hold?: number;
  /** playback speed over [t0, t1] (2: fast forward through the build-up, 0.5: slow motion into the moment) */
  rate?: number;
  view?: ViewMode;
  /** the one protagonist, ringed (settings.selected) */
  select: number | null;
  actors: Actor[];
  /** the numbers that justify the beat */
  facts: Fact[];
  /** the drawings, with their clip-time windows (Telestration's `window`); a held beat's items show for its hold.
   *  Telestration `Item`s, plus the pass and run arrows it has not built yet (draw.ts) */
  draw: DrawItem[];
  /** what the line must say there, for the narration session ({p:i} {n:i} as in its scripts); a hint, not the line */
  say: string;
  /** 0..1, how much the beat matters to this clip's story (beats below the cut are dropped, see Plan.dropped) */
  salience: number;
  /** the camera for this beat (director scripts, 2026-10-23): a view, the player a player's view belongs to, or a preset
   *  ('shot': the telestration's low shot camera behind `player` at `at`); held from the beat's start until the next
   *  beat with a camera */
  /** a director script's camera from this beat on: a view (a player's view selects him), the low shot camera, or a
   *  fixed free-camera pose (the Director's __camSet: orbit centre x, height, z (the data's y), yaw and pitch in degrees,
   *  distance) */
  camera?: { view: ViewMode; player?: number; preset?: 'shot'; pose?: [number, number, number, number, number, number]; at?: number; note?: string; move?: number;
    /** the ball's camera (the Explain mode; Yi 2026-10-26, 22:54's ball through Lowe's legs): `up` m over the grass,
     *  `behind` m behind the ball on the line of the pass kicked at `from` and taken at `to` (clip times), looking along
     *  it down to `lookY` m; it stops `stopS` m along the line from the kick, and the ball runs on from it */
    ball?: { from: number; to: number; behind: number; up: number; stopS?: number; lookY?: number; side?: number; fov?: number } };
  /** the English lines (Yi, 2026-10-23: the product is English): the subtitle and the spoken form, at clip time `t`
   *  (a held line at the beat's `at`); {p:i} full name, {s:i} short name, {n:i} No. 13 */
  lines?: { t: number; subtitle: string; voice?: string; held?: boolean }[];
  /** the director's notes for this beat: nuances, alternatives, what is still missing */
  notes?: string[];
  /** an insight beat: its catalogue entry, the detector's confidence, and the line's two tones (Yi, 2026-10-23: praise,
   *  or an improvement put as "如果……会更好", never "he is bad at") */
  entry?: InsightId;
  confidence?: number;
  tone?: { praise?: string; improve?: string };
  /** the rules that fired, with their numbers: why this beat, why these drawings (the debug view shows them) */
  why: string[];
}

export type PhaseKind = 'build-up' | 'progression' | 'final-third' | 'finish' | 'after';
export interface Phase { kind: PhaseKind; t0: number; t1: number; why: string }

/** one on-ball action of the possession, from the ball's track (touches) joined to the feed's event where one matches */
export interface Action {
  t: number;
  player: number;
  kind: 'pass' | 'carry' | 'shot' | 'save' | 'clear' | 'cross' | 'lost' | 'touch';
  /** a pass: who touched it next, when, where (the reception), how far it went */
  to?: number; tTo?: number; metres?: number;
  /** the feed's event index and fields, when matched */
  event?: number; lb?: { lines: number; last: string | null }; xpass?: number; xg?: number; tags?: string[];
  ok?: boolean;
  /** the ball's height at its highest between this touch and the next (a lofted pass rises over 2 m) */
  peak?: number;
}

export interface Story {
  /** who attacks, as the HUD names the team: 'A' (home) or 'B' (away) */
  team: 'A' | 'B';
  /** how the attack ended */
  end: 'goal' | 'saved' | 'missed' | 'blocked' | 'post' | 'lost' | 'cross-cleared' | 'other';
  /** from the first action of the possession to the end */
  t0: number; t1: number;
  passes: number;
  /** a one-line summary for the debug view (Chinese, with {p:i}) */
  summary: string;
}

export interface Plan {
  clip: string;
  v: 1;
  /** the rules' version, so a cached plan can be checked against the code */
  rules: string;
  story: Story;
  phases: Phase[];
  actions: Action[];
  beats: Beat[];
  /** a director script's slow or fast stretches on clip time (a replay's slow motion), apart from the beats */
  speed?: { t0: number; t1: number; rate: number }[];
  /** a director script's call-outs: the player named, from n0 to n1 on the narration time (private/orchestrator/passage_mix.py fit) */
  callouts?: { player: number; name: string; n0: number; n1: number }[];
  /** candidates the budget or the salience cut left out, with why (the debug view lists them) */
  dropped: { id: string; kind: BeatKind; salience: number; why: string }[];
  /** the clutter budget's check over the compiled timeline */
  budget: { maxItems: number; worst: number; at: number | null };
  /** every insight the detectors found, chosen or not (the debug view and the storyboard list the unvalidated ones
   *  for Yi's eye) */
  candidates: { id: string; entry: InsightId; t: number; t0: number; t1: number; players: number[]; salience: number; confidence: number; validated: boolean; say: string; facts: Fact[]; draw: DrawItem[]; why: string[]; chosen: boolean }[];
  /** every attacker's run during the attack's passes (for the check against Opta's activeRun) */
  runs: { p: number; from: number; to: number; peak: number; disp: number; passT: number; received: boolean }[];
}
