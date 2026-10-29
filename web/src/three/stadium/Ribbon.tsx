import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { PathPt } from './path';
import { LOWER_END } from './layout';
import wordSvg from '../../assets/brand/yizhan-06-horizontal-white.svg?raw';

// The LED ribbon on the upper tier's front (candidate 7 of docs/research/stadium-vivid.md). A black
// strip 0.9 m tall set into the tier front's 1.1 m light grey band, so a thin grey line stays above and below it, with
// the white YIZHAN signature evenly spaced round the loop (preferred over a plain black strip with white edge lines,
// also on the third tier; that version: <private-workspace>). The
// signatures are a whole number of tiles along the ribbon's own length (its corners run 21 m out from the bowl's edge,
// so they are much longer than the base path's), a multiple of four, so one sits centred on the halfway line and on
// both goal axes and the pattern is symmetric. (The first version tiled by the base path every 12 m: stretched and
// spread out on the corners, with a seam at the main stand's middle.)
const H = 0.9, TILE = 12;

/** a ribbon strip along the path at offset d, its top at top(i); u counts tiles along the strip's own length, a whole
 *  number of them round the loop, a multiple of four, with u = 0.5 (a tile's centre) at the path's start */
function ribbonGeometry(path: PathPt[], d: number, top: (i: number) => number) {
  const n = path.length, P = path.map((p) => [p.x + p.nx * d, p.y + p.ny * d]), arc = [0];
  for (let i = 1; i <= n; i++) arc.push(arc[i - 1] + Math.hypot(P[i % n][0] - P[i - 1][0], P[i % n][1] - P[i - 1][1]));
  const L = arc[n], tiles = Math.max(4, 4 * Math.round(L / TILE / 4));
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const k = i % n, h1 = top(k) - 0.1, h0 = h1 - H, u = arc[i] / L * tiles + 0.5;
    pos.push(P[k][0], h0, P[k][1], P[k][0], h1, P[k][1]); uv.push(u, 0, u, 1);
  }
  for (let i = 0; i < n; i++) { const a = 2 * i; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return { geo: g, tiles, tileM: L / tiles };
}

/** one tile's texture, 128 px per metre of height: black with the signature 0.44 m tall, centred */
function ribbonTexture(onReady: () => void) {
  const c = document.createElement('canvas'); c.width = 1536; c.height = 128;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8;
  const g = c.getContext('2d')!; g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  const img = new Image();
  img.onload = () => { const h = 62, w = h * (img.width / img.height || 4.84); g.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h); t.needsUpdate = true; onReady(); };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(wordSvg);
  return t;
}

/** LED content is self-lit; it wins depth ties with the grey band it sits on */
function ribbonMaterial(tex: THREE.Texture, clip: THREE.Plane[]) {
  return new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, clippingPlanes: clip });
}

/** the upper tier's ribbon: its front face (layout FASCIA) at d = LOWER_END.d + 1.2, its grey band's top at LOWER_END.h + 3.2 */
export function Ribbon({ path, clip }: { path: PathPt[]; clip: THREE.Plane[] }) {
  const invalidate = useThree((s) => s.invalidate);
  const geo = useMemo(() => ribbonGeometry(path, LOWER_END.d + 1.2 - 0.02, () => LOWER_END.h + 3.2).geo, [path]);
  const tex = useMemo(() => ribbonTexture(invalidate), [invalidate]);
  const mat = useMemo(() => ribbonMaterial(tex, clip), [tex, clip]);
  useEffect(() => () => { geo.dispose(); tex.dispose(); mat.dispose(); }, [geo, tex, mat]);
  return <mesh geometry={geo} material={mat} />;
}
