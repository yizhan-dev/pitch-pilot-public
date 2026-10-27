// The ball's speed (Yi, 2026-10-22: an option for the shots; the height was tried and dropped), beside the ball, turned to the camera, the same
// size on screen at any distance. pitch_prism's locked racing-HUD read-out (the trace's speed label): a big italic white
// number with its unit stacked smaller under the number's right edge, a soft dark offset edge for legibility; here in
// the project's display face, Barlow Condensed 600 italic. Speed is the ball's, from the tracking (a centred difference
// over 0.16 s), held at its peak for `holdS` seconds so a shot's speed stays readable after the save. Fades in above
// `minKmh`, out below. On when TELE.readout.mode is 'speed', or when the `on` prop says so (the pause window's shots).
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import fontUrl from '@fontsource/barlow-condensed/files/barlow-condensed-latin-600-italic.woff?url';
import type { Loaded } from '../../data';
import type { Clock } from '../../clock';
import { ballAt } from '../Ball';
import { TELE } from './style';

type Troika = THREE.Mesh & { text: string; sync: (cb?: () => void) => void; textRenderInfo?: { blockBounds: number[] }; fillOpacity: number; outlineOpacity: number };

const speedAt = (pkg: Loaded['pkg'], t: number) => {
  const a = ballAt(pkg, t - 0.08), b = ballAt(pkg, t + 0.08);
  return a && b ? (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.16) * 3.6 : 0;
};

export function BallReadout({ data, clock, on }: { data: Loaded; clock: Clock; on?: boolean }) {
  const group = useRef<THREE.Group>(null);
  const refs = { sp: useRef<Troika>(null), spU: useRef<Troika>(null) };
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  const st = useMemo(() => ({ alpha: 0, last: { sp: '' }, w: { sp: 0 }, right: new THREE.Vector3(), up: new THREE.Vector3(), fwd: new THREE.Vector3(), v: new THREE.Vector3(), lastNow: -1 }), []);

  /** set a text and, once laid out, its width (the unit is stacked under the number's right edge) */
  const setText = (key: 'sp', s: string) => {
    const m = refs[key].current;
    if (!m || st.last[key] === s) return;
    st.last[key] = s; m.text = s;
    m.sync(() => { const b = m.textRenderInfo?.blockBounds; if (b) st.w[key] = b[2] - b[0]; });
  };

  useFrame((state) => {
    const R = TELE.readout, g = group.current;
    if (!g) return;
    const W = window as unknown as { __capture?: boolean; __teleNow?: number };
    const now = W.__teleNow ?? (W.__capture ? clock.t : state.clock.elapsedTime), dt = st.lastNow < 0 ? 1 : Math.max(0, Math.min(0.2, now - st.lastNow));
    st.lastNow = now;
    const pkg = data.pkg, t = clock.t, b = ballAt(pkg, t);
    // the speed, held at its peak over the last holdS seconds (stateless, so scrubbing and recording agree)
    let kmh = speedAt(pkg, t);
    for (let s = 0.04; s <= R.holdS; s += 0.04) kmh = Math.max(kmh, speedAt(pkg, t - s));
    const want = (on ?? R.mode === 'speed') && b && kmh >= R.minKmh ? 1 : 0;
    st.alpha += (want - st.alpha) * (1 - Math.exp(-dt / 0.12));
    g.visible = st.alpha > 0.01 && !!b;
    if (!g.visible || !b) return;
    setText('sp', String(Math.round(kmh)));
    // the layout in pixels: the number's left edge at the anchor, the unit stacked under its right edge
    const N = R.numPx;
    // the sizes follow the style live (the sandbox's slider); a change of size lays the text out again
    for (const [key, size] of [['sp', N], ['spU', N * R.unitRatio]] as const) {
      const m = refs[key].current as (Troika & { fontSize: number }) | null;
      if (m && m.fontSize !== size) { m.fontSize = size; m.sync(() => { if (key === 'sp') { const bb = m.textRenderInfo?.blockBounds; if (bb) st.w.sp = bb[2] - bb[0]; } }); }
    }
    const num = refs.sp.current, unit = refs.spU.current;
    if (num && unit) {
      num.position.set(st.w.sp, 0, 0); unit.position.set(st.w.sp, -N * 0.06, 0);
      num.fillOpacity = (245 / 255) * st.alpha; unit.fillOpacity = (170 / 255) * st.alpha;
      num.outlineOpacity = 0.7 * st.alpha; unit.outlineOpacity = 0.7 * st.alpha;
    }
    // beside the ball on screen: offset in pixels along the camera's right and up, one world unit per pixel at its depth
    const cam = state.camera as THREE.PerspectiveCamera;
    cam.getWorldDirection(st.fwd);
    st.v.set(b[0], Math.max(0.11, b[2]), b[1]);
    const depth = Math.max(0.1, st.v.clone().sub(cam.position).dot(st.fwd));
    const s = (depth * 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / state.size.height;
    st.right.set(1, 0, 0).applyQuaternion(cam.quaternion); st.up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    g.position.copy(st.v).addScaledVector(st.right, R.offsetPx[0] * s).addScaledVector(st.up, R.offsetPx[1] * s);
    g.quaternion.copy(cam.quaternion);
    g.scale.setScalar(s);
  });

  const common = { font: fontUrl, material: mat, color: '#ffffff', anchorX: 'right' as const, outlineWidth: 0, outlineBlur: '18%', outlineOffsetX: '5%', outlineOffsetY: '-6%', outlineColor: '#05070b', renderOrder: 31 };
  const N = TELE.readout.numPx, U = N * TELE.readout.unitRatio;
  return (
    <group ref={group} visible={false}>
      <Text ref={refs.sp} {...common} fontSize={N} anchorY="bottom">0</Text>
      <Text ref={refs.spU} {...common} fontSize={U} anchorY="top" letterSpacing={0.04}>KM/H</Text>
    </group>
  );
}
