// The xG widget lying on the grass (Yi, 2026-10-22: when the view is above a certain height, the xG tag is displayed
// as if it were on the grass). The same plate as the standing widget (XgWidget.tsx) and the same frames (xgFrame: the
// leader, the plate opening, the decimals rolling, the glitch), drawn into a canvas each frame and laid on a plane beside
// the shooter's feet: depth tested like the other ground marks (players standing on it hide it), turned about the
// vertical so it reads upright from the camera, its leader running out from his ring. Sized in metres (TELE.shot.tagM,
// the plate's height), so it foreshortens like paint.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { xgFrame, type XgWidgetState } from './XgWidget';

const CU = 3, H = 58 * CU, W = 640;                 // canvas pixels per plate unit; the plate's height; the canvas width
const LEAD = 46 * CU;                                // the leader's length in the canvas, before the plate
const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';

/** draws one frame: the leader from the near end (the feet's side), then the plate (accent bar on the leader's side,
 *  "xG" and the number sharing a baseline, read left to right on either side), opened from the leader's end, glitching */
function draw(g: CanvasRenderingContext2D, off: HTMLCanvasElement, S: XgWidgetState, left: boolean) {
  const F = xgFrame(S), o = off.getContext('2d')!;
  g.clearRect(0, 0, W, H); o.clearRect(0, 0, W, H);
  const capPx = 17 * CU, numPx = 44 * CU, base = H - 7 * CU - 0.1 * numPx;     // the shared baseline (0.9 em down)
  o.font = `600 ${capPx}px ${FONT}`; const capW = o.measureText('xG').width;
  o.font = `700 ${numPx}px ${FONT}`; const dW = o.measureText('0').width, dotW = o.measureText('.').width;
  const numW = F.rolls.reduce((sum, r) => sum + (r.ch === '.' ? dotW : dW), 0);
  const pw = 4 * CU + 12 * CU + capW + 6 * CU + 2 * CU + numW + 14 * CU;
  // the plate in the offscreen canvas at 0..pw, its accent bar at the end nearer the leader
  const grad = o.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, 'rgba(16,21,30,0.94)'); grad.addColorStop(1, 'rgba(6,9,14,0.9)');
  o.fillStyle = grad; o.fillRect(0, 0, pw, H);
  o.strokeStyle = 'rgba(255,255,255,0.14)'; o.lineWidth = 2; o.strokeRect(1, 1, pw - 2, H - 2);
  o.fillStyle = S.accent; o.fillRect(left ? pw - 4 * CU : 0, 0, 4 * CU, H);
  const xs = left ? 0 : 4 * CU;                                           // where the text block starts
  o.font = `600 ${capPx}px ${FONT}`; o.fillStyle = 'rgba(242,244,247,0.66)'; o.textBaseline = 'alphabetic';
  o.fillText('xG', xs + 12 * CU, base);
  let x = xs + 12 * CU + capW + 6 * CU + 2 * CU;
  o.font = `700 ${numPx}px ${FONT}`;
  for (const r of F.rolls) {
    const w = r.ch === '.' ? dotW : dW;
    o.save(); o.beginPath(); o.rect(x, base - 0.9 * numPx, w, numPx); o.clip();
    o.filter = r.e < 1 ? `blur(${(1 - r.e) * 1.4 * CU}px)` : 'none';
    const glyph = (t: string, y: number) => {
      if (F.glitch) {
        o.fillStyle = 'rgba(255,46,96,0.85)'; o.fillText(t, x + F.glitch.dx * CU, y);
        o.fillStyle = 'rgba(40,226,255,0.85)'; o.fillText(t, x - F.glitch.dx * CU, y);
      }
      o.fillStyle = '#f2f4f7'; o.fillText(t, x, y);
    };
    if (r.ch === '.') glyph('.', base);
    else { const k0 = Math.floor(r.k), fr = r.k - k0; glyph(String(k0 % 10), base - fr * numPx); if (fr > 0.001) glyph(String((k0 + 1) % 10), base + (1 - fr) * numPx); }
    o.restore();
    x += w;
  }
  // onto the canvas: the plate just past the leader, opened from the leader's end, jittered and torn while it glitches
  const G = F.glitch, shown = pw * Math.max(0, Math.min(1, F.open));
  const px0 = left ? W - LEAD - pw : LEAD, sx = left ? pw - shown : 0, dx0 = px0 + sx + (G ? G.jitter * CU : 0);
  if (shown > 0.5) {
    g.globalAlpha = G ? G.alpha : 1;
    g.drawImage(off, sx, 0, shown, H, dx0, 0, shown, H);
    if (G) for (const bar of G.bars) {
      const y = bar.top * H, hh = bar.h * CU;
      g.drawImage(off, sx, y, shown, hh, dx0 + bar.shift * CU, y, shown, hh);
      g.fillStyle = 'rgba(242,244,247,0.22)'; g.fillRect(dx0 + bar.shift * CU, y, shown, hh);
    }
    g.globalAlpha = 1;
  }
  // the leader: from the near end along the plate's middle, drawn out first
  g.strokeStyle = 'rgba(242,244,247,0.85)'; g.lineWidth = 1.6 * CU;
  g.beginPath();
  if (left) { g.moveTo(W, H / 2); g.lineTo(W - LEAD * F.lead, H / 2); } else { g.moveTo(0, H / 2); g.lineTo(LEAD * F.lead, H / 2); }
  g.stroke();
}

export function XgGroundTag({ store }: { store: { s: XgWidgetState } }) {
  const res = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const off = document.createElement('canvas'); off.width = W; off.height = H;
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4, toneMapped: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.renderOrder = 9; mesh.visible = false; mesh.matrixAutoUpdate = false; mesh.frustumCulled = false;
    return { canvas, off, tex, mat, mesh, g: canvas.getContext('2d')!, up: new THREE.Vector3(), right: new THREE.Vector3(), n: new THREE.Vector3(0, 1, 0), m: new THREE.Matrix4() };
  }, []);
  useEffect(() => () => { res.tex.dispose(); res.mat.dispose(); res.mesh.geometry.dispose(); }, [res]);
  useFrame(({ camera }) => {
    const S = store.s, R = res;
    R.mesh.visible = S.on && S.mode === 'ground';
    if (!R.mesh.visible) return;
    // reading upright from the camera: its up is the camera's up laid on the grass (as the ground labels)
    R.up.set(0, 1, 0).applyQuaternion(camera.quaternion).setY(0);
    if (R.up.lengthSq() < 1e-6) camera.getWorldDirection(R.up).setY(0);
    R.up.normalize(); R.right.set(-R.up.z, 0, R.up.x);
    // beside the feet on the widget's side, its near end at the ring's edge
    const h = S.tagM, w = (h * W) / H, side = S.side, c = S.ringR + 0.15 + w / 2;
    const cx = S.feet[0] + R.right.x * side * c, cz = S.feet[1] + R.right.z * side * c;
    R.m.makeBasis(R.right, R.up, R.n).scale(new THREE.Vector3(w, h, 1)).setPosition(cx, 0, cz);
    R.mesh.matrix.copy(R.m); R.mesh.matrixWorldNeedsUpdate = true;
    draw(R.g, R.off, S, side < 0);
    R.tex.needsUpdate = true;
  });
  return <primitive object={res.mesh} />;
}
