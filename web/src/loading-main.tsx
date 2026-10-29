import { assetFile } from './data/paths';
import { hook, hooked } from './dev';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/barlow-condensed/600.css';
import { LoadingScene } from './loading/LoadingScene';
import type { LookKey } from './loading/looks';

// The loading scene's own page (/loading.html): the scene over a still of the line-up show's first
// drone frame, a progress slider and a ready button. Address: ?look=ring|ringtilt|pass|hex &name=<text> (empty: none)
// &ui=0 (no panel) &sim=fast|slow (a load played on the scene's clock: fast is in by 0.5 s, slow stalls twice and is in
// by 5.5 s). Hooks for the headless recordings: __frames, __replay (and the scene's __teleNow).
const q = new URLSearchParams(location.search);
const LOOK_NAMES: { key: LookKey; label: string }[] = [{ key: 'ring', label: 'A1 Ring' }, { key: 'ringtilt', label: 'A2 On the pitch' }, { key: 'pass', label: 'B First pass' }, { key: 'hex', label: 'C Board' }];
const SIM = q.get('sim');
/** the simulated load: progress and ready at time t */
function sim(t: number): [number, boolean] {
  if (SIM === 'fast') return [Math.min(1, t / 0.5), t >= 0.6];
  // slow: in steps, stalling at 40% and at 80%
  const k: [number, number][] = [[0, 0], [0.6, 0.15], [2.0, 0.4], [3.0, 0.42], [4.4, 0.8], [5.0, 0.81], [5.5, 1]];
  let p = 1;
  for (let i = 1; i < k.length; i++) if (t < k[i][0]) { const [t0, p0] = k[i - 1], [t1, p1] = k[i]; p = p0 + ((p1 - p0) * (t - t0)) / (t1 - t0); break; }
  return [p, t >= 5.6];
}

function Page() {
  const [look, setLook] = useState<LookKey>(((['ring', 'ringtilt', 'pass', 'hex'] as const).find((k) => k === q.get('look')) ?? 'ring'));
  const [name, setName] = useState(q.get('name') ?? 'Pitch Pilot');
  const [progress, setProgress] = useState(0), [ready, setReady] = useState(false), [exited, setExited] = useState(false), [run, setRun] = useState(0);
  const t0 = useRef(performance.now() / 1000);
  // the frame counter, and the simulated load on the scene's clock
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      hook('frames', (hooked<number>('frames') ?? 0) + 1);
      if (SIM) { const tn = hooked<number>('teleNow'), t = typeof tn === 'number' ? tn : performance.now() / 1000 - t0.current, [p, r] = sim(t); setProgress(p); setReady(r); }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const replay = () => {
    t0.current = performance.now() / 1000; setExited(false); setRun((n) => n + 1);
    if (!SIM) { setProgress(0); setReady(false); }
    hooked<() => void>('loadReplay')?.();
  };
  hook('replay', replay);
  return (
    <>
      <img className="ld-back" src={assetFile('loading/drone.jpg')} alt="" />
      {!exited && <LoadingScene key={run} progress={progress} ready={ready} onExit={() => setExited(true)} name={name} look={look} />}
      {q.get('ui') !== '0' && (
        <div className="ld-panel">
          <div className="ld-row">{LOOK_NAMES.map((l) => <button key={l.key} className={look === l.key ? 'on' : ''} onClick={() => { setLook(l.key); replay(); }}>{l.label}</button>)}</div>
          <div className="ld-row"><span>Progress</span><input type="range" min={0} max={1} step={0.01} value={progress} disabled={!!SIM} onChange={(e) => setProgress(+e.target.value)} /><b>{Math.round(progress * 100)}%</b></div>
          <div className="ld-row"><button className={ready ? 'on' : ''} disabled={!!SIM} onClick={() => setReady(true)}>Ready</button><button onClick={replay}>Replay</button>{exited && <span className="ld-note">exited: the show would start</span>}</div>
          <div className="ld-row"><span>Name</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} /></div>
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<Page />);
