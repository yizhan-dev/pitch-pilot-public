// The Explain mode's part inside the 3D canvas (mounted by three/Stage.tsx next to the one Telestration): the director
// script's drawings (a Telestration of their own; the one beside it keeps the selected player's ring), a script's tags (a
// pointer whose text is the tag), and the offside close-up's camera. The player on the ball and the player the voice names
// wear the Show layer's tags, as in the Watch mode (director.ts fills showNamed). Nothing shows unless a script runs the clip (explain/director.ts).
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { Loaded } from '../data';
import type { Clock } from '../clock';
import type { PitchMode } from '../three/Pitch';
import { Telestration, type Item } from '../three/telestration/Telestration';
import { HoverPointer } from '../three/telestration/HoverPointer';
import { VAR_FACTS, varCamera } from '../three/telestration/var';
import { TELE } from '../three/telestration/style';
import { scriptPose, useExplain } from './director';

/** how long the drawings have to play their exits once the mode ends (theirs run 0.25-0.35 s, anim.ts and style.ts) */
const EXIT_MS = 1000;

export function ExplainLayer({ data, clock, surface }: { data: Loaded; clock: Clock; surface: PitchMode }) {
  const v = useExplain();
  // for the headless checks: where a player stands on screen (px, his waist), to keep the HUD off the subject
  const { camera, size } = useThree();
  useEffect(() => {
    const F = data.pkg.frames, fps = data.pkg.meta.fps, nAtt = F[0].att.length;
    (window as unknown as { __screenOf?: (p: number) => number[] | null }).__screenOf = (p) => {
      const f = F[Math.max(0, Math.min(F.length - 1, Math.round(clock.t * fps)))], q = p < nAtt ? f.att[p] : f.def[p - nAtt];
      if (!q) return null;
      const v3 = new THREE.Vector3(q[0], 1.0, q[1]).project(camera);
      return [Math.round(((v3.x + 1) / 2) * size.width), Math.round(((1 - v3.y) / 2) * size.height)];
    };
  }, [data, clock, camera, size]);
  const tags = useMemo(() => v.items.filter((it) => (it as { kind: string }).kind === 'tag') as unknown as { id: string; player: number; text: string }[], [v.items]);
  const tagRefs = useMemo(() => tags.map((g) => ({ id: g.id, ref: { current: g.player }, name: (p: number) => (p === g.player ? g.text : null) })), [tags]);
  const items = useMemo(() => v.items.filter((it) => (it as { kind: string }).kind !== 'tag') as Item[], [v.items]);
  // leaving the mode (Yi, 2026-10-26: no jump either way): the layer stays a moment with its items emptied, so each
  // drawing plays its exit instead of vanishing
  const [linger, setLinger] = useState(false), wasOn = useRef(false);
  useEffect(() => {
    if (v.active) { wasOn.current = true; setLinger(false); return; }
    if (!wasOn.current) return;
    wasOn.current = false; setLinger(true);
    const id = window.setTimeout(() => setLinger(false), EXIT_MS);
    return () => window.clearTimeout(id);
  }, [v.active]);
  if (!v.active && !linger) return null;
  // the player on the ball and the player the voice names wear the Watch mode's tags (the Show layer's; Yi, 2026-10-25),
  // not pointers of their own
  return (
    <>
      <Telestration data={data} clock={clock} items={items} surface={surface} />
      {tagRefs.map((g) => <HoverPointer key={g.id} data={data} clock={clock} hover={g.ref} names={g.name} />)}
      <VarCam />
    </>
  );
}

/** the offside close-up's camera (the telestration sandbox's VarCam, as on the board): while an offside item with
 *  `close` shows, the wide view (the pose the script last set) holds `holdS`, then the orbit eases over `flyS` to the
 *  line; not while the item leaves, when the script's next camera has cut away. The wide pose is the director's own
 *  (scriptPose): catching it on its way through window.__camSet missed it whenever the camera director had just
 *  re-assigned __camSet (it does on each render) before a jump, and the close-up never came */
const VAR_LIFT = 1.0;
function VarCam() {
  const st = useMemo(() => ({ lastAge: Infinity }), []);
  useFrame(() => {
    const set = (window as unknown as { __camSet?: (...a: number[]) => void }).__camSet, F = VAR_FACTS, V = TELE.offside.var;
    const w = scriptPose();
    if (!F.on || F.exit !== null || !set || !w) return;
    const restart = F.age < st.lastAge - 0.05;
    st.lastAge = F.age;
    const c0 = varCamera(F, w[3], V.turnDeg);
    if (!c0) return;
    // the close-up's centre a little lower than var.ts sets it, so the attacker and his verdict stand above the game's
    // subtitles and minimap (2026-10-26: they sat in the subtitle's band; the speed read-out under the verdict too)
    const c = [c0[0], c0[1] - VAR_LIFT, c0[2], c0[3], c0[4], c0[5]];
    // the free view keeps its orbit centre at least 0.3 m up (Director.tsx): under that, the same camera about a centre
    // slid towards it along the line of sight
    if (c[1] < 0.3) {
      const p = THREE.MathUtils.degToRad(c[4]), y = THREE.MathUtils.degToRad(c[3]), k = (0.3 - c[1]) / Math.sin(p);
      c[0] += k * Math.cos(p) * Math.sin(y); c[1] = 0.3; c[2] += k * Math.cos(p) * Math.cos(y); c[5] -= k;
    }
    const u = Math.min(1, Math.max(0, (F.age - V.holdS) / V.flyS)), e = u * u * (3 - 2 * u);
    if (u <= 0) { if (restart) set(...w); return; }
    let dy = c[3] - w[3]; dy -= 360 * Math.round(dy / 360);
    set(w[0] + (c[0] - w[0]) * e, w[1] + (c[1] - w[1]) * e, w[2] + (c[2] - w[2]) * e, w[3] + dy * e, w[4] + (c[4] - w[4]) * e, w[5] * Math.pow(c[5] / w[5], e));
  });
  return null;
}
