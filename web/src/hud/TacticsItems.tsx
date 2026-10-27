import { useEffect, useReducer } from 'react';
import type { Clock } from '../clock';
import type { Loaded } from '../data';
import type { Look } from '../three/players/looks';
import { useGameSettings } from '../game/settings';
import { Telestration, type Item } from '../three/telestration/Telestration';
import { annot, offsideMark, xgMark, clipMoments, useStore } from './draft';
import { eventLabel } from './eventNames';
import { passStateAt, passChances, shooterAt, holderSideAt, contactAt } from './passProb';
import type { ClipPkg } from './match';
import { spaceSide, useSpace } from './space';
import { useClockTime } from './useClockTime';

// The 战术 marks that chat 1 draws (the animation chat owns the marks on the pitch; docs/plans/telestration-notes.md):
// - the offside line (Yi, 2026-10-25: one click, universal), chat 1's offside item following the clock, every player in an
//   offside position ringed (`highlight: 'all'`). Its line is the side without the ball's: the side on the ball is the player
//   on the ball's, or a keeper's holding it (passProb.ts holderSideAt), else the space export's held possession.
// - the pass chance (Yi, 2026-10-25): chat 1's `passprob` links from the carrier to every team-mate in the passing
//   network's look (no link to an offside one), from passProb.ts's distilled model, following the clock; the numbers go in
//   the head tags, which the Shell chat's ShowLayer draws from `passChances` (published here).
// - the shot chance (Yi, 2026-10-26): chat 1's shot cone from the player on the ball, with his xG if he shot now.
// It also lists the clip's on-ball moments for the Tactics pause's previous / next event (clipMoments).
// Its own Telestration, so nothing else re-renders with the clock; mounted by PitchOverlay3D, inside the Stage's canvas.

export function TacticsItems({ data, clock, surface, looks }: { data: Loaded; clock: Clock; surface?: { current: number }; looks?: Look[] }) {
  const pkg = data.pkg as unknown as ClipPkg;
  const { mode } = useGameSettings(), annotation = useStore(annot), offsideOn = useStore(offsideMark), xgOn = useStore(xgMark);
  const offside = mode === 'tactics' && offsideOn, passing = mode === 'tactics' && annotation === 'pass';
  const shot = mode === 'tactics' && xgOn;
  const space = useSpace(pkg, offside), t = useClockTime(clock, offside || passing || shot ? 5 : 1);
  const [, modelLoaded] = useReducer((n: number) => n + 1, 0);
  // the line is the side without the ball's: by the players first (the one on the ball, or a keeper holding it), else the
  // export's held possession
  const onBall = offside ? holderSideAt(pkg, t) ?? (space ? spaceSide(space, t) : 1) : 1, side = onBall === 2 ? 'att' : 'def';
  const pass = passing ? passStateAt(pkg, t, modelLoaded) : null;
  const chances = pass && pass.carrier !== null && pass.opts ? pass : null;
  // published for the head tags (the Shell chat's ShowLayer reads it each frame); null when off or nobody has the ball
  useEffect(() => { passChances.set(chances); }, [chances?.carrier, chances?.opts, t]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => passChances.set(null), []);
  // the on-ball moments: each event by a player at his contact with the ball (passProb.ts contactAt: the 25 Hz sample
  // before his touch; the feed's time less 0.15 s where none shows), one per 0.4 s; named as the game shows him (the
  // roster's number and name, not the feed's shirt number)
  useEffect(() => {
    const SKIP = new Set(['Offside provoked', 'Foul', 'Card', 'SubstitutionOn', 'SubstitutionOff', 'Start', 'End']);
    const found: { t: number; label: string }[] = [];
    for (const e of (pkg as { events?: { t: number; type: string; player?: number | null }[] }).events ?? []) {
      if (e.player == null || SKIP.has(e.type)) continue;
      const look = looks?.[e.player];
      found.push({ t: contactAt(pkg, { t: e.t, type: e.type, player: e.player }) ?? Math.max(0, e.t - 0.15), label: `${look ? `${look.number}. ${look.name} · ` : ''}${eventLabel(e.type)}` });
    }
    const out: typeof found = [];
    for (const m of found.sort((a, b) => a.t - b.t)) if (!out.length || m.t - out[out.length - 1].t >= 0.4) out.push(m);
    clipMoments.set(out);
  }, [pkg, looks]);
  const shooter = shot ? shooterAt(pkg, t) : null;   // only in the opponents' half (Yi)
  const items: Item[] = [
    ...(offside ? [{ id: `tactics-offside-${side}`, kind: 'offside', side, focus: null, highlight: 'all' } as const] : []),
    ...(shooter !== null ? [{ id: `tactics-xg-${shooter}`, kind: 'shot', shooter, labels: true } as const] : []),
    ...(chances ? [{ id: 'pass-chance', kind: 'passprob', carrier: chances.carrier as number, edges: (chances.opts ?? []).map((o) => ({ to: o.p, p: o.prob, offside: o.offside })) } as const] : []),
  ];
  return <Telestration data={data} clock={clock} items={items} surface={surface} />;
}
