// Free ribbons (the ball trace's ribbon looks, BallTrace.tsx): polylines whose side vector the caller gives per point,
// so one layer draws a ribbon lying on the grass, one turned to the camera, one standing upright (a curtain), or one
// turning from the one to the other along its length. Many lines in one draw call, each a separate triangle strip.
//  - Constant width in metres (`half` per point), never under uMinPx pixels across, up to uCap times its width (thinner:
//    wider and fainter, so the ribbon keeps its weight; or, uHold 1, wider at full strength: the ribbon on the grass,
//    which the view flattens far away), antialiased over the pixel's footprint across the ribbon (fwidth), so it reads the same
//    lying flat, turned to the view, or nearly edge-on (where it fades instead of breaking up).
//  - Alpha per point and per side (an upright curtain fades from its foot to its top).
//  - An optional round cap at the line's head (its last point), a half disc of the ribbon's width.
//  - Under the ball (the trail always underneath the ball, else the ball looks messy): every
//    fragment inside the ball's silhouette, grown by uBallGap.x pixels, is dropped, whatever its depth. The silhouette
//    is exact for the perspective view: the view ray's distance to the ball's centre is under its radius. The ball
//    (setBall) is read per camera when the layer is drawn (onBeforeRender), so a second view is right too.
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute vec3 aSideV; attribute float aSide; attribute vec4 aW; attribute vec3 aTan; attribute vec4 aColor;
uniform vec4 uViewport; uniform float uMinPx, uCap, uHold, uFlatMin, uFlatNear, uFlatFar;
varying float vAcross; varying float vAlong; varying float vHalf; varying float vK; varying vec4 vColor;
void main() {
  mat4 vp = projectionMatrix * viewMatrix;
  vec4 c0 = vp * vec4(position, 1.0), c1 = vp * vec4(position + aSideV * 0.05, 1.0);
  vec2 h = 0.5 * uViewport.zw;
  float pxPerM = (c0.w > 1e-3 && c1.w > 1e-3) ? length((c1.xy / c1.w - c0.xy / c0.w) * h) / 0.05 : 1e4;
  float half_ = aW.x;
  float hw = max(half_, min(0.5 * uMinPx / max(pxPerM, 1e-4), uCap * half_));    // at least uMinPx across, within reason
  // far away a ribbon the view flattens (lying on the grass) is widened to keep uFlatMin of the width it would show
  // turned to the view: none within uFlatNear m of the camera (the near side as it was), all of it from uFlatFar m
  float pxFace = projectionMatrix[1][1] * h.y / max(c0.w, 1e-3), fs = clamp(pxPerM / max(pxFace, 1e-4), 0.0, 1.0);
  float keep = uFlatMin * smoothstep(uFlatNear, uFlatFar, c0.w);
  if (keep > 0.0) hw = max(hw, min(half_ * keep / max(fs, 1e-3), uCap * half_));
  float margin = min(1.5 / max(pxPerM, 1e-4), 2.0 * hw + 0.05);                 // room for the antialiasing
  float draw = hw + margin;
  vec3 p = position + aSideV * (aSide * draw) + aTan * (aW.w * draw);           // aW.w: the cap's vertex, past the head
  vAcross = aSide * draw; vAlong = aW.z - aW.w * draw; vHalf = hw; vK = mix(half_ / max(hw, 1e-6), 1.0, uHold);
  vColor = vec4(aColor.rgb, aSide < 0.0 ? aColor.a : aW.y);
  gl_Position = vp * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
varying float vAcross; varying float vAlong; varying float vHalf; varying float vK; varying vec4 vColor;
uniform vec4 uViewport; uniform vec4 uProj; uniform vec4 uBall; uniform vec2 uBallGap; uniform float uOrtho;
void main() {
  float aa = max(fwidth(vAcross), 1e-5);
  float e = max(vHalf, 0.6 * aa);
  float d = abs(vAcross);
  if (vAlong < 0.0) { d = length(vec2(vAlong, vAcross)); aa = max(aa, fwidth(vAlong)); }   // the round cap
  float a = clamp((e - d) / aa + 0.5, 0.0, 1.0) * (vHalf / e) * vK * vColor.a;
  if (uBall.w > 0.0) {                                                           // under the ball
    vec2 ndc = (gl_FragCoord.xy - uViewport.xy) / uViewport.zw * 2.0 - 1.0;
    float perp, mpp;
    if (uOrtho > 0.5) {
      vec2 q = vec2((ndc.x - uProj.z) / uProj.x, (ndc.y - uProj.w) / uProj.y);
      perp = length(uBall.xy - q); mpp = 2.0 / (uProj.y * uViewport.w);
    } else {
      vec3 r = normalize(vec3((ndc.x + uProj.z) / uProj.x, (ndc.y + uProj.w) / uProj.y, -1.0));
      float along = max(dot(uBall.xyz, r), 1e-3);
      perp = length(uBall.xyz - along * r); mpp = along * 2.0 / (uProj.y * uViewport.w);
    }
    a *= smoothstep(uBall.w + uBallGap.x * mpp, uBall.w + (uBallGap.x + uBallGap.y) * mpp, perp);
  }
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor.rgb * a, a);
}`;

/** a point of a ribbon: its centre (scene metres), its unit side vector (the ribbon spans centre ± side * half), its
 *  half-width (metres), and its alpha on the - side (`a`) and on the + side (`a2`, default `a`) */
export interface RibbonPoint { x: number; y: number; z: number; sx: number; sy: number; sz: number; half: number; a: number; a2?: number }

export class RibbonLayer {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  /** the ball to stay under (scene metres), and whether there is one */
  readonly ball = { p: new THREE.Vector3(), r: 0.11, on: false };
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array; private sideV: Float32Array; private side: Float32Array; private w: Float32Array; private tan: Float32Array; private col: Float32Array;
  private idx: Uint32Array;
  private nv = 0; private ni = 0;
  private vp = new THREE.Vector4(); private v = new THREE.Vector3();
  /** `ground`: the layer lies on the grass (polygon offset, drawn before the ones in the air) */
  constructor(private maxPts = 2048, ground = false) {
    const V = maxPts * 2;
    this.pos = new Float32Array(V * 3); this.sideV = new Float32Array(V * 3); this.side = new Float32Array(V); this.w = new Float32Array(V * 4);
    this.tan = new Float32Array(V * 3); this.col = new Float32Array(V * 4); this.idx = new Uint32Array(maxPts * 6);
    const dyn = (a: Float32Array, n: number) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', dyn(this.pos, 3)); this.geo.setAttribute('aSideV', dyn(this.sideV, 3)); this.geo.setAttribute('aSide', dyn(this.side, 1));
    this.geo.setAttribute('aW', dyn(this.w, 4)); this.geo.setAttribute('aTan', dyn(this.tan, 3)); this.geo.setAttribute('aColor', dyn(this.col, 4));
    this.geo.setIndex(new THREE.BufferAttribute(this.idx, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true, premultipliedAlpha: true, side: THREE.DoubleSide, toneMapped: false,
      polygonOffset: ground, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
      uniforms: {
        uViewport: { value: new THREE.Vector4(0, 0, 1, 1) }, uMinPx: { value: 1.5 }, uCap: { value: 3 }, uHold: { value: 0 }, uFlatMin: { value: 0 }, uFlatNear: { value: 35 }, uFlatFar: { value: 70 }, uProj: { value: new THREE.Vector4(1, 1, 0, 0) },
        uBall: { value: new THREE.Vector4(0, 0, 0, 0) }, uBallGap: { value: new THREE.Vector2(1, 1) }, uOrtho: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = ground ? 7 : 12;
    // per camera, as it is drawn: the viewport, the projection and the ball in the camera's frame
    this.mesh.onBeforeRender = (renderer, _scene, camera) => {
      const u = this.material.uniforms, e = camera.projectionMatrix.elements, ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera === true;
      u.uViewport.value.copy(renderer.getCurrentViewport(this.vp));
      u.uOrtho.value = ortho ? 1 : 0;
      u.uProj.value.set(e[0], e[5], ortho ? e[12] : e[8], ortho ? e[13] : e[9]);
      if (this.ball.on) { this.v.copy(this.ball.p).applyMatrix4(camera.matrixWorldInverse); u.uBall.value.set(this.v.x, this.v.y, this.v.z, this.ball.r); }
      else u.uBall.value.w = 0;
      this.material.uniformsNeedUpdate = true;
    };
  }
  begin() { this.nv = 0; this.ni = 0; }
  /** one ribbon, colour r g b; `cap`: a round cap at its head (the last point) */
  line(pts: RibbonPoint[], r: number, g: number, b: number, cap = false) {
    const n = pts.length;
    if (n < 2 || this.nv / 2 + n + 1 > this.maxPts) return;
    const v0 = this.nv;
    // along: metres from the head, for the cap
    let along = 0;
    const al: number[] = new Array(n); al[n - 1] = 0;
    for (let i = n - 2; i >= 0; i--) { along += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y, pts[i + 1].z - pts[i].z); al[i] = along; }
    const put = (p: RibbonPoint, alongM: number, ext: number, tx: number, ty: number, tz: number) => {
      for (const s of [-1, 1]) {
        const k = this.nv++;
        this.pos[k * 3] = p.x; this.pos[k * 3 + 1] = p.y; this.pos[k * 3 + 2] = p.z;
        this.sideV[k * 3] = p.sx; this.sideV[k * 3 + 1] = p.sy; this.sideV[k * 3 + 2] = p.sz;
        this.side[k] = s;
        this.w[k * 4] = p.half; this.w[k * 4 + 1] = p.a2 ?? p.a; this.w[k * 4 + 2] = alongM; this.w[k * 4 + 3] = ext;
        this.tan[k * 3] = tx; this.tan[k * 3 + 1] = ty; this.tan[k * 3 + 2] = tz;
        this.col[k * 4] = r; this.col[k * 4 + 1] = g; this.col[k * 4 + 2] = b; this.col[k * 4 + 3] = p.a;
      }
    };
    for (let i = 0; i < n; i++) put(pts[i], al[i], 0, 0, 0, 0);
    let m = n;
    if (cap) {
      // the head's way: from the last point some way back (a stopped ball's last points coincide)
      const h = pts[n - 1];
      let j = n - 2;
      while (j > 0 && Math.hypot(h.x - pts[j].x, h.y - pts[j].y, h.z - pts[j].z) < 0.05) j--;
      let tx = h.x - pts[j].x, ty = h.y - pts[j].y, tz = h.z - pts[j].z;
      // square to the side vector, so the cap lies in the ribbon's plane
      const sd = tx * h.sx + ty * h.sy + tz * h.sz; tx -= sd * h.sx; ty -= sd * h.sy; tz -= sd * h.sz;
      const L = Math.hypot(tx, ty, tz);
      if (L > 1e-6) { put(h, 0, 1, tx / L, ty / L, tz / L); m = n + 1; }
    }
    for (let i = 0; i < m - 1; i++) {
      const a = v0 + i * 2;
      this.idx[this.ni++] = a; this.idx[this.ni++] = a + 1; this.idx[this.ni++] = a + 2;
      this.idx[this.ni++] = a + 1; this.idx[this.ni++] = a + 3; this.idx[this.ni++] = a + 2;
    }
  }
  end() {
    for (const name of ['position', 'aSideV', 'aSide', 'aW', 'aTan', 'aColor']) {
      const at = this.geo.getAttribute(name) as THREE.BufferAttribute;
      at.clearUpdateRanges(); at.addUpdateRange(0, this.nv * at.itemSize); at.needsUpdate = true;
    }
    const ix = this.geo.getIndex()!; ix.clearUpdateRanges(); ix.addUpdateRange(0, this.ni); ix.needsUpdate = true;
    this.geo.setDrawRange(0, this.ni);
    this.mesh.visible = this.ni > 0;
  }
  dispose() { this.geo.dispose(); this.material.dispose(); }
}
