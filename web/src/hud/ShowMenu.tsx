import { useRef, useState } from 'react';
import { useGameSettings, toggleShow, setShowStyle, setShowWho, toggleLayer, SHOW_WHAT, SHOW_WHO, SHOW_STYLES } from '../game/settings';
import { usePanel, togglePanel } from './panel';
import { StyleIcon, BallIcon } from './icons';

// The Show menu: one button at the bottom of every mode's left column (the column is
// TacticsRail; it mounts <ShowMenu /> beside the player-style button) and its panel, opening upward to the right. What:
// name, stamina (multi; the MVP's two); the player style (Toon, Skeleton, Silhouette, Ghost, one at a
// time); on whom, one condition shared by all three: the player on the ball, the selected one, either
// team, all (one at a time). The button wears the player-style figure (the first icon was confusing).
// The choices live in settings.ts `show`, shared by every mode and kept across them; the 3D side draws them
// (three/layers/ShowLayer.tsx: one tag over the head, the stamina bar under the name; Stage: the chosen players in the
// style, the rest toon).

/** `tabIndex`: the column's, so the button leaves the tab order while the column is hidden. Under it, a switch of its own
 *  for the ball's trail (a separate button under the Show button, a ball for its icon): the 'ball' layer,
 *  drawn by three/layers/GameLayers.tsx */
export function ShowMenu({ tabIndex = 0 }: { tabIndex?: number }) {
  const { show, layers } = useGameSettings(), open = usePanel() === 'show', trail = layers.includes('ball');
  // which way the panel opens, decided on the press from where the button is (one render, no flip after measuring,
  // which lagged): in the screen's lower half (Tactics, the column's bottom) upward, its bottom edge on the
  // button's; in the upper half (Watch, the column's only button) downward, its top edge on the button's
  const btn = useRef<HTMLButtonElement>(null), [up, setUp] = useState(true);
  const press = () => { const r = btn.current?.getBoundingClientRect(); if (r) setUp(r.top > window.innerHeight / 2); togglePanel('show'); };
  const drawn = [...SHOW_WHAT.filter((x) => show.what.includes(x.key)).map((x) => x.label), ...(show.style !== 'toon' ? [SHOW_STYLES.find((x) => x.key === show.style)!.label] : [])];
  const tip = `Show · ${drawn.length ? drawn.join(', ') : 'Nothing on the players'}`;
  // one anchor in the column for both buttons, so the column's divider (.hud-ranchor:last-child) stays above Show
  return (
    <div className="hud-ranchor hud-showgroup">
    <div className="hud-ranchor-in">
      <button type="button" className="hud-rbtn menu" tabIndex={tabIndex} aria-haspopup="dialog" aria-expanded={open} aria-pressed={drawn.length > 0} aria-label="Show" data-hud-toggle
        data-tip={open ? undefined : tip} ref={btn} onClick={press}>
        <StyleIcon size={20} />
      </button>
      {open && (
        <div className={`hud-pop hud-rpop${up ? ' up' : ''} hud-showpop`} role="dialog" aria-label="Show" data-hud-pop>
          <p className="hud-rpop-h">Show</p>
          <div className="hud-chips">{SHOW_WHAT.map((x) => <button key={x.key} type="button" aria-pressed={show.what.includes(x.key)} onClick={() => toggleShow(x.key)}>{x.label}</button>)}</div>
          <p className="hud-rpop-h">Player style</p>
          <div className="hud-chips">{SHOW_STYLES.map((x) => <button key={x.key} type="button" aria-pressed={show.style === x.key} onClick={() => setShowStyle(x.key)}>{x.label}</button>)}</div>
          <p className="hud-rpop-h">On</p>
          <div className="hud-chips">{SHOW_WHO.map((x) => <button key={x.key} type="button" aria-pressed={show.who === x.key} onClick={() => setShowWho(x.key)}>{x.label}</button>)}</div>
        </div>
      )}
    </div>
    <div className="hud-ranchor-in">
      <button type="button" className="hud-rbtn" tabIndex={tabIndex} aria-pressed={trail} aria-label="Ball trail" data-tip={trail ? 'Ball trail · on' : 'Ball trail'} onClick={() => toggleLayer('ball')}>
        <BallIcon size={20} />
      </button>
    </div>
    </div>
  );
}
