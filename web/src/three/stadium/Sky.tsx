import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

/** sky dome: zenith colour blending to a haze at the horizon (night default: a faint glow from the stadium lights) */
export function SkyDome({ top = '#020306', haze = '#141c2c', radius = 1400 }: { top?: string; haze?: string; radius?: number }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color(top) }, uHaze: { value: new THREE.Color(haze) } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uTop, uHaze; varying vec3 vDir;
      void main(){ float t = smoothstep(-0.05, 0.6, vDir.y); gl_FragColor = vec4(mix(uHaze, uTop, t), 1.0);
        #include <colorspace_fragment>
      }`,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  useEffect(() => { mat.uniforms.uTop.value.set(top); mat.uniforms.uHaze.value.set(haze); }, [mat, top, haze]);
  useEffect(() => () => mat.dispose(), [mat]);   // its own material, released with it
  // (drawn last of the opaque things: first, it was shaded over the whole screen and then
  // covered; last, the depth test keeps it to where nothing else is. It writes no depth, so the rest is unchanged)
  return <mesh material={mat} renderOrder={10}><sphereGeometry args={[radius, 32, 16]} /></mesh>;
}
