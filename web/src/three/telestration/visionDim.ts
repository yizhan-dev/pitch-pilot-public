// The vision cone's darkness (a player's vision cone, everything behind him darkened): every
// built-in material in the scene (grass, players, goals, stands; MeshStandard, Basic, Lambert, Phong, Toon) learns, like
// fog, to darken a fragment by where it stands on the ground relative to one player: nothing in his central view (within
// `central` of where his head points), part in his peripheral view (to `peripheral`), most behind him; never within
// `keep` metres of him, so he stays lit. A fog-like patch through onBeforeCompile (chained with the material's own),
// sharing one set of uniforms, so a frame sets it once for all. Custom shader materials (the telestration's own marks,
// the sky) are left as they are. Off (uVisOn 0) the patch costs one branch per fragment.
import * as THREE from 'three';

/** the offside close-up's cue on the attacker's body (the part of him beyond the wall shows lighter, so
 *  the audience sees at once what is offside): within `uOffR` m of him (`uOffP`, scene x, z) and above the grass, what
 *  lies beyond the wall's plane (x = `uOffX`, beyond along `uOffSg`) is lifted towards white by `uOffK`, with a bright
 *  seam where the wall cuts him */
export const OFFB = {
  uOffOn: { value: 0 }, uOffX: { value: 0 }, uOffSg: { value: 1 }, uOffR: { value: 0.9 }, uOffK: { value: 0 },
  uOffP: { value: new THREE.Vector2() },
};

/** up to this many players' views at once: a spot stays lit if any of them sees it (the selected
 *  players together; what none of them can see is the dark) */
export const VIS_MAX = 4;

export const VIS = {
  uVisOn: { value: 0 },
  uVisN: { value: 1 },                                                                    // how many players
  uVisP: { value: Array.from({ length: VIS_MAX }, () => new THREE.Vector2()) },           // each player, scene x, z
  uVisD: { value: Array.from({ length: VIS_MAX }, () => new THREE.Vector2(1, 0)) },       // where his head points
  uVisCos: { value: new THREE.Vector2(0.5, -0.17) },   // cos of the central and the peripheral half-angles
  uVisDark: { value: new THREE.Vector2(0.62, 0.3) },  // how much darker: behind, peripheral
  uVisKeep: { value: 1.2 },
  uVisSoft: { value: 0.06 },                        // the edges' softness, in cos units
  // from his eyes (as if the view came out of his head): each player's eyes (scene x, up, z); what is
  // farther from them than uVisR m is still all dark (the sight spreading out from the eyes), a soft bright band at
  // that front (uVisWash); uVisK the whole effect's strength 0..1 (the scene dims first)
  uVisE: { value: Array.from({ length: VIS_MAX }, () => new THREE.Vector3()) },
  uVisR: { value: 1e4 }, uVisWash: { value: 0 }, uVisK: { value: 1 },
};

const patched = new WeakSet<THREE.Material>();
const VERT_DECL = 'varying vec3 vVisW;\n';
const FRAG_DECL = `varying vec3 vVisW;
uniform float uVisOn, uVisKeep, uVisSoft, uVisN, uVisR, uVisWash, uVisK; uniform vec2 uVisP[${VIS_MAX}], uVisD[${VIS_MAX}], uVisCos, uVisDark; uniform vec3 uVisE[${VIS_MAX}];
uniform float uOffOn, uOffX, uOffSg, uOffR, uOffK; uniform vec2 uOffP;
vec3 offLift(vec3 c) {
  if (uOffOn < 0.5) return c;
  float beyond = (vVisW.x - uOffX) * uOffSg;
  float body = (1.0 - smoothstep(uOffR, uOffR + 0.15, length(vVisW.xz - uOffP))) * step(0.04, vVisW.y);
  float past = smoothstep(0.0, 0.015, beyond), seam = exp(-pow(beyond / 0.02, 2.0));
  return mix(c, vec3(1.0), 0.55 * uOffK * past * body) + 0.6 * uOffK * seam * body;
}
float visOne(vec2 P, vec2 D, vec3 E) {
  vec2 d = vVisW.xz - P; float r = length(d);
  float c = r > 1e-4 ? dot(d / r, D) : 1.0;
  float back = 1.0 - smoothstep(uVisCos.y - uVisSoft, uVisCos.y + uVisSoft, c);      // beyond the peripheral edge
  float peri = 1.0 - smoothstep(uVisCos.x - uVisSoft, uVisCos.x + uVisSoft, c);      // beyond the central edge
  float keep = smoothstep(uVisKeep, uVisKeep + 1.0, r);
  float cone = max(back * uVisDark.x, peri * uVisDark.y) * keep;
  // the sight spreading out from his eyes: what it has not reached yet stays all dark; a bright band at its front
  float r3 = length(vVisW - E), lit = 1.0 - smoothstep(uVisR - 2.5, uVisR, r3);
  float wash = uVisWash * exp(-pow((r3 - uVisR) / 1.8, 2.0)) * (1.0 - peri);
  return mix(uVisDark.x * keep, cone, lit) - wash;
}
float visDark() {
  if (uVisOn < 0.5) return 0.0;
  // lit if any of them sees it: the least darkness of all
  float k = 1.0;
  for (int i = 0; i < ${VIS_MAX}; i++) if (float(i) < uVisN) k = min(k, visOne(uVisP[i], uVisD[i], uVisE[i]));
  return k * uVisK;
}
`;

/** patch one material, once; returns whether it took the patch */
export function patchVision(m: THREE.Material): boolean {
  if (patched.has(m)) return false;
  patched.add(m);
  if ((m as THREE.ShaderMaterial).isShaderMaterial || (m as THREE.PointsMaterial).isPointsMaterial || (m as THREE.SpriteMaterial).isSpriteMaterial) return false;
  // troika's derived materials (the telestration's text) are marks too, and their onBeforeCompile is an accessor: a
  // handler set on it is called from troika's own, so chaining troika's as `prev` recursed without end and froze the page
  if ((m as unknown as { isDerivedMaterial?: boolean }).isDerivedMaterial) return false;
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    if (!sh.vertexShader.includes('#include <fog_vertex>') || !sh.fragmentShader.includes('#include <fog_fragment>')) return;
    Object.assign(sh.uniforms, VIS, OFFB);
    sh.vertexShader = VERT_DECL + sh.vertexShader.replace('#include <fog_vertex>', `#include <fog_vertex>
  { vec4 vw = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
    vw = batchingMatrix * vw;
  #endif
  #ifdef USE_INSTANCING
    vw = instanceMatrix * vw;
  #endif
    vVisW = (modelMatrix * vw).xyz; }`);
    sh.fragmentShader = FRAG_DECL + sh.fragmentShader.replace('#include <fog_fragment>', '#include <fog_fragment>\n  gl_FragColor.rgb = offLift(gl_FragColor.rgb);\n  gl_FragColor.rgb *= 1.0 - visDark();');
  };
  m.customProgramCacheKey = () => prevKey() + '|vis';
  m.needsUpdate = true;
  return true;
}

/** patch every material in the scene not patched yet (new ones as the stadium and the players load) */
export function patchScene(scene: THREE.Object3D) {
  let n = 0;
  scene.traverse((o) => {
    const mm = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!mm) return;
    for (const m of Array.isArray(mm) ? mm : [mm]) if (patchVision(m)) n++;
  });
  return n;
}
