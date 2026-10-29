import { useEffect, useMemo, useRef } from 'react';
import { hook } from '../dev';
import * as THREE from 'three';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import type { Clock } from '../clock';
import type { Loaded } from '../data';
import { useGameSettings } from '../game/settings';
import { Telestration, type Item } from '../three/telestration/Telestration';
import { makeAnchors } from '../three/telestration/anchors';
import { TELE } from '../three/telestration/style';
import type { ClipPkg } from './match';
import { momentAt } from './analysis';
import { useClockTime } from './useClockTime';
import {
  drawMode, tool, ink, drafting, strokes, frames, playbackPlaying, addStroke, replaceLastStroke, hoveredPlayer,
  hoveredStroke, selectedStroke, selectedAt, removeStroke, openZone, drawingExit, drawingAt, openFrame, leaveDrawing, switchClip,
  FRAME_VISIBLE_TOLERANCE_SECONDS, FRAME_MERGE_TOLERANCE_SECONDS,
  strokeId, useStore, type Stroke,
} from './draft';

// The Tactics pen (telestration-notes §22): the pointer's gestures and the marks they make.
// While the pen is on (`drawMode` in the Tactics mode) an unseen plane over the pitch takes the pointer (the camera
// director leaves it alone, as it did for 画板) and each tool turns a gesture into a stroke (draft.ts); every stroke is
// drawn as the telestration items (the Explain tab's accepted elements and their animations):
// - highlight, vision, speed trail: click players (`spotlight`, one `vision` for all the clicked players, `trail`; the
//   passing network is not a pen tool);
// - pass: drag from a player to a spot, or to a team-mate (`pass`; along the ground under LOFT_FROM_M, lofted beyond it,
//   the telestration arc's height from the length: the pass's distance decides whether it is lofted);
// - run: drag a player to where he could run (`heading` with `to`: the chevrons, no ghost);
// - link: click players in order; the first again closes it (`link`: two opponents the marking pair, team-mates a line,
//   closed an area with its m²); a click on the grass ends a line;
// - zone: click a polygon's corners, the first again closes it (`zone` poly; no box or circle); while it is
//   open its edges so far, the next one following the pointer and the first corner's reach are drawn (ZoneDraft), the
//   zone itself only once closed;
// - distance: drag between two points (`stroke` 'measure').
// Strokes are pinned to the moment they were drawn (`at`). Each drawing is a freeze frame (draft.ts):
// paused on a frame its drawing is opened here to draw on; it leaves (the telestration items' exits) when play goes on, the clock moves
// away from its moment or its frame is deleted; each clip keeps its own. A drawn mark under the pointer is outlined faintly; a click on
// it selects it (outlined brightly; the Tactics column shows a delete button by it) instead of drawing.
// Mounted by PitchOverlay3D, inside the Stage's canvas.

const L = 105, W = 68;
/** the pick plane, a little past the lines so a drag can end just outside them, metres */
const PLANE_PAD_M = 6;
/** a click this close to a player picks him, metres */
const PICK_M = 2;
/** a polygon's click this close to its first corner closes it, metres */
const CLOSE_M = 2;
/** a drag shorter than this is a slip, metres */
const MIN_DRAG_M = 0.8;
/** a pass this long or longer is drawn lofted (`loft: true`: the telestration arc, 18% of the length within 1.5 to 9 m), metres */
const LOFT_FROM_M = 25;
/** a polygon's corners at most */
const POLY_MAX = 8;
/** a mark's hit area and outline: the margin round a line's ends and either side of it, round a player, round a zone */
const LINE_PAD_M = 1.1, PLAYER_PAD_M = 1.5, ZONE_PAD_M = 0.6;
/** the outline's width, metres, and its strength hovered and selected */
const OUTLINE_W_M = 0.16, HOVER_ALPHA = 0.4, SELECTED_ALPHA = 0.9;
/** the open polygon's look: its edges (the pen's line width), the next one's dashes (on, off) and width, the corners'
 *  dots, all metres; the first corner's ring pulses this often a second once it can close */
const DRAFT_W_M = 0.26, NEXT_W_M = 0.2, NEXT_DASH_M: XY = [1.0, 0.6], DOT_R_M = 0.38, REACH_HZ = 0.8;

/** how high the pen's own marks (outlines, the open polygon) lie, metres: on the grass, where the telestration draws
 *  (ground.ts, y 0), the polygon offset keeping them on top. Higher reads as further from the camera (at
 *  4.5 cm the hover ring sat off the spotlight column's centre, about 10 cm behind it from the broadcast camera) */
const MARK_Y = 0.002;

type XY = [number, number];
const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** where the pointer's ray meets the grass (y 0), pitch metres: not the hit plane's point, which lies above it */
const groundOf = (e: ThreeEvent<PointerEvent>): XY => {
  const { origin: o, direction: d } = e.ray;
  if (Math.abs(d.y) < 1e-6) return [e.point.x, e.point.z];
  const k = -o.y / d.y;
  return [o.x + d.x * k, o.z + d.z * k];
};

/** a mark's outline (its hit area too), pitch metres: a band round a line, a circle round a player, the zone's own shape */
function outlineOf(s: Stroke, posAt: (p: number, t: number) => XY | null): XY[] {
  const t = s.t ?? 0, ps = s.players ?? [], end = s.pts[s.pts.length - 1];
  const circle = (c: XY, r: number, n = 20): XY[] => Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)]);
  const band = (a: XY, b: XY): XY[] => {
    const d = Math.max(dist(a, b), 1e-6), u: XY = [(b[0] - a[0]) / d, (b[1] - a[1]) / d], n: XY = [-u[1], u[0]], r = LINE_PAD_M;
    return [[a[0] - u[0] * r + n[0] * r, a[1] - u[1] * r + n[1] * r], [b[0] + u[0] * r + n[0] * r, b[1] + u[1] * r + n[1] * r],
      [b[0] + u[0] * r - n[0] * r, b[1] + u[1] * r - n[1] * r], [a[0] - u[0] * r - n[0] * r, a[1] - u[1] * r - n[1] * r]];
  };
  const box = (pts: XY[], pad: number): XY[] => {
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  };
  const players = ps.map((p) => posAt(p, t)).filter((q): q is XY => q !== null);
  switch (s.tool) {
    case 'highlight': case 'trail': return players.length ? circle(players[0], PLAYER_PAD_M) : [];
    case 'vision': return players.length === 1 ? circle(players[0], PLAYER_PAD_M) : players.length ? box(players, PLAYER_PAD_M) : [];
    case 'link': return players.length === 1 ? circle(players[0], PLAYER_PAD_M) : players.length === 2 ? band(players[0], players[1]) : players.length ? box(players, PLAYER_PAD_M) : [];
    case 'pass': {
      const a = s.player !== undefined ? posAt(s.player, t) ?? s.pts[0] : s.pts[0], b = ps.length ? players[0] ?? end : end;
      return band(a, b);
    }
    case 'run': return band(s.player !== undefined ? posAt(s.player, t) ?? s.pts[0] : s.pts[0], end);
    case 'measure': return band(s.pts[0], end);
    case 'zone':
      if (s.shape === 'circle') return circle(s.pts[0], dist(s.pts[0], end) + ZONE_PAD_M, 28);
      if (s.shape === 'poly') return s.pts.length >= 3 ? box(s.pts, ZONE_PAD_M) : [];
      return box([s.pts[0], end], ZONE_PAD_M);
    default: return [];
  }
}
const inside = (q: XY, poly: XY[]) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > q[1]) !== (yj > q[1]) && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
const area = (poly: XY[]) => Math.abs(poly.reduce((a, q, i) => { const r = poly[(i + 1) % poly.length]; return a + q[0] * r[1] - r[0] * q[1]; }, 0)) / 2;
/** a path as a flat band on the grass (world x, z = pitch x, y): its triangles' corners; closed back to its start, or
 *  open, solid or in dashes (on, off metres, from each edge's start) */
function band(path: XY[], width: number, closed: boolean, dash?: XY, y = MARK_Y): number[] {
  const v: number[] = [], h = width / 2;
  const quad = (a: XY, b: XY) => {
    const d = Math.max(dist(a, b), 1e-6), n: XY = [-(b[1] - a[1]) / d * h, (b[0] - a[0]) / d * h];
    const A1 = [a[0] + n[0], y, a[1] + n[1]], A2 = [a[0] - n[0], y, a[1] - n[1]], B1 = [b[0] + n[0], y, b[1] + n[1]], B2 = [b[0] - n[0], y, b[1] - n[1]];
    v.push(...A1, ...B1, ...B2, ...A1, ...B2, ...A2);
  };
  for (let i = 0; i < (closed ? path.length : path.length - 1); i++) {
    const a = path[i], b = path[(i + 1) % path.length], d = dist(a, b);
    if (!dash) { quad(a, b); continue; }
    const at = (f: number): XY => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    for (let s0 = 0; s0 < d; s0 += dash[0] + dash[1]) quad(at(s0 / d), at(Math.min(d, s0 + dash[0]) / d));
  }
  return v;
}
const geometryOf = (v: number[], g = new THREE.BufferGeometry()) => {
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeBoundingSphere();
  return g;
};
/** a closed outline as a flat band on the grass */
const ribbon = (poly: XY[], width: number) => geometryOf(band(poly, width, true));
const draftMaterial = (opacity: number) => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });

/** the polygon still being clicked on, each edge shown as it is drawn so the viewer knows when and where to close it:
 *  its edges so far, the next one dashed from the last corner to the pointer, a dot at
 *  each corner and, from the third corner, a ring round the first as far as a click there closes it (CLOSE_M), pulsing;
 *  with the pointer inside it the ring fills, the next edge runs to the first corner and the zone it makes shows faintly */
function ZoneDraft({ pts, pointer }: { pts: XY[]; pointer: { current: XY | null } }) {
  const y = 0.003, canClose = pts.length >= 3, first = pts[0];   // a millimetre over MARK_Y
  const edges = useMemo(() => geometryOf(band(pts, DRAFT_W_M, false, undefined, y)), [pts]);
  const mats = useMemo(() => ({ edge: draftMaterial(0.95), next: draftMaterial(0.75), fill: draftMaterial(0.2), ring: draftMaterial(0.8), reach: draftMaterial(0.26) }), []);
  const live = useMemo(() => ({ next: new THREE.BufferGeometry(), fill: new THREE.BufferGeometry() }), []);
  useEffect(() => () => edges.dispose(), [edges]);
  useEffect(() => () => { live.next.dispose(); live.fill.dispose(); Object.values(mats).forEach((m) => m.dispose()); }, [live, mats]);
  const reachRef = useRef<THREE.Mesh>(null), fillRef = useRef<THREE.Mesh>(null), last = useRef('');
  useEffect(() => { last.current = ''; }, [pts]);
  useFrame(({ clock }) => {
    const p = pointer.current, closing = !!p && canClose && dist(p, first) < CLOSE_M;
    mats.ring.opacity = closing ? 0.95 : 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 2 * Math.PI * REACH_HZ));
    if (reachRef.current) reachRef.current.visible = closing;
    if (fillRef.current) fillRef.current.visible = closing;
    const key = p ? `${p[0].toFixed(2)},${p[1].toFixed(2)},${closing}` : '';
    if (key === last.current) return;
    last.current = key;
    const from = pts[pts.length - 1], to = closing ? first : p;
    geometryOf(to ? band([from, to], closing ? DRAFT_W_M : NEXT_W_M, false, closing ? undefined : NEXT_DASH_M, y) : [], live.next);
    if (closing) {
      const v: number[] = [];
      for (const tri of THREE.ShapeUtils.triangulateShape(pts.map((q) => new THREE.Vector2(q[0], q[1])), [])) for (const i of tri) v.push(pts[i][0], y - 0.001, pts[i][1]);
      geometryOf(v, live.fill);
    }
  });
  const flat = { 'rotation-x': -Math.PI / 2, renderOrder: 10, raycast: () => undefined, frustumCulled: false } as const;
  return (
    <group>
      <mesh geometry={live.fill} material={mats.fill} ref={fillRef} renderOrder={10} raycast={() => undefined} frustumCulled={false} visible={false} />
      <mesh geometry={edges} material={mats.edge} renderOrder={10} raycast={() => undefined} frustumCulled={false} />
      <mesh geometry={live.next} material={mats.next} renderOrder={10} raycast={() => undefined} frustumCulled={false} />
      {pts.map((q, i) => (
        <mesh key={i} position={[q[0], y, q[1]]} material={mats.edge} {...flat}><circleGeometry args={[DOT_R_M, 20]} /></mesh>
      ))}
      {canClose && <>
        <mesh position={[first[0], y, first[1]]} material={mats.ring} {...flat}><ringGeometry args={[CLOSE_M - 0.14, CLOSE_M, 48]} /></mesh>
        <mesh ref={reachRef} position={[first[0], y, first[1]]} material={mats.reach} {...flat} visible={false}><circleGeometry args={[CLOSE_M, 48]} /></mesh>
      </>}
    </group>
  );
}

/** one stroke as the telestration items: `key` its marks' id, `at` the moment it shows the players at, `alpha` for the distance */
function strokeItems(s: Stroke, key: string, at: number, alpha: number): Item[] {
  const ps = s.players ?? [], end = s.pts[s.pts.length - 1];
  switch (s.tool) {
    case 'highlight': return ps.map((p) => ({ id: `${key}-${p}`, kind: 'spotlight', at: { player: p, at } }));
    case 'vision': return ps.length ? [{ id: key, kind: 'vision', player: ps, at }] : [];
    case 'trail': return ps.map((p) => ({ id: `${key}-${p}`, kind: 'trail', player: p }));
    case 'pass': return [{
      id: key, kind: 'pass', from: s.player !== undefined ? { player: s.player, at } : s.pts[0],
      to: ps.length ? { player: ps[0], at } : end, ...(dist(s.pts[0], end) >= LOFT_FROM_M ? { loft: true } : {}),
    }];
    case 'run': return s.player !== undefined ? [{ id: key, kind: 'heading', player: s.player, to: end, at }] : [];
    case 'link': return ps.length ? [{ id: key, kind: 'link', players: ps, closed: !!s.closed, at }] : [];
    case 'zone': {
      if (s.shape === 'circle') return [{ id: key, kind: 'zone', circle: [s.pts[0][0], s.pts[0][1], Math.max(0.5, dist(s.pts[0], end))], ink: 'att' }];
      if (s.shape === 'poly') return s.pts.length >= 3 && s.closed ? [{ id: key, kind: 'zone', poly: s.pts, ink: 'att' }] : [];   // open: ZoneDraft's
      const [a, b] = [s.pts[0], end];
      return [{ id: key, kind: 'zone', rect: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], ink: 'att' }];
    }
    case 'measure': return [{ id: key, kind: 'stroke', tool: 'measure', ink: s.ink, pts: [s.pts[0], end], alpha }];
    default: return [];   // 画板's tools, the HUD preview's only
  }
}

export function Pen3D({ data, clock, surface }: { data: Loaded; clock: Clock; surface?: { current: number } }) {
  const pkg = data.pkg as unknown as ClipPkg;
  const { mode } = useGameSettings();
  const penOn = useStore(drawMode) && mode === 'tactics';
  const drawn = useStore(strokes), saved = useStore(frames), dragging = useStore(drafting), playing = useStore(playbackPlaying), selectedTool = useStore(tool);
  const t = useClockTime(clock, saved.length ? 10 : 2), exiting = useStore(drawingExit);
  useEffect(() => { switchClip(String(pkg.meta.id)); }, [pkg]);
  // paused in the Tactics mode: the drawing leaves once the clock is away from its moment (a scrub, a step) or its frame
  // was deleted (the replay plate's list); a frame here is opened to draw on (play reaching one pauses on it)
  useEffect(() => {
    if (mode !== 'tactics' || playing || exiting) return;
    const now = clock.t, at = drawingAt();
    if (at !== null && (Math.abs(at - now) >= FRAME_VISIBLE_TOLERANCE_SECONDS || !saved.some((f) => Math.abs(f.t - at) <= FRAME_MERGE_TOLERANCE_SECONDS))) leaveDrawing();
    const f = saved.find((x) => Math.abs(x.t - now) < FRAME_VISIBLE_TOLERANCE_SECONDS), open = drawingAt();
    if (f && (open === null || Math.abs(open - f.t) > FRAME_MERGE_TOLERANCE_SECONDS)) openFrame(f);
  }, [t, playing, mode, saved, exiting, clock]);

  // ---- the pointer (and, for the headless checks, the clip's clock)
  useEffect(() => { hook('clipT', () => clock.t); }, [clock]);
  const planeRef = useRef<THREE.Mesh>(null);
  useEffect(() => {
    const plane = planeRef.current;
    if (plane) plane.raycast = penOn ? THREE.Mesh.prototype.raycast : () => undefined;
  }, [penOn]);
  /** the link still being clicked on (its stroke's id), ended by a tool change, a close or a click on the grass (the
   *  polygon being clicked on is the last stroke while open: draft.ts openZone) */
  const open = useRef<string | null>(null);
  /** the pointer on the pitch, for the open polygon's next edge */
  const pointer = useRef<XY | null>(null);
  useEffect(() => {
    open.current = null;
    // a polygon left open by a tool change or the pen going off: closed if it has an area, else dropped
    const z = openZone(strokes.get());
    if (z?.id) { if (z.pts.length >= 3) replaceLastStroke({ ...z, closed: true }); else removeStroke(z.id); }
  }, [selectedTool, penOn]);
  /** the player a click or a drag's end is on: the one the hover triangle points at (the director's pick, on his body),
   *  else the nearest within PICK_M of the point on the grass */
  const pick = (at: XY): number | null => {
    const hovered = hoveredPlayer.get();
    if (hovered >= 0 && hovered < momentAt(pkg, clock.t).pos.length) return hovered;
    let best: number | null = null, nearest = PICK_M;
    momentAt(pkg, clock.t).pos.forEach((_, i) => { const d = dist(posOf(i), at); if (d < nearest) { nearest = d; best = i; } });
    return best;
  };
  // a player's place for the marks' outlines, hit areas and starts: where the telestration draws on him (his hips on the
  // ground, smoothed over TELE.smoothS; anchors.ts), so the hover ring sits centred on the spotlight's column (on
  // the 10 Hz tracked position it sat off centre: that is not the hips the column stands on)
  const anchors = useMemo(() => makeAnchors(data), [data]);
  const posAt = (p: number, at: number): XY | null => { const out: XY = [0, 0]; return anchors.player(p, at, TELE.smoothS, out) ? out : null; };
  const posOf = (p: number): XY => posAt(p, clock.t) ?? (() => { const q = momentAt(pkg, clock.t).pos[p]; return [q[0], q[1]] as XY; })();
  /** the drawn mark under a pitch point (the smallest whose outline holds it), leaving out the one still being clicked on
   *  (a link, a polygon) and, with the vision tool, the latest vision (its players toggle) */
  const markAt = (at: XY): string | null => {
    const list = strokes.get(), lastVision = tool.get() === 'vision' ? [...list].reverse().find((x) => x.tool === 'vision') : undefined;
    let best: string | null = null, smallest = Infinity;
    for (const s of list) {
      if (!s.id || s.id === open.current || s === lastVision || s === openZone(list)) continue;
      const poly = outlineOf(s, posAt);
      if (poly.length >= 3 && inside(at, poly)) { const a = area(poly); if (a < smallest) { smallest = a; best = s.id; } }
    }
    return best;
  };
  const lastOpen = () => { const p = strokes.get(), s = p[p.length - 1]; return s && s.id === open.current ? s : null; };

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (!penOn) return;
    e.stopPropagation();
    const at = groundOf(e), t0 = clock.t, kind = tool.get(), hit = pick(at), base = { ink: ink.get(), t: t0 };
    // a click on a drawn mark selects it instead of drawing (not while a polygon is open: its corners go anywhere);
    // anywhere else lets the selection go
    const mark = kind === 'zone' && openZone(strokes.get()) ? null : markAt(at);
    if (mark) { selectedStroke.set(mark); return; }
    selectedStroke.set(null);
    const drag = (s: Stroke) => { (e.target as Element | null)?.setPointerCapture?.(e.pointerId); drafting.set(s); };
    switch (kind) {
      case 'highlight': case 'trail':
        if (hit !== null) addStroke({ ...base, id: strokeId(), tool: kind, pts: [at], players: [hit] });
        return;
      case 'vision': {
        if (hit === null) return;
        const last = strokes.get()[strokes.get().length - 1];
        if (last?.tool === 'vision' && last.t === t0) {   // several players at one moment: one vision, their union
          const ps = last.players ?? [];
          replaceLastStroke({ ...last, players: ps.includes(hit) ? ps.filter((p) => p !== hit) : [...ps, hit] });
        } else addStroke({ ...base, id: strokeId(), tool: 'vision', pts: [at], players: [hit] });
        return;
      }
      case 'link': {
        const live = lastOpen();
        if (hit === null) { open.current = null; return; }   // a click on the grass ends the line
        if (live) {
          const ps = live.players ?? [];
          if (hit === ps[0] && ps.length >= 3) { replaceLastStroke({ ...live, closed: true }); open.current = null; }
          else if (!ps.includes(hit)) replaceLastStroke({ ...live, players: [...ps, hit] });
          return;
        }
        const id = strokeId();
        addStroke({ ...base, id, tool: 'link', pts: [at], players: [hit] });
        open.current = id;
        return;
      }
      case 'zone': {
        const live = openZone(strokes.get());
        if (live) {
          if (live.pts.length >= 3 && dist(at, live.pts[0]) < CLOSE_M) { replaceLastStroke({ ...live, closed: true }); return; }
          const pts: XY[] = [...live.pts, at];
          replaceLastStroke({ ...live, pts, closed: pts.length >= POLY_MAX });
          return;
        }
        addStroke({ ...base, id: strokeId(), tool: 'zone', shape: 'poly', pts: [at], closed: false });
        return;
      }
      case 'pass':
        drag({ ...base, id: strokeId(), tool: 'pass', pts: [hit !== null ? posOf(hit) : at, at], ...(hit !== null ? { player: hit } : {}) });
        return;
      case 'run':
        if (hit !== null) drag({ ...base, id: strokeId(), tool: 'run', pts: [posOf(hit), at], player: hit });
        return;
      case 'measure':
        drag({ ...base, id: strokeId(), tool: 'measure', pts: [at, at] });
        return;
      default:
    }
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const s = drafting.get();
    const at = groundOf(e);
    pointer.current = at;
    if (penOn && !s) hoveredStroke.set(openZone(strokes.get()) && tool.get() === 'zone' ? null : markAt(at));
    if (!penOn || !s) return;
    drafting.set({ ...s, pts: [s.pts[0], at] });
  };
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    const s = drafting.get();
    drafting.set(null);
    (e.target as Element | null)?.releasePointerCapture?.(e.pointerId);
    if (!s) return;
    const end = groundOf(e), done: Stroke = { ...s, pts: [s.pts[0], end] };
    if (dist(done.pts[0], end) < MIN_DRAG_M) return;
    if (done.tool === 'pass') {   // released on a team-mate: the arrow ends on him
      const to = pick(end), nAtt = pkg.frames[0]?.att.length ?? 11;
      if (to !== null && to !== done.player && (done.player === undefined || (to < nAtt) === (done.player < nAtt))) done.players = [to];
    }
    addStroke(done);
  };

  // ---- the hovered and the selected mark's outlines, and where the delete button goes
  const hovered = useStore(hoveredStroke), selected = useStore(selectedStroke);
  useEffect(() => { if (!penOn) { hoveredStroke.set(null); selectedStroke.set(null); } }, [penOn]);
  const outlines = useMemo(() => {
    const of = (id: string | null) => { const s = id ? drawn.find((x) => x.id === id) : undefined, poly = s ? outlineOf(s, posAt) : []; return poly.length >= 3 ? poly : null; };
    return { hover: hovered !== selected ? of(hovered) : null, selected: of(selected) };
  }, [hovered, selected, drawn]); // eslint-disable-line react-hooks/exhaustive-deps
  const hoverGeo = useMemo(() => (outlines.hover ? ribbon(outlines.hover, OUTLINE_W_M) : null), [outlines.hover]);
  const selectedGeo = useMemo(() => (outlines.selected ? ribbon(outlines.selected, OUTLINE_W_M) : null), [outlines.selected]);
  useEffect(() => () => { hoverGeo?.dispose(); }, [hoverGeo]);
  useEffect(() => () => { selectedGeo?.dispose(); }, [selectedGeo]);
  const { camera, gl } = useThree();
  useFrame(() => {
    const poly = outlines.selected;
    if (!poly) { if (selectedAt.get() !== null) selectedAt.set(null); return; }
    // the button by the outline's highest point on the screen
    const r = gl.domElement.getBoundingClientRect();
    let top: [number, number] | null = null;
    for (const q of poly) {
      const v = new THREE.Vector3(q[0], MARK_Y, q[1]).project(camera), x = r.left + (v.x * 0.5 + 0.5) * r.width, y = r.top + (-v.y * 0.5 + 0.5) * r.height;
      if (!top || y < top[1]) top = [x, y];
    }
    const old = selectedAt.get();
    if (top && (!old || Math.abs(old[0] - top[0]) > 0.5 || Math.abs(old[1] - top[1]) > 0.5)) selectedAt.set(top);
  });

  // ---- the marks: the drawing on the pitch (in Tactics) and the stroke being dragged; left out while they animate out
  const liveZone = openZone(drawn);
  const items: Item[] = [];
  if (mode === 'tactics' && !exiting) {
    drawn.forEach((s, i) => items.push(...strokeItems(s, s.id ?? `stroke-${i}`, s.t ?? t, 1)));
    if (dragging) items.push(...strokeItems(dragging, dragging.id ?? 'dragging', dragging.t ?? t, 1));
  }

  return (
    <group>
      <mesh ref={planeRef} rotation-x={-Math.PI / 2} position-y={0.04} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onPointerLeave={() => { hoveredStroke.set(null); pointer.current = null; }}>
        <planeGeometry args={[L + 2 * PLANE_PAD_M, W + 2 * PLANE_PAD_M]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      <Telestration data={data} clock={clock} items={items} surface={surface} />
      {penOn && liveZone && !exiting && <ZoneDraft pts={liveZone.pts} pointer={pointer} />}
      {hoverGeo && mode === 'tactics' && (
        <mesh geometry={hoverGeo} renderOrder={10} raycast={() => undefined}>
          <meshBasicMaterial color="#ffffff" transparent opacity={HOVER_ALPHA} depthWrite={false} toneMapped={false} polygonOffset polygonOffsetFactor={-6} polygonOffsetUnits={-6} />
        </mesh>
      )}
      {selectedGeo && mode === 'tactics' && (
        <mesh geometry={selectedGeo} renderOrder={10} raycast={() => undefined}>
          <meshBasicMaterial color="#ffffff" transparent opacity={SELECTED_ALPHA} depthWrite={false} toneMapped={false} polygonOffset polygonOffsetFactor={-6} polygonOffsetUnits={-6} />
        </mesh>
      )}
    </group>
  );
}
