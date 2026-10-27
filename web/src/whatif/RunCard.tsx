import type { Look } from '../three/players/looks';
import { attackingOf, playerTeam } from '../three/coords';
import { namer } from './names';
import { useLand } from './state';
import type { Outcome } from './onball';

// The off-ball what-if's result (step 3, 2026-10-25; Yi's answer of 2026-10-24: the man on the ball keeps his real pass;
// report the real receiver's chance and space, and the chance had the pass gone to the runner): what can become of the
// real pass with the new run, a click plays another; the real receiver's chance of receiving and keeping it and the
// nearest defender at his touch, with the runner's real run and with this one (the same simulation, only the run
// differs); the defender the run moved most; had the pass gone into the run, his chance of receiving it, which plays
// too. Labelled a simulation throughout (AGENTS.md).

const pct = (p: number) => `${Math.round(p * 100)}%`;

export function RunCard({ meta, nAtt, looks, onShow, onAlt, onRetry, onBack, onReal }: {
  meta: { attacking: string }; nAtt: number; looks: Look[];
  onShow: (i: number) => void; onAlt: () => void; onRetry: () => void; onBack: () => void; onReal: () => void;
}) {
  const st = useLand(), r = st.run;
  if ((st.phase !== 'sim' && st.phase !== 'result') || !r || st.runner === null) return null;
  const attacking = attackingOf(meta), P = (i: number) => st.toPkg[i];
  const name = namer(looks, nAtt, attacking, playerTeam(st.carrier, nAtt, attacking));
  const runner = name(st.runner), receiver = name(r.receiver), by = name(st.carrier);
  const label = (o: Outcome) => o.kind === 'none' ? 'Nobody reaches it' : o.kind === 'out' ? 'Goes out of play'
    : o.kind === 'lost' ? `Dispossessed by ${name(P(o.who))} before the pass`
    : o.kind === 'cut' ? `Cut out by ${name(P(o.who))}`
    : o.kind === 'kept' ? `${name(P(o.who))} receives, keeps it`
    : `${name(P(o.who))} receives, tackled by ${name(P(o.tackle!.by))}`;
  const m = (x: number) => `${x.toFixed(1)}\u00a0m`;
  return (
    <div className="pw-card glass wi-card" aria-label="What if: run there">
      <div className="pw-h"><b>Run there</b><span className="wi-tag">Simulation</span></div>
      <p className="pw-n wi-q">{runner} runs {Math.round(r.len)}&nbsp;m in {r.dur.toFixed(1)}&nbsp;s instead. {by}'s pass to {receiver} is the real one, unchanged.</p>
      <div className="pw-rows">
        {st.outcomes.map((o, i) => (
          <button key={i} className={`pw-r wi-r ${!st.alt && i === st.shown ? 'on' : ''}`} onClick={() => onShow(i)}>
            <span>{label(o)}</span><b>{pct(o.p)}</b>
          </button>
        ))}
      </div>
      <div className="wi-cmp">
        <div className="wi-cmp-h"><span>{runner}'s run:</span><span>real</span><span>this one</span></div>
        <div><span>{receiver} receives it</span><b>{pct(r.base.receive)}</b><b>{pct(r.now.receive)}</b></div>
        <div><span>He keeps it</span><b>{pct(r.base.keep)}</b><b>{pct(r.now.keep)}</b></div>
        <div><span>Nearest defender to him</span><b>{m(r.base.near)}</b><b>{m(r.now.near)}</b></div>
      </div>
      {r.follower && <p className="pw-n">{name(r.follower.who)} went with the run: {m(r.follower.shift)} from where he would have been.</p>}
      {r.alt
        ? <button className={`pw-r wi-r wi-alt ${st.alt ? 'on' : ''}`} onClick={onAlt}><span>Pass into his run instead ({r.alt.loft ? 'lofted' : 'along the ground'}): he receives it</span><b>{pct(r.alt.receive)}</b></button>
        : <p className="pw-n">A pass into {runner}'s run would not reach him in time.</p>}
      {st.ghost && (
        <div className="wi-real">
          <span>Really: {runner} ran the dashed line.</span>
          <button onClick={onReal}>{st.showReal ? 'Hide' : 'Show'}</button>
        </div>
      )}
      <div className="wi-actions">
        <button onClick={onRetry}>Try another run</button>
        <button onClick={onBack}>Back to the real play</button>
      </div>
    </div>
  );
}
