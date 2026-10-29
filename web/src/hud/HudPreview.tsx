import { clipAddr, parseClip } from '../data/paths';
import { hook, hooked } from '../dev';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadMoment, duration, type Loaded } from '../data';
import { makeClock } from '../clock';
import { getSettings, setSettings, useGameSettings, MODES } from '../game/settings';
import { makeLooks, keepersOf } from '../three/players/looks';
import { clipLooks, useRoster } from '../lineup/roster';
import { Hud } from './Hud';
import { PreviewStage } from './PreviewStage';
import type { Playback } from './ReplayPlate';
import { DEFAULT_MOMENT, INDEX_FILE, type ClipIndex, type ClipPkg } from './match';
import { ViewIcon } from './icons';
import { VIEW_UI } from './views';
import { MODE_OPTIONS, OptionIcon, isPicked } from './modeIconOptions';
import { ShowMenu } from './ShowMenu';

/** ?sheet=mode-icons: candidates for the three modes' icons, one row per mode: large, at HUD size, and on the 模式
 *  button itself; the one the HUD shows meanwhile is outlined */
function ModeIconSheet() {
  return (
    <div className="hud-sheet hud-msheet">
      {MODES.map((m) => (
        <section key={m.key}>
          <h2>{m.label}<small>{m.sub}</small></h2>
          <div className="hud-msheet-row">
            {MODE_OPTIONS[m.key].map((o) => (
              <figure key={o.id} className={isPicked(m.key, o.id) ? 'cur' : ''}>
                <OptionIcon node={o.node} size={96} />
                <div className="hud-sheet-small"><OptionIcon node={o.node} size={28} /><OptionIcon node={o.node} size={18} /></div>
                <span className="hud-btn hud-glass">模式<span className="hud-val"><OptionIcon node={o.node} size={18} />{m.label}</span></span>
                <figcaption><b>{o.id}</b> {o.name}{o.note && <em>{o.note}</em>}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
/** ?cards=7:yellow,12:red: preview-only bookings at the clip's first moment, to see the badges without real data */
function withPreviewCards(pkg: ClipPkg, spec: string | null): ClipPkg {
  if (!spec) return pkg;
  const kinds = ['yellow', 'red', 'second-yellow'] as const;
  const cards = spec.split(',').map((x) => x.split(':')).filter(([p, k]) => Number.isInteger(+p) && (kinds as readonly string[]).includes(k))
    .map(([p, k]) => ({ player: +p, clock: pkg.clock0 ?? 0, kind: k as (typeof kinds)[number] }));
  return { ...pkg, cards: [...(pkg.cards ?? []), ...cards] };
}

/** ?sheet=show: the Show menu (ShowMenu.tsx) alone in a column on the grass, for checking it by eye before it is mounted
 *  at the bottom of the left column; ?panel=show opens its panel */
function ShowSheet() {
  return (
    <div className="hud-preview"><div className="hud-preview-bg grass" />
      <div className="hud"><div className="hud-rail on" style={{ top: 'auto', bottom: 120 }}><div className="hud-rail-in"><ShowMenu /></div></div></div>
    </div>
  );
}

/** ?sheet=icons: the view icons large and at HUD size, for checking them by eye */
function IconSheet() {
  const rows = VIEW_UI.filter((v) => !v.hidden).map((v) => ({ key: v.key, label: v.label }));
  return (
    <div className="hud-sheet">
      {rows.map((r) => (
        <figure key={r.key}>
          <ViewIcon view={r.key} size={120} />
          <div className="hud-sheet-small"><ViewIcon view={r.key} size={24} /><ViewIcon view={r.key} size={18} /></div>
          <figcaption>{r.label}</figcaption>
        </figure>
      ))}
    </div>
  );
}

// The HUD's own preview page (/hud.html), without the 3D pitch: a dark stand-in behind the overlays, one clip loaded
// with loadMoment and played on a local clock. ?moment=<clip> picks the clip, ?t=<s> holds the time (for screenshots),
// ?panel=... opens a panel, and the settings parameters (view, layers, style, scope, sel) work as in ?ui=game.
// The pitch is not here to click on, so a player starts selected (the clip's shooter, else the first
// attacker); ?sel=<i> picks another and ?sel=none starts with nobody. Space plays and pauses; [ and ] step the selected
// player, \ clears it. ?cards=7:yellow,12:red,3:second-yellow gives players cards from the clip's start, to preview the
// card badges (design only: the real cards come from the export). ?bg=grass puts mowed grass behind the overlays instead of
// the dark stand-in, to judge the see-through parts against something like the pitch (plain CSS, no match imagery); in the
// 战术 mode it turns the dark grey of the 3D side's analysis board, as the pitch does in ?ui=game.
// The preview shows the HUD's draft designs (the next proposals: the 战术 mode's analysis layers); ?current=1
// shows the HUD as ?ui=game has it.

export function HudPreview() {
  const q = useMemo(() => new URLSearchParams(location.search), []);
  const address = parseClip(q.get('moment') ?? DEFAULT_MOMENT), moment = clipAddr(address.id, address.match);
  const hold = q.get('t');
  const clock = useMemo(makeClock, []);
  const [data, setData] = useState<Loaded | null>(null);
  const [index, setIndex] = useState<ClipIndex | null>(null);
  const [playing, setPlaying] = useState(hold === null);
  const [speed, setSpeed] = useState(1);
  const { mode } = useGameSettings();
  const draft = !q.has('current');
  // the replay plate's controls, on the preview's own clock (in ?ui=game the 3D side provides these)
  const play = useCallback((on: boolean) => { clock.playing = on; setPlaying(on); }, [clock]);
  const playback: Playback | undefined = data ? {
    playing, speed, duration: duration(data.pkg), play,
    seek: (x: number) => { clock.t = x; },
    setSpeed: (s: number) => { clock.rate = s; setSpeed(s); },
    // another clip: a fresh page with the other parameters kept, as GameApp does
    gotoClip: (m: string) => { const u = new URLSearchParams(location.search); u.set('moment', m); u.delete('t'); location.search = u.toString(); },
  } : undefined;

  useEffect(() => {
    loadMoment(moment).then((d) => {
      if (!q.has('sel')) setSettings({ selected: (d.pkg.meta as { shot?: { shooter?: number } }).shot?.shooter ?? 0 });
      setData(d);
    });
  }, [moment, q]);
  useEffect(() => { fetch(INDEX_FILE).then((r) => (r.ok ? r.json() : null)).then(setIndex).catch(() => undefined); }, []);

  // the local clock: plays from the start and loops, unless ?t= holds it; window.__frames counts frames for scripts/shot.mjs
  useEffect(() => {
    if (!data) return;
    const end = duration(data.pkg);
    if (hold !== null) { clock.t = Math.min(end, Math.max(0, +hold || 0)); clock.playing = false; } else { clock.t = 0; clock.playing = true; }
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      // forward loops at the end; rewinding stops at the start, paused, back at 1x (as in GameApp)
      if (clock.playing) { clock.t += dt * clock.rate; if (clock.t > end) clock.t = 0; if (clock.t < 0) { clock.t = 0; clock.rate = 1; setSpeed(1); clock.playing = false; setPlaying(false); } }
      hook('frames', (hooked<number>('frames') ?? 0) + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const P = data.pkg.frames[0].att.length + data.pkg.frames[0].def.length;
    const key = (e: KeyboardEvent) => {
      // the page's own keys, but never over a focused control, an editable field or a modifier (review F11): Space on a
      // button presses that button
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.('button, input, textarea, select, [contenteditable], [role="button"], [role="slider"]')) return;
      if (e.key === ' ') { play(!clock.playing); e.preventDefault(); }
      else if (e.key === '[' || e.key === ']') { const s = getSettings().selected, d = e.key === ']' ? 1 : -1; setSettings({ selected: s === null ? (d > 0 ? 0 : P - 1) : (s + d + P) % P }); }
      else if (e.key === '\\') setSettings({ selected: null });
    };
    window.addEventListener('keydown', key);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', key); };
  }, [data, clock, hold, play]);

  // the match roster's names, numbers and faces by tracking id, as ?ui=game has them (the same players everywhere);
  // the window's own makeLooks for anyone not on it, or until it loads
  const roster = useRoster();
  const looks = useMemo(() => {
    if (!data) return [];
    const n = (k: string) => +(q.get(k) ?? 1) || 1, f0 = data.pkg.frames[0];
    const P = data.joints?.players ?? f0.att.length + f0.def.length, nAtt = data.joints?.nAtt ?? f0.att.length;
    const seeds = { hair: n('hair'), number: n('num'), skin: n('skin'), build: n('build'), boots: n('boots') };
    return clipLooks(data.pkg, roster, makeLooks(P, nAtt, seeds, keepersOf(data.pkg)), seeds);
  }, [data, q, roster]);

  if (q.get('sheet') === 'icons') return <IconSheet />;
  if (q.get('sheet') === 'mode-icons') return <ModeIconSheet />;
  if (q.get('sheet') === 'show') return <ShowSheet />;
  return (
    <div className="hud-preview">
      {/* the draft shows its stand-in pitch (the clip from above, with what the 3D pitch would draw); ?bg=plain or ?current=1
          keep the plain stand-in */}
      <div className={`hud-preview-bg${q.get('bg') === 'grass' || (draft && q.get('bg') !== 'plain') ? ' grass' : ''}${mode === 'tactics' ? ' board' : ''}`}>
        {draft && q.get('bg') !== 'plain' && data ? <PreviewStage pkg={data.pkg as ClipPkg} clock={clock} looks={looks} playback={playback} /> : <span aria-hidden="true">3D 画面占位</span>}
      </div>
      {data && <Hud pkg={withPreviewCards(data.pkg as ClipPkg, q.get('cards'))} clock={clock} looks={looks} index={index} playback={playback} draft={draft} />}
    </div>
  );
}
