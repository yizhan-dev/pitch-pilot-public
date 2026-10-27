// The hover cue (tier 3 of the agreed ring tiers: hover is the triangle only, no ring): a pointer over the head of the
// player under the mouse, the same size on screen at any distance, drawn by a distance function so it stays sharp at
// any size. It replaces Stage's canvas-sprite HoverMarker when Yi accepts it (docs/research/telestration.md, 0.1).
// Language: the ring's entrance (a zoom through the 106% blip) and exit (shrink and fade); while held it bobs, as today.
// White, the neutral pointer; a soft dark halo behind it separates it from the stands and the sky.
// Sized in metres like the stamina bar, held between two shares of the view's height (Yi: the fixed size was too big
// in the broadcast view). Shapes compared (TELE.pointer.shape; Yi chose 'tri', 2026-10-22), all pointing down:
//  'tri'  today's triangle (HoverMarker's canvas: 48 px wide, 40 px tall in a 64 px sprite 3% of the view's height)
//  'barb' the locked arrows' barbed head (pitch_prism arrows.py: barbs 0.66 rad off the axis, notch at 0.55 of the head),
//         so the pointer is the same object as the run and pass arrows
//  'chev' the freeform arrow's chevron (arrows.py: depth 1.15 w, half-width 0.62 w, arm 0.52 w along the axis)
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import nameFont from '@fontsource/barlow-condensed/files/barlow-condensed-latin-600-normal.woff?url';
import type { Loaded } from '../../data';
import type { Clock } from '../../clock';
import { getSettings, staminaShown, SHOW_TAG } from '../../game/settings';
import { jointAt } from '../camera/Director';
import { ringEnter, ringExit, RING } from './anim';
import { TELE, TEAM_SIDE, surfaceColour, inkColour, stackScale, type PointerShape } from './style';
import { attackingOf } from '../coords';

const SHAPE_ID: Record<PointerShape, number> = { tri: 0, barb: 1, chev: 2 };

const VERT = /* glsl */ `
attribute vec4 iAnchor;   // world position over the head, the shape's half-size in pixels
attribute vec4 iP;        // scale, alpha, lift of the shape's centre in pixels (screen up), shape
attribute vec3 iColor;    // sRGB 0..1
uniform vec2 uViewport;
varying vec2 vQ; flat varying vec4 vP; flat varying vec3 vColor;
const float M = 1.7;      // the quad's margin over the shape, for the halo
void main() {
  vec4 c = projectionMatrix * viewMatrix * vec4(iAnchor.xyz, 1.0);
  float S = iAnchor.w * iP.x;
  vec2 q = position.xy * 2.0 * M;                 // shape units: the shape spans about -1..1
  c.xy += vec2(q.x * S, q.y * S + iP.z) * 2.0 / uViewport * c.w;
  gl_Position = c; vQ = q; vP = iP; vColor = iColor;
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vQ; flat varying vec4 vP; flat varying vec3 vColor;
uniform float uShadow, uShadowSigma;
// Inigo Quilez's polygon distance (iquilezles.org/articles/distfunctions2d), up to 6 vertices
float sdPoly(vec2 p, vec2 v[6], int n) {
  float d = dot(p - v[0], p - v[0]), s = 1.0;
  for (int i = 0, j = n - 1; i < n; j = i, i++) {
    vec2 e = v[j] - v[i], w = p - v[i], b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= v[i].y, p.y < v[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s *= -1.0;
  }
  return s * sqrt(d);
}
void main() {
  vec2 p = vQ, v[6]; int n;
  int k = int(vP.w + 0.5);
  if (k == 0) {
    v[0] = vec2(-1.0, 0.833); v[1] = vec2(1.0, 0.833); v[2] = vec2(0.0, -0.833); n = 3;
  } else if (k == 1) {
    v[0] = vec2(0.0, -1.0); v[1] = vec2(0.981, 0.264); v[2] = vec2(0.0, -0.12); v[3] = vec2(-0.981, 0.264); n = 4;
  } else {
    v[0] = vec2(0.0, -0.376); v[1] = vec2(-0.744, 1.004); v[2] = vec2(-0.744, 0.38);
    v[3] = vec2(0.0, -1.0); v[4] = vec2(0.744, 0.38); v[5] = vec2(0.744, 1.004); n = 6;
  }
  float d = sdPoly(p, v, n), aa = max(fwidth(d), 1e-4);
  float cov = clamp(0.5 - d / aa, 0.0, 1.0);
  float x = max(d, 0.0) / uShadowSigma, sh = uShadow * exp(-x * x);
  float a = (cov + sh * (1.0 - cov)) * vP.y;        // the halo is dark: it adds coverage, not light
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * cov * vP.y, a);
}`;

type Troika = THREE.Mesh & { text: string; fontSize: number; color: THREE.ColorRepresentation; fillOpacity: number; outlineOpacity: number; sync: (cb?: () => void) => void };
const NAMES = 4;

/** the cue over the selected player (his team colour) and over the player in `hover` (a package index, -1 for none;
 *  white). Draws over everything, like the sprite it replaces, and sits higher when the player carries the stamina bar.
 *  `names` (Yi, 2026-10-24): a player's name, written above his triangle in the triangle's language: its entrance and
 *  exit, its colour and bob, sized from it but held readable at broadcast distance (TELE.pointer.name*); null: none */
export function HoverPointer({ data, clock, hover, names }: { data: Loaded; clock: Clock; hover: { current: number }; names?: (p: number) => string | null }) {
  TEAM_SIDE.attacking = attackingOf(data.pkg.meta);   // the selected player's triangle in his team's colour (style.ts)
  const res = useMemo(() => {
    const plane = new THREE.PlaneGeometry(1, 1), geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index; geo.setAttribute('position', plane.getAttribute('position'));
    const anchor = new THREE.InstancedBufferAttribute(new Float32Array(16), 4).setUsage(THREE.DynamicDrawUsage);
    const params = new THREE.InstancedBufferAttribute(new Float32Array(16), 4).setUsage(THREE.DynamicDrawUsage);
    const color = new THREE.InstancedBufferAttribute(new Float32Array(12), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iAnchor', anchor); geo.setAttribute('iP', params); geo.setAttribute('iColor', color); geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false, premultipliedAlpha: true, side: THREE.DoubleSide,
      uniforms: { uViewport: { value: new THREE.Vector2(1, 1) }, uShadow: { value: 0.5 }, uShadowSigma: { value: 0.3 } },
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.renderOrder = 30;
    return { mesh, geo, mat, anchor, params, color, live: new Map<number, { born: number; exitAt: number | null; col: [number, number, number] }>(), lastT: -1, v: new THREE.Vector3(), w: new THREE.Vector3(), fwd: new THREE.Vector3(), size: new THREE.Vector2(), c: [1, 1, 1] as [number, number, number] };
  }, []);
  useEffect(() => () => { res.geo.dispose(); res.mat.dispose(); }, [res]);
  const neck = useMemo(() => data.joints?.names.indexOf('neck') ?? -1, [data]);
  const tags = useRef<(Troika | null)[]>([]), tagGrp = useRef<(THREE.Group | null)[]>([]);
  const tagSt = useMemo(() => ({ text: [] as string[], col: new THREE.Color(), up: new THREE.Vector3() }), []);
  const tagMat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false }), []);
  useEffect(() => () => tagMat.dispose(), [tagMat]);

  useFrame((state) => {
    const W = window as unknown as { __capture?: boolean; __teleNow?: number };
    const now = W.__teleNow ?? (W.__capture ? clock.t : state.clock.elapsedTime), P = TELE.pointer, J = data.joints;
    // who carries a cue (Yi, 2026-10-22): the selected player always, in his team colour (not in his own first-person
    // view, the camera is in his head); the player under the mouse, white, unless he is the selected one. Births and
    // exits per player; a hovered player who is then selected keeps his cue, which turns from white to his colour
    // none in the top-down view: seen from above the pointer floats off the man, and his rotating ring marks him (Yi,
    // 2026-10-27: "for top down view, we do not show the floating triangle, but only rotating ring")
    const st = getSettings(), top = st.view === 'tactical', sel = st.selected !== null && st.view !== 'first' && !top ? st.selected : -1, hv = top ? -1 : hover.current;
    const want = new Set<number>(); if (sel >= 0) want.add(sel); if (hv >= 0) want.add(hv);
    for (const q of want) { const L = res.live.get(q); if (!L) res.live.set(q, { born: now, exitAt: null, col: [1, 1, 1] as [number, number, number] }); else if (L.exitAt !== null) { L.exitAt = null; L.born = now; } }
    for (const [q, L] of res.live) if (!want.has(q) && L.exitAt === null) L.exitAt = now;
    const dt = res.lastT < 0 ? 0 : Math.max(0, Math.min(0.1, now - res.lastT)), kc = 1 - Math.exp(-dt / 0.12);
    res.lastT = now;
    state.gl.getDrawingBufferSize(res.size);
    const u = res.mat.uniforms;
    u.uViewport.value.copy(res.size);
    u.uShadow.value = P.shadow; u.uShadowSigma.value = P.shadowSigma;
    // half-size: metres at the player's depth, as a share of the view's height, held between sizeMin and sizeVH
    const cam = state.camera as THREE.PerspectiveCamera, unit = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    cam.getWorldDirection(res.fwd);
    const A = res.anchor.array as Float32Array, Q = res.params.array as Float32Array, C = res.color.array as Float32Array;
    let n = 0, nt = 0;
    tagSt.up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    for (const [q, L] of res.live) {
      const ex = L.exitAt === null ? null : now - L.exitAt;
      if (ex !== null && ex >= RING.exitS) { res.live.delete(q); continue; }
      if (n >= 4 || !J || neck < 0 || !jointAt(J, q, neck, clock.t, res.v)) continue;
      const [se, ae] = ringEnter(now - L.born), [sx, ax] = ex === null ? [1, 1] : ringExit(ex);
      // a player the Show layer tags (name, stamina): TELE.pointer.tagged says what the cue does over the tag
      const tagged = staminaShown(getSettings(), q, J.nAtt), mode = P.tagged, bob = 0.5 + 0.5 * Math.sin(2 * Math.PI * P.bobHz * now);
      if (tagged && mode === 'hide') continue;
      const bar = tagged && (mode === 'stack' || mode === 'stack-noname'), under = tagged && mode === 'under';
      // over a player the Show layer tags (chat 5's request, 2026-10-24): the cue stacks on the tag in pixels, from the
      // tag's foot, since the tag keeps one pixel size at any distance (a lift in metres landed on the name far away);
      // the tag's own gap over the head, when it has one in pixels (`gapPx`), goes under it
      res.v.y += bar || under ? SHOW_TAG.upM : 0.45;
      const depth = Math.max(0.1, res.w.copy(res.v).sub(cam.position).dot(res.fwd));
      // over a tag in the new stack ('stack-noname', 'under') the cue is sized with the tag, in pixels (stackScale)
      const sized = bar && mode !== 'stack' || under, ss = sized ? stackScale(depth) : 1;
      const half = sized ? P.stackTri * ss : THREE.MathUtils.clamp(P.halfM / (depth * unit), P.sizeMin, P.sizeVH) * res.size.y;
      A.set([res.v.x, res.v.y, res.v.z, half], n * 4);
      // the colour eases to its target (about 0.12 s), so a click turns the white cue into the team colour in place
      if (q === sel) inkColour('team', q < J.nAtt ? 'att' : 'def', 0, res.c); else surfaceColour(TELE.color[P.color], 0, res.c);
      for (let i = 0; i < 3; i++) L.col[i] += (res.c[i] - L.col[i]) * (L.born === now ? 1 : kc);
      C.set(L.col, n * 3);
      // the lift of the shape's centre, pixels: over a tag, its tip (0.833 half-sizes under the centre) `tagGapPx` over the
      // tag's top, so the name sits midway between the stamina bar and the tip (Yi, 2026-10-25: "centred ... between the
      // stamina bar and the floating triangle"), the bob cut to `tagBobPx`; elsewhere today's lift in half-sizes
      // 'under' (eFootball's way, Yi 2026-10-25): the tip over the head where the tag's foot would be, the tag over it
      const gapPx = sized ? P.stackGap * ss : (SHOW_TAG as { gapPx?: number }).gapPx ?? 0, tagH = sized ? (P.stackName + P.stackRow + P.stackBarH) * ss : SHOW_TAG.px;
      const lift = bar ? tagH + gapPx + P.tagGapPx * ss + 0.833 * half + P.tagBobPx * bob : under ? gapPx + 0.833 * half + P.tagBobPx * bob : half * (P.lift + P.bob * bob);
      Q.set([se * sx, ae * ax, lift, SHAPE_ID[P.shape]], n * 4);
      n++;
      // his name above the triangle: its bottom at the triangle's top plus a gap, in pixels up the screen, turned into
      // metres at his depth; grows and fades with the triangle
      // its name only where no tag carries one (or today's 'stack', which keeps both)
      const name = names && (!tagged || mode === 'stack') ? names(q) : null, g = tagGrp.current[nt], tx = tags.current[nt];
      if (name && g && tx && nt < NAMES) {
        const pxPerM = res.size.y / (depth * unit), S = half * se * sx;
        const capPx = THREE.MathUtils.clamp(P.nameK * half, P.nameMinVH * res.size.y, P.nameMaxVH * res.size.y);
        const upPx = lift + 0.833 * S + Math.max(P.nameGap * half, P.nameGapVH * res.size.y);
        if (tagSt.text[nt] !== name) { tagSt.text[nt] = name; tx.text = name; tx.sync(); }
        tx.color = tagSt.col.setRGB(L.col[0], L.col[1], L.col[2]).getHex();
        tx.fillOpacity = ae * ax; tx.outlineOpacity = 0.55 * ae * ax;
        g.position.copy(res.v).addScaledVector(tagSt.up, upPx / pxPerM);
        g.quaternion.copy(cam.quaternion);
        g.scale.setScalar(((capPx / 0.7) / pxPerM) * se * sx);   // font size in metres: the cap height is about 0.7 em
        g.visible = ae * ax > 0.003;
        nt++;
      }
    }
    for (let i = nt; i < NAMES; i++) { const g = tagGrp.current[i]; if (g) g.visible = false; }
    res.anchor.needsUpdate = true; res.params.needsUpdate = true; res.color.needsUpdate = true;
    res.geo.instanceCount = n; res.mesh.visible = n > 0;
  });
  return (
    <>
      <primitive object={res.mesh} />
      {Array.from({ length: NAMES }, (_, i) => (
        <group key={i} ref={(r) => { tagGrp.current[i] = r; }} visible={false}>
          <Text ref={(r: unknown) => { tags.current[i] = r as Troika | null; }} font={nameFont} material={tagMat} fontSize={1} anchorX="center" anchorY="bottom" letterSpacing={0.02}
            outlineWidth="7%" outlineBlur="22%" outlineColor="#000000" outlineOpacity={0.55} renderOrder={31}>{' '}</Text>
        </group>
      ))}
    </>
  );
}
