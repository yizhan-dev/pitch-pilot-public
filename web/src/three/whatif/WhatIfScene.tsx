import { useEffect, useMemo, useRef } from 'react';
import { hook, hooked } from '../../dev';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Loaded } from '../../data';
import type { Clock } from '../../clock';
import { useLand, useWiRewind } from '../../whatif/state';
import { loftApex } from '../../whatif/onball';
import { Telestration, type Item } from '../telestration/Telestration';
import { HoverPointer } from '../telestration/HoverPointer';
import { WhatIfTags } from './WhatIfTags';
import type { Look } from '../players/looks';
import { Players, type PlayerMask } from '../players/Styles';
import { attackingOf } from '../coords';

// The What-if mode on the pitch: at the pause the whole screen darkens and a column of light marks each potential
// passing option; the option under the pointer is lit and his passing lane shown; the xG reuses the animation kit
// built for Explain. Drawn with the Explain page's kit (three/telestration): while he picks, the scene
// darkened and a column of light on each realistic option (whatif/options.ts), the one under the pointer marked by the
// game's floating triangle (the kit's HoverPointer; no rotating ring, it fought the column) and the passing lane
// drawn to where the pass meets him (along the ground, or the lofted arc); the lane stays while the pass
// plays; as the receiver takes it, the kit's shot (the cone to the posts with what hides it, the xG widget rolling in).
// Mounted by the game shell among its pitch overlays (useWhatIf's `scene`), with the stage's pitch mode.

/** the dark: a full-screen quad drawn in clip space (the vertex shader writes screen coordinates straight out, so it
 *  does not depend on the camera's pose, near plane, frame order or any parent transform: a sheet placed in front of
 *  the camera each frame lagged it and lightened the scene while the view moved), after everything
 *  opaque (the stadium and the players at render order 0, the pitch's marks to 6) and before the kit's light (its
 *  columns from 7), fading in and out over FADE_S. No frame moves the fade more than STEP_S's worth: on the iGPU at
 *  3440x1440 the pause's first frame takes about 0.1 s (the HUD and the stage re-rendered, at any render scale; the
 *  what-if's own overlays measured at nothing) and the frames after it 33 ms, and with the step uncapped the dark
 *  jumped a third of the way and then crept, darkening in about three visible steps; capped, that frame shows a tenth
 *  and the rest follow evenly */
const FADE_S = 0.45, STEP_S = 0.05;
const DIM_V = /* glsl */ `void main() { gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }`;
const DIM_F = /* glsl */ `precision mediump float; uniform float uA; void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, uA); }`;
function Dim({ on }: { on: boolean }) {
  const k = useRef(0);
  const mat = useMemo(() => new THREE.ShaderMaterial({ vertexShader: DIM_V, fragmentShader: DIM_F, uniforms: { uA: { value: 0 } }, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }), []);
  const mesh = useRef<THREE.Mesh>(null);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame((_, dt) => {
    k.current = Math.min(1, Math.max(0, k.current + ((on ? 1 : -1) * Math.min(dt, STEP_S)) / FADE_S));
    const a = 0.62 * k.current * k.current * (3 - 2 * k.current);
    mat.uniforms.uA.value = a;
    hook('wiDim', a);   // (for the checks: the dark's alpha this frame)
    if (mesh.current) mesh.current.visible = a > 0.002;
  });
  return <mesh ref={mesh} material={mat} renderOrder={6.5} frustumCulled={false}><planeGeometry args={[1, 1]} /></mesh>;
}

/** the lit options drawn once more over their columns of light (otherwise the column could seem to cover the player,
 *  as if in the wrong layer): the ghosts are see-through and write no depth,
 *  and the column (the kit's Spotlights, after the dim so that it glows) lay over the man inside it, his back wall
 *  too. While he picks, the options alone are drawn again after the light (ON_TOP), in the same still ghost: each stands
 *  in front of his column, lit by it, the others dimmed as before */
const ON_TOP = 15;
function LitOptions({ data, clock, looks, who }: { data: Loaded; clock: Clock; looks: Look[]; who: number[] }) {
  const set = useMemo(() => new Set<number>(), []), mask = useMemo<PlayerMask>(() => ({ current: (p) => set.has(p) }), [set]);
  set.clear(); for (const w of who) set.add(w);
  const g = useRef<THREE.Group>(null);
  useFrame(() => { g.current?.traverse((o) => { if (o.renderOrder !== ON_TOP) o.renderOrder = ON_TOP; }); });
  if (!data.joints) return null;
  return <group ref={g}><Players J={data.joints} clock={clock} style="ghost-still" looks={looks} mask={mask} attacking={attackingOf(data.pkg.meta)} /></group>;
}

export function WhatIfScene({ data, clock, surface, looks }: { data: Loaded; clock: Clock; surface?: { current: number }; looks: Look[] }) {
  const st = useLand(), rw = useWiRewind();
  const picking = st.kind === 'pass' && (st.phase === 'pick' || st.phase === 'computing');
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    if (st.kind !== 'pass' || st.phase === 'off' || rw) return out;   // (nothing while a play runs back, useWhatIf.tsx)
    const from = { player: st.carrier, at: st.t0 };
    const lane = (who: number, at: [number, number], loft: boolean, id: string): Item => ({
      id, kind: 'pass', from, to: at, whatif: true,
      loft: loft ? loftApex(Math.hypot(at[0] - (data.pkg.frames[Math.round(st.t0 * data.pkg.meta.fps)]?.ball?.[0] ?? at[0]), at[1] - (data.pkg.frames[Math.round(st.t0 * data.pkg.meta.fps)]?.ball?.[1] ?? at[1]))) : false,
    });
    if (st.phase === 'pick') {
      // (on the live clock, not pinned to the moment: the pick ends as soon as the clock leaves it, useWhatIf.tsx tick,
      // and a column shrinking away then stays on its man, not where he stood)
      // (window.__wiNoCols: no columns, for timing the pick's stalls; checks only)
      if (!hooked<boolean>('wiNoCols')) for (const o of st.options ?? []) out.push({ id: `opt-${st.t0.toFixed(2)}-${o.who}`, kind: 'spotlight', at: { player: o.who } });
      const h = st.options?.find((o) => o.who === st.hoverWho);
      if (h) out.push(lane(h.who, h.meetAt ?? h.at, h.loft, `lane-${st.t0.toFixed(2)}-${h.who}`));   // (to where he meets it)
    } else if ((st.phase === 'computing' || st.phase === 'sim') && st.toWho !== null && st.target) {
      out.push(lane(st.toWho, st.meetAt ?? st.target, st.loft, `lane-${st.t0.toFixed(2)}-${st.toWho}`));
    } else if (st.phase === 'result' && st.shot && !st.shot.no && st.info) {
      // (his own shot from here: the cone at his strike, not where he ran on to after it)
      const at = st.isShot ? st.info.t0 + st.info.hold * 0.1 : st.info.end;
      out.push({ id: `shot-${at.toFixed(2)}-${st.shot.who}`, kind: 'shot', shooter: st.shot.who, at, xg: st.shot.xg, header: st.shot.header });
    }
    return out;
  }, [st.kind, st.phase, st.options, st.hoverWho, st.carrier, st.t0, st.toWho, st.target, st.meetAt, st.loft, st.shot, st.info, st.isShot, data, rw]);
  // the option under the pointer, for the floating triangle
  const hov = useRef({ current: -1 }).current;
  hov.current = st.phase === 'pick' && st.kind === 'pass' && st.hoverWho !== null && st.options?.some((o) => o.who === st.hoverWho) ? st.hoverWho : -1;
  return (
    <>
      <Dim on={picking} />
      {st.kind === 'pass' && st.phase === 'pick' && !rw && !!st.options?.length && !hooked<boolean>('wiNoLit') && <LitOptions data={data} clock={clock} looks={looks} who={st.options.map((o) => o.who)} />}
      <Telestration data={data} clock={clock} items={items} surface={surface} />
      <HoverPointer data={data} clock={clock} hover={hov} />
      <WhatIfTags data={data} clock={clock} looks={looks} />
    </>
  );
}
