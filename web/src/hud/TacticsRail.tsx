import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Clock } from '../clock';
import { useGameSettings, setSettings, toggleLayer, applyPreset, presetOf, PRESETS, LAYERS, STYLES, SCOPES, type LayerKey, type Preset } from '../game/settings';
import { usePanel, togglePanel, setPanel, getPanel } from './panel';
import { LayerIcon, PresetIcon, StyleIcon, RailIcon } from './icons';
import type { Playback } from './ReplayPlate';
import { drawMode, offsideMark, xgMark, clipMoments, playbackPlaying, exitDrawing, useFreezeFramePlay, base, annot, annotSub, railMenu, BASES, ANNOTS, TOOLS, tool, strokes, undone, undo, redo, clearStrokes, selectedStroke, selectedAt, removeStroke, openZone, type RailMenu, type Tool, useStore } from './draft';
import { ShowMenu } from './ShowMenu';
import { ballHeld, shotHeld } from './passProb';
import { useClockTime } from './useClockTime';
import { tr } from '../i18n';

// The left column: the current mode's tools, a column of icon buttons down the left edge, under the
// score, out of the pitch's way. One column (chosen over two). Hovering a button names it (and its key, or the menu's
// current choice); the buttons with a corner mark open a menu to the right. Group titles are one short word (two
// characters, or four letters in English) so they never widen the column. It slides in when a mode with tools is
// entered and out when it is left, and where the expanded player card would run into it (it can be about 590 px tall)
// it moves aside, to the card's right.
// With `draft` (the HUD preview and ?ui=game; docs/plans/hud-notes.md) every mode has its own: 观赛 the
// display options, 战术 a base map and an annotation (each one at a time, combinable), 画板 the drawing tools; that state
// is draft.ts's. Without it (the preview's ?current=1), the 战术 mode's old display switches (src/game/settings.ts).

const GROUPS: { label: string; of: (typeof LAYERS)[number]['group'] }[] = [
  { label: tr('球员', 'Men'), of: '球员身上' }, { label: tr('阵型', 'Team'), of: '两队阵型' }, { label: tr('球', 'Ball'), of: '球' }, { label: tr('画面', 'Info'), of: '画面' },
];
/** a switch's name on the rail's hover label: the settings' label, shortened where it runs long */
const SHORT: Partial<Record<LayerKey, string>> = { lines: tr('防线和中场线', 'Team lines'), xg: tr('持球人 xG', 'Carrier xG'), toast: tr('事件提示', 'Event toasts') };

/** what a preset turns on, in words, for its menu row (the minimap aside: it has its own switch) */
const presetLine = (p: Preset) => PRESETS[p].layers.filter((k) => k !== 'map').map((k) => SHORT[k] ?? LAYERS.find((l) => l.key === k)?.label ?? k).join(' · ') || tr('只有球员', 'Players only');

/** open or close one of the column's menus (one panel at a time, panel.ts) */
const toggleMenu = (id: RailMenu) => { if (getPanel() === 'rail' && railMenu.get() === id) setPanel(null); else { railMenu.set(id); setPanel('rail'); } };
const openMenu = (id: RailMenu) => { railMenu.set(id); setPanel('rail'); };


export interface TacticsRailProps {
  /** the HUD preview's designs (every mode's column); off in ?ui=game until they are accepted */
  draft?: boolean;
  clock?: Clock;
  playback?: Playback;
}

/** the Tactics pause's glide between moments peaks at this many times play's speed */
const GLIDE_PEAK_SPEED = 2;

/** the pen's link tool: two players, two rings joined by one line (the four joined dots looked like the
 *  zone's shape). The column's icons' style (icons.tsx) */
function LinkIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6.5" cy="17" r="3" /><circle cx="17.5" cy="7" r="3" /><path d="M8.7 15 L15.3 9" />
    </svg>
  );
}

export function TacticsRail({ draft = false, clock, playback }: TacticsRailProps) {
  const { mode, layers, style, scope } = useGameSettings();
  // the Tactics pen (Draw merged into Tactics): `drawMode` now means "the pen is on", in Tactics only
  const penOn = useStore(drawMode) && draft && mode === 'tactics';
  // the freeze frames in play: from a drawing, its marks animate out before play goes on; play pauses on each frame
  useFreezeFramePlay(playback, clock);
  const shown = mode;
  const open = usePanel(), menu = useStore(railMenu), on = draft ? shown === 'watch' || shown === 'tactics' : mode === 'tactics', tab = on ? 0 : -1;
  const preset = presetOf(layers);
  // the draft's state, read here (hooks run every render, whatever the mode)
  const selectedBase = useStore(base), selectedAnnotation = useStore(annot), annotationSubs = useStore(annotSub);
  const held = useStore(ballHeld), shotOk = useStore(shotHeld), offsideOn = useStore(offsideMark), xgOn = useStore(xgMark);
  // a drawn mark selected with the pen (Pen3D.tsx): a delete button by it, and the Delete key (Esc lets it go)
  const selectedMark = useStore(selectedStroke), markAt = useStore(selectedAt);
  useEffect(() => {
    if (!penOn) return;
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')) return;
      const id = selectedStroke.get();
      if (id && (e.key === 'Delete' || e.key === 'Backspace')) { removeStroke(id); e.preventDefault(); }
      else if (id && e.key === 'Escape') selectedStroke.set(null);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [penOn]);
  const selectedTool = useStore(tool), drawnStrokes = useStore(strokes), undoneStrokes = useStore(undone);
  const lastBase = useRef(selectedBase ?? 'pc');
  if (selectedBase) lastBase.current = selectedBase;
  // leaving the mode closes the column's menus (not at load, where ?panel= may have opened one)
  const firstShown = useRef(shown);
  useEffect(() => { if (shown === firstShown.current) return; firstShown.current = shown; const p = getPanel(); if (p === 'presets' || p === 'style' || p === 'rail') setPanel(null); }, [shown]);
  // the draft's 战术: entering the mode starts with nothing on (the plain board, as the settings do); an address that
  // opens in the mode keeps its ?base= and ?annot=
  const wasShown = useRef(shown);
  useEffect(() => { if (shown === 'tactics' && wasShown.current !== 'tactics') { base.set(null); annot.set(null); offsideMark.set(false); xgMark.set(false); } wasShown.current = shown; }, [shown]);
  // the pen pauses the clip, like a telestrator on a frozen picture
  useEffect(() => { if (penOn) playback?.play(false); }, [penOn]); // eslint-disable-line react-hooks/exhaustive-deps
  // the player card (bottom left) grows upward when expanded: if it would reach the column, the column stands to its right
  const ref = useRef<HTMLDivElement>(null);
  const [aside, setAside] = useState<number | null>(null);
  useEffect(() => {
    const rail = ref.current, root = rail?.parentElement;
    if (!on || !rail || !root) { setAside(null); return; }
    let card: Element | null = null;
    const check = () => {
      const c = card?.getBoundingClientRect(), top = rail.getBoundingClientRect().top;
      setAside(c && c.height > 0 && top + rail.offsetHeight + 10 > c.top ? c.right + 10 : null);
    };
    const ro = new ResizeObserver(check);
    // the card's element changes with the selection (the empty tag or the nameplate), so follow the HUD's children
    const attach = () => { const c = root.querySelector('.hud-card'); if (c !== card) { if (card) ro.unobserve(card); card = c; if (c) ro.observe(c); } check(); };
    const mo = new MutationObserver(attach);
    mo.observe(root, { childList: true });
    ro.observe(rail); attach();
    window.addEventListener('resize', check);
    return () => { ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', check); };
  }, [on, shown]);
  let buttonIndex = 0;   // each button's place, for the staggered entrance
  const staggered = () => ({ '--i': buttonIndex++ } as React.CSSProperties);
  const menuOpen = (id: RailMenu) => open === 'rail' && menu === id;

  /** a button that opens a menu to its right; lit says whether what it controls is on */
  const menuButton = ({ id, icon, label, tip, lit, onPress, up, disabled, children }: { id: RailMenu; icon: ReactNode; label: string; tip: string; lit?: boolean; onPress?: () => void; up?: boolean; disabled?: boolean; children: ReactNode }) => (
    <div key={id} className="hud-ranchor">
      <button type="button" className="hud-rbtn menu" style={{ ...staggered(), ...(disabled ? { opacity: 0.35, cursor: 'default' } : {}) }} tabIndex={tab} aria-haspopup="menu" aria-expanded={menuOpen(id)} aria-pressed={lit} aria-disabled={disabled} aria-label={label} data-hud-toggle
        data-tip={menuOpen(id) ? undefined : tip} onClick={disabled ? undefined : onPress ?? (() => toggleMenu(id))}>{icon}</button>
      {menuOpen(id) && <div className={`hud-pop hud-rpop${up ? ' up' : ''}`} role="menu" aria-label={label} data-hud-pop>{children}</div>}
    </div>
  );
  const group = (label: string, children: ReactNode, radio = false) => (
    <div key={label} className="hud-tgroup" role={radio ? 'radiogroup' : 'group'} aria-label={label}>
      <p className="hud-tgroup-label">{label}</p>
      <div className="hud-tgrid">{children}</div>
    </div>
  );

  // ---- the draft's columns
  const tacticsCol = () => {
    const baseLabel = BASES.find((x) => x.key === selectedBase)?.label ?? 'Off';
    return (
      <>
        {group('Map', menuButton({   // was 'Base', a name that did not explain the pitch-control map under it
          id: 'base', icon: <RailIcon name="space" size={20} />, label: 'Map', lit: !!selectedBase, tip: `Map · ${baseLabel}`,   // the popover and the tip follow the group's name (Map)
          onPress: () => { if (selectedBase) { base.set(null); setPanel(null); } else { base.set(lastBase.current); openMenu('base'); } },
          children: <>
            <p className="hud-rpop-h">Map</p>
            {BASES.map((x) => (
              <button key={x.key} type="button" role="menuitemradio" aria-checked={selectedBase === x.key} className="hud-rrowbtn" onClick={() => base.set(x.key)}>
                <b>{x.label}{x.abbr && <span className="hud-rrow-abbr">{x.abbr}</span>}</b>
              </button>
            ))}
          </>,
        }))}
        {group(tr('标注', 'Mark'), [...ANNOTS.map((x) => {
          // a mark without sub-options (Passing) is a plain switch, greyed while paused with nobody on the ball
          if (!x.subs.length) {
            const disabled = x.key === 'pass' && !held;
            return (
              <button key={x.key} type="button" className="hud-rbtn" style={{ ...staggered(), ...(disabled ? { opacity: 0.35, cursor: 'default' } : {}) }} tabIndex={tab}
                aria-pressed={selectedAnnotation === x.key} aria-disabled={disabled} aria-label={x.label} data-tip={disabled ? `${x.label} · nobody on the ball` : x.label}
                onClick={disabled ? undefined : () => { annot.set(selectedAnnotation === x.key ? null : x.key); setPanel(null); }}>
                <RailIcon name={x.key} size={20} />
              </button>
            );
          }
          const chosenSub = x.subs.find((option) => option.key === annotationSubs[x.key]);
          return menuButton({
            id: x.key, icon: <RailIcon name={x.key} size={20} />, label: x.label, lit: selectedAnnotation === x.key, disabled: x.key === 'pass' && !held,
            tip: x.key === 'pass' && !held ? `${x.label} · nobody on the ball` : `${x.label} · ${chosenSub?.label ?? ''}`,
            onPress: () => { if (selectedAnnotation === x.key) { annot.set(null); setPanel(null); } else { annot.set(x.key); openMenu(x.key); } },
            children: <>
              <p className="hud-rpop-h">{x.label}</p>
              {x.subs.map((s) => (
                <button key={s.key} type="button" role="menuitemradio" aria-checked={annotationSubs[x.key] === s.key} className="hud-rrowbtn" onClick={() => annotSub.set((previous) => ({ ...previous, [x.key]: s.key }))}>
                  <b>{s.label}</b>
                </button>
              ))}
            </>,
          });
        }),
          // the shot chance, a switch of its own: the player on the ball's xG if he shot now; greyed as Passing
          <button key="xg" type="button" className="hud-rbtn" style={{ ...staggered(), ...(!shotOk ? { opacity: 0.35, cursor: 'default' } : {}) }} tabIndex={tab}
            aria-pressed={xgOn} aria-disabled={!shotOk} aria-label="Shot xG"
            data-tip={shotOk ? 'Shot xG: his chance if he shot now' : held ? "Shot xG · in the opponents' half only" : 'Shot xG · nobody on the ball'}
            onClick={shotOk ? () => xgMark.set((on) => !on) : undefined}>
            <RailIcon name="shot" size={20} />
          </button>,
          // the offside line, a switch of its own: it can be on with the passing mark
          <button key="offside" type="button" className="hud-rbtn" style={staggered()} tabIndex={tab} aria-pressed={offsideOn} aria-label="Offside line" data-tip="Offside line"
            onClick={() => offsideMark.set((on) => !on)}>
            <LayerIcon layer="offside" size={20} />
          </button>,
        ])}
        {penGroup()}
      </>
    );
  };

  // ---- the pen (telestration-notes §22): a switch; while it is on, the clip pauses, the
  // pointer draws (Pen3D.tsx) and a palette beside it holds the tools, the tool's options and undo, redo, clear
  const toolIcon = (key: Tool) => {
    switch (key) {
      case 'vision': return <LayerIcon layer="fov" size={20} />;
      case 'trail': return <LayerIcon layer="trail" size={20} />;
      case 'link': return <LinkIcon size={20} />;
      case 'highlight': return <RailIcon name="circle" size={20} />;
      case 'pass': return <RailIcon name="pass_tool" size={20} />;
      case 'run': return <RailIcon name="run_tool" size={20} />;
      default: return <RailIcon name={key} size={20} />;
    }
  };
  const penGroup = () => {
    const current = TOOLS.find((x) => x.key === selectedTool) ?? TOOLS[0];
    // the zone's hint follows its clicks, so the viewer knows when and where to close it
    const corners = selectedTool === 'zone' ? openZone(drawnStrokes)?.pts.length ?? 0 : 0;
    const how = !corners ? current.how : corners < 3 ? 'Click the next corner' : 'Click the first corner to close';
    return group('Pen', (
      <div key="pen" className="hud-ranchor">
        <button type="button" className="hud-rbtn" style={staggered()} tabIndex={tab} aria-pressed={penOn} aria-label="Pen"
          data-tip={penOn ? undefined : 'Pen: draw on the pitch'} onClick={() => { drawMode.set(!penOn); setPanel(null); }}>
          <RailIcon name="pen" size={20} />
        </button>
        {penOn && (
          <div className="hud-pop hud-rpop" role="toolbar" aria-label="Pen tools" data-hud-pop style={{ width: 'min-content' }}>   {/* as wide as the four-across tools */}
            <p className="hud-rpop-h">{current.label}</p>
            <div role="radiogroup" aria-label="Tools" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 34px)', gap: 6, margin: '2px 0 8px' }}>
              {TOOLS.map((x) => (
                <button key={x.key} type="button" role="radio" className="hud-rbtn" aria-checked={selectedTool === x.key} aria-label={x.label} data-tip={x.label} onClick={() => tool.set(x.key)}>
                  {toolIcon(x.key)}
                </button>
              ))}
            </div>
            <p style={{ margin: '6px 0 8px', fontSize: 12, lineHeight: 1.35, color: 'var(--ink-2)' }}>{how}</p>
            <div role="group" aria-label="Edit" style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="hud-rbtn" disabled={!drawnStrokes.length} aria-label="Undo" data-tip="Undo" onClick={undo}><RailIcon name="undo" size={20} /></button>
              <button type="button" className="hud-rbtn" disabled={!undoneStrokes.length} aria-label="Redo" data-tip="Redo" onClick={redo}><RailIcon name="redo" size={20} /></button>
              <button type="button" className="hud-rbtn" disabled={!drawnStrokes.length} aria-label="Clear the drawing" data-tip="Clear the drawing" onClick={clearStrokes}><RailIcon name="clear" size={20} /></button>
            </div>
          </div>
        )}
      </div>
    ));
  };

  // the Tactics pause (a pause and two buttons, the previous and the next event, so the viewer can easily find a
  // moment to draw passing probabilities or xG on): at the top centre while
  // paused, in place of the what-if's pause window, the clip's on-ball moments one by one (clipMoments, TacticsItems)
  const moments = useStore(clipMoments), playing = useStore(playbackPlaying), now = useClockTime(clock ?? { t: 0 } as Clock, 4);
  const prevMoment = [...moments].reverse().find((m) => m.t < now - 0.05), nextMoment = moments.find((m) => m.t > now + 0.05);
  const atMoment = moments.find((m) => Math.abs(m.t - now) <= 0.05);
  // no jump (the players never teleport: play runs on at up to twice its speed and stops at the next event, easing in
  // and out rather than linear): the clock glides there, backwards for
  // the previous event, on a cosine ease, its peak speed twice play's; pressing play stops the glide
  const glide = useRef<number | null>(null);
  const stopGlide = () => { if (glide.current !== null) cancelAnimationFrame(glide.current); glide.current = null; };
  useEffect(() => stopGlide, []);
  useEffect(() => { if (playing || shown !== 'tactics') stopGlide(); }, [playing, shown]);
  const go = (m?: { t: number }) => {
    if (!m || !playback || !clock) return;
    stopGlide(); playback.play(false);
    exitDrawing(() => {   // the drawing animates out first (its freeze frame stays), then the glide
      const from = clock.t, to = m.t, span = Math.abs(to - from);
      if (span < 0.02) return;
      const ms = Math.max(350, ((Math.PI * span) / (2 * GLIDE_PEAK_SPEED)) * 1000);   // a cosine ease peaks at π/2 x its mean speed
      const start = performance.now();
      const step = (frame: number) => {
        const u = Math.min(1, (frame - start) / ms), eased = (1 - Math.cos(Math.PI * u)) / 2;
        playback.seek(from + (to - from) * eased);
        glide.current = u < 1 ? requestAnimationFrame(step) : null;
      };
      glide.current = requestAnimationFrame(step);
    });
  };
  const hudRootEl = ref.current?.closest('.hud') as HTMLElement | null | undefined;
  const pausePanel = draft && shown === 'tactics' && clock && playback && !playing && moments.length && hudRootEl ? createPortal(
    <div className="pw glass hud-pause" role="group" aria-label="Paused" style={{ pointerEvents: 'auto', width: 'auto', minWidth: 300 }}>
      <div className="pw-h"><b>Paused</b>{atMoment && <span>{atMoment.label}</span>}</div>
      <div className="pw-o" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>   {/* the two buttons span the panel */}
        <button type="button" disabled={!prevMoment} onClick={() => go(prevMoment)} style={{ width: '100%', justifyContent: 'center' }}><span aria-hidden="true" style={{ marginRight: 'var(--s5)' }}>‹</span>Previous event</button>
        <button type="button" disabled={!nextMoment} onClick={() => go(nextMoment)} style={{ width: '100%', justifyContent: 'center' }}>Next event<span aria-hidden="true" style={{ marginLeft: 'var(--s5)' }}>›</span></button>
      </div>
    </div>, hudRootEl) : null;

  // the delete button, on the HUD (not inside the column, which slides): above the selected mark's highest point
  const hudRoot = ref.current?.closest('.hud') as HTMLElement | null | undefined;
  const deleteButton = penOn && selectedMark && markAt && hudRoot ? (() => {
    const r = hudRoot.getBoundingClientRect();
    return createPortal(
      <div className="hud-glass" style={{ position: 'absolute', left: markAt[0] - r.left - 21, top: markAt[1] - r.top - 52, padding: 4, borderRadius: 8, zIndex: 30, pointerEvents: 'auto' }}>   {/* the HUD layer itself lets clicks through */}
        <button type="button" className="hud-rbtn" aria-label="Delete this drawing" data-tip="Delete (Del)" onClick={() => removeStroke(selectedMark)}><RailIcon name="clear" size={20} /></button>
      </div>, hudRoot);
  })() : null;

  return (
    <>
    {deleteButton}
    {pausePanel}
    <div ref={ref} className={`hud-rail${on ? ' on' : ''}`} style={aside === null ? undefined : { left: aside }} role="toolbar" aria-orientation="vertical" aria-label={tr('当前模式的工具', "This mode's tools")} aria-hidden={!on}>
      {draft ? (
        <div key={shown} className="hud-rail-in">
          {/* 观赛's display options are the Show menu, in Watch and Tactics */}
          {shown === 'watch' && <ShowMenu tabIndex={tab} />}
          {shown === 'tactics' && tacticsCol()}
          {/* the player style is in the Show menu (one button, not two with the same icon) */}
          {shown === 'tactics' && <ShowMenu tabIndex={tab} />}
        </div>
      ) : (
        <>
          <div className="hud-ranchor">
            <button type="button" className="hud-rbtn menu" style={staggered()} tabIndex={tab} aria-haspopup="menu" aria-expanded={open === 'presets'} aria-label={tr('预设', 'Presets')} data-hud-toggle
              data-tip={open === 'presets' ? undefined : `${tr('预设', 'Preset')} · ${preset ? PRESETS[preset].label : tr('自定义', 'Custom')}`} onClick={() => togglePanel('presets')}>
              <PresetIcon size={20} />
            </button>
            {open === 'presets' && (
              <div className="hud-pop hud-rpop" role="menu" aria-label={tr('预设', 'Presets')} data-hud-pop>
                <p className="hud-rpop-h">{tr('预设', 'Presets')}</p>
                {(Object.keys(PRESETS) as Preset[]).map((p) => (
                  <button key={p} type="button" role="menuitemradio" aria-checked={preset === p} className="hud-rrowbtn" onClick={() => { applyPreset(p); setPanel(null); }}>
                    <b>{PRESETS[p].label}</b><small>{presetLine(p)}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
          {GROUPS.map((g) => {
            const keys = LAYERS.filter((l) => l.group === g.of && l.key !== 'map');
            if (!keys.length) return null;
            return (
              <div key={g.label} className="hud-tgroup" role="group" aria-label={g.label}>
                <p className="hud-tgroup-label">{g.label}</p>
                <div className="hud-tgrid">
                  {keys.map((l) => (
                    <button key={l.key} type="button" className="hud-rbtn" style={staggered()} tabIndex={tab} aria-pressed={layers.includes(l.key)} aria-label={l.label}
                      data-tip={`${SHORT[l.key] ?? l.label}`} data-key={l.hotkey} onClick={() => toggleLayer(l.key)}>
                      <LayerIcon layer={l.key} size={20} />
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {styleMenu()}
        </>
      )}
    </div>
    </>
  );

  function styleMenu() {
    return (
      <div className="hud-ranchor">
        <button type="button" className="hud-rbtn menu" style={staggered()} tabIndex={tab} aria-haspopup="menu" aria-expanded={open === 'style'} aria-label={tr('球员样式', 'Player style')} data-hud-toggle
          data-tip={open === 'style' ? undefined : `${tr('球员样式', 'Player style')} · ${STYLES.find((x) => x.key === style)?.label}`} onClick={() => togglePanel('style')}>
          <StyleIcon size={20} />
        </button>
        {open === 'style' && (
          <div className="hud-pop hud-rpop up" role="dialog" aria-label={tr('球员样式', 'Player style')} data-hud-pop>
            <p className="hud-rpop-h">{tr('球员样式', 'Player style')}</p>
            <div className="hud-chips">{STYLES.map((x) => <button key={x.key} type="button" aria-pressed={style === x.key} onClick={() => setSettings({ style: x.key })}>{x.label}</button>)}</div>
            <p className="hud-rpop-h">{tr('显示在谁身上', 'Shown on')}</p>
            <div className="hud-chips">{SCOPES.map((x) => <button key={x.key} type="button" aria-pressed={scope === x.key} onClick={() => setSettings({ scope: x.key })}>{x.label.replace('只看', '').replace(' only', '')}</button>)}</div>
          </div>
        )}
      </div>
    );
  }
}
