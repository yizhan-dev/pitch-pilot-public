import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { Loaded } from '../../data';
import type { Clock } from '../../clock';
import { ballAt } from '../Ball';
import { getSettings, type LayerKey } from '../../game/settings';
import type { Look } from '../players/looks';
import { FIGURE_STENCIL, type HideRef } from '../players/Styles';
import { jointAt } from '../camera/Director';
import { attackingOf, playerTeam, roleTeam, type Team } from '../coords';

// The display layers on the pitch (?ui=game, 2026-10-22), switched in src/game/settings.ts (the HUD's display panel). No
// stamina bar over the heads since Yi's call the same day: stamina is the player card's.
//  speed    a ring at the feet in the speed band's colour (FIFA bands as in MA45: walk < 7 km/h, jog < 15, run < 20,
//           high-speed run < 25, sprint)
//  trail    the last 3 s of each player's path, a ribbon on the grass fading out
//  fov      where the face points (nose from between the ears), a 60-degree, 6 m sector on the grass
//  lines    the defending side's back line and midfield line
//  offside  the second-last defender (the keeper counted), across the pitch
//  (the Spearman 'space' layer is gone, Yi 2026-10-24: pitch control is the 战术 mode's base map, the notebook's model
//   precalculated at export; hud/space.ts, docs/plans/space-metrics.md)
//  ball     the ball's last 2 s, a ribbon facing the camera, in every mode (the Show column's ball switch)
// "Which players" (scope): all, the selected one, or the attackers. The player whose eyes the camera uses loses his own.
// Colours go by team, as the kits: home blue and away orange in every clip (coords.ts, Yi 2026-10-23; until then the
// attacking side was blue and the defending side orange).

const BANDS: [number, string][] = [[7, '#8a93a3'], [15, '#e8ebef'], [20, '#67b0ff'], [25, '#ffc94d'], [Infinity, '#ff5a52']];
/** the teams' colours on the pitch, the kits' hues a step lighter */
const TEAM: Record<Team, THREE.Color> = { home: new THREE.Color('#62b0ff'), away: new THREE.Color('#ff8a4c') };
/** the defending side's back line and midfield line, two pale tints of its team's colour: the orange pair as before
 *  2026-10-23, the blue pair the same steps towards white from #62b0ff (about 0.3 and 0.6) */
const LINE_TINT: Record<Team, [string, string]> = { home: ['#91c8ff', '#c3e1ff'], away: ['#ffab85', '#ffd2bd'] };
const TRAIL_N = 31, TRAIL_DT = 0.1, TRAIL_W = 0.2;
const BALL_N = 50, BALL_DT = 0.04;   // the ball's trail: the last 2 s
const CONE_R = 6, CONE_HALF = Math.PI / 6;

type Pkg = Loaded['pkg'] & { players?: { pid: string }[]; half_t0?: number; clock0?: number; teams?: { match?: string } };

const on = (k: LayerKey) => getSettings().layers.includes(k);



/** a sprite drawn from a canvas, redrawn only when what it shows changes, the same size on screen at any distance */
export class Badge {
  canvas = document.createElement('canvas');
  tex: THREE.CanvasTexture;
  sprite: THREE.Sprite;
  key = '';
  constructor(w: number, h: number, centerY: number) {
    this.canvas.width = w; this.canvas.height = h;
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false }));
    this.sprite.renderOrder = 20; this.sprite.center.set(0.5, centerY);
  }
  ctx(key: string) { if (key === this.key) return null; this.key = key; const g = this.canvas.getContext('2d')!; g.clearRect(0, 0, this.canvas.width, this.canvas.height); this.tex.needsUpdate = true; return g; }
}

/** mode: the pitch's grass-to-board change (Stage's TacticalFlip); coming into the 战术 mode the layers wait for the board */
export function GameLayers({ data, clock, looks: _looks, hide, mode }: { data: Loaded; clock: Clock; looks: Look[] | undefined; hide: HideRef; mode?: { current: number } }) {
  const pkg = data.pkg as Pkg, J = data.joints;
  const P = J?.players ?? pkg.frames[0].att.length + pkg.frames[0].def.length, nAtt = J?.nAtt ?? pkg.frames[0].att.length;
  const attacking = attackingOf(pkg.meta), defending = roleTeam('def', attacking);
  const keepers = useMemo(() => new Set(pkg.keepers ?? []), [pkg]);
  const { camera } = useThree();
  const ix = useMemo(() => (J ? { hip: J.names.indexOf('midHip'), neck: J.names.indexOf('neck'), nose: J.names.indexOf('nose'), rEar: J.names.indexOf('rEar'), lEar: J.names.indexOf('lEar') } : null), [J]);

  // ---- the objects
  const objs = useMemo(() => {
    const group = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(0.55, 0.72, 40).rotateX(-Math.PI / 2);
    const rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), P);
    const coneGeo = new THREE.CircleGeometry(CONE_R, 24, -CONE_HALF, 2 * CONE_HALF).rotateX(-Math.PI / 2);
    const cones = new THREE.InstancedMesh(coneGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.13, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), P);
    // trails: one strip per player, two vertices per sample
    const tv = P * TRAIL_N * 2, trailGeo = new THREE.BufferGeometry(), idx: number[] = [];
    for (let p = 0; p < P; p++) for (let k = 0; k < TRAIL_N - 1; k++) { const a = (p * TRAIL_N + k) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(tv * 4), 4).setUsage(THREE.DynamicDrawUsage));
    trailGeo.setIndex(idx);
    const trails = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    // the defending side's lines and the offside line: ribbons on the grass, up to 12 segments
    const lineGeo = new THREE.BufferGeometry(), lv = 12 * 4;
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(lv * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const lidx: number[] = []; for (let s = 0; s < 12; s++) { const a = s * 4; lidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    lineGeo.setIndex(lidx);
    const lines = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }));
    // the ball's trail, facing the camera
    const bv = BALL_N * 2, ballGeo = new THREE.BufferGeometry(), bidx: number[] = [];
    for (let k = 0; k < BALL_N - 1; k++) { const a = k * 2; bidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    ballGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    ballGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(bv * 4), 4).setUsage(THREE.DynamicDrawUsage));
    ballGeo.setIndex(bidx);
    // always under every player, the referee and the ball (Yi, 2026-10-26), whether they are in front of it or behind: they
    // mark the stencil (players/Styles.tsx FIGURE_STENCIL) and the trail draws only where it is unmarked. Over the ground
    // marks (pitch control, the pen, telestration on the grass, orders up to 9), since the ball is above the grass
    const ballTrail = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
      stencilWrite: true, stencilRef: FIGURE_STENCIL, stencilFunc: THREE.NotEqualStencilFunc, stencilWriteMask: 0,
      stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp }));
    for (const o of [rings, cones, trails, lines, ballTrail]) o.frustumCulled = false;
    group.add(rings, cones, trails, lines);
    // the board's layers in `group` (shown in the tactical mode only); the ball's trail beside it, in every mode
    const root = new THREE.Group(); root.add(group, ballTrail);
    rings.renderOrder = 3; cones.renderOrder = 2; trails.renderOrder = 2; lines.renderOrder = 4; ballTrail.renderOrder = 10;
    return { root, group, rings, cones, trails, lines, ballTrail };
  }, [P]);
  useEffect(() => () => {
    for (const m of [objs.rings, objs.cones, objs.trails, objs.lines, objs.ballTrail]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
  }, [objs]);

  const st = useMemo(() => ({
    hips: Array.from({ length: P }, () => new THREE.Vector3()), prev: Array.from({ length: P }, () => new THREE.Vector3()),
    yaw: new Float32Array(P), yawInit: new Uint8Array(P), v: new THREE.Vector3(), w: new THREE.Vector3(), m: new THREE.Matrix4(), q: new THREE.Quaternion(),
    zero: new THREE.Matrix4().makeScale(0, 0, 0), up: new THREE.Vector3(0, 1, 0), c: new THREE.Color(), lastT: -1,
    // the ball's trail: its samples and which of them have a ball
    pts: Array.from({ length: BALL_N }, () => new THREE.Vector3()), has: new Uint8Array(BALL_N), origin: new THREE.Vector3(),
  }), [P]);

  /** a player's hips at time t (scene axes); from the joints, else the 10 Hz positions */
  const hipAt = (p: number, t: number, out: THREE.Vector3) => {
    if (J && ix && jointAt(J, p, ix.hip, t, out)) { out.y = 0; return out; }
    const F = pkg.frames, f = F[Math.max(0, Math.min(F.length - 1, Math.round(t * pkg.meta.fps)))], a = [...f.att, ...f.def][p];
    return out.set(a?.[0] ?? 0, 0, a?.[1] ?? 0);
  };


  useFrame((_, dt) => {
    const s = getSettings(), t = clock.t, hidden = hide.current;
    // the ball's trail, as a ribbon turned to the camera: in every mode but Explain, whose look is its director's (as the
    // Show menu's choices are not taken there), not only on the board (Yi, 2026-10-26: the Show column's ball switch)
    objs.ballTrail.visible = on('ball') && s.mode !== 'explain';
    if (objs.ballTrail.visible) {
      const pos = objs.ballTrail.geometry.attributes.position.array as Float32Array, col = objs.ballTrail.geometry.attributes.color.array as Float32Array;
      const { pts, has } = st;
      let first = -1;
      for (let k = 0; k < BALL_N; k++) {
        const b = ballAt(pkg, t - (BALL_N - 1 - k) * BALL_DT);
        has[k] = b ? 1 : 0;
        if (b) { pts[k].set(b[0], Math.max(0.11, b[2]), b[1]); if (first < 0) first = k; }
      }
      for (let k = 0; k < BALL_N; k++) {
        // a sample with no ball takes the first one there is (it is drawn at no width), as the neighbours do
        const p = has[k] ? pts[k] : first >= 0 ? pts[first] : st.origin, ka = Math.max(0, k - 1), kb = Math.min(BALL_N - 1, k + 1);
        const a = has[ka] ? pts[ka] : p, b = has[kb] ? pts[kb] : p;
        const dir = st.v.subVectors(b, a), view = st.w.subVectors(camera.position, p), side = dir.cross(view);
        const l = side.length() || 1, w = has[k] ? 0.07 * (0.3 + 0.7 * k / (BALL_N - 1)) : 0;
        side.multiplyScalar(w / l);
        const o = k * 6; pos[o] = p.x - side.x; pos[o + 1] = p.y - side.y; pos[o + 2] = p.z - side.z; pos[o + 3] = p.x + side.x; pos[o + 4] = p.y + side.y; pos[o + 5] = p.z + side.z;
        const al = has[k] ? 0.8 * (k / (BALL_N - 1)) ** 1.3 : 0, c = k * 8;
        col[c] = col[c + 1] = col[c + 2] = 1; col[c + 3] = al; col[c + 4] = col[c + 5] = col[c + 6] = 1; col[c + 7] = al;
      }
      objs.ballTrail.geometry.attributes.position.needsUpdate = true; objs.ballTrail.geometry.attributes.color.needsUpdate = true;
    }
    // the layers belong to the tactical mode: off, the pitch is the plain match. Coming in they wait for the board and
    // fade in over the end of the hexagon change (Yi, 2026-10-22: pitch control showed on the grass first); going out they
    // go at once
    const k = mode ? THREE.MathUtils.smoothstep(mode.current, 0.8, 1) : 1;
    objs.group.visible = s.tactical && k > 0;
    if (!objs.group.visible) { st.lastT = t; return; }
    const shows = (p: number) => p !== hidden && (s.scope === 'all' || (s.scope === 'selected' ? p === s.selected : p < nAtt));
    // hips and speeds
    for (let p = 0; p < P; p++) { hipAt(p, t, st.hips[p]); hipAt(p, t - 0.2, st.prev[p]); }
    // speed rings
    objs.rings.visible = on('speed');
    if (objs.rings.visible) {
      for (let p = 0; p < P; p++) {
        if (!shows(p)) { objs.rings.setMatrixAt(p, st.zero); continue; }
        const kmh = (st.hips[p].distanceTo(st.prev[p]) / 0.2) * 3.6, band = BANDS.find(([lim]) => kmh < lim)!;
        objs.rings.setColorAt(p, st.c.set(band[1]));
        st.m.makeTranslation(st.hips[p].x, 0.03, st.hips[p].z); objs.rings.setMatrixAt(p, st.m);
      }
      objs.rings.instanceMatrix.needsUpdate = true; if (objs.rings.instanceColor) objs.rings.instanceColor.needsUpdate = true;
    }
    // vision sectors, the face's direction smoothed over about 0.2 s
    objs.cones.visible = on('fov') && !!J && !!ix;
    if (objs.cones.visible && J && ix) {
      const k = 1 - Math.exp(-Math.max(dt, 1e-3) / 0.2);
      for (let p = 0; p < P; p++) {
        if (!shows(p) || !jointAt(J, p, ix.nose, t, st.v) || !jointAt(J, p, ix.rEar, t, st.w)) { objs.cones.setMatrixAt(p, st.zero); continue; }
        const nx = st.v.x, nz = st.v.z, ex = st.w.x, ez = st.w.z;
        if (!jointAt(J, p, ix.lEar, t, st.w)) { objs.cones.setMatrixAt(p, st.zero); continue; }
        const dx = nx - (ex + st.w.x) / 2, dz = nz - (ez + st.w.z) / 2, target = Math.atan2(-dz, dx);
        if (!st.yawInit[p] || Math.abs(t - st.lastT) > 0.5) { st.yaw[p] = target; st.yawInit[p] = 1; }
        st.yaw[p] += Math.atan2(Math.sin(target - st.yaw[p]), Math.cos(target - st.yaw[p])) * k;
        st.q.setFromAxisAngle(st.up, st.yaw[p]); st.m.compose(st.v.set(st.hips[p].x, 0.025, st.hips[p].z), st.q, st.w.set(1, 1, 1));
        objs.cones.setMatrixAt(p, st.m);
      }
      objs.cones.instanceMatrix.needsUpdate = true;
    }
    // trails
    objs.trails.visible = on('trail');
    if (objs.trails.visible) {
      const pos = objs.trails.geometry.attributes.position.array as Float32Array, col = objs.trails.geometry.attributes.color.array as Float32Array;
      const pts = Array.from({ length: TRAIL_N }, () => new THREE.Vector3());
      for (let p = 0; p < P; p++) {
        const vis = shows(p), tc = TEAM[playerTeam(p, nAtt, attacking)];
        for (let k = 0; k < TRAIL_N; k++) hipAt(p, t - (TRAIL_N - 1 - k) * TRAIL_DT, pts[k]);
        for (let k = 0; k < TRAIL_N; k++) {
          const a = pts[Math.max(0, k - 1)], b = pts[Math.min(TRAIL_N - 1, k + 1)];
          let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
          const w = vis ? TRAIL_W * (0.35 + 0.65 * k / (TRAIL_N - 1)) : 0, o = ((p * TRAIL_N + k) * 2) * 3;
          pos[o] = pts[k].x - dz * w / 2; pos[o + 1] = 0.035; pos[o + 2] = pts[k].z + dx * w / 2;
          pos[o + 3] = pts[k].x + dz * w / 2; pos[o + 4] = 0.035; pos[o + 5] = pts[k].z - dx * w / 2;
          const al = vis ? 0.85 * (k / (TRAIL_N - 1)) ** 1.5 : 0, c4 = ((p * TRAIL_N + k) * 2) * 4;
          for (const off of [0, 4]) { col[c4 + off] = tc.r; col[c4 + off + 1] = tc.g; col[c4 + off + 2] = tc.b; col[c4 + off + 3] = al; }
        }
      }
      objs.trails.geometry.attributes.position.needsUpdate = true; objs.trails.geometry.attributes.color.needsUpdate = true;
    }
    // the defending side's lines and the offside line
    objs.lines.visible = on('lines') || on('offside');
    if (objs.lines.visible) {
      const pos = objs.lines.geometry.attributes.position.array as Float32Array, col = objs.lines.geometry.attributes.color.array as Float32Array;
      pos.fill(0); col.fill(0);
      let seg = 0;
      const ribbon = (ax: number, az: number, bx: number, bz: number, w: number, c: THREE.Color, a: number) => {
        if (seg >= 12) return;
        let dx = bx - ax, dz = bz - az; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const o = seg * 12, q = seg * 16, h = 0.04;
        const v = [[ax - dz * w, az + dx * w], [ax + dz * w, az - dx * w], [bx - dz * w, bz + dx * w], [bx + dz * w, bz - dx * w]];
        v.forEach(([x, z], i) => { pos[o + i * 3] = x; pos[o + i * 3 + 1] = h; pos[o + i * 3 + 2] = z; col[q + i * 4] = c.r; col[q + i * 4 + 1] = c.g; col[q + i * 4 + 2] = c.b; col[q + i * 4 + 3] = a; });
        seg++;
      };
      const defs = Array.from({ length: P - nAtt }, (_, i) => nAtt + i), out = defs.filter((p) => !keepers.has(p)).sort((a, b) => st.hips[b].x - st.hips[a].x);
      if (on('lines') && out.length >= 4) {
        let back = out.slice(0, 4);
        if (out[4] && st.hips[out[3]].x - st.hips[out[4]].x < 2.5) back = out.slice(0, 5);
        const rest = out.slice(back.length), mid = rest.filter((p) => st.hips[p].x >= st.hips[rest[0]].x - 9).slice(0, 5);
        const draw = (g: number[], c: THREE.Color, a: number) => { const s2 = [...g].sort((a2, b2) => st.hips[a2].z - st.hips[b2].z); for (let i = 0; i + 1 < s2.length; i++) ribbon(st.hips[s2[i]].x, st.hips[s2[i]].z, st.hips[s2[i + 1]].x, st.hips[s2[i + 1]].z, 0.07, c, a); };
        draw(back, st.c.set(LINE_TINT[defending][0]), 0.95);
        if (mid.length >= 2) draw(mid, st.c.set(LINE_TINT[defending][1]), 0.6);
      }
      if (on('offside') && defs.length >= 2) {
        const xs = defs.map((p) => st.hips[p].x).sort((a, b) => b - a), xo = xs[1];
        ribbon(xo, -34, xo, 34, 0.06, st.c.set('#ffe066'), 0.95);
      }
      objs.lines.geometry.attributes.position.needsUpdate = true; objs.lines.geometry.attributes.color.needsUpdate = true;
    }
    st.lastT = t;
  });
  return <primitive object={objs.root} />;
}
