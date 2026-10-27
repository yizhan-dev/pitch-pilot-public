// Sparks (Yi, 2026-10-22: particles at the growing edge of each line, so the entrance looks cooler): points the same
// size on screen, added as light, depth tested so players hide them. Stateless: the caller computes every live spark's
// position from its emission time and seed at the current animation time, so a pause, a scrub and a recording all agree.
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute vec4 aColor; attribute float aSize;
uniform float uPixelRatio;
varying vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixelRatio;
}`;
const FRAG = /* glsl */ `
precision highp float;
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = vColor.a * (1.0 - smoothstep(0.35, 1.0, d));   // a bright core with a soft edge
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb * a, 0.0);                 // pure light (additive)
}`;

export class SparkLayer {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array; private col: Float32Array; private size: Float32Array;
  private n = 0;
  constructor(private max = 4096) {
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    const dyn = (a: Float32Array, k: number) => new THREE.BufferAttribute(a, k).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', dyn(this.pos, 3)); this.geo.setAttribute('aColor', dyn(this.col, 4)); this.geo.setAttribute('aSize', dyn(this.size, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: true, premultipliedAlpha: true,
      blending: THREE.AdditiveBlending, toneMapped: false, uniforms: { uPixelRatio: { value: 1 } },
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false; this.points.renderOrder = 13;
  }
  begin() { this.n = 0; }
  push(x: number, y: number, z: number, r: number, g: number, b: number, a: number, sizePx: number) {
    if (this.n >= this.max || a <= 0.003) return;
    const k = this.n++;
    this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
    this.col[k * 4] = r; this.col[k * 4 + 1] = g; this.col[k * 4 + 2] = b; this.col[k * 4 + 3] = a;
    this.size[k] = sizePx;
  }
  end(pixelRatio: number) {
    for (const name of ['position', 'aColor', 'aSize']) {
      const at = this.geo.getAttribute(name) as THREE.BufferAttribute;
      at.clearUpdateRanges(); at.addUpdateRange(0, this.n * at.itemSize); at.needsUpdate = true;
    }
    this.geo.setDrawRange(0, this.n);
    this.points.visible = this.n > 0;
    this.material.uniforms.uPixelRatio.value = pixelRatio;
  }
  dispose() { this.geo.dispose(); this.material.dispose(); }
}

/** a deterministic hash to 0..1 */
export function hash01(a: number, b: number, c: number, d = 0) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647 + d * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
