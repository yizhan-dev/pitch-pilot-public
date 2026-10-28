import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { Loaded } from '../../data';
import type { Clock } from '../../clock';
import type { PitchMode } from '../Pitch';
import { useStore } from '../../hud/draft';
import { setSettings } from '../../game/settings';
import { varReplay, VAR_OFF, VAR_SEEK_RATE, type Pose } from '../../game/varReplay';
import { Telestration, type Item } from '../telestration/Telestration';
import { VAR_FACTS, varCamera } from '../telestration/var';
import { TELE } from '../telestration/style';

// The Watch mode's VAR check in the 3D scene (game/varReplay.ts holds its state; the HUD's VAR button starts and ends
// it): the offside item with its close-up (Animation's, telestration/var.ts) and the camera. The camera starts from the
// view the viewer had, as a free pose, holds there while the wall comes in, flies to the line (varCamera) and holds the
// close-up; going back it returns to that view (the camera director blends to a named view; a free pose is flown back).

type CamW = { __camSet?: (...a: number[]) => void; __camScripted?: boolean };
/** the close-up a little lower than var.ts sets it, so the attacker and his verdict stand clear of the bottom widgets
 *  (as Explain's VarCam, ExplainLayer.tsx) */
const LIFT = 1.0;
/** how long the way back takes: a free pose flown back; a named view, the director's blend, then the state clears */
const BACK_S = 1.4;
/** the camera director's free view's field of view (Director.tsx freePose) */
const FREE_FOV = 45;
const ease = (u: number) => u * u * (3 - 2 * u);

/** the free pose framing what the camera frames now: centred where its line of sight meets the grass (0.8 m up, inside
 *  the pitch), as the director seeds its free view, and brought in along that line so the free view's wider lens
 *  (FREE_FOV) frames the same: taking it over changes the picture as little as it can */
function poseOf(camera: THREE.Camera): Pose {
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), o = camera.position;
  const hit = dir.y < -0.05 ? -o.y / dir.y : 40, T = o.clone().addScaledVector(dir, Math.min(hit, 120));
  T.set(Math.max(-54, Math.min(54, T.x)), 0.8, Math.max(-35, Math.min(35, T.z)));
  const fov = (camera as THREE.PerspectiveCamera).fov ?? FREE_FOV, lens = Math.tan(THREE.MathUtils.degToRad(fov / 2)) / Math.tan(THREE.MathUtils.degToRad(FREE_FOV / 2));
  const off = o.clone().sub(T), d = Math.max(3, Math.min(90, off.length() * lens));
  return [T.x, T.y, T.z, THREE.MathUtils.radToDeg(Math.atan2(off.x, off.z)), THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1, off.y / Math.max(1e-3, off.length()))))), d];
}
/** a pose between two, the yaw the short way round and the distance in proportion */
function between(a: Pose, b: Pose, e: number): Pose {
  let dy = b[3] - a[3]; dy -= 360 * Math.round(dy / 360);
  return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e, a[3] + dy * e, a[4] + (b[4] - a[4]) * e, a[5] * Math.pow(b[5] / a[5], e)];
}

export function VarReplay({ data, clock, surface }: { data: Loaded; clock: Clock; surface: PitchMode }) {
  const v = useStore(varReplay);
  const { camera } = useThree();
  const st = useMemo(() => ({ phase: 'off' as string, wide: null as Pose | null, last: null as Pose | null, leaveAt: 0, from: null as Pose | null, scripted: false as boolean | undefined }), []);
  const items = useMemo<Item[]>(() => (v.phase === 'on' ? [{ id: 'var-check', kind: 'offside', close: true, focus: v.focus, at: v.t } as Item] : []), [v.phase, v.focus, v.t]);
  // the camera director's idle return to the broadcast view stays off while the check owns the camera
  useEffect(() => {
    if (v.phase === 'off') return;
    const W = window as unknown as CamW;
    st.scripted = W.__camScripted; W.__camScripted = true;
    return () => { W.__camScripted = st.scripted; };
  }, [v.phase === 'off', st]);   // eslint-disable-line react-hooks/exhaustive-deps

  // for the headless checks: where the check stands
  useEffect(() => {
    (window as unknown as { __varState?: () => unknown }).__varState = () => ({ phase: st.phase, wide: st.wide, last: st.last, facts: { on: VAR_FACTS.on, age: VAR_FACTS.age, exit: VAR_FACTS.exit, att: VAR_FACTS.att, close: VAR_FACTS.close } });
  }, [st]);
  useFrame((_, dt) => {
    // on the way: the clip runs at double speed to the kick (play is paused, so the game's own clock stands still), then
    // the check proper starts there, on the view the viewer has then
    if (v.phase === 'seeking') {
      const left = v.t - clock.t, step = VAR_SEEK_RATE * Math.min(dt, 0.1);
      if (Math.abs(left) <= step) { clock.t = v.t; varReplay.set({ ...v, phase: 'on' }); } else clock.t += Math.sign(left) * step;
      return;
    }
    const W = window as unknown as CamW, set = W.__camSet;
    if (v.phase !== st.phase) {
      // starting: the view the viewer has, taken over as a free pose; leaving: from wherever the camera is now
      if (v.phase === 'on') { st.wide = poseOf(camera); st.last = st.wide; set?.(...st.wide); }
      if (v.phase === 'leaving') {
        st.leaveAt = performance.now(); st.from = st.last ?? poseOf(camera);
        if (v.back && v.back.view !== 'free') setSettings({ view: v.back.view });   // the director blends back
      }
      st.phase = v.phase;
    }
    if (!set) return;
    if (v.phase === 'leaving') {
      const u = Math.min(1, (performance.now() - st.leaveAt) / (BACK_S * 1000));
      // a free pose is flown back; a named view the director is already blending to
      if (v.back?.view === 'free' && st.wide && st.from) set(...between(st.from, st.wide, ease(u)));
      if (u >= 1) varReplay.set(VAR_OFF);
    }
  });
  // the close-up's camera comes after the item in the tree, so in each frame it reads the facts the item has just set
  return items.length ? <><Telestration data={data} clock={clock} items={items} surface={surface} /><VarCam st={st} /></> : null;
}

/** while the check runs: the wall comes in on the wide view and holds `holdS`; then the flight over `flyS` to the line
 *  (varCamera), held there */
function VarCam({ st }: { st: { wide: Pose | null; last: Pose | null } }) {
  useFrame(() => {
    const set = (window as unknown as CamW).__camSet, F = VAR_FACTS, V = TELE.offside.var;
    // (only while the check is on: a clip change ends it outright, and a frame of this before it unmounts would take the
    // camera back to the close-up, over the change's own view)
    if (!set || !st.wide || !F.on || F.exit !== null || varReplay.get().phase !== 'on') return;
    const c0 = varCamera(F, st.wide[3], V.turnDeg);
    if (!c0) return;
    const c: Pose = [c0[0], c0[1] - LIFT, c0[2], c0[3], c0[4], c0[5]];
    // the free view keeps its centre at least 0.3 m up: under that, the same camera about a centre slid along the sight
    if (c[1] < 0.3) {
      const p = THREE.MathUtils.degToRad(c[4]), y = THREE.MathUtils.degToRad(c[3]), k = (0.3 - c[1]) / Math.sin(p);
      c[0] += k * Math.cos(p) * Math.sin(y); c[1] = 0.3; c[2] += k * Math.cos(p) * Math.cos(y); c[5] -= k;
    }
    const u = Math.min(1, Math.max(0, (F.age - V.holdS) / V.flyS));
    if (u <= 0) return;
    st.last = between(st.wide, c, ease(u));
    set(...st.last);
  });
  return null;
}
