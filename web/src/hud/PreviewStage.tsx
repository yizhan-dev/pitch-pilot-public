import { useEffect, useMemo, useRef, useState } from 'react';
import type { Clock } from '../clock';
import { GK_KIT, type Look } from '../three/players/looks';
import { useGameSettings, setSettings } from '../game/settings';
import { attackingOf, playerTeam, type Team } from '../three/coords';
import { loadXg } from '../pause/moment';
import type { XgFreezeModel } from '../response/xg';
import type { ClipPkg } from './match';
import type { Playback } from './ReplayPlate';
import { useClockTime } from './useClockTime';
import { instantStamina, sampleAt, staminaBand } from './playerStats';
import { GRID, momentAt, baseMap, moves, type XY } from './analysis';
import { annotationShapes, aidShapes, strokeShapes, ShapesSvg } from './overlayShapes';
import { drawMode, base, annot, annotSub, tool, ink, aids, strokes, frames, addStroke, drawingFading, frameAlpha as frameAlphaAt, type Stroke, useStore } from './draft';

// The HUD preview's stand-in for the 3D pitch: the clip from straight above, all 22 players and the ball at
// the clock's time, with what ?ui=game would draw on the grass once the designs are accepted (docs/plans/hud-notes.md):
// the Show menu's stamina bars and names (every mode) and the hover name; the 战术 mode's base map and
// annotations; 画板's drawings, guides and saved freeze frames. Only in the preview, under the HUD as the 3D canvas is in the game; it takes the clicks the HUD
// lets through (select a player; draw). Pitch metres, the clip's attackers attacking +x, y down the screen.

const L = 105, W = 68;
const TEAM_CSS: Record<Team, string> = { home: '#3987e5', away: '#d95926' };
const LIGHT: Record<Team, [number, number, number]> = { home: [106, 184, 255], away: [255, 149, 96] };
/** a drawn stroke shorter than this is a slip, not a stroke, metres; a free stroke takes a point every this far, metres */
const MIN_STROKE_M = 0.8, PEN_STEP_M = 0.6;
/** a click this close to a player circles him, metres */
const CIRCLE_PICK_M = 3;

export interface PreviewStageProps { pkg: ClipPkg; clock: Clock; looks: Look[]; playback?: Playback }

export function PreviewStage({ pkg, clock, looks, playback }: PreviewStageProps) {
  const t = useClockTime(clock, 20);
  const { mode, selected: selectedSetting, show } = useGameSettings();
  const draw = useStore(drawMode), shown = draw ? 'draw' : mode;
  const b = useStore(base), a = useStore(annot), sub = useStore(annotSub);
  const m = momentAt(pkg, t), attacking = attackingOf(pkg.meta as { attacking?: string });
  // a selection from the address may not exist in this clip (?sel=-1, or a larger clip's index): treat it as none (review F01)
  const selected = selectedSetting !== null && selectedSetting >= 0 && selectedSetting < m.pos.length ? selectedSetting : null;
  const team = (p: number) => playerTeam(p, m.nAtt, attacking);
  const name = (p: number) => (looks[p] ? `${looks[p].number} ${looks[p].name}` : '');
  // the Show menu's players (settings.ts `show`, in every mode, as the 3D layer draws them): the one on the ball (the
  // nearest within 2.5 m), the selected one, either team
  const onBall = m.hasBall ? m.pos.reduce<{ p: number | null; d: number }>((best, q, i) => { const d = Math.hypot(q[0] - m.ball[0], q[1] - m.ball[1]); return d < best.d ? { p: i, d } : best; }, { p: null, d: 2.5 }).p : null;
  const showOn = new Set<number>(m.pos.map((_, p) => p).filter((p) => (show.who === 'ball' && p === onBall) || (show.who === 'selected' && p === selected) || show.who === 'all' || show.who === team(p)));
  const [hover, setHover] = useState<number | null>(null);
  const [xg, setXg] = useState<XgFreezeModel | null>(null);
  useEffect(() => { loadXg().then(setXg); }, []);
  const stamina = useMemo(() => instantStamina(pkg), [pkg]);
  const allMoves = useMemo(() => moves(pkg), [pkg]);

  // the base map, as a 35 x 23 picture laid over the pitch, three times a second of clip time
  const tick = Math.floor(t * 3);
  const baseImg = useMemo(() => {
    if (shown !== 'tactics' || !b || typeof document === 'undefined') return null;
    const v = baseMap(pkg, b, tick / 3);
    if (!v) return null;   // the ball was not tracked at this moment: no map rather than one around a made-up ball
    const cv = document.createElement('canvas');
    cv.width = GRID.nx; cv.height = GRID.nz;
    const ctx = cv.getContext('2d')!, img = ctx.createImageData(GRID.nx, GRID.nz);
    const attC = LIGHT[team(0)], defC = LIGHT[team(m.nAtt)];
    for (let i = 0; i < v.length; i++) {
      let c: [number, number, number], al: number;
      if (b === 'pc') { c = v[i] >= 0.5 ? attC : defC; al = Math.abs(v[i] - 0.5) * 2 * 0.55; }
      else { c = attC; al = Math.min(1, v[i] * 1.6) * 0.7; }
      img.data.set([c[0], c[1], c[2], Math.round(al * 255)], i * 4);
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL();
  }, [pkg, b, tick, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- 画板: drawing in pitch metres
  const svg = useRef<SVGSVGElement>(null);
  const [cur, setCur] = useState<Stroke | null>(null);
  const toPitch = (e: React.PointerEvent): XY => {
    const s = svg.current!, pt = s.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const q = pt.matrixTransform(s.getScreenCTM()!.inverse());
    return [q.x, q.y];
  };
  const nearest = (q: XY) => { let best = -1, d = CIRCLE_PICK_M; m.pos.forEach((p, i) => { const x = Math.hypot(p[0] - q[0], p[1] - q[1]); if (x < d) { d = x; best = i; } }); return best >= 0 ? best : null; };
  const down = (e: React.PointerEvent) => {
    if (shown !== 'draw') return;
    const q = toPitch(e), tl = tool.get();
    if (tl === 'circle') { const p = nearest(q); if (p !== null) addStroke({ tool: 'circle', ink: ink.get(), pts: [q], player: p }); return; }
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* a synthetic event (the scripted checks) has no pointer to capture */ }
    setCur({ tool: tl, ink: ink.get(), pts: [q, q] });
  };
  const move = (e: React.PointerEvent) => {
    if (!cur) return;
    const q = toPitch(e);
    setCur((c) => (!c ? c : c.tool === 'pen' || c.tool === 'run' ? { ...c, pts: Math.hypot(q[0] - c.pts[c.pts.length - 1][0], q[1] - c.pts[c.pts.length - 1][1]) > PEN_STEP_M ? [...c.pts, q] : c.pts } : { ...c, pts: [c.pts[0], q] }));
  };
  const up = () => { if (cur && Math.hypot(cur.pts[cur.pts.length - 1][0] - cur.pts[0][0], cur.pts[cur.pts.length - 1][1] - cur.pts[0][1]) > MIN_STROKE_M) addStroke(cur); setCur(null); };

  // the strokes on the frozen picture fade when play resumes and are dropped unless saved (the HUD runs it, draft.ts)
  const st = useStore(strokes), fr = useStore(frames), playing = !!playback?.playing, fading = useStore(drawingFading);
  // a saved frame shows while the clock is at it, and fades over the play after it
  const frameAlpha = (ft: number) => frameAlphaAt(ft, t, playing);

  const ad = useStore(aids);
  const P = m.pos.length, keepers = new Set(pkg.keepers ?? []);

  return (
    <div className={`hud-stage${shown === 'draw' ? ' drawing' : ''}`}>
      <svg ref={svg} viewBox={`${-L / 2 - 3} ${-W / 2 - 3} ${L + 6} ${W + 6}`} preserveAspectRatio="xMidYMid meet" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setCur(null)}>
        {baseImg && <image href={baseImg} x={-L / 2} y={-W / 2} width={L} height={W} preserveAspectRatio="none" style={{ imageRendering: 'auto' }} />}
        <g className="hud-stage-lines">
          <rect x={-L / 2} y={-W / 2} width={L} height={W} />
          <path d={`M0 ${-W / 2} V${W / 2}`} />
          <circle cx="0" cy="0" r="9.15" />
          {[-1, 1].map((s) => (
            <g key={s}>
              <path d={`M${(s * L) / 2} -20.16 H${s * (L / 2 - 16.5)} V20.16 H${(s * L) / 2}`} />
              <path d={`M${(s * L) / 2} -9.16 H${s * (L / 2 - 5.5)} V9.16 H${(s * L) / 2}`} />
              <path d={`M${(s * L) / 2} -3.66 h${s * 1.6} V3.66 h${-s * 1.6}`} />
            </g>
          ))}
        </g>

        {shown === 'tactics' && a && <ShapesSvg shapes={annotationShapes(pkg, t, a, sub[a], m, allMoves, xg, name, selected)} />}
        {shown === 'draw' && <ShapesSvg shapes={aidShapes(pkg, t, m, ad, selected)} />}

        {/* the players, the Show menu's stamina bars over them */}
        {Array.from({ length: P }, (_, p) => {
          const [x, y] = m.pos[p], sel = p === selected, tm = team(p);
          const kit = looks[p]?.keeper || keepers.has(p) ? GK_KIT[tm].shirt : TEAM_CSS[tm];
          const sta = showOn.has(p) && show.what.includes('stamina') ? sampleAt(stamina[p], t, pkg.meta.fps) : null;
          return (
            <g key={p} className="hud-stage-p" transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`}
              role="button" tabIndex={shown !== 'draw' && p === (selected ?? 0) ? 0 : -1} aria-pressed={sel} aria-label={`Select ${name(p) || `player ${p + 1}`}`}
              onPointerEnter={() => setHover(p)} onPointerLeave={() => setHover((h) => (h === p ? null : h))}
              onClick={() => { if (shown !== 'draw') setSettings({ selected: p }); }}
              onKeyDown={(e) => {
                if (shown === 'draw') return;
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSettings({ selected: p }); }
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setSettings({ selected: (p + (e.key === 'ArrowRight' ? 1 : P - 1)) % P }); }
              }}>
              {sel && <circle r="2.3" className="hud-stage-sel" />}
              <circle r="1.4" fill={kit} className="hud-stage-body" />
              <text className="hud-stage-no" y=".47">{looks[p]?.number ?? ''}</text>
              {sta !== null && (
                <g transform="translate(-1.6 -2.9)">
                  <rect width="3.2" height=".55" className="hud-stage-bar-bg" />
                  <rect width={(3.2 * sta) / 100} height=".55" className={`hud-stage-bar ${staminaBand(sta)}`} />
                </g>
              )}
            </g>
          );
        })}
        <circle cx={m.ball[0]} cy={m.ball[1]} r=".55" className="hud-stage-ball" />
        {/* 观赛: the hovered player's name */}
        {/* names: the Show menu's players, and the hovered one whatever is chosen */}
        {shown !== 'draw' && (
          <ShapesSvg shapes={[...new Set([...(show.what.includes('name') ? showOn : []), ...(hover !== null ? [hover] : [])])].map((p) => ({ kind: 'tag' as const, at: [m.pos[p][0], m.pos[p][1] - 2.4] as [number, number], text: name(p) }))} />
        )}

        {/* 画板: saved frames, the frame being drawn, the stroke in progress */}
        {fr.map((f) => { const alpha = frameAlpha(f.t); return alpha > 0 ? <ShapesSvg key={f.t} shapes={f.strokes.flatMap((stroke) => strokeShapes(stroke, m, alpha))} /> : null; })}
        {shown === 'draw' && <g className={fading ? 'hud-stage-fade' : ''}><ShapesSvg shapes={[...st, ...(cur ? [cur] : [])].flatMap((stroke) => strokeShapes(stroke, m))} /></g>}
      </svg>
    </div>
  );
}
