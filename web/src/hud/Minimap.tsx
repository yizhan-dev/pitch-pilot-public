import { useEffect, useRef } from 'react';
import type { Clock } from '../clock';
import { GK_KIT, type Look } from '../three/players/looks';
import { useGameSettings, setSettings } from '../game/settings';
import type { ClipPkg } from './match';
import { nAttOf, playersOf } from './playerStats';
import { attackingOf, kitLabel, playerTeam, viewSign } from '../three/coords';
import { camFacing } from '../three/camera/Director';
import { clipSwap } from '../game/clipSwap';
import { useStore } from './draft';

// The minimap, bottom centre (Yi, 2026-10-22: where games put it), shown while the settings' `map` layer is on (the top
// bar's 小地图 switch, or M). A top-down pitch in metres: the attackers attack +x (left to right) and +y is the near touchline,
// as the broadcast camera sees it; turned round whenever the camera looks across from the other side (the match's ends,
// coords.ts viewSign, or any view from there: Director's camFacing, Yi 2026-10-25; viewSign where no camera runs). All 22 players and the ball, at the clock's time, interpolated between the package's
// 10 Hz frames; the positions are written straight into the SVG every frame, without re-rendering React. On white frosted
// glass, no green (Yi); the teams in lighter blue and orange (#6ab8ff, #ff9560), home blue and away orange in every clip
// as their kits (coords.ts, Yi 2026-10-23), the keepers in their keeper kits as on the pitch; the selected player has a
// soft white ring and no number (Yi). Clicking a player selects him.
// The 战术 mode's tools are not round it any more (Yi, 2026-10-22: it looked messy); they are the rail down the left edge
// (TacticsRail.tsx), and the minimap stays itself in every mode (the HUD preview draws the 战术 mode's maps on its stand-in
// pitch, PreviewStage.tsx, as ?ui=game will on the 3D pitch).

export interface MinimapProps { pkg: ClipPkg; clock: Clock; looks: Look[] }

const L = 105, W = 68, M = 2.5;               // pitch, and a margin round it

function lerp(a: [number, number], b: [number, number], f: number): [number, number] { return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }

export function Minimap({ pkg, clock, looks }: MinimapProps) {
  const swapOut = useStore(clipSwap) === 'out';
  const { layers, selected, mode } = useGameSettings();
  const dots = useRef<(SVGGElement | null)[]>([]), ball = useRef<SVGCircleElement>(null);
  // not in 战术 (Yi, 2026-10-25: the analysis legend needs the bottom centre); its switch is kept for the other modes
  const shown = layers.includes('map') && mode !== 'tactics';

  useEffect(() => {
    if (!shown) return;
    const fps = pkg.meta.fps, nAtt = nAttOf(pkg), P = playersOf(pkg), F = pkg.frames.length, ends = viewSign(pkg.meta as { half?: number; attacking?: string });
    let raf = 0;
    const draw = () => {
      const s = camFacing.live ? camFacing.sign : ends;
      const x = Math.min(F - 1, Math.max(0, clock.t * fps)), k = Math.floor(x), k1 = Math.min(F - 1, k + 1), f = x - k;
      const a = pkg.frames[k], b = pkg.frames[k1];
      for (let p = 0; p < P; p++) {
        const pa = p < nAtt ? a.att[p] : a.def[p - nAtt], pb = p < nAtt ? b.att[p] : b.def[p - nAtt], g = dots.current[p];
        if (g && pa && pb) { const [px, py] = lerp(pa, pb, f); g.setAttribute('transform', `translate(${(s * px).toFixed(2)} ${(s * py).toFixed(2)})`); }
      }
      const ba = a.ball, bb = b.ball ?? a.ball;
      if (ball.current) {
        if (ba && bb) { const [bx, by] = lerp([ba[0], ba[1]], [bb[0], bb[1]], f); ball.current.setAttribute('cx', (s * bx).toFixed(2)); ball.current.setAttribute('cy', (s * by).toFixed(2)); ball.current.style.display = ''; }
        else ball.current.style.display = 'none';
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [pkg, clock, shown]);

  if (!shown) return null;
  const nAtt = nAttOf(pkg), P = playersOf(pkg), attacking = attackingOf(pkg.meta);
  const team = (p: number) => playerTeam(p, nAtt, attacking);
  const colour = (p: number) => (looks[p]?.keeper ? GK_KIT[team(p)].shirt : `var(--mm-${team(p)})`);
  // the selected player last, so he draws on top
  const order = Array.from({ length: P }, (_, p) => p).sort((a, b) => (a === selected ? 1 : b === selected ? -1 : 0));
  return (
    // a clip changing in place (game/clipSwap.ts): the radar fades out as the board comes down and back in with the next
    // clip as it turns back (Yi, 2026-10-26: "fade out, and then fade in, instead of ... a blink of shift")
    <div className={swapOut ? 'hud-minimap swap-out' : 'hud-minimap'} aria-label="Radar">
      {/* the slight blur, behind the pitch only: no box round the minimap (Yi) */}
      <span className="hud-mm-blur" style={{ left: `${(100 * M) / (L + 2 * M)}%`, top: `${(100 * M) / (W + 2 * M)}%`, width: `${(100 * L) / (L + 2 * M)}%`, height: `${(100 * W) / (W + 2 * M)}%` }} />
      <svg viewBox={`${-L / 2 - M} ${-W / 2 - M} ${L + 2 * M} ${W + 2 * M}`} role="group" aria-label="Radar: select a player">
        <g className="hud-mm-pitch">
          <rect x={-L / 2} y={-W / 2} width={L} height={W} />
          <path d={`M0 ${-W / 2} V${W / 2}`} />
          <circle cx="0" cy="0" r="9.15" />
          {[-1, 1].map((s) => (
            <g key={s}>
              <path d={`M${(s * L) / 2} -20.16 H${s * (L / 2 - 16.5)} V20.16 H${(s * L) / 2}`} />
              <path d={`M${(s * L) / 2} -9.16 H${s * (L / 2 - 5.5)} V9.16 H${(s * L) / 2}`} />
              <rect className="hud-mm-goal" x={s > 0 ? L / 2 : -L / 2 - 1.6} y={-3.66} width={1.6} height={7.32} />
            </g>
          ))}
        </g>
        {order.map((p) => (
          // each player is a control (review F10): one tab stop (the selected player, else the first), the arrow keys step
          // through the players, Enter or Space selects
          <g key={p} ref={(el) => { dots.current[p] = el; }} className={`hud-mm-dot${p === selected ? ' sel' : ''}`}
            role="button" tabIndex={p === (selected ?? 0) ? 0 : -1} aria-pressed={p === selected}
            aria-label={`Select ${looks[p] ? `${looks[p].number} ${looks[p].name}` : `player ${p + 1}`}`}
            onClick={() => setSettings({ selected: p })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSettings({ selected: p }); }
              else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const next = (p + (e.key === 'ArrowRight' ? 1 : P - 1)) % P;
                setSettings({ selected: next });
                requestAnimationFrame(() => dots.current[next]?.focus());
              }
            }}>
            <title>{kitLabel(team(p), looks[p]?.number ?? '')}</title>
            <circle className="hud-mm-hit" r="3.4" />
            {p === selected && <circle className="hud-mm-ring" r="2.95" />}
            <circle className="hud-mm-body" r="1.9" style={{ fill: colour(p) }} />
          </g>
        ))}
        <circle ref={ball} className="hud-mm-ball" r="1" />
      </svg>
    </div>
  );
}
