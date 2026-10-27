// Polyline ribbons, many lines in one draw call. Two kinds:
//  'facing': a ribbon in 3D turned to the camera (the ball's trace, a path in the air): its width is metres at its
//            depth, never under uMinPx pixels, antialiased over one pixel, with an optional halo in pixels
//  'ground': a ribbon lying on the pitch at y = 0 (a shadow, a trail): width in metres, antialiased over the pixel's
//            footprint across the ribbon (the ground layer's rule), optionally soft (a Gaussian across, for shadows),
//            optionally round-ended and dashed (the Tactics pen's strokes)
// Each point carries its half-width, colour and alpha, so tapers and fades are per point. Lines are separate triangle
// strips in one index buffer; nothing is shared between lines.
import * as THREE from 'three';

const FACING_VERT = /* glsl */ `
attribute vec3 aPrev; attribute vec3 aNext; attribute float aSide; attribute vec4 aW; attribute vec4 aColor;
uniform vec2 uViewport; uniform float uMinPx, uGlowPx;
varying float vAcross; varying float vHalf; varying vec4 vColor; varying float vGlow;
void main() {
  mat4 vp = projectionMatrix * viewMatrix;
  vec4 c = vp * vec4(position, 1.0), cp = vp * vec4(aPrev, 1.0), cn = vp * vec4(aNext, 1.0);
  vec2 h = 0.5 * uViewport, s = c.xy / c.w * h, sp = cp.xy / cp.w * h, sn = cn.xy / cn.w * h;
  vec2 d = sn - sp; d = length(d) > 1e-4 ? normalize(d) : vec2(1.0, 0.0);
  float hwPx = aW.x * projectionMatrix[1][1] * h.y / c.w;           // metres at this depth, in pixels
  float hw = max(hwPx, 0.5 * uMinPx), draw = hw + 1.0 + 3.0 * uGlowPx * aW.y;
  c.xy += vec2(-d.y, d.x) * aSide * draw / h * c.w;
  vAcross = aSide * draw; vHalf = hw; vGlow = aW.y;
  vColor = vec4(aColor.rgb, aColor.a * min(1.0, hwPx / max(hw, 1e-4) + 0.6));   // thinner than the floor: a little fainter
  gl_Position = c;
}`;

const FACING_FRAG = /* glsl */ `
precision highp float;
varying float vAcross; varying float vHalf; varying vec4 vColor; varying float vGlow;
uniform float uGlowPx, uGlow;
void main() {
  float d = abs(vAcross) - vHalf;
  float cov = clamp(0.5 - d, 0.0, 1.0);
  float g = vGlow > 0.0 ? exp(-pow(max(d, 0.0) / max(uGlowPx, 1e-3), 2.0)) * uGlow * vGlow : 0.0;
  float a = cov * vColor.a;
  vec3 col = vColor.rgb * (cov + g * (1.0 - cov)) * vColor.a;
  if (a < 0.002 && g * vColor.a < 0.002) discard;
  gl_FragColor = vec4(col, a);
}`;

const GROUND_VERT = /* glsl */ `
attribute vec3 aPrev; attribute vec3 aNext; attribute float aSide; attribute vec4 aW; attribute vec4 aColor; attribute vec4 aDash;
varying float vAcross; varying vec4 vW; varying vec4 vColor; varying vec2 vN; varying vec2 vXZ; varying vec4 vDash;
void main() {
  vec2 d = aNext.xz - aPrev.xz; d = length(d) > 1e-5 ? normalize(d) : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x);
  float draw = aW.x + aW.z;                                          // half-width plus the margin for the footprint
  vec2 xz = position.xz + n * aSide * draw;
  vAcross = aSide * draw; vW = aW; vColor = aColor; vN = n; vXZ = xz; vDash = aDash;
  gl_Position = projectionMatrix * viewMatrix * vec4(xz.x, 0.0, xz.y, 1.0);
}`;

const GROUND_FRAG = /* glsl */ `
precision highp float;
varying float vAcross; varying vec4 vW; varying vec4 vColor; varying vec2 vN; varying vec2 vXZ; varying vec4 vDash;
void main() {
  float aa = max(length(vec2(dot(vN, dFdx(vXZ)), dot(vN, dFdy(vXZ)))), 1e-5);
  // vDash: the distance along the line (metres), the dash period (0: solid), the painted share, the line's length (its
  // ends round, the ribbon running on past them; negative: square ends where the points stop)
  float sA = max(length(vec2(dFdx(vDash.x), dFdy(vDash.x))), 1e-5), so = vDash.w >= 0.0 ? max(-vDash.x, vDash.x - vDash.w) : 0.0;
  float across = so > 0.0 ? length(vec2(so, vAcross)) : abs(vAcross);
  float a;
  if (vW.y > 0.5) { float x = vAcross / max(vW.x, aa); a = exp(-x * x); }          // soft: a Gaussian across
  else { float e = max(vW.x, 0.6 * aa); a = clamp((e - across) / aa + 0.5, 0.0, 1.0) * (vW.x / e); }
  if (vDash.y > 0.0) {
    // square-ended dashes; a period only a few pixels long becomes its average, as paint does
    float P = vDash.y, L = vDash.z * P, u = mod(max(vDash.x, 0.0), P), d = u < L ? max(-u, u - L) : min(u - L, P - u);
    a *= mix(vDash.z, clamp(0.5 - d / sA, 0.0, 1.0), smoothstep(2.0, 5.0, P / sA));
  }
  a *= vColor.a;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor.rgb * a, a);
}`;

/** a point of a line: position (scene metres), half-width (metres), colour (sRGB 0..1) and alpha; `glow` (facing: halo
 *  strength 0..1) and `soft` (ground: a Gaussian profile across, for shadows) */
export interface StripPoint { x: number; y: number; z: number; half: number; r: number; g: number; b: number; a: number; glow?: number; soft?: boolean }

export class StripLayer {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array; private prev: Float32Array; private next: Float32Array; private side: Float32Array; private w: Float32Array; private col: Float32Array; private dash: Float32Array;
  private idx: Uint32Array;
  private nv = 0; private ni = 0;
  constructor(readonly kind: 'facing' | 'ground', private maxPts = 4096) {
    const V = maxPts * 2;
    this.pos = new Float32Array(V * 3); this.prev = new Float32Array(V * 3); this.next = new Float32Array(V * 3);
    this.side = new Float32Array(V); this.w = new Float32Array(V * 4); this.col = new Float32Array(V * 4); this.dash = new Float32Array(V * 4); this.idx = new Uint32Array(maxPts * 6);
    const dyn = (a: Float32Array, n: number) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', dyn(this.pos, 3)); this.geo.setAttribute('aPrev', dyn(this.prev, 3)); this.geo.setAttribute('aNext', dyn(this.next, 3));
    this.geo.setAttribute('aSide', dyn(this.side, 1)); this.geo.setAttribute('aW', dyn(this.w, 4)); this.geo.setAttribute('aColor', dyn(this.col, 4)); this.geo.setAttribute('aDash', dyn(this.dash, 4));
    this.geo.setIndex(new THREE.BufferAttribute(this.idx, 1).setUsage(THREE.DynamicDrawUsage));
    const facing = kind === 'facing';
    this.material = new THREE.ShaderMaterial({
      vertexShader: facing ? FACING_VERT : GROUND_VERT, fragmentShader: facing ? FACING_FRAG : GROUND_FRAG,
      transparent: true, depthWrite: false, depthTest: true, premultipliedAlpha: true, side: THREE.DoubleSide, toneMapped: false,
      polygonOffset: !facing, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
      uniforms: { uViewport: { value: new THREE.Vector2(1, 1) }, uMinPx: { value: 1.5 }, uGlowPx: { value: 2.5 }, uGlow: { value: 0.25 } },
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = facing ? 12 : 7;
  }
  begin() { this.nv = 0; this.ni = 0; }
  /** one polyline. For 'ground', `margin` is extra half-width in metres for the antialiasing footprint (per point);
   *  `ends`: 'round' runs the ribbon on half its width past both ends and rounds them; `dash`: square-ended dashes
   *  `period` metres apart, `fill` of each painted, from the start */
  line(pts: StripPoint[], margin: (i: number) => number = () => 0, opt: { ends?: 'round'; dash?: { period: number; fill: number } } = {}) {
    if (opt.ends === 'round' && pts.length >= 2) {
      // one more point beyond each end, along the line, as far as the half-width
      const ext = (p: StripPoint, q: StripPoint): StripPoint => { const dx = p.x - q.x, dz = p.z - q.z, l = Math.hypot(dx, dz) || 1; return { ...p, x: p.x + (dx / l) * p.half, z: p.z + (dz / l) * p.half }; };
      pts = [ext(pts[0], pts[1]), ...pts, ext(pts[pts.length - 1], pts[pts.length - 2])];
    }
    const n = pts.length;
    if (n < 2 || this.nv / 2 + n > this.maxPts) return;
    const v0 = this.nv, round = opt.ends === 'round';
    // the distance along the line from its first real point (the round end's extra point lies before it)
    let along = round ? -Math.hypot(pts[1].x - pts[0].x, pts[1].z - pts[0].z) : 0, len = 0;
    for (let i = round ? 2 : 1; i < (round ? n - 1 : n); i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    for (let i = 0; i < n; i++) {
      const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      if (i > 0) along += Math.hypot(p.x - a.x, p.z - a.z);
      for (const s of [-1, 1]) {
        const k = this.nv++;
        this.pos.set([p.x, p.y, p.z], k * 3); this.prev.set([a.x, a.y, a.z], k * 3); this.next.set([b.x, b.y, b.z], k * 3);
        this.side[k] = s;
        this.w.set([p.half, this.kind === 'facing' ? (p.glow ?? 0) : p.soft ? 1 : 0, margin(i), 0], k * 4);
        this.col.set([p.r, p.g, p.b, p.a], k * 4);
        this.dash.set([along, opt.dash?.period ?? 0, opt.dash?.fill ?? 1, round ? len : -1], k * 4);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = v0 + i * 2;
      this.idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], this.ni); this.ni += 6;
    }
  }
  end(viewport?: THREE.Vector2) {
    for (const name of ['position', 'aPrev', 'aNext', 'aSide', 'aW', 'aColor', 'aDash']) {
      const at = this.geo.getAttribute(name) as THREE.BufferAttribute;
      at.clearUpdateRanges(); at.addUpdateRange(0, this.nv * at.itemSize); at.needsUpdate = true;
    }
    const ix = this.geo.getIndex()!; ix.clearUpdateRanges(); ix.addUpdateRange(0, this.ni); ix.needsUpdate = true;
    this.geo.setDrawRange(0, this.ni);
    this.mesh.visible = this.ni > 0;
    if (viewport) this.material.uniforms.uViewport.value.copy(viewport);
  }
  dispose() { this.geo.dispose(); this.material.dispose(); }
}
