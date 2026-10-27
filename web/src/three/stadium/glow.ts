import * as THREE from 'three';

export function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** additive glow sprites: size in metres, never smaller than min pixels; set uFocal every frame.
 *  vis: the geometry carries an aVis attribute (0..1) that scales each sprite: its visibility, worked out by the caller
 *  (Crystal.tsx for the floodlight halos, which are drawn without the depth test) */
export function glowMaterial(tex: THREE.Texture, clip: THREE.Plane[], size: number, min: number, color: string, opacity: number, opts: { vis?: boolean } = {}) {
  return new THREE.ShaderMaterial({
    defines: opts.vis ? { USE_VIS: '' } : {},
    // uChase/uGoalT/uGoalAng: the goal reaction's light chase round the ring (goalFx.ts), off unless uChase is 1
    uniforms: { uFocal: { value: 1000 }, uMap: { value: tex }, uSize: { value: size }, uMin: { value: min }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity },
      uChase: { value: 0 }, uGoalT: { value: -1 }, uGoalAng: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, clipping: true, clippingPlanes: clip, toneMapped: false,
    vertexShader: `#include <clipping_planes_pars_vertex>
      uniform float uFocal, uSize, uMin, uChase, uGoalT, uGoalAng; varying float vBoost, vVis;
      #ifdef USE_VIS
        attribute float aVis;
      #endif
      void main(){
        #ifdef USE_VIS
          vVis = aVis;
        #else
          vVis = 1.0;
        #endif
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        float t = uGoalT, d = abs(mod(atan(position.z, position.x) - uGoalAng + 3.14159265, 6.2831853) - 3.14159265);
        float pq = (d - t * 2.3) / 0.3, pulse = exp(-pq * pq) * step(t, 1.6);   // (pow() of a negative base is undefined in GLSL)
        float breathe = step(1.6, t) * (0.5 + 0.5 * cos((t - 1.6) * 6.2831853)) * (1.0 - smoothstep(3.0, 6.0, t));
        vBoost = uChase * step(0.0, t) * max(2.2 * pulse, 0.8 * breathe);
        gl_PointSize = max(uMin, uSize * uFocal / -mvPosition.z) * (1.0 + 0.5 * vBoost);
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: `#include <clipping_planes_pars_fragment>
      uniform sampler2D uMap; uniform vec3 uColor; uniform float uOpacity; varying float vBoost, vVis;
      void main(){
        #include <clipping_planes_fragment>
        if (vVis < 0.002) discard;
        gl_FragColor = vec4(uColor, vVis * min(1.0, uOpacity * (1.0 + vBoost)) * texture2D(uMap, gl_PointCoord).a); }`,
  });
}

/** focal length in pixels for the current camera, for screen-size-aware point shaders */
export function focalPx(height: number, fovDeg: number) {
  return (height * window.devicePixelRatio / 2) / Math.tan(THREE.MathUtils.degToRad(fovDeg / 2));
}
