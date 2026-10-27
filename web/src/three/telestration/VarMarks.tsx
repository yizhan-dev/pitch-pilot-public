// The offside close-up's marks (var.ts): a small target (ring and dot) on each man's deciding body part, a thin drop line from it to the grass
// (where his own line runs), and an upright verdict between them, ONSIDE or OFFSIDE over the margin in metres, facing
// the camera (Barlow Condensed, as the other read-outs; English, the product's language). Read from VAR_FACTS each frame.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import fontUrl from '@fontsource/barlow-condensed/files/barlow-condensed-latin-600-italic.woff?url';
import { TELE } from './style';
import { VAR_FACTS } from './var';

// the target on a deciding body part (Yi, 2026-10-24: the first dot and its ring were so big they hid the part): a thin
// ring round it and a small dot at it, sized in pixels at its depth, with a faint dark edge for contrast
const RET_VERT = /* glsl */ `
varying vec2 vQ;
void main() { vQ = position.xy * 2.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RET_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor; uniform float uAlpha, uSpan, uRing, uLine, uDot;
varying vec2 vQ;
void main() {
  float r = length(vQ) * uSpan;                                   // pixels from the centre
  float dR = abs(r - uRing) - 0.5 * uLine, dD = r - uDot;
  float cov = max(clamp(0.5 - dR, 0.0, 1.0), clamp(0.5 - dD, 0.0, 1.0));
  float edge = 0.45 * exp(-pow(max(min(dR, dD), 0.0) / 1.2, 2.0));
  float a = (cov + edge * (1.0 - cov)) * uAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * cov * uAlpha, a);
}`;

type Troika = THREE.Mesh & { text: string; color: THREE.ColorRepresentation; fillOpacity: number; outlineOpacity: number; sync: (cb?: () => void) => void };

export function VarMarks() {
  const grp = useRef<THREE.Group>(null), tag = useRef<THREE.Group>(null);
  const word = useRef<Troika | null>(null), num = useRef<Troika | null>(null);
  const parts = useMemo(() => {
    const mk = () => {
      const lineM = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
      const u = { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uSpan: { value: 16 }, uRing: { value: 10 }, uLine: { value: 1.6 }, uDot: { value: 2.5 } };
      const ret = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ vertexShader: RET_VERT, fragmentShader: RET_FRAG, uniforms: u, transparent: true, depthTest: false, depthWrite: false, premultipliedAlpha: true, toneMapped: false }));
      const drop = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), lineM);
      ret.renderOrder = 33; drop.renderOrder = 32;
      return { ret, u, drop };
    };
    return [mk(), mk()];
  }, []);
  useEffect(() => () => { for (const p of parts) { for (const m of [p.ret, p.drop]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } } }, [parts]);
  const st = useMemo(() => ({ last: '', col: new THREE.Color(), fwd: new THREE.Vector3(), v: new THREE.Vector3(), w: new THREE.Vector3(), right: new THREE.Vector3() }), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false }), []);
  useEffect(() => () => mat.dispose(), [mat]);

  useFrame(({ camera, size }) => {
    const F = VAR_FACTS, V = TELE.offside.var, g = grp.current, tg = tag.current;
    if (!g || !tg) return;
    const k = F.on ? F.close : 0, tk = F.on ? F.tag : 0;
    g.visible = k > 0.01;
    const pts = [F.def, F.att], rgbs = [F.defRgb, F.attRgb];
    const cam = camera as THREE.PerspectiveCamera, tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    cam.getWorldDirection(st.fwd);
    parts.forEach((p, i) => {
      const P = pts[i], vis = !!P;
      p.ret.visible = p.drop.visible = vis;
      if (!P) return;
      const c = rgbs[i];
      // the target: its ring and dot in pixels at the part's depth, held between a floor and a ceiling
      const depth = Math.max(0.5, st.v.set(P[0], P[1], P[2]).sub(cam.position).dot(st.fwd)), pxPerM = size.height / (2 * depth * tanH);
      const ring = THREE.MathUtils.clamp(V.ringM * pxPerM, V.ringPx[0], V.ringPx[1]) * (0.7 + 0.3 * k), span = ring + 4;
      p.u.uColor.value.setRGB(c[0], c[1], c[2]); p.u.uAlpha.value = k; p.u.uSpan.value = span; p.u.uRing.value = ring;
      p.u.uLine.value = V.ringLinePx; p.u.uDot.value = V.dotPx;
      p.ret.position.set(P[0], P[1], P[2]); p.ret.quaternion.copy(camera.quaternion); p.ret.scale.setScalar((2 * span) / pxPerM);
      // the drop line to the grass, drawn down from the dot
      const h = P[1] * k;
      (p.drop.material as THREE.MeshBasicMaterial).color.setRGB(c[0], c[1], c[2]);
      (p.drop.material as THREE.MeshBasicMaterial).opacity = 0.9 * k;
      p.drop.position.set(P[0], P[1] - h / 2, P[2]); p.drop.scale.set(V.dropR, Math.max(1e-3, h), V.dropR);
    });
    // the verdict: to his left on screen at his chest, facing the camera, sized in pixels at his depth
    const a = F.att;
    tg.visible = !!a && tk > 0.01;
    if (!a || !tg.visible || !word.current || !num.current) return;
    const off = F.margin > 0, text = `${Math.abs(F.margin).toFixed(2)} m`;
    if (st.last !== text + off) {
      st.last = text + off;
      word.current.text = off ? 'OFFSIDE' : 'ONSIDE'; num.current.text = text;
      const c = off ? F.attRgb : [1, 1, 1];
      word.current.color = st.col.setRGB(c[0], c[1], c[2]).getHex(); num.current.color = 0xffffff;
      word.current.sync(); num.current.sync();
    }
    word.current.fillOpacity = num.current.fillOpacity = tk; word.current.outlineOpacity = num.current.outlineOpacity = 0.6 * tk;
    const base = st.v.set(F.feet[0], V.tagUpM, F.feet[1]), depth = Math.max(0.5, st.w.copy(base).sub(cam.position).dot(st.fwd)), pxPerM = size.height / (2 * depth * tanH);
    const numPx = THREE.MathUtils.clamp(V.tagM * 0.84 * pxPerM, V.tagPx[0], V.tagPx[1]);
    st.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    tg.position.copy(base).addScaledVector(st.right, -(V.tagLeftM + 12 / pxPerM));
    tg.quaternion.copy(camera.quaternion);
    tg.scale.setScalar((numPx / (V.tagM * pxPerM)) * (0.85 + 0.15 * tk));
  });

  const common = { font: fontUrl, material: mat, anchorX: 'right' as const, outlineWidth: 0, outlineBlur: '18%', outlineOffsetX: '5%', outlineOffsetY: '-5%', outlineColor: '#000000', renderOrder: 33 };
  return (
    <group>
      <group ref={grp} visible={false}>
        {parts.map((p, i) => <group key={i}><primitive object={p.drop} /><primitive object={p.ret} /></group>)}
      </group>
      <group ref={tag} visible={false}>
        <Text ref={(r: unknown) => { word.current = r as Troika | null; }} {...common} fontSize={TELE.offside.var.tagM * 0.55} anchorY="bottom" letterSpacing={0.08} position={[0, 0.02, 0]}>ONSIDE</Text>
        <Text ref={(r: unknown) => { num.current = r as Troika | null; }} {...common} fontSize={TELE.offside.var.tagM} anchorY="top">0.00 m</Text>
      </group>
    </group>
  );
}
