import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Joints } from '../../data';
import type { Clock } from '../../clock';
import { TEAM_KIT, playerTeam, type Team } from '../coords';
import { Mannequins } from '../Mannequins';
import { poseAt, poseIndex, jointOf, torsoFrame, focalPx } from './pose';
import { LIMBS, BLOBS, DOTS_TORSO, TORSO_RINGS, TORSO_SEG, TORSO_N, SEAT_SHAPE, SEAT_TILT, ringBack, pointOf, headFrame, blobFrame, kitColor, shapeW, bustAt, type Part } from './body';
import { makeLooks, numberAtlas, nameAtlas, HAIR_PIECES, PIECE_NAMES, STYLE_PIECES, GK_KIT, type Look, type Zone } from './looks';
import type { Grp } from './body';

/** the players' figures' one bound: the stadium's ground round the pitch (see where the figures are made) */
const FIGURE_BOUND = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 400);

// Candidate player styles, all driven by the same tracked joints. Each is a sketch for choosing a direction, not a
// finished look: toon, silhouette and ghost share one body (tapered limbs and ellipsoids); token, lines and dots are
// their own constructions; mannequin is the existing workbench figure.

const UP = new THREE.Vector3(0, 1, 0);
/** the stencil value every figure (players, officials, the ball) writes where it is drawn: the ball's trail (GameLayers)
 *  is drawn only where it is not, so it is always under them, near or far. The stage's canvas has a
 *  stencil buffer for it */
export const FIGURE_STENCIL = 1;
/** a figure's material marks the stencil (FIGURE_STENCIL) wherever it is drawn */
export function markFigure<M extends THREE.Material>(m: M): M {
  m.stencilWrite = true; m.stencilRef = FIGURE_STENCIL; m.stencilFunc = THREE.AlwaysStencilFunc;
  m.stencilZPass = THREE.ReplaceStencilOp; m.stencilFail = THREE.KeepStencilOp; m.stencilZFail = THREE.KeepStencilOp;
  return m;
}
/** player p's team (the joints are in attack order; `attacking` says which team attacks): the kits go by team, not by
 *  role (coords.ts) */
const teamOf = (p: number, J: Joints, attacking: Team): Team => playerTeam(p, J.nAtt, attacking);
/** the skeleton style's bones in a team's colour a step lighter than the shirt (as GameLayers' trails) */
const LINE_TINT: Record<Team, string> = { home: '#62b0ff', away: '#ff8a4c' };

/** three tones for the toon ramp */
export function toonRamp() {
  const t = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255]), 3, 1);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
}

/** the outline: the back faces pushed out along their normals. Close up it is about px pixels wide; past about 10 m it
 *  is a fixed 11 mm, so it thins with the figure instead of swallowing it, and from 35 m to 70 m it fades away, so from
 *  the broadcast and aerial cameras the players read by their kit colours alone. 1.1 px and 11 mm: at 1.4 px and
 *  14 mm the outline read as too heavy. */
const OUTLINE_PX = 1.1, OUTLINE_MAX = 0.011;
export function outlineMaterial(px = OUTLINE_PX, instanced = true) {
  return new THREE.ShaderMaterial({
    uniforms: { uW: { value: px / 1000 }, uMax: { value: OUTLINE_MAX }, uFade: { value: new THREE.Vector2(35, 70) }, uColor: { value: new THREE.Color('#0b0d10') } },
    side: THREE.BackSide,
    vertexShader: `uniform float uW, uMax; uniform vec2 uFade;
      void main() {
        mat4 m = modelMatrix${instanced ? ' * instanceMatrix' : ''};
        vec4 wp = m * vec4(position, 1.0);
        vec3 n = normalize(mat3(m) * normal);
        float d = -(viewMatrix * wp).z, f = 1.0 - smoothstep(uFade.x, uFade.y, d);
        // past the fade the outline is not drawn at all: a shell with no offset only fights the body for depth
        if (f < 0.002) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
        // near the camera the line keeps its pixel width; in the fade it never shrinks below 4 mm
        float o = min(uW * d, uMax) * f;
        wp.xyz += n * (d > uFade.x ? max(o, 0.004) : o);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0); }`,
    // the shell loses every depth tie with the body it outlines, whatever the depth buffer's precision
    polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4,
  });
}

type Shade = 'toon' | 'silhouette' | 'ghost';

/** the torso's material: the toon material with vertex colours (shirt and shorts), drawing one cell of the number atlas
 *  on the back. aNumUv places the number on the back (outside 0..1 elsewhere), aNum is the player's number. */
function torsoMaterial(base: THREE.MeshToonMaterial, names: THREE.Texture, P: number) {
  const m = base.clone(); m.vertexColors = true;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNums = { value: numberAtlas() }; sh.uniforms.uNames = { value: names }; sh.uniforms.uRows = { value: P };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aNum; attribute vec2 aNumUv; attribute vec3 aCollar; attribute vec3 aSkin; attribute vec3 aName; varying float vNum; varying vec2 vNumUv; varying vec3 vCollar; varying vec3 vSkin; varying vec3 vName;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvNum = aNum; vNumUv = aNumUv; vCollar = aCollar; vSkin = aSkin; vName = aName;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uNums, uNames; uniform float uRows; varying float vNum; varying vec2 vNumUv; varying vec3 vCollar; varying vec3 vSkin; varying vec3 vName;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // the neckline: a round crew collar about 13 cm across, as on match shirts, high at the back and dipping about
          // 3.5 cm at the front in a U; the shoulders stay covered. A darker ribbed trim runs along it, with skin inside.
          // vCollar: (metres across, forward share, height up the spine as a share of hip-to-neck)
          float x = abs(vCollar.x), W = 0.064, fr = smoothstep(-0.3, 0.3, vCollar.y);
          float hc = mix(1.0, 0.99 - 0.06 * max(0.0, 1.0 - (x / W) * (x / W)), fr);
          float eh = fwidth(vCollar.z) * 1.2 + 1e-4, ex = fwidth(vCollar.x) * 1.2 + 1e-4;
          float skin = smoothstep(hc - eh, hc + eh, vCollar.z) * (1.0 - smoothstep(W - ex, W + ex, x));
          float trim = smoothstep(hc - 0.03 - eh, hc - 0.03 + eh, vCollar.z) * (1.0 - smoothstep(W + 0.014 - ex, W + 0.014 + ex, x)) * (1.0 - skin);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.72, trim);
          diffuseColor.rgb = mix(diffuseColor.rgb, vSkin, skin);
        }
        {
          // sampled on every fragment with gradients from the unbroken coordinate, then clipped to the box: sampled only
          // inside the box, the broken gradients drew it as a dashed square
          vec2 uv = vNumUv, cu = clamp(uv, 0.0, 1.0), cell = vec2(mod(max(vNum, 0.0), 10.0), floor(max(vNum, 0.0) / 10.0));
          vec2 auv = vec2((cell.x + cu.x) / 10.0, 1.0 - (cell.y + 1.0 - cu.y) / 10.0);
          float ink = textureGrad(uNums, auv, dFdx(uv) / 10.0, dFdy(uv) / 10.0).a;
          float box = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0) * step(0.0, vNum);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), ink * box);
          // the name above the number: row vName.z of the name atlas
          vec2 nu = vName.xy, nc = clamp(nu, 0.0, 1.0);
          vec2 nuv = vec2(nc.x, 1.0 - (vName.z + 1.0 - nc.y) / uRows);
          float nink = textureGrad(uNames, nuv, dFdx(nu) * vec2(1.0, 1.0 / uRows), dFdy(nu) * vec2(1.0, 1.0 / uRows)).a;
          float nbox = step(0.0, nu.x) * step(nu.x, 1.0) * step(0.0, nu.y) * step(nu.y, 1.0) * step(0.0, vNum);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), nink * nbox);
        }`);
  };
  m.customProgramCacheKey = () => 'toon-torso-v6';
  return m;
}

/** the lofted torsos of all P players in one geometry: TORSO_RINGS sections of TORSO_SEG points, and a point under the
 *  bottom section to close it */
function torsoGeometry(P: number, colorOf: (part: Part, p: number, grp?: Grp) => THREE.Color, numberOf: (p: number) => number) {
  const NR = TORSO_RINGS.length, NS = TORSO_SEG, per = NR * NS + 1, n = P * per;
  const g = new THREE.BufferGeometry(), col = new Float32Array(n * 3), uv = new Float32Array(n * 2), num = new Float32Array(n), idx: number[] = [];
  const collar = new Float32Array(n * 3), skin = new Float32Array(n * 3), name = new Float32Array(n * 3).fill(-5);
  for (let p = 0; p < P; p++) {
    const b = p * per;
    TORSO_RINGS.forEach((ring, r) => {
      const c = colorOf(ring.part, p);
      for (let j = 0; j < NS; j++) {
        const v = b + r * NS + j, th = (2 * Math.PI * j) / NS, cx = Math.sign(Math.cos(th)) * Math.abs(Math.cos(th)) ** (2 / TORSO_N);
        c.toArray(col, v * 3); num[v] = numberOf(p); colorOf('skin', p, 'neck').toArray(skin, v * 3);
        collar[v * 3] = ring.w * cx; collar[v * 3 + 1] = Math.sin(th); collar[v * 3 + 2] = ring.h;
        // on the back half: the number in a box 34 cm wide (across the unscaled body) from 0.34 to 0.78 of the spine up,
        // the name above it, 36 cm wide, from 0.8 to 0.9
        if (Math.sin(th) < -0.2) {
          uv[v * 2] = 0.5 + (ring.w * cx) / 0.34; uv[v * 2 + 1] = (ring.h - 0.34) / 0.44;
          name[v * 3] = 0.5 + (ring.w * cx) / 0.36; name[v * 3 + 1] = (ring.h - 0.8) / 0.1; name[v * 3 + 2] = p;
        } else { uv[v * 2] = -5; uv[v * 2 + 1] = -5; }
        if (r < NR - 1) { const a = v, a1 = b + r * NS + ((j + 1) % NS), c0 = a + NS, c1 = a1 + NS; idx.push(a, a1, c1, a, c1, c0); }
      }
    });
    const bot = b + NR * NS; colorOf(TORSO_RINGS[0].part, p).toArray(col, bot * 3); num[bot] = numberOf(p); uv[bot * 2] = uv[bot * 2 + 1] = -5;
    for (let j = 0; j < NS; j++) idx.push(bot, b + ((j + 1) % NS), b + j);
  }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aNumUv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('aNum', new THREE.BufferAttribute(num, 1));
  g.setAttribute('aCollar', new THREE.BufferAttribute(collar, 3)); g.setAttribute('aSkin', new THREE.BufferAttribute(skin, 3)); g.setAttribute('aName', new THREE.BufferAttribute(name, 3));
  g.setIndex(idx);
  return g;
}

/** the torso's section as a unit superellipse, one point per segment (the same for every ring and frame, so worked out
 *  once): across (cx) and forward (cz), each in -1..1 */
const SEC_CX = Array.from({ length: TORSO_SEG }, (_, j) => { const co = Math.cos((2 * Math.PI * j) / TORSO_SEG); return Math.sign(co) * Math.abs(co) ** (2 / TORSO_N); });
const SEC_CZ = Array.from({ length: TORSO_SEG }, (_, j) => { const si = Math.sin((2 * Math.PI * j) / TORSO_SEG); return Math.sign(si) * Math.abs(si) ** (2 / TORSO_N); });

/** the torsos' vertex normals exactly as three's computeVertexNormals makes them (each face's normal, by its area, added
 *  to its three corners, then normalised; the same order and float32 rounding), on the arrays directly: computeVertexNormals
 *  goes through BufferAttribute accessors and was a sixth of the players' frame time (profiled) */
function torsoNormals(g: THREE.BufferGeometry) {
  const pos = g.attributes.position.array as Float32Array, attr = g.attributes.normal as THREE.BufferAttribute, n = attr.array as Float32Array, idx = g.index!.array;
  n.fill(0);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const cbx = pos[c] - pos[b], cby = pos[c + 1] - pos[b + 1], cbz = pos[c + 2] - pos[b + 2];
    const abx = pos[a] - pos[b], aby = pos[a + 1] - pos[b + 1], abz = pos[a + 2] - pos[b + 2];
    const nx = cby * abz - cbz * aby, ny = cbz * abx - cbx * abz, nz = cbx * aby - cby * abx;
    n[a] += nx; n[a + 1] += ny; n[a + 2] += nz;
    n[b] += nx; n[b + 1] += ny; n[b + 2] += nz;
    n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
  }
  for (let i = 0; i < n.length; i += 3) {
    const x = n[i], y = n[i + 1], z = n[i + 2], inv = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    n[i] = x * inv; n[i + 1] = y * inv; n[i + 2] = z * inv;
  }
  attr.needsUpdate = true;
}

const HEAD = BLOBS.find((b) => b.frame === 'head')!;

/** an uneven limb: along y from -0.5 (a) to +0.5 (b), each section an ellipse that reaches `side` to either side, `front`
 *  towards +z and `back` towards -z, interpolated smoothly between the profile's stations */
function asymGeometry(prof: [number, number, number, number][], NT = 24, NA = 22) {
  const at = (t: number) => {
    let k = 0; while (k < prof.length - 2 && prof[k + 1][0] < t) k++;
    const a = prof[k], b = prof[k + 1], u = Math.min(1, Math.max(0, (t - a[0]) / ((b[0] - a[0]) || 1))), w = u * u * (3 - 2 * u);
    return [a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w, a[3] + (b[3] - a[3]) * w];
  };
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= NT; i++) {
    const t = i / NT, [sd, fr, bk] = at(t), zc = (fr - bk) / 2, hd = (fr + bk) / 2;
    for (let j = 0; j < NA; j++) { const th = (2 * Math.PI * j) / NA; pos.push(sd * Math.cos(th), t - 0.5, zc + hd * Math.sin(th)); }
  }
  for (let i = 0; i < NT; i++) for (let j = 0; j < NA; j++) {
    const a = i * NA + j, b = i * NA + ((j + 1) % NA), c = a + NA, d = b + NA; idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** how much of its thigh's swing the seat takes: 0 rigid with the pelvis, 1 fully with the thigh */
const SEAT_FOLLOW = 0.3;
/** how much a part is widened by the player's build: fists follow the arms halfway, the neck the torso, boots not at all */
/** which costume zone a body part falls in (looks.ts Zone); the face and the hair have none */
const zoneOf = (part: Part, arm: boolean, grp: Grp | null): Zone | null => grp === 'hand' ? 'hand'
  : part === 'skin' ? (arm ? 'arm' : grp === 'leg' ? 'leg' : grp === 'neck' ? 'neck' : null)
    : part === 'shirt' ? 'top' : part === 'shorts' ? 'bottom' : part === 'socks' ? 'sock' : part === 'boot' ? 'shoe' : null;
const widthOf = (g: Grp, l: Look) => g === 'arm' ? l.build.arm : g === 'leg' ? l.build.leg : g === 'torso' ? l.build.torso : g === 'head' ? l.build.head
  : g === 'hand' ? 0.5 + 0.5 * l.build.arm : g === 'neck' ? 0.5 + 0.5 * l.build.torso : 1;

/** the shared body: one instanced mesh per limb (each limb has its own taper), one for all the ellipsoids (the chest
 *  carries the shirt number), and one per hair piece; looks set each player's skin, hair and number */
/** the referees' kit: near black, so they read apart from both teams and both keepers */
const OFFICIAL_KIT: Record<string, string> = { shirt: '#1b1e24', shorts: '#0e1013', socks: '#1b1e24' };

/** hide: a player (index) drawn far below the grass, for a camera at his eyes; -1 for none. only: the reverse, every
 *  player but this one below the grass (-1: none shown; the shot's freeze draws the shooter in toon over everyone else
 *  in silhouette, as the telestration does). kit 'official': the referees, in their own kit and without shirt numbers */
export interface HideRef { current: number }
/** mask: only the players it accepts are drawn (the rest go below the grass), read every frame, for drawing one set of
 *  players in one style and the rest in another (the Show menu's style, Stage) */
export interface PlayerMask { current: (p: number) => boolean }

function Figure({ J, clock, shade, looks, lag = 0, opacity = 1, hide, only, mask, kit, hover, lod = true, attacking = 'home' }: { J: Joints; clock: Clock; shade: Shade; looks?: Look[]; lag?: number; opacity?: number; hide?: HideRef; only?: HideRef; mask?: PlayerMask; kit?: 'official'; hover?: HideRef; lod?: boolean; attacking?: Team }) {
  const ix = useMemo(() => poseIndex(J), [J]), nJ = J.names.length, P = J.players;
  const pose = useMemo(() => new Float32Array(P * nJ * 3), [P, nJ]);
  const L = useMemo(() => looks ?? makeLooks(P, J.nAtt, { hair: 1, number: 1, skin: 1 }), [looks, P, J.nAtt]);
  const res = useMemo(() => {
    // a limb with a profile is turned (a lathe from y = -0.5 at a to +0.5 at b), the others are plain tapers
    const limbGeo = LIMBS.map((l) => l.asym ? asymGeometry(l.asym) : l.prof
      ? new THREE.LatheGeometry(l.prof.map(([t, r]) => new THREE.Vector2(r, t - 0.5)), 20)
      : new THREE.CylinderGeometry(l.rb, l.ra, 1, 20, 1, false));
    const blobGeo = new THREE.SphereGeometry(1, 28, 18);
    // the far level of detail: the same shapes with about a fifth of the faces, swapped in when every
    // player is more than 22 m from the camera (back under 15 m); the players were nine tenths of the frame's triangles
    const limbGeoLo = LIMBS.map((l) => l.asym ? asymGeometry(l.asym, 10, 10) : l.prof
      ? new THREE.LatheGeometry(l.prof.map(([t, r]) => new THREE.Vector2(r, t - 0.5)), 8)
      : new THREE.CylinderGeometry(l.rb, l.ra, 1, 8, 1, false));
    const blobGeoLo = new THREE.SphereGeometry(1, 12, 8);
    const ramp = toonRamp();
    const mat = shade === 'toon' ? new THREE.MeshToonMaterial({ gradientMap: ramp })
      : shade === 'silhouette' ? new THREE.MeshBasicMaterial()
        : new THREE.MeshBasicMaterial({ transparent: true, opacity, depthWrite: false });   // normal blending keeps the team colours on the grass
    const limbs = limbGeo.map((g) => new THREE.InstancedMesh(g, mat, P));
    const blobs = new THREE.InstancedMesh(blobGeo, mat, P * BLOBS.length);
    const hair = PIECE_NAMES.map(() => new THREE.InstancedMesh(blobGeo, mat, P));
    const outline = shade === 'toon' ? outlineMaterial() : null;
    const lines = outline ? [...limbGeo.map((g) => new THREE.InstancedMesh(g, outline, P)), new THREE.InstancedMesh(blobGeo, outline, P * BLOBS.length), ...PIECE_NAMES.map(() => new THREE.InstancedMesh(blobGeo, outline, P))] : [];
    // colours: kit parts, skin and hair from the looks for toon; one flat tone per team for the silhouettes (pure white
    // and pure black); a pale team tint for the ghosts. All by team: home white and pale blue, away black and pale orange
    const col = new THREE.Color();
    // keepers: their own kit colours, long sleeves over the bare arm, gloves on the fists
    const colorFor = (part: Part, p: number, arm = false, grp: Grp | null = null) => {
      const team = teamOf(p, J, attacking), gk = L[p].keeper;
      if (kit === 'official') {
        if (shade !== 'toon') return col.set(shade === 'ghost' ? '#c9ccd2' : '#3a3d44');
        if (part === 'skin' || part === 'hair' || part === 'boot') return col.set(part === 'skin' ? L[p].skin : part === 'hair' ? L[p].hair : '#15171b');
        return col.set(OFFICIAL_KIT[part] ?? OFFICIAL_KIT.shirt);
      }
      if (shade === 'silhouette') return col.set(team === 'home' ? '#ffffff' : '#000000');
      if (shade === 'ghost') return col.set(team === 'home' ? '#8cc4ff' : '#ffa27a');
      const z = L[p].dress && zoneOf(part, arm, grp), dz = z && L[p].dress![z];
      if (dz) return col.set(dz);
      if (gk && arm) return col.set(GK_KIT[team].shirt);
      if (gk && grp === 'hand') return col.set(GK_KIT.glove);
      if (gk && (part === 'shirt' || part === 'shorts' || part === 'socks')) return col.set(GK_KIT[team][part]);
      return col.set(part === 'skin' ? L[p].skin : part === 'hair' ? L[p].hair : part === 'boot' ? L[p].boot : kitColor(part, team));
    };
    limbs.forEach((m, k) => { for (let p = 0; p < P; p++) m.setColorAt(p, colorFor(LIMBS[k].part, p, LIMBS[k].arm, LIMBS[k].grp)); });
    BLOBS.forEach((b, k) => { for (let p = 0; p < P; p++) blobs.setColorAt(k * P + p, colorFor(b.part, p, b.arm, b.grp)); });
    hair.forEach((m) => { for (let p = 0; p < P; p++) m.setColorAt(p, colorFor('hair', p)); });
    // the torso: one lofted mesh for all players, rebuilt every frame
    const torsoGeo = torsoGeometry(P, (part, p, grp) => colorFor(part, p, false, grp).clone(), (p) => (shade === 'toon' ? L[p].number : -1));
    const names = nameAtlas(L.map((l) => l.name));
    const torsoMat = shade === 'toon' ? torsoMaterial(mat as THREE.MeshToonMaterial, names, P) : (() => { const m = mat.clone(); m.vertexColors = true; return m; })();
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    const torsoLine = outline ? new THREE.Mesh(torsoGeo, outlineMaterial(OUTLINE_PX, false)) : null;
    // a fixed bound for each: the renderer sorts by it, and computing it from the first frame's vertices met a player not
    // yet placed (NaN, "computeBoundingSphere(): Computed radius is NaN" on every cold load); nothing culls or picks by it
    // (the outlines cast no shadow: a shell is the body's own geometry, pushed out in screen space only, and the shadow
    // pass draws the raw geometry, so its shadow was the body's again, a second time)
    const shells = new Set<THREE.Object3D>([...lines, ...(torsoLine ? [torsoLine] : [])]);
    for (const m of [...limbs, blobs, ...hair, ...lines, torso, ...(torsoLine ? [torsoLine] : [])]) { m.frustumCulled = false; m.geometry.boundingSphere = FIGURE_BOUND.clone(); m.castShadow = shade !== 'ghost' && !shells.has(m); markFigure(m.material as THREE.Material); }
    const wears = PIECE_NAMES.map((name) => L.map((l) => STYLE_PIECES[l.style].includes(name)));
    // a hair piece nobody here wears is not drawn at all (no draw call for instances all scaled to nothing)
    PIECE_NAMES.forEach((_, k) => { const any = wears[k].some(Boolean); hair[k].visible = any; if (lines.length) lines[LIMBS.length + 1 + k].visible = any; });
    const group = new THREE.Group(); group.add(...limbs, blobs, ...hair, ...lines, torso, ...(torsoLine ? [torsoLine] : []));
    // the hovered player's colours, lifted towards white (a game's hover cue); f = 0 puts them back
    const WHITE = new THREE.Color('#ffffff');
    const repaint = (p: number, f: number) => {
      if (p < 0 || p >= P) return;
      const c = (part: Part, arm = false, grp: Grp | null = null) => colorFor(part, p, arm, grp).clone().lerp(WHITE, f);
      limbs.forEach((m, k) => { m.setColorAt(p, c(LIMBS[k].part, LIMBS[k].arm, LIMBS[k].grp)); if (m.instanceColor) m.instanceColor.needsUpdate = true; });
      BLOBS.forEach((b, k) => blobs.setColorAt(k * P + p, c(b.part, b.arm, b.grp))); if (blobs.instanceColor) blobs.instanceColor.needsUpdate = true;
      hair.forEach((m) => { m.setColorAt(p, c('hair')); if (m.instanceColor) m.instanceColor.needsUpdate = true; });
      const tc = torsoGeo.getAttribute('color') as THREE.BufferAttribute, NR = TORSO_RINGS.length, NS = TORSO_SEG, per = NR * NS + 1;
      TORSO_RINGS.forEach((ring, r) => { const cc = c(ring.part); for (let j = 0; j < NS; j++) tc.setXYZ(p * per + r * NS + j, cc.r, cc.g, cc.b); });
      const cb = c(TORSO_RINGS[0].part); tc.setXYZ(p * per + NR * NS, cb.r, cb.g, cb.b); tc.needsUpdate = true;
    };
    const nLimb = LIMBS.length;
    const setLod = (lo: boolean) => {
      limbs.forEach((m, k) => { m.geometry = lo ? limbGeoLo[k] : limbGeo[k]; if (lines[k]) lines[k].geometry = m.geometry; });
      const bg = lo ? blobGeoLo : blobGeo;
      blobs.geometry = bg; hair.forEach((m) => { m.geometry = bg; });
      for (let k = nLimb; k < lines.length; k++) lines[k].geometry = bg;     // the blobs' and hair's outlines
    };
    return { group, limbs, blobs, hair, lines, wears, limbGeo, blobGeo, limbGeoLo, blobGeoLo, mat, outline, ramp, torsoGeo, torsoMat, torsoLine, names, repaint, hovered: { p: -1 }, setLod, lod: { lo: false } };
  }, [J, P, shade, opacity, L, kit, attacking]);
  useEffect(() => () => { for (const m of [...res.limbs, res.blobs, ...res.hair, ...res.lines]) m.dispose();
    res.limbGeo.forEach((g) => g.dispose()); res.blobGeo.dispose(); res.limbGeoLo.forEach((g) => g.dispose()); res.blobGeoLo.dispose(); res.mat.dispose(); res.outline?.dispose(); res.ramp.dispose();
    res.torsoGeo.dispose(); res.torsoMat.dispose(); res.names.dispose(); (res.torsoLine?.material as THREE.Material | undefined)?.dispose(); }, [res]);

  const tmp = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), d: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(), m: new THREE.Matrix4(), T: new THREE.Matrix4(), H: new THREE.Matrix4(), R: new THREE.Matrix4(), zero: new THREE.Matrix4().makeScale(0, 0, 0),
    fx: new THREE.Vector3(), fy: new THREE.Vector3(), fz: new THREE.Vector3(),
    // the torso loft's
    rs: new THREE.Vector3(), rt: new THREE.Vector3(), fw: new THREE.Vector3(), c: new THREE.Vector3(), hj: [new THREE.Vector3(), new THREE.Vector3()], hq: [new THREE.Quaternion(), new THREE.Quaternion()],
    kv: new THREE.Vector3(), dn: new THREE.Vector3(), v: new THREE.Vector3(), v2: new THREE.Vector3(), id: new THREE.Quaternion() }), []);
  /** each player's torso frame, worked out once a frame for the limbs, the blobs and the head */
  const frames = useMemo(() => Array.from({ length: P }, () => new THREE.Matrix4()), [P]);
  /** an uneven limb's guide, the two joints it is turned by (toes and heel, thumb and little finger, ankle and heel, wrist
   *  and elbow, on its own side); null for a plain taper */
  const guides = useMemo(() => LIMBS.map((l) => {
    if (!l.front) return null;
    const sd = l.a.toString().startsWith('l') ? 'l' : 'r';
    const [g0, g1] = l.front === 'foot' ? ['BigToe', 'Heel'] : l.front === 'thumb' ? ['Thumb', 'Pinky'] : l.front === 'instep' ? ['Ankle', 'Heel'] : ['Wrist', 'Elbow'];
    return [ix[`${sd}${g0}`], ix[`${sd}${g1}`]] as const;
  }), [ix]);
  useFrame(({ camera }) => {
    const ok = poseAt(J, ix, clock.t - lag, pose);
    res.group.visible = ok;
    if (!ok) return;
    if (hide && hide.current >= 0 && hide.current < P) for (let j = 0; j < nJ; j++) pose[(hide.current * nJ + j) * 3 + 1] -= 80;
    if (only) for (let p = 0; p < P; p++) if (p !== only.current) for (let j = 0; j < nJ; j++) pose[(p * nJ + j) * 3 + 1] -= 80;
    if (mask) for (let p = 0; p < P; p++) if (!mask.current(p)) for (let j = 0; j < nJ; j++) pose[(p * nJ + j) * 3 + 1] -= 80;
    if (hover && hover.current !== res.hovered.p) { res.repaint(res.hovered.p, 0); res.repaint(hover.current, 0.24); res.hovered.p = hover.current; }
    // level of detail: the nearest player's hips from the camera, with a margin so it does not flicker at the edge
    // (lod false: always full detail, for figures drawn away from the main camera, e.g. the portraits)
    let near = lod ? Infinity : 0;
    if (lod) for (let p = 0; p < P; p++) { const o = (p * nJ + ix.midHip) * 3, d0 = Math.hypot(pose[o] - camera.position.x, pose[o + 1] - camera.position.y, pose[o + 2] - camera.position.z); if (d0 < near) near = d0; }
    if (!res.lod.lo && near > 22) { res.setLod(true); res.lod.lo = true; } else if (res.lod.lo && near < 15) { res.setLod(false); res.lod.lo = false; }
    const { a, b, d, q, s, m, H, R, zero, fx, fy, fz } = tmp, nL = LIMBS.length;
    for (let p = 0; p < P; p++) torsoFrame(pose, nJ, ix, p, frames[p]);
    for (let k = 0; k < nL; k++) {
      const l = LIMBS[k], gd = guides[k];
      for (let p = 0; p < P; p++) {
        pointOf(pose, nJ, ix, p, l.a, a); pointOf(pose, nJ, ix, p, l.b, b);
        d.subVectors(b, a); const len = Math.max(0.005, d.length()), w = widthOf(l.grp, L[p]);
        d.multiplyScalar(1 / len);
        if (gd) {
          // an uneven limb is turned about its axis so its front faces the toes (legs) or the side the elbow bends to (arms)
          jointOf(pose, nJ, p, gd[0], fz).sub(jointOf(pose, nJ, p, gd[1], fx));
          fz.addScaledVector(d, -fz.dot(d));
          // as the guiding direction fades (a straight arm has no bend), turn smoothly to the chest's forward instead of
          // switching to it, so the limb never flips about its axis
          const k = THREE.MathUtils.smoothstep(fz.length(), 0.015, 0.06);
          fy.setFromMatrixColumn(frames[p], 2).addScaledVector(d, -fy.dot(d));
          fz.normalize().multiplyScalar(k).addScaledVector(fy.lengthSq() > 1e-6 ? fy.normalize() : fy.set(d.y, -d.x, 0).normalize(), 1 - k);
          fz.addScaledVector(d, -fz.dot(d));
          if (fz.lengthSq() < 1e-6) fz.set(-d.z, 0, d.x);
          fz.normalize(); fx.crossVectors(d, fz);
          m.makeBasis(fx.multiplyScalar(w), fy.copy(d).multiplyScalar(len), fz.multiplyScalar(w)).setPosition(a.add(b).multiplyScalar(0.5));
        } else {
          q.setFromUnitVectors(UP, d);
          m.compose(a.add(b).multiplyScalar(0.5), q, s.set(w, len, w));
        }
        res.limbs[k].setMatrixAt(p, m); if (res.lines[k]) res.lines[k].setMatrixAt(p, m);
      }
    }
    for (let p = 0; p < P; p++) {
      const T = frames[p];
      headFrame(pose, nJ, ix, p, T, H);
      for (let k = 0; k < BLOBS.length; k++) {
        const bl = BLOBS[k];
        pointOf(pose, nJ, ix, p, bl.at, a);
        blobFrame(pose, nJ, ix, p, bl, T, H, R);
        if (bl.lift) a.addScaledVector(d.setFromMatrixColumn(R, 1), bl.lift);
        if (bl.back) a.addScaledVector(d.setFromMatrixColumn(R, 2), -bl.back);
        const w = widthOf(bl.grp, L[p]);
        // the torso widens across and in depth, not in height; everything else grows evenly
        if (bl.grp === 'torso') s.set(bl.r[0] * w, bl.r[1], bl.r[2] * w); else s.set(bl.r[0] * w, bl.r[1] * w, bl.r[2] * w);
        m.copy(R).scale(s).setPosition(a);
        res.blobs.setMatrixAt(k * P + p, m);
        if (res.lines.length) res.lines[nL].setMatrixAt(k * P + p, m);
      }
      // hair: each piece placed in the head's frame, offset from the head's centre
      pointOf(pose, nJ, ix, p, HEAD.at, a).addScaledVector(d.setFromMatrixColumn(H, 1), HEAD.lift ?? 0);
      PIECE_NAMES.forEach((name, k) => {
        if (!res.wears[k][p]) { res.hair[k].setMatrixAt(p, zero); if (res.lines.length) res.lines[nL + 1 + k].setMatrixAt(p, zero); return; }
        const pc = HAIR_PIECES[name], hs = L[p].build.head;
        b.copy(a).addScaledVector(d.setFromMatrixColumn(H, 0), pc.off[0] * hs).addScaledVector(d.setFromMatrixColumn(H, 1), pc.off[1] * hs).addScaledVector(d.setFromMatrixColumn(H, 2), pc.off[2] * hs);
        m.copy(H); if (pc.tilt) m.multiply(R.makeRotationX(-pc.tilt));
        m.scale(s.set(pc.r[0] * hs, pc.r[1] * hs, pc.r[2] * hs)).setPosition(b);
        res.hair[k].setMatrixAt(p, m); if (res.lines.length) res.lines[nL + 1 + k].setMatrixAt(p, m);
      });
    }
    for (const x of res.limbs) x.instanceMatrix.needsUpdate = true;
    for (const x of res.hair) x.instanceMatrix.needsUpdate = true;
    for (const x of res.lines) x.instanceMatrix.needsUpdate = true;
    res.blobs.instanceMatrix.needsUpdate = true;
    // the torsos: each section centred on the spine, turned from the hips' heading to the shoulders', forward to the nose
    const pos = res.torsoGeo.attributes.position.array as Float32Array, NR = TORSO_RINGS.length, NS = TORSO_SEG, per = NR * NS + 1;
    const hip = tmp.a, up = tmp.b, rh = tmp.d, { rs, rt, fw, c, hj, hq, kv, dn, v, v2, id } = tmp;
    for (let p = 0; p < P; p++) {
      jointOf(pose, nJ, p, ix.midHip, hip); jointOf(pose, nJ, p, ix.neck, up).sub(hip);
      const S = up.length(); up.multiplyScalar(1 / S);
      // the pelvis and the ribcage as two masses on the spine, each tilted with its own line (hips, shoulders): the
      // sections lean with them, so a dropped hip or a raised shoulder shows, often tilting opposite ways (contrapposto)
      jointOf(pose, nJ, p, ix.rHip, rh).sub(jointOf(pose, nJ, p, ix.lHip, rt)).normalize();
      jointOf(pose, nJ, p, ix.rShoulder, rs).sub(jointOf(pose, nJ, p, ix.lShoulder, rt)).normalize();
      const tw = L[p].build.torso, b0 = p * per;
      // each thigh's swing from hanging straight down the spine, taken in part by the seat on its side, about its hip joint
      dn.copy(up).negate();
      for (let sI = 0; sI < 2; sI++) {
        jointOf(pose, nJ, p, ix[sI ? 'lHip' : 'rHip'], hj[sI]); jointOf(pose, nJ, p, ix[sI ? 'lKnee' : 'rKnee'], kv).sub(hj[sI]).normalize();
        hq[sI].setFromUnitVectors(dn, kv); hq[sI].copy(id.identity().slerp(hq[sI], SEAT_FOLLOW));
      }
      for (let r = 0; r < NR; r++) {
        const ring = TORSO_RINGS[r];
        const t = Math.min(1, Math.max(0, (ring.h - 0.1) / 0.8)), k = t * t * (3 - 2 * t);
        // forward comes from the spine and the hip and shoulder lines alone: taking the head's way into account flipped
        // the sections inside out whenever a player looked back over his shoulder or lay on the grass (drawn black)
        rt.copy(rh).lerp(rs, k).normalize(); fw.crossVectors(up, rt).normalize();
        c.copy(hip).addScaledVector(up, ring.h * S);
        // a woman's figure (the cast's, looks.ts shape): narrower shoulders and waist, wider hips, the bust at the front
        const sh = L[p].shape, w = ring.w * tw * shapeW(sh, ring.h), db = ringBack(ring) * tw, df = ring.d * tw * (1 + bustAt(sh, ring.h));
        // the seat (body.ts SEAT): the lowest rings' backs carry the lobes and the cleft, and the pelvis tips forward,
        // its front down and its back up by the tilt's sine of the depth
        const sm = SEAT_SHAPE[r], tl = SEAT_TILT[r];
        for (let j = 0; j < NS; j++) {
          const cx = SEC_CX[j], cz = SEC_CZ[j], o = (b0 + r * NS + j) * 3;
          const dd = (cz > 0 ? df : sm ? db * sm[j] : db) * cz, dy = -dd * tl;
          v.set(c.x + rt.x * w * cx + fw.x * dd + up.x * dy, c.y + rt.y * w * cx + fw.y * dd + up.y * dy, c.z + rt.z * w * cx + fw.z * dd + up.z * dy);
          if (ring.h < 0.2) {
            // below the waistband: the side's weight grows outwards from the middle and downwards from the waist
            const sI = cx >= 0 ? 0 : 1, wgt = Math.min(1, Math.abs(cx) / 0.6) * Math.min(1, (0.2 - ring.h) / 0.2);
            v2.copy(v).sub(hj[sI]).applyQuaternion(hq[sI]).add(hj[sI]); v.lerp(v2, wgt);
          }
          v.toArray(pos, o);
        }
      }
      c.copy(hip).addScaledVector(up, -0.03 * S); c.toArray(pos, (b0 + NR * NS) * 3);
    }
    res.torsoGeo.attributes.position.needsUpdate = true; torsoNormals(res.torsoGeo);
  });
  return <primitive object={res.group} />;
}

/** minimal: a piece on a disc, leaning with the body, with a nub showing which way the chest faces */
function Tokens({ J, clock, hide, hover, attacking }: { J: Joints; clock: Clock; hide?: HideRef; hover?: HideRef; attacking: Team }) {
  const ix = useMemo(() => poseIndex(J), [J]), nJ = J.names.length, P = J.players;
  const pose = useMemo(() => new Float32Array(P * nJ * 3), [P, nJ]);
  const res = useMemo(() => {
    const body = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.24, 1, 6, 16), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.05 }), P);
    const head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 20, 14), new THREE.MeshStandardMaterial({ roughness: 0.35 }), P);
    const disc = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.55, 0.55, 0.03, 32), new THREE.MeshStandardMaterial({ roughness: 0.6 }), P);
    const nub = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }), P);
    const c = new THREE.Color();
    for (let p = 0; p < P; p++) {
      const k = TEAM_KIT[teamOf(p, J, attacking)];
      body.setColorAt(p, c.set(k.shirt)); head.setColorAt(p, c.set(k.shirt)); disc.setColorAt(p, c.set(k.shirt).multiplyScalar(0.7));
    }
    body.castShadow = head.castShadow = true;
    const group = new THREE.Group(); group.add(body, head, disc, nub);
    group.traverse((o) => { o.frustumCulled = false; });
    const repaint = (p: number, f: number) => {
      if (p < 0 || p >= P) return;
      const k = TEAM_KIT[teamOf(p, J, attacking)], w = new THREE.Color('#ffffff');
      body.setColorAt(p, c.set(k.shirt).lerp(w, f)); head.setColorAt(p, c.set(k.shirt).lerp(w, f)); disc.setColorAt(p, c.set(k.shirt).multiplyScalar(0.7).lerp(w, f));
      for (const x of [body, head, disc]) if (x.instanceColor) x.instanceColor.needsUpdate = true;
    };
    return { group, body, head, disc, nub, repaint, hovered: { p: -1 } };
  }, [J, P, attacking]);
  useEffect(() => () => {
    for (const m of [res.body, res.head, res.disc, res.nub]) { m.dispose(); m.geometry.dispose(); m.material.dispose(); }
  }, [res]);
  const tmp = useMemo(() => ({ g: new THREE.Vector3(), n: new THREE.Vector3(), d: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(), m: new THREE.Matrix4(), T: new THREE.Matrix4(), f: new THREE.Vector3() }), []);
  useFrame(() => {
    if (!poseAt(J, ix, clock.t, pose)) return;
    const { g, n, d, q, s, m, T, f } = tmp;
    const hidden = hide?.current ?? -1;
    if (hover && hover.current !== res.hovered.p) { res.repaint(res.hovered.p, 0); res.repaint(hover.current, 0.3); res.hovered.p = hover.current; }
    for (let p = 0; p < P; p++) {
      if (p === hidden) { m.makeScale(0, 0, 0); for (const x of [res.body, res.head, res.disc, res.nub]) x.setMatrixAt(p, m); continue; }
      jointOf(pose, nJ, p, ix.midHip, g); g.y = 0; jointOf(pose, nJ, p, ix.neck, n);
      d.subVectors(n, g); const len = d.length(); q.setFromUnitVectors(UP, d.clone().normalize());
      // the capsule is 1.48 m tall (1 m and two 0.24 m caps): stretched to run from the ground to the neck
      m.compose(g.clone().addScaledVector(d, 0.5), q, s.set(1, len / 1.48, 1)); res.body.setMatrixAt(p, m);
      m.compose(n.clone().addScaledVector(d, 0.2 / len), q, s.set(1, 1, 1)); res.head.setMatrixAt(p, m);
      m.compose(g.clone().setY(0.015), q.identity(), s.set(1, 1, 1)); res.disc.setMatrixAt(p, m);
      torsoFrame(pose, nJ, ix, p, T); f.setFromMatrixColumn(T, 2);
      m.compose(g.clone().addScaledVector(d, 0.72).addScaledVector(f, 0.25), q.identity(), s.set(1, 1, 1)); res.nub.setMatrixAt(p, m);
    }
    for (const x of [res.body, res.head, res.disc, res.nub]) x.instanceMatrix.needsUpdate = true;
  });
  return <primitive object={res.group} />;
}

const LINE_BONES: [string, string][] = [
  ['neck', 'midHip'], ['rShoulder', 'lShoulder'], ['rHip', 'lHip'], ['neck', 'nose'],
  ['rShoulder', 'rElbow'], ['rElbow', 'rWrist'], ['lShoulder', 'lElbow'], ['lElbow', 'lWrist'],
  ['rHip', 'rKnee'], ['rKnee', 'rAnkle'], ['lHip', 'lKnee'], ['lKnee', 'lAnkle'],
  ['rAnkle', 'rHeel'], ['rHeel', 'rBigToe'], ['lAnkle', 'lHeel'], ['lHeel', 'lBigToe'],
];
const LINE_JOINTS = ['nose', 'neck', 'rShoulder', 'lShoulder', 'rElbow', 'lElbow', 'rWrist', 'lWrist', 'midHip', 'rHip', 'lHip', 'rKnee', 'lKnee', 'rAnkle', 'lAnkle', 'rBigToe', 'lBigToe'];

/** minimal: the tracked skeleton itself, bright bones and white joints, unlit */
function Lines({ J, clock, hide, mask, hover, attacking }: { J: Joints; clock: Clock; hide?: HideRef; mask?: PlayerMask; hover?: HideRef; attacking: Team }) {
  const ix = useMemo(() => poseIndex(J), [J]), nJ = J.names.length, P = J.players;
  const pose = useMemo(() => new Float32Array(P * nJ * 3), [P, nJ]);
  const res = useMemo(() => {
    const bones = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.024, 0.024, 1, 6), new THREE.MeshBasicMaterial(), P * LINE_BONES.length);
    const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }), P * LINE_JOINTS.length);
    const head = new THREE.InstancedMesh(new THREE.TorusGeometry(0.11, 0.018, 6, 24), new THREE.MeshBasicMaterial(), P);
    const c = new THREE.Color();
    for (let k = 0; k < LINE_BONES.length; k++) for (let p = 0; p < P; p++) bones.setColorAt(k * P + p, c.set(LINE_TINT[teamOf(p, J, attacking)]));
    for (let p = 0; p < P; p++) head.setColorAt(p, c.set(LINE_TINT[teamOf(p, J, attacking)]));
    const group = new THREE.Group(); group.add(bones, dots, head);
    group.traverse((o) => { o.frustumCulled = false; if (o instanceof THREE.Mesh) markFigure(o.material as THREE.Material); });
    const repaint = (p: number, f: number) => {
      if (p < 0 || p >= P) return;
      const col = c.set(LINE_TINT[teamOf(p, J, attacking)]).lerp(new THREE.Color('#ffffff'), f);
      for (let k = 0; k < LINE_BONES.length; k++) bones.setColorAt(k * P + p, col);
      head.setColorAt(p, col);
      for (const x of [bones, head]) if (x.instanceColor) x.instanceColor.needsUpdate = true;
    };
    return { group, bones, dots, head, repaint, hovered: { p: -1 } };
  }, [J, P, attacking]);
  useEffect(() => () => {
    for (const m of [res.bones, res.dots, res.head]) { m.dispose(); m.geometry.dispose(); m.material.dispose(); }
  }, [res]);
  const tmp = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), d: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(), m: new THREE.Matrix4(), T: new THREE.Matrix4(), H: new THREE.Matrix4() }), []);
  useFrame(() => {
    if (!poseAt(J, ix, clock.t, pose)) return;
    if (hide && hide.current >= 0 && hide.current < P) for (let j = 0; j < nJ; j++) pose[(hide.current * nJ + j) * 3 + 1] -= 80;
    if (mask) for (let p = 0; p < P; p++) if (!mask.current(p)) for (let j = 0; j < nJ; j++) pose[(p * nJ + j) * 3 + 1] -= 80;
    if (hover && hover.current !== res.hovered.p) { res.repaint(res.hovered.p, 0); res.repaint(hover.current, 0.35); res.hovered.p = hover.current; }
    const { a, b, d, q, s, m, T, H } = tmp;
    LINE_BONES.forEach(([ja, jb], k) => {
      for (let p = 0; p < P; p++) {
        jointOf(pose, nJ, p, ix[ja], a); jointOf(pose, nJ, p, ix[jb], b); d.subVectors(b, a); const len = d.length();
        q.setFromUnitVectors(UP, d.multiplyScalar(1 / Math.max(1e-3, len)));
        m.compose(a.add(b).multiplyScalar(0.5), q, s.set(1, len, 1)); res.bones.setMatrixAt(k * P + p, m);
      }
    });
    LINE_JOINTS.forEach((jn, k) => { for (let p = 0; p < P; p++) { m.makeTranslation(jointOf(pose, nJ, p, ix[jn], a)); res.dots.setMatrixAt(k * P + p, m); } });
    for (let p = 0; p < P; p++) {
      // the head as a ring facing forward, round the point between the ears and the nose
      torsoFrame(pose, nJ, ix, p, T); headFrame(pose, nJ, ix, p, T, H);
      pointOf(pose, nJ, ix, p, ['earMid', 'nose', 0.3], a); m.copy(H).setPosition(a); res.head.setMatrixAt(p, m);
    }
    for (const x of [res.bones, res.dots, res.head]) x.instanceMatrix.needsUpdate = true;
  });
  return <primitive object={res.group} />;
}

/** dot matrix: the body as round points on its surface, like the crowd in the stands */
function Dots({ J, clock, attacking }: { J: Joints; clock: Clock; attacking: Team }) {
  const ix = useMemo(() => poseIndex(J), [J]), nJ = J.names.length, P = J.players;
  const pose = useMemo(() => new Float32Array(P * nJ * 3), [P, nJ]);
  const SP = 0.04;    // dot spacing, metres
  // a fixed sampling of the body: rings along each limb, a spiral over each ellipsoid
  const plan = useMemo(() => {
    const limbs = LIMBS.map((l) => { const r = (l.ra + l.rb) / 2, around = Math.max(4, Math.round((2 * Math.PI * r) / SP)); return { rings: 5, around }; });
    const blobs = [...BLOBS, ...DOTS_TORSO].filter((b) => b.frame !== 'none').map((b) => {
      const [x, y, z] = b.r, area = 4 * Math.PI * Math.pow((Math.pow(x * y, 1.6) + Math.pow(x * z, 1.6) + Math.pow(y * z, 1.6)) / 3, 1 / 1.6);
      return { blob: b, n: Math.max(12, Math.round(area / (SP * SP))) };
    });
    const perPlayer = limbs.reduce((s, l) => s + l.rings * l.around, 0) + blobs.reduce((s, b) => s + b.n, 0);
    return { limbs, blobs, perPlayer };
  }, []);
  const res = useMemo(() => {
    const n = plan.perPlayer * P, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), c = new THREE.Color();
    let k = 0;
    for (let p = 0; p < P; p++) {
      const team = teamOf(p, J, attacking);
      LIMBS.forEach((l, i) => { c.set(kitColor(l.part, team)); for (let m = 0; m < plan.limbs[i].rings * plan.limbs[i].around; m++, k++) c.toArray(col, k * 3); });
      plan.blobs.forEach((b) => { c.set(kitColor(b.blob.part, team)); for (let m = 0; m < b.n; m++, k++) c.toArray(col, k * 3); });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uFocal: { value: 1000 }, uSize: { value: SP * 0.82 }, uMin: { value: 1.5 } }, vertexColors: true,
      vertexShader: `uniform float uFocal, uSize, uMin; varying vec3 vColor;
        void main() { vColor = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = max(uMin, uSize * uFocal / -mv.z); }`,
      fragmentShader: `varying vec3 vColor; void main() { vec2 c = gl_PointCoord - 0.5; if (dot(c, c) > 0.25) discard; gl_FragColor = linearToOutputTexel(vec4(vColor, 1.0)); }`,
    });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false;
    return { pts, geo, mat, pos };
  }, [J, P, plan, attacking]);
  useEffect(() => () => { res.geo.dispose(); res.mat.dispose(); }, [res]);
  const tmp = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), d: new THREE.Vector3(), e1: new THREE.Vector3(), e2: new THREE.Vector3(), v: new THREE.Vector3(), T: new THREE.Matrix4(), H: new THREE.Matrix4(), R: new THREE.Matrix4() }), []);
  useFrame(({ size, camera }) => {
    res.mat.uniforms.uFocal.value = focalPx(size.height, (camera as THREE.PerspectiveCamera).fov);
    if (!poseAt(J, ix, clock.t, pose)) return;
    const { a, b, d, e1, e2, v, T, H, R } = tmp, out = res.pos;
    let k = 0;
    for (let p = 0; p < P; p++) {
      LIMBS.forEach((l, i) => {
        pointOf(pose, nJ, ix, p, l.a, a); pointOf(pose, nJ, ix, p, l.b, b); d.subVectors(b, a).normalize();
        e1.set(d.y, -d.x, 0); if (e1.lengthSq() < 1e-4) e1.set(1, 0, 0); e1.normalize(); e2.crossVectors(d, e1);
        const { rings, around } = plan.limbs[i];
        for (let r = 0; r < rings; r++) {
          const u = (r + 0.5) / rings, rad = l.ra + (l.rb - l.ra) * u, off = (r % 2) * Math.PI / around;
          for (let m = 0; m < around; m++, k++) {
            const ang = (2 * Math.PI * m) / around + off;
            v.copy(a).lerp(b, u).addScaledVector(e1, Math.cos(ang) * rad).addScaledVector(e2, Math.sin(ang) * rad).toArray(out, k * 3);
          }
        }
      });
      torsoFrame(pose, nJ, ix, p, T); headFrame(pose, nJ, ix, p, T, H);
      plan.blobs.forEach(({ blob, n }) => {
        blobFrame(pose, nJ, ix, p, blob, T, H, R);
        pointOf(pose, nJ, ix, p, blob.at, a);
        if (blob.lift) a.addScaledVector(e1.setFromMatrixColumn(R, 1), blob.lift);
        if (blob.back) a.addScaledVector(e1.setFromMatrixColumn(R, 2), -blob.back);
        for (let m = 0; m < n; m++, k++) {
          // a Fibonacci spiral over the unit sphere, scaled to the ellipsoid and turned into the body frame
          const y = 1 - (2 * (m + 0.5)) / n, rr = Math.sqrt(1 - y * y), th = m * 2.39996323;
          v.set(Math.cos(th) * rr * blob.r[0], y * blob.r[1], Math.sin(th) * rr * blob.r[2]).applyMatrix4(R).add(a).toArray(out, k * 3);
        }
      });
    }
    res.geo.attributes.position.needsUpdate = true;
  });
  return <primitive object={res.pts} />;
}

export type PlayerStyle = 'token' | 'lines' | 'dots' | 'mannequin' | 'toon' | 'silhouette' | 'ghost' | 'ghost-still' | 'rigged';

/** the players in one of the candidate styles. attacking: the team of players 0..J.nAtt-1 (pkg.meta.attacking, through
 *  coords.ts attackingOf), so each team wears its own kit in every clip; without it they draw as
 *  before, the attackers in the home kit */
export function Players({ ghosts, ...rest }: { J: Joints; clock: Clock; style: PlayerStyle; looks?: Look[]; hide?: HideRef; only?: HideRef; mask?: PlayerMask; kit?: 'official'; hover?: HideRef; lod?: boolean; attacking?: Team; ghosts?: Ghost[] }) {
  const main = <PlayersIn {...rest} />;
  return ghosts?.length ? <group>{main}<GhostPlayers J={rest.J} clock={rest.clock} looks={rest.looks} attacking={rest.attacking} ghosts={ghosts} /></group> : main;
}

/** a ghost (the Tactics pen's sketch of a move): one player's body as he stands now (the
 *  pause), in the ghost shade, at another ground point `at` (pitch metres, the package's frame), turned to face along the
 *  drag, from where he really is to `at`. alpha: the body's opacity (0.55 by default) */
export interface Ghost { player: number; at: [number, number]; alpha?: number }

/** the ghosts alone, for mounting anywhere in the canvas (the pen's overlay mounts these with its items; Players takes
 *  them too, through its `ghosts` prop) */
export function GhostPlayers({ J, clock, looks, attacking = 'home', ghosts }: { J: Joints; clock: Clock; looks?: Look[]; attacking?: Team; ghosts: Ghost[] }) {
  return <>{ghosts.map((g, i) => <GhostOne key={`${g.player}-${i}`} J={J} clock={clock} looks={looks} attacking={attacking} ghost={g} />)}</>;
}

function GhostOne({ J, clock, looks, attacking, ghost }: { J: Joints; clock: Clock; looks?: Look[]; attacking: Team; ghost: Ghost }) {
  const only = useMemo<HideRef>(() => ({ current: ghost.player }), [ghost.player]);
  const ix = useMemo(() => poseIndex(J), [J]), nJ = J.names.length;
  const st = useMemo(() => {
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    return { group, pose: new Float32Array(J.players * nJ * 3), T: new THREE.Matrix4(), R: new THREE.Matrix4(), B: new THREE.Matrix4() };
  }, [J, nJ]);
  // each frame: his hips to the origin, turned from the way he faces (neck to nose, on the ground) to the drag's way, then
  // stood at `at`; the body itself is a Figure drawing only him
  useFrame(() => {
    if (!poseAt(J, ix, clock.t, st.pose)) return;
    const o = (k: number) => (ghost.player * nJ + k) * 3, P = st.pose;
    const hx = P[o(ix.midHip)], hz = P[o(ix.midHip) + 2];
    const fx = P[o(ix.nose)] - P[o(ix.neck)], fz = P[o(ix.nose) + 2] - P[o(ix.neck) + 2];
    const dx = ghost.at[0] - hx, dz = ghost.at[1] - hz;
    const turn = Math.hypot(dx, dz) > 0.05 && Math.hypot(fx, fz) > 1e-4 ? Math.atan2(dx, dz) - Math.atan2(fx, fz) : 0;
    st.group.matrix.copy(st.T.makeTranslation(ghost.at[0], 0, ghost.at[1])).multiply(st.R.makeRotationY(turn)).multiply(st.B.makeTranslation(-hx, 0, -hz));
    st.group.matrixWorldNeedsUpdate = true;
  });
  return <primitive object={st.group}><Figure J={J} clock={clock} shade="ghost" looks={looks} opacity={ghost.alpha ?? 0.55} only={only} lod={false} attacking={attacking} /></primitive>;
}

function PlayersIn({ J, clock, style, looks, hide, only, mask, kit, hover, lod, attacking = 'home' }: { J: Joints; clock: Clock; style: PlayerStyle; looks?: Look[]; hide?: HideRef; only?: HideRef; mask?: PlayerMask; kit?: 'official'; hover?: HideRef; lod?: boolean; attacking?: Team }) {
  if (style === 'token') return <Tokens J={J} clock={clock} hide={hide} hover={hover} attacking={attacking} />;
  if (style === 'lines') return <Lines J={J} clock={clock} hide={hide} mask={mask} hover={hover} attacking={attacking} />;
  if (style === 'dots') return <Dots J={J} clock={clock} attacking={attacking} />;
  if (style === 'mannequin') return <Mannequins joints={J} clock={clock} attacking={attacking} />;
  // the ghost without its trail (the What-if mode's pause and touch, whatif/useWhatIf.tsx)
  if (style === 'ghost-still') return <Figure J={J} clock={clock} shade="ghost" looks={looks} lag={0} opacity={0.6} hide={hide} only={only} mask={mask} kit={kit} hover={hover} attacking={attacking} />;
  if (style === 'ghost') {
    // the current pose bright, and echoes of the last third of a second fading behind it
    return <group>{[0, 0.08, 0.16, 0.24, 0.32].map((lag, k) => <Figure key={k} J={J} clock={clock} shade="ghost" looks={looks} lag={lag} opacity={[0.6, 0.26, 0.17, 0.11, 0.07][k]} hide={hide} mask={mask} kit={kit} hover={k === 0 ? hover : undefined} attacking={attacking} />)}</group>;
  }
  return <Figure J={J} clock={clock} shade={style as Shade} looks={looks} hide={hide} only={only} mask={mask} kit={kit} hover={hover} lod={lod} attacking={attacking} />;
}
