import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { HX, HY, RC, ROOF } from './layout';
import { STADIUM_CURRENT } from './crystalParams';
import { buildCrystalShell } from './crystalBuild';

// Floodlight haze (Yi, 2026-10-22: candidate 4 of docs/research/stadium-vivid.md). A faint warm curtain hangs from the
// floodlight ring under the roof opening and fades out 26 m inwards and 22 m down, so the air under the lights glows a
// little, as on a misty night. Additive and unlit.
// Mist only shows where you look into the light, so the curtain fades with the view (Yi, same day: from high up it lay
// over the pitch like a wall with a hard top edge, and tinted the grass): a fragment seen looking down through it fades
// out (gone by 17 degrees down, so it never tints the pitch), one within 15-40 m of the camera fades too, so flying
// through it shows no sheet, and so does one where the curtain turns edge-on to the view, where it would end in a hard
// silhouette; and it is two thirds as bright as before. ?haze=0 turns it off (for comparisons).
const HAZE_OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('haze') === '0';
export function Haze({ clip }: { clip: THREE.Plane[] }) {
  const geo = useMemo(() => {
    const G = buildCrystalShell(STADIUM_CURRENT, HX, HY, RC, ROOF.back), p = G.lampGeo.getAttribute('position'), n = p.count;
    const pos: number[] = [], al: number[] = [], idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const k = i % n, x = p.getX(k), y = p.getY(k), z = p.getZ(k), l = Math.hypot(x, z), ix = -x / l, iz = -z / l;
      // three rows: at the lamps, 10 m in and 8 m down, 26 m in and 22 m down; brightest at the lamps
      for (const [din, dy, a] of [[0, -0.5, 1], [10, -8, 0.55], [26, -22, 0]] as const) { pos.push(x + ix * din, y + dy, z + iz * din); al.push(a); }
    }
    for (let i = 0; i < n; i++) for (let r = 0; r < 2; r++) { const a = 3 * i + r, b = 3 * (i + 1) + r; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    for (const g of Object.values(G)) if (g instanceof THREE.BufferGeometry) g.dispose();
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aA', new THREE.Float32BufferAttribute(al, 1)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  }, []);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#ffe6c4') }, uOpacity: { value: 0.3 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, toneMapped: false, clipping: true, clippingPlanes: clip,
    vertexShader: `#include <clipping_planes_pars_vertex>
      attribute float aA; varying float vA; varying vec3 vWorld, vN;
      void main(){ vA = aA; vWorld = (modelMatrix * vec4(position, 1.0)).xyz; vN = normalize(mat3(modelMatrix) * normal); vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: `#include <clipping_planes_pars_fragment>
      uniform vec3 uColor; uniform float uOpacity; varying float vA; varying vec3 vWorld, vN;
      void main(){
        #include <clipping_planes_fragment>
        vec3 ray = vWorld - cameraPosition; float dist = length(ray), down = -ray.y / dist;
        float facing = abs(dot(ray / dist, normalize(vN)));   // 0 where the curtain is seen edge-on: its silhouette
        float k = (1.0 - smoothstep(0.0, 0.3, down)) * smoothstep(15.0, 40.0, dist) * smoothstep(0.05, 0.45, facing);
        gl_FragColor = vec4(uColor * uOpacity * vA * vA * k, 1.0); }`,
  }), [clip]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  return HAZE_OFF ? null : <mesh geometry={geo} material={mat} renderOrder={3} />;
}
