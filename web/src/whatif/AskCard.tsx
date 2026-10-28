import { useState } from 'react';
import type { Look } from '../three/players/looks';
import { attackingOf, playerTeam } from '../three/coords';
import { useLand } from './state';
import { namer } from './names';
import { noShotWhy, type ShotEval } from './shot';

/** the chain (Continue from here, Start over) is off for this version: one step, the pass and what came of it (Yi,
 *  2026-10-27 night: "we only allow user to make one step, they can not continue from there"); the code stays */
const CHAIN = false;

/** how he finished and what the control would have cost, as data (Yi, 2026-10-27 night: the control's chance of being
 *  disrupted shown, not only used): "Volley first time · a touch 71% disrupted", "A touch, then a drive · 29% disrupted" */
function finishLine(ev: ShotEval): string {
  const b = ev.best, t = ev.touch, pct = t ? `${Math.round(t.pLose * 100)}% disrupted` : null;
  if (!b) return '';
  if (b.how === 'touch') return `A touch, then a drive${pct ? ` · ${pct}` : ''}`;
  const kind = b.kind === 'header' ? 'Header' : b.kind === 'volley' ? 'Volley' : 'Drive';
  return `${kind} first time${pct ? ` · a touch ${pct}` : ''}`;
}

// The What-if's widget at the top centre (Yi, 2026-10-26: "keep it simple: What would you do?"; "the goal is to make it
// very easy to use and read"; "keep the top widget simple and minimal"). While he picks: the question and Pass | Shoot
// only, each option's chance by his name on the pitch (WhatIfTags.tsx, as Tactics shows its pass chance); Shoot plays
// his shot from here (his real shot at a shooting moment). While the pass is worked out and plays: the title alone. At
// the stop (Yi: "we do not need to show xG, #15 Marsh: a touch then a drive, etc", "just show Simulation (also drop the
// time to its right), and then the buttons", "we can delete the details button for this MVP"): the title, "Simulation"
// or "Real play", the outcome in a word only where the pitch shows no xG for it (offside, no shot, a pass that does not
// reach him), and one row of buttons: Continue from here, Try another, and Start over once a chain has begun (before
// that it would do the same as Try another). No verdict against the real choice (Yi: "just show the data").

export function AskCard({ meta, nAtt, looks, onShoot, onContinue, onRetry, onStartOver }: {
  meta: { attacking: string }; nAtt: number; looks: Look[];
  onShoot: () => void; onContinue: () => void; onRetry: () => void; onStartOver: () => void;
}) {
  const st = useLand(), [tool, setTool] = useState<'pass' | 'shoot'>('pass');
  if (st.carrier < 0) return null;
  const attacking = attackingOf(meta), name = namer(looks, nAtt, attacking, playerTeam(st.carrier, nAtt, attacking));
  const picking = st.phase === 'pick', computing = st.phase === 'computing', done = st.phase === 'result';
  const n = st.options?.length ?? 0, first = st.steps.length === 0;
  // a shot ends the move (his real one, or his shot from here, has no "continue"), and so does an offside pass
  const off = st.shot?.no?.why === 'offside';
  const ownShot = st.isReal && st.atShot && st.info?.who === st.carrier;
  const shotEnd = st.isShot || ownShot || off;
  const got = done && !!st.info && st.info.who >= 0 && st.info.outcome.kind === 'kept' && !shotEnd;
  const o = st.outcomes[st.shown];
  const word = !done ? null : off ? 'Offside'
    : st.shot && (got || ownShot || st.isShot) ? (st.shot.no || !st.shot.eval.best ? 'No shot' : null)
    : o && o.kind !== 'kept' ? (o.kind === 'cut' ? (looks[o.who]?.keeper ? 'Claimed by the keeper' : 'Cut out') : o.kind === 'lost' ? 'Dispossessed' : o.kind === 'tackled' ? 'Tackled' : o.kind === 'out' ? 'Out of play' : 'Nobody reaches it') : null;
  const title = picking ? (first ? 'What would you do?' : 'What next?') : computing ? (st.auto ? 'His choice' : 'Simulating') : st.isReal ? 'Real play' : 'Simulation';
  return (
    <div className="glass wi-ask" aria-label="What if">
      <div className="wi-ask-h"><b>{title}</b></div>
      {picking && <>
        <div className="wi-seg" role="tablist">
          <button role="tab" aria-selected={tool === 'pass'} className={tool === 'pass' ? 'on' : ''} onClick={() => setTool('pass')}>Pass</button>
          <button role="tab" aria-selected={tool === 'shoot'} className={tool === 'shoot' ? 'on' : ''} onClick={() => { setTool('shoot'); onShoot(); }}>Shoot</button>
        </div>
        {tool === 'pass' && st.optionsDone && n === 0 && <p className="wi-ask-q">He has no pass worth trying from here.</p>}
        {tool === 'shoot' && !st.atShot && st.shootHere?.no && <p className="wi-ask-q">No shot from here: {noShotWhy(st.shootHere.no, name)}.</p>}
        {st.optionsDone && <p className="pw-n">Esc to leave the what-if.</p>}
      </>}
      {done && <>
        {word && <p className="wi-ask-out">{word}</p>}
        {!word && got && st.shot?.eval.best && !st.isReal && <p className="wi-ask-out">{finishLine(st.shot.eval)}</p>}
        <div className="wi-ask-act">
          {CHAIN && got && <button className="wi-ask-go" onClick={onContinue} disabled={st.thinking}>Continue from here</button>}
          <button onClick={onRetry}>Try another</button>
          {CHAIN && !first && <button onClick={onStartOver}>Start over</button>}
        </div>
      </>}
    </div>
  );
}
