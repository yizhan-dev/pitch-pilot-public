// The speed trail's read-out (pitch_prism's locked racing-HUD label, freeze/trace.py): a big italic number with KM/H
// beside it on one line (Yi, 2026-10-24; stacked under the number it ran onto the player), white with a soft dark offset edge, standing upright beside the player (not on the
// ground, so it reads while he runs), to the left of his body. Sized with the player (pitch_prism: the number
// 58 px for a 66 px player, so about 0.88 of his height), held between a floor and a ceiling in pixels so it stays
// readable far away and does not swamp the close views. The layout is BallReadout's. A small pool, set each frame.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { addAfterEffect, useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import fontUrl from '@fontsource/barlow-condensed/files/barlow-condensed-latin-600-italic.woff?url';
import { TELE } from './style';
import { VAR_FACTS } from './var';

/** one read-out: the player's feet (scene x, z), the speed text, alpha and the entrance's scale */
export interface SpeedTag { x: number; z: number; text: string; alpha: number; scale: number }

type Troika = THREE.Mesh & { text: string; fontSize: number; sync: (cb?: () => void) => void; textRenderInfo?: { blockBounds: number[]; visibleBounds?: number[] }; fillOpacity: number; outlineOpacity: number };
const POOL = 3;
/** the read-out's right edge this far to the left of his centre, and the digits' middle this high, in his heights */
const LEFT_OF = 0.3, MID_AT = 0.5;
/** the offside verdict's metres (VarMarks.tsx, anchored at their top): their digits' bottom this far down, and the gap
 *  under them, in the verdict's heights; their digits stand this share of the verdict's number height (measured) */
const VERDICT_LOW = 1.0, VERDICT_GAP = 0.15, VERDICT_DIGITS = 0.8;

export function SpeedTags({ store }: { store: { list: SpeedTag[] } }) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  const nums = useRef<(Troika | null)[]>([]), units = useRef<(Troika | null)[]>([]);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  // whether an offside close-up was drawn last frame, read once every layer has drawn (the first of the scene's
  // Telestrations to run each frame clears VAR_FACTS.on, so read in useFrame it depends on which one this is)
  const varOn = useRef(false);
  useEffect(() => addAfterEffect(() => { varOn.current = VAR_FACTS.on; }), []);
  const st = useMemo(() => ({ last: [] as string[], w: [] as number[], base: [] as number[], top: [] as number[], uw: [] as number[], size: [] as number[], fwd: new THREE.Vector3(), right: new THREE.Vector3(), camR: new THREE.Vector3(), camU: new THREE.Vector3(), v: new THREE.Vector3(), vb: new THREE.Vector3(), vd: new THREE.Vector3() }), []);

  useFrame(({ camera, size }) => {
    const T = TELE.trail, cam = camera as THREE.PerspectiveCamera, N = T.numM, U = N * T.unitRatio;
    const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)), F = VAR_FACTS, V = TELE.offside.var;
    cam.getWorldDirection(st.fwd);
    st.right.set(1, 0, 0).applyQuaternion(cam.quaternion).setY(0);
    if (st.right.lengthSq() < 1e-6) st.right.set(1, 0, 0);
    st.right.normalize();
    st.camR.set(1, 0, 0).applyQuaternion(cam.quaternion); st.camU.set(0, 1, 0).applyQuaternion(cam.quaternion);
    for (let i = 0; i < POOL; i++) {
      const g = groups.current[i], num = nums.current[i], unit = units.current[i], tag = store.list[i];
      if (!g || !num || !unit) continue;
      g.visible = !!tag && tag.alpha > 0.01 && tag.scale > 0.01;
      if (!tag || !g.visible) continue;
      const measure = () => { const r = num.textRenderInfo, b = r?.blockBounds, vb = r?.visibleBounds; if (b) st.w[i] = b[2] - b[0]; if (vb) { st.base[i] = vb[1]; st.top[i] = vb[3]; } };
      if (st.last[i] !== tag.text) { st.last[i] = tag.text; num.text = tag.text; num.sync(measure); }
      if (st.size[i] !== N) {
        st.size[i] = N; num.fontSize = N; unit.fontSize = U;
        num.sync(measure); unit.sync(() => { const b = unit.textRenderInfo?.visibleBounds; if (b) st.uw[i] = b[2]; });   // to the last letter's ink
      }
      const w = st.w[i] ?? N * 0.9, gap = N * 0.14, uw = st.uw[i] ?? U * 2.6;
      const base = st.base[i] ?? N * 0.2, top = st.top[i] ?? N * 0.9;
      // one line (Yi, 2026-10-24: the unit under the number ran onto the player): KM/H to the right of the number, its
      // baseline on the digits' bottom (Yi, 2026-10-26: the unit sat too low; both were anchored at their line boxes'
      // bottoms, and the big number's box keeps more room under its baseline than the small unit's)
      num.position.set(0, 0, 0); unit.position.set(w + gap, base, 0);
      num.fillOpacity = (245 / 255) * tag.alpha; unit.fillOpacity = (175 / 255) * tag.alpha;
      num.outlineOpacity = 0.63 * tag.alpha; unit.outlineOpacity = 0.63 * tag.alpha;
      // to the left of his body, the digits' middle at his waist, for everyone and in every view (Yi, 2026-10-26: up
      // and to the right, pitch_prism's place, the name tag over his head ran into it, and moving it down only for the
      // tagged players made it jump whenever a line named him): the anchor is the read-out's right end, at its middle
      st.v.set(tag.x, MID_AT * T.playerH, tag.z).addScaledVector(st.right, -LEFT_OF * T.playerH);
      // the number's size on screen, held between the floor and the ceiling
      const depth = Math.max(0.5, st.v.clone().sub(cam.position).dot(st.fwd));
      const pxPerM = size.height / (2 * depth * tanH);
      const px = N * pxPerM, k = Math.min(T.maxPx, Math.max(T.minPx, px)) / px;
      let s = k * tag.scale;
      // the offside verdict stands there too when it is his (VarMarks: to his left at his chest, Yi 2026-10-24): as it
      // comes in, the read-out slides under it and takes its metres' size, their right ends lined up, so the three lines
      // read as one column (at its own size, up to 96 px, it ran under the subtitles in the close-up)
      const vk = varOn.current && F.att ? F.tag : 0;
      if (vk > 0.01 && Math.hypot(F.feet[0] - tag.x, F.feet[1] - tag.z) < 1) {
        const vb = st.vb.set(F.feet[0], V.tagUpM, F.feet[1]), vpx = size.height / (2 * Math.max(0.5, st.vd.copy(vb).sub(cam.position).dot(st.fwd)) * tanH);
        const numPx = THREE.MathUtils.clamp(V.tagM * 0.84 * vpx, V.tagPx[0], V.tagPx[1]), vs = (numPx / (V.tagM * vpx)) * (0.85 + 0.15 * vk);
        const e = THREE.MathUtils.smoothstep(vk, 0, 1), sv = ((VERDICT_DIGITS * numPx) / vpx / (top - base)) * tag.scale;
        s += (sv - s) * e;
        vb.addScaledVector(st.camR, -V.tagLeftM - s * (w + gap + uw)).addScaledVector(st.camU, -V.tagM * (VERDICT_LOW + VERDICT_GAP) * vs - s * top);
        g.position.copy(st.v).addScaledVector(st.camR, -s * (w + gap + uw)).addScaledVector(st.camU, -s * (base + top) / 2).lerp(vb, e);
      } else g.position.copy(st.v).addScaledVector(st.camR, -s * (w + gap + uw)).addScaledVector(st.camU, -s * (base + top) / 2);
      g.quaternion.copy(cam.quaternion); g.scale.setScalar(s);
    }
  });

  const common = { font: fontUrl, material: mat, color: '#ffffff', anchorX: 'left' as const, outlineWidth: 0, outlineBlur: '18%', outlineOffsetX: '6%', outlineOffsetY: '-6%', outlineColor: '#000000', renderOrder: 31 };
  return (
    <group>
      {Array.from({ length: POOL }, (_, i) => (
        <group key={i} ref={(r) => { groups.current[i] = r; }} visible={false}>
          <Text ref={(r: unknown) => { nums.current[i] = r as Troika | null; }} {...common} fontSize={TELE.trail.numM} anchorY="bottom">0</Text>
          <Text ref={(r: unknown) => { units.current[i] = r as Troika | null; }} {...common} fontSize={TELE.trail.numM * TELE.trail.unitRatio} anchorY="bottom-baseline" letterSpacing={0.04}>KM/H</Text>
        </group>
      ))}
    </group>
  );
}
