// The narration script of a clip (docs/plans/narration-notes.md): cues on the clip's clock, some of which hold the clock
// while they read. Everything the player shows is a function of one "narration time" n: the clip's time with every hold
// spliced in, so a live run (the clock, plus a real-time hold) and a recording (n set frame by frame) show the same.
import type { Item } from '../three/telestration/Telestration';
import type { ViewMode } from '../game/settings';
import type { Look } from '../three/players/looks';

export interface Cue {
  /** clip seconds: the cue starts when the clock reaches t */
  t: number;
  /** a playing cue ends here (clip seconds); without it, at the next cue */
  until?: number;
  /** a held cue: at t the clock stops for this many real seconds; held cues at the same t read one after another */
  pause?: number;
  /** one line. {p:7} is player 7 as the HUD names him (31 号 HEONZGEKSEN), {n:7} his number only (31 号), {name:7} the name */
  text?: string;
  /** the action the line is pinned to, for the record: who, what, and the touch's time before rounding */
  on?: { player: number; kind: string; t: number };
  draw?: Item[];
  /** the line's subject: settings.selected when the cue starts (his ring and the player card) */
  select?: number | null;
  view?: ViewMode;
  rate?: number;
  /** the spoken line (private/narration/voice_mix.py): its audio, when it starts on the narration timeline (it may
   *  start a little after the cue, or not at all: null, when the previous line was still speaking), its length, and
   *  where a key line cut it off */
  voice?: { file: string; at: number; dur: number; rate?: number; cut?: number } | null;
}
export interface NarrationScript { clip: string; v: 1; lang: string; status?: string; written: string; cues: Cue[]; facts?: Record<string, string> }

/** a cue placed on the narration timeline: it shows for s <= n < e */
export interface Placed { cue: Cue; i: number; s: number; e: number }
export interface Timeline {
  placed: Placed[];
  /** the holds, in clip time, with their length */
  holds: { t: number; d: number }[];
  /** clip time to narration time (before any hold at exactly t) */
  n: (t: number) => number;
  /** narration time to the clip's time, and how far into a hold */
  at: (n: number) => { t: number; hold: { t: number; elapsed: number } | null };
}

export function makeTimeline(script: NarrationScript): Timeline {
  const cues = script.cues.map((c, i) => ({ c, i })).sort((a, b) => a.c.t - b.c.t || a.i - b.i);
  const holds: { t: number; d: number }[] = [];
  for (const { c } of cues) if (c.pause) { const h = holds.find((x) => Math.abs(x.t - c.t) < 1e-6); if (h) h.d += c.pause; else holds.push({ t: c.t, d: c.pause }); }
  const n = (t: number) => t + holds.filter((h) => h.t < t - 1e-9).reduce((a, h) => a + h.d, 0);
  const at = (x: number) => {
    let off = 0;
    for (const h of holds) {
      const s = h.t + off;
      if (x < s) break;
      if (x < s + h.d) return { t: h.t, hold: { t: h.t, elapsed: x - s } };
      off += h.d;
    }
    return { t: x - off, hold: null };
  };
  // starts: a playing cue at n(t); held cues one after another from the hold's start
  const placed: Placed[] = [];
  const holdUsed = new Map<number, number>();
  for (const { c, i } of cues) {
    if (c.pause) { const k = Math.round(c.t * 1000), used = holdUsed.get(k) ?? 0; placed.push({ cue: c, i, s: n(c.t) + used, e: n(c.t) + used + c.pause }); holdUsed.set(k, used + c.pause); }
    else placed.push({ cue: c, i, s: n(c.t), e: c.until !== undefined ? n(c.until) : Infinity });
  }
  placed.sort((a, b) => a.s - b.s || a.i - b.i);
  // a cue without an end runs to the next line's start (cues without text, a change of speed, do not end it)
  for (let k = 0; k < placed.length; k++) if (placed[k].e === Infinity) {
    const nx = placed.slice(k + 1).find((p) => p.cue.text);
    placed[k].e = nx ? nx.s : n(Number.MAX_SAFE_INTEGER / 4);
  }
  return { placed, holds, n, at };
}

/** the line showing at narration time n (the latest started that has not ended), and the one before it */
export function linesAt(tl: Timeline, n: number): { cur: Placed | null; prev: Placed | null } {
  let cur: Placed | null = null, prev: Placed | null = null;
  for (const p of tl.placed) {
    if (!p.cue.text || p.s > n + 1e-9) continue;
    if (n < p.e) { if (cur) prev = cur; cur = p; } else prev = p;
  }
  if (cur && prev && prev.s > cur.s) prev = null;
  return { cur, prev };
}

/** a line's text with its players named as the HUD names them */
export function fillNames(text: string, looks: Look[]): string {
  return text.replace(/\{(p|n|name):(\d+)\}/g, (_, k: string, i: string) => {
    const l = looks[+i];
    if (!l) return '';
    return k === 'name' ? l.name : k === 'n' ? `${l.number} 号` : `${l.number} 号 ${l.name}`;
  });
}
