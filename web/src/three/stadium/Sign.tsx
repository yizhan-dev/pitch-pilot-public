import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import wordSvg from '../../assets/brand/yizhan-06-horizontal-white.svg?raw';
import symbolSvg from '../../assets/brand/yizhan-06-symbol-white.svg?raw';

// The YIZHAN mark on the stadium, placed the way the Allianz Arena carries its name: one signature on each long side,
// the symbol on each end. The letters are fixed on the fins: their backs sit on the fin edges and follow the facade's bow.
// It follows the identity guidelines (src/assets/brand/README.md): the master artwork scaled, never redrawn; pure white,
// alone or on a solid black panel; clear space of at least 0.25 H.

/** Where a sign goes. pos: a point on the face plane at the sign's centre; n, up: the face's outward normal and up;
 *  H: the visible symbol height; bend: the fin-tip surface across the sign, as offsets d along n at lateral offsets x. */
export interface SignAnchor {
  kind: 'word' | 'symbol'; pos: THREE.Vector3; n: THREE.Vector3; up: THREE.Vector3; room: number; H: number;
  bend: { x: number; d: number }[]; standoff: number;
}

const GAP = 0.04;        // between a letter's back and the fin edges, metres
const DEPTH = 0.32;      // letter depth, metres

/** the master artwork as flat shapes; its centre and extent in units of H (the visible symbol height, 100 SVG units) */
function markShapes(svg: string) {
  const data = new SVGLoader().parse(svg);
  const shapes = data.paths.flatMap((p) => SVGLoader.createShapes(p));
  const probe = new THREE.ShapeGeometry(shapes); probe.computeBoundingBox();
  const bb = probe.boundingBox!.clone(); probe.dispose();
  return { shapes, cx: (bb.min.x + bb.max.x) / 2, cy: (bb.min.y + bb.max.y) / 2, w: (bb.max.x - bb.min.x) / 100, h: (bb.max.y - bb.min.y) / 100 };
}
type Mark = ReturnType<typeof markShapes>;

const bendAt = (bend: SignAnchor['bend'], x: number) => {
  if (!bend.length) return 0;
  if (x <= bend[0].x) return bend[0].d;
  for (let k = 0; k < bend.length - 1; k++) if (x <= bend[k + 1].x) { const a = bend[k], b = bend[k + 1]; return a.d + (b.d - a.d) * (x - a.x) / ((b.x - a.x) || 1); }
  return bend[bend.length - 1].d;
};

/** solid letters H high in the sign's frame (x right, y up, z out); each vertex pushed out onto the fin-tip surface */
function letters(m: Mark, H: number, bend: SignAnchor['bend'], base: number) {
  const g = new THREE.ExtrudeGeometry(m.shapes, { depth: DEPTH / H * 100, bevelEnabled: false, curveSegments: 16 });
  g.translate(-m.cx, -m.cy, 0);
  // SVG y runs down: a half turn about x keeps the winding; then scale to metres, with the back face at z = 0
  g.applyMatrix4(new THREE.Matrix4().makeScale(H / 100, -H / 100, -H / 100));
  g.translate(0, 0, DEPTH);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let k = 0; k < p.count; k++) p.setZ(k, p.getZ(k) + bendAt(bend, p.getX(k)) + GAP - base);
  p.needsUpdate = true; g.computeVertexNormals();
  return g;
}

export interface SignProps { anchors: SignAnchor[]; wordPanel: boolean; symbolPanel: boolean; lit: number; clip: THREE.Plane[]; shadows: boolean; }

/** The white mark fixed on the fins, alone or on a black glass panel; chosen separately for the signature and the symbol. */
export function YizhanSigns({ anchors, wordPanel, symbolPanel, lit, clip, shadows }: SignProps) {
  const marks = useMemo(() => ({ word: markShapes(wordSvg), symbol: markShapes(symbolSvg) }), []);
  const mats = useMemo(() => ({
    // pure white at full opacity; untouched by tone mapping so it stays #FFFFFF
    mark: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.45, toneMapped: false, clippingPlanes: clip }),
    panel: new THREE.MeshStandardMaterial({ color: '#000000', roughness: 0.3, metalness: 0.2, envMapIntensity: 0.4, clippingPlanes: clip }),
  }), [clip]);
  useEffect(() => { mats.mark.emissiveIntensity = lit; }, [mats, lit]);
  const built = useMemo(() => anchors.map((a) => {
    const m = a.kind === 'word' ? marks.word : marks.symbol, panel = a.kind === 'word' ? wordPanel : symbolPanel, H = a.H;
    const pw = m.w * H + H, ph = m.h * H + H, pt = 0.3;          // 0.5 H clear space on every side of the mark
    const base = bendAt(a.bend, 0);                               // the frame's origin sits on the fin edge at the centre
    let geo: THREE.BufferGeometry, panelGeo: THREE.BufferGeometry | null = null;
    if (panel) {
      // a flat panel cannot bend: it rests on the outermost fin edges behind it, and the mark sits flat on its face
      const reach = Math.max(base, ...a.bend.filter((b) => Math.abs(b.x) <= pw / 2).map((b) => b.d)) - base + GAP;
      panelGeo = new THREE.BoxGeometry(pw, ph, pt).translate(0, 0, reach + pt / 2);
      geo = letters(m, H, [], 0).translate(0, 0, reach + pt - GAP);
    } else geo = letters(m, H, a.bend, base);
    const n = a.n.clone().normalize(), up = a.up.clone().addScaledVector(n, -a.up.dot(n)).normalize(), right = up.clone().cross(n);
    const M = new THREE.Matrix4().makeBasis(right, up, n).setPosition(a.pos.clone().addScaledVector(n, base));
    return { geo, panelGeo, q: new THREE.Quaternion().setFromRotationMatrix(M), p: new THREE.Vector3().setFromMatrixPosition(M) };
  }), [anchors, marks, wordPanel, symbolPanel]);
  useEffect(() => () => { built.forEach((b) => { b.geo.dispose(); b.panelGeo?.dispose(); }); }, [built]);
  return (
    <group>
      {built.map((b, k) => (
        <group key={k} position={b.p} quaternion={b.q}>
          {b.panelGeo && <mesh geometry={b.panelGeo} material={mats.panel} castShadow={shadows} receiveShadow={shadows} />}
          <mesh geometry={b.geo} material={mats.mark} castShadow={shadows} />
        </group>
      ))}
    </group>
  );
}
