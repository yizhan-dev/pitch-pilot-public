// The Explain mode's page part (mounted by GameApp): loads the clip's director script, if it has one, for
// explain/director.ts, and shows its subtitles (the board's look: one line, white on the HUD's dark glass, above the
// minimap) and the commentary's sound switch. The clock, the drawings, the cameras and the voice run in the frame loop
// (explainTick); this only draws what they publish.
import { useEffect } from 'react';
import type { Loaded } from '../data';
import { useGameSettings } from '../game/settings';
import { loadDirected, setDirected, setSound, soundOn, useExplain } from './director';
import './narration.css';

export function ExplainPlayer({ data }: { data: Loaded }) {
  const game = useGameSettings(), v = useExplain();
  useEffect(() => {
    let live = true;
    setDirected(null);
    loadDirected(data).then((d) => { if (live) setDirected(d); }).catch(() => undefined);
    return () => { live = false; setDirected(null); };
  }, [data]);
  if (game.mode !== 'explain' || !v.active) return null;
  const mapOn = game.layers.includes('map'), sound = soundOn() && !v.locked;
  return (<>
    <div className={`nr ${mapOn ? '' : 'nr-low'}`} aria-live="polite">
      {v.sub && <div className="nr-box" style={{ opacity: 1 }}><span className="nr-txt">{v.sub}</span></div>}
    </div>
    <button className={`nr-sound ${sound ? 'on' : ''}`} aria-pressed={sound} title={v.locked ? 'The browser held the sound back: click to turn the commentary on' : sound ? 'Turn the commentary off' : 'Turn the commentary on'}
      onClick={() => { if (v.locked) { const a = new Audio(); a.play().catch(() => undefined); setSound(true); } else setSound(!soundOn()); }}>
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />{sound ? <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /> : <path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}</svg>
      <span>{v.locked ? 'Click for commentary' : sound ? 'Commentary on' : 'Commentary off'}</span>
    </button>
  </>);
}
