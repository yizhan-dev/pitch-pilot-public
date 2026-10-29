import { useEffect, useMemo } from 'react';
import { hook } from '../../dev';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { glowTexture, glowMaterial, focalPx } from './glow';
import { GOAL_FX } from './goalFx';
import { evenLamps, lampVisibility, insideLampRing } from './lamps';
import { shellCeiling } from './shellCeiling';
import { DEFAULT_CRYSTAL, type CrystalParams } from './crystalParams';
import { membraneTexture, finGlowTexture } from './Facade';
import { Landscape } from './Landscape';
import { YizhanSigns } from './Sign';
import { buildCrystalShell } from './crystalBuild';


// The clean crystal: hard outside, soft inside.
// Plan: an octagon, four long sides and four corner cuts, every face a true plane leaning out.
// Roofline: a trapezoid. The long sides are flat and high, the ends flat and low, the corner faces are the ramps,
// so every fold lands on a corner of the plan. The roof runs down and in to one smooth opening over the pitch.
// One quiet skin: straight, evenly spaced fins, or a silver membrane. At night only the folds are drawn in light.
export type { CrystalParams } from './crystalParams';

const SHAPE_KEYS: (keyof CrystalParams)[] = ['cornerClear', 'cutMain', 'cutOther', 'low', 'rise', 'mainRise', 'skew', 'lean', 'mainLean', 'lift', 'podInset',
  'inDrop', 'openInset', 'openR', 'bowLong', 'bowEnd', 'finStep', 'finDepth', 'finThick', 'finUp', 'finWave', 'finWaves', 'finYaw', 'signEnds', 'signCenter', 'signWordRise', 'signSymbolRise', 'signSymbolRiseWest', 'legs', 'legV', 'legStyle', 'legIn', 'podSlant', 'landscape', 'deckH', 'deckOut', 'stepT', 'plazaW', 'ground', 'groundD', 'lampStep', 'fillet', 'crown', 'archMain', 'archLong', 'archEnd', 'archPow', 'sag', 'eaveR', 'cornerR', 'split', 'peak', 'tail', 'diag', 'diagFlip', 'roundCut', 'sharpCut', 'roundR', 'sharpR', 'crestTwist', 'eaveRSharp', 'edgeHard', 'band', 'rimW', 'lipW'];
/** concourse levels behind the glass, v = height / hMax */
function bandTexture(lift: number, hMax: number) {
  const W = 64, H = 1024, y = (h: number) => (1 - h / hMax) * H, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  for (const [h0, h1, k] of [[lift + 1.2, lift + 4.6, 0.9], [lift + 11, lift + 14, 0.65], [lift + 21, lift + 24, 0.5]]) {
    const grd = g.createLinearGradient(0, y(h1), 0, y(h0));
    grd.addColorStop(0, `rgba(255,214,150,${k})`); grd.addColorStop(1, `rgba(255,170,100,${0.45 * k})`);
    g.fillStyle = grd; g.fillRect(0, y(h1), W, y(h0) - y(h1));
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t;
}

/** the glazed base: warm light, a mullion every 4 m */
function podiumTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d')!, grd = g.createLinearGradient(0, 64, 0, 0);
  grd.addColorStop(0, 'rgba(255,206,150,1)'); grd.addColorStop(1, 'rgba(255,180,110,0.55)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#000'; g.fillRect(0, 0, 3, 64); g.fillRect(0, 0, 128, 3);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

/** Draw a facade material's back faces as the dark liner seen from inside the bowl, in the same draw call. */
function withLiner(m: THREE.MeshStandardMaterial) {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n  if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.0042, 0.0063, 0.0091);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  if (!gl_FrontFacing) roughnessFactor = 0.9;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  if (!gl_FrontFacing) metalnessFactor = 0.0;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  if (!gl_FrontFacing) totalEmissiveRadiance = vec3(0.0);');
  };
  m.customProgramCacheKey = () => 'liner-v1';
  return m;
}

/** interior: draw only what a camera inside the bowl can see, the roof (its top from the tactical view overhead) and its
 *  underside; the facade, fins, rim, signs, podium, ground, legs and lights are left out (used by the game) */
export interface CrystalProps { hx: number; hy: number; rc: number; back: number; clip: THREE.Plane[]; params?: Partial<CrystalParams>; shadows?: boolean; interior?: boolean; }

/** the floodlight halos' opacity: at 0.22 the lights read too bright */
const HALO = 0.16;

export function Crystal({ hx, hy, rc, back, clip, params, shadows = false, interior = false }: CrystalProps) {
  const P = useMemo(() => ({ ...DEFAULT_CRYSTAL, ...params }), [params]);
  const shapeKey = SHAPE_KEYS.map((k) => P[k]).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const G = useMemo(() => { const t0 = performance.now(), g = buildCrystalShell(P, hx, hy, rc, back); hook('buildMs', +(performance.now() - t0).toFixed(1)); return g; }, [hx, hy, rc, back, shapeKey]);
  const lamps = useMemo(() => evenLamps(G.lampGeo), [G]);   // the floodlights evenly spaced along the opening (lamps.ts)
  useEffect(() => () => lamps.dispose(), [lamps]);
  const lampVis = useMemo(() => lampVisibility(lamps), [lamps]), overOpening = useMemo(() => insideLampRing(lamps), [lamps]);
  // the roof's underside over each point (Infinity in the opening): where the camera is inside the stadium
  const ceil = useMemo(() => shellCeiling(P, hx, hy, rc, back), [P, hx, hy, rc, back]);
  useEffect(() => () => ceil.dispose(), [ceil]);
  useEffect(() => () => { for (const g of [G.face, ...(G.shoulder ? [G.shoulder] : []), G.rim, G.fins, G.cap, G.roof, ...(G.roofBand ? [G.roofBand] : []), ...(G.roofLip ? [G.roofLip] : []), ...G.seams, G.lip, G.under, G.soffit, G.podium, G.apron, G.eaveLine, G.edgeLine, G.arrisGeo, G.openLine, G.lampGeo, G.plazaGeo]) g.dispose(); }, [G]);
  const tex = useMemo(() => {
    const skin = membraneTexture(); skin.channel = 1;   // laid on uv1: one diamond per fin bay, arc-length rows
    const roof = membraneTexture();
    return { bands: bandTexture(P.lift, G.hMax), podium: podiumTexture(), skin, roof, finGlow: finGlowTexture(), glow: glowTexture() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [P.lift, G.hMax]);
  const mats = useMemo(() => ({
    glass: withLiner(new THREE.MeshStandardMaterial({ color: '#3f4b59', metalness: 0.7, roughness: 0.14, side: THREE.DoubleSide, emissive: '#ffffff', emissiveMap: tex.bands, clippingPlanes: clip })),
    // the smooth shoulder and roof: a satin white skin, the same colour as the membrane, no lattice
    rim: new THREE.MeshStandardMaterial({ color: '#e6e9ed', metalness: 0.2, roughness: 0.35, side: THREE.DoubleSide, clippingPlanes: clip }),
    shell: new THREE.MeshStandardMaterial({ color: '#e9edf1', metalness: 0.15, roughness: 0.32, clippingPlanes: clip }),
    skin: withLiner(new THREE.MeshStandardMaterial({ color: '#dfe4ea', map: tex.skin, metalness: 0.3, roughness: 0.5, side: THREE.DoubleSide, emissive: '#ffffff', emissiveMap: tex.bands, clippingPlanes: clip })),
    liner: new THREE.MeshStandardMaterial({ color: '#0b0e13', roughness: 0.9, side: THREE.BackSide, clippingPlanes: clip }),
    fin: new THREE.MeshStandardMaterial({ color: '#dfe4ea', metalness: 0.55, roughness: 0.38, side: THREE.DoubleSide, emissive: '#ffffff', emissiveMap: tex.finGlow, clippingPlanes: clip }),
    roof: new THREE.MeshStandardMaterial({ color: '#e9edf1', map: tex.roof, metalness: 0.3, roughness: 0.5, side: THREE.DoubleSide, clippingPlanes: clip }),
    band: new THREE.MeshStandardMaterial({ color: '#11151b', metalness: 0.75, roughness: 0.12, side: THREE.DoubleSide, clippingPlanes: clip }),
    seam: new THREE.LineBasicMaterial({ color: '#c9d0d8', transparent: true, opacity: 0.8, clippingPlanes: clip }),
    under: new THREE.MeshStandardMaterial({ color: '#1f242c', emissive: '#11151d', roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide, clippingPlanes: clip }),
    soffit: new THREE.MeshStandardMaterial({ color: '#cfd5dc', roughness: 0.6, emissive: '#ffd9a6', side: THREE.DoubleSide, clippingPlanes: clip }),
    podium: new THREE.MeshStandardMaterial({ color: '#2b3440', metalness: 0.25, roughness: 0.22, emissive: '#ffffff', emissiveMap: tex.podium, side: THREE.DoubleSide, clippingPlanes: clip }),
    concrete: new THREE.MeshStandardMaterial({ color: '#b3b6ba', roughness: 0.9, clippingPlanes: clip }),
    // a light, satin steel: low metalness so a dark night sky does not turn it dark; at night the glazed base uplights it
    steel: new THREE.MeshStandardMaterial({ color: '#f2f4f6', metalness: 0.2, roughness: 0.45, emissive: '#ffe2c0', emissiveIntensity: 0, clippingPlanes: clip }),
    apron: new THREE.MeshStandardMaterial({ color: '#474b52', roughness: 0.95, clippingPlanes: clip }),
    led: new THREE.LineBasicMaterial({ color: '#73d9ff', toneMapped: false, transparent: true, clippingPlanes: clip }),
    lampCore: glowMaterial(tex.glow, clip, 1.4, 3, '#fff7e6', 1.0),
    lampHalo: glowMaterial(tex.glow, clip, 9, 10, '#ffe9c2', HALO, { vis: true }),   // see lampVisibility
    plazaCore: glowMaterial(tex.glow, clip, 0.6, 2, '#ffd9a6', 1.0),
    plazaHalo: glowMaterial(tex.glow, clip, 5, 5, '#ffcf96', 0.16),
  }), [tex, clip]);
  useEffect(() => {
    const on = Math.min(1, P.glow / 0.85), lit = P.glow * Math.min(1, P.glow / 0.85);   // interior light all but vanishes by day
    mats.glass.emissiveIntensity = lit;
    mats.skin.color.set(P.faceColor); mats.skin.emissiveIntensity = 0.45 * lit;
    mats.fin.color.set(P.faceColor); mats.fin.emissiveIntensity = 0.6 * lit;
    mats.roof.color.set(P.roofColor); mats.shell.color.set(P.roofColor); mats.band.color.set(P.bandColor);
    mats.soffit.emissiveIntensity = 0.3 * lit;
    mats.steel.emissiveIntensity = 0.32 * lit;
    mats.podium.emissiveIntensity = lit;
    mats.led.color.set(P.ledColor).multiplyScalar(Math.min(1.6, P.ledGain)); mats.led.opacity = Math.min(1, 0.35 + 0.65 * P.ledGain); mats.led.visible = P.ledGain > 0.02;
    mats.lampCore.uniforms.uOpacity.value = on; mats.lampHalo.uniforms.uOpacity.value = HALO * on;
    mats.plazaCore.uniforms.uOpacity.value = on; mats.plazaHalo.uniforms.uOpacity.value = 0.16 * on;
  }, [mats, P]);
  const objs = useMemo(() => {
    const legGeo = new THREE.CylinderGeometry(0.3, 0.45, 1, 10); legGeo.translate(0, 0.5, 0);
    const legs = new THREE.InstancedMesh(legGeo, mats.steel, Math.max(1, G.legs.length));
    const upV = new THREE.Vector3(0, 1, 0), Mx = new THREE.Matrix4(), Q = new THREE.Quaternion(), Sc = new THREE.Vector3();
    G.legs.forEach((c, k) => { const v = c.b.clone().sub(c.a), l = v.length(); Q.setFromUnitVectors(upV, v.normalize()); Sc.set(c.r, l, c.r); Mx.compose(c.a, Q, Sc); legs.setMatrixAt(k, Mx); });
    legs.count = G.legs.length; legs.instanceMatrix.needsUpdate = true;
    // concrete footings: a low plinth with a chamfered top, flush with the plaza
    const ftGeo = new THREE.CylinderGeometry(0.85, 1, 0.45, 16); ftGeo.translate(0, 0.225, 0);
    const feet = new THREE.InstancedMesh(ftGeo, mats.concrete, Math.max(1, G.footings.length)), I = new THREE.Quaternion();
    G.footings.forEach((f, k) => { Sc.set(f.r, 1, f.r); Mx.compose(f.p, I, Sc); feet.setMatrixAt(k, Mx); });
    feet.count = G.footings.length; feet.instanceMatrix.needsUpdate = true;
    return { legs, feet, seams: G.seams.map((g) => new THREE.Line(g, mats.seam)), eave: new THREE.Line(G.eaveLine, mats.led), edge: new THREE.Line(G.edgeLine, mats.led), arris: new THREE.LineSegments(G.arrisGeo, mats.led), open: new THREE.Line(G.openLine, mats.led) };
  }, [G, mats]);
  useEffect(() => () => { objs.legs.geometry.dispose(); objs.feet.geometry.dispose(); }, [objs]);
  useEffect(() => { objs.legs.castShadow = shadows; objs.feet.receiveShadow = shadows; return () => { objs.legs.dispose(); objs.feet.dispose(); }; }, [objs, shadows]);
  useFrame(({ size, camera }) => {
    const f = focalPx(size.height, (camera as THREE.PerspectiveCamera).fov);
    for (const m of [mats.lampCore, mats.lampHalo, mats.plazaCore, mats.plazaHalo]) m.uniforms.uFocal.value = f;
    // A halo is the glare round a floodlight, not a thing in the scene. Depth-tested as a flat 9 m sprite at the lamp, it
    // was cut wherever the roof opening's lip came in front of it: the lip read as corrugated
    // cardboard. The halos are drawn without the depth test, each scaled by whether its lamp can be seen
    // (lamps.ts lampVisibility); the lamp cores keep the depth test. That holds wherever the camera is inside the stadium
    // or over its opening at any height: under the roof (the broadcast and Decision Lab cameras sit under the near roof
    // at z = 60) or inside the lamp ring in plan (the lineup show's crane rises to 46 m). A test of
    // the bowl's inner edge below 45 m alone would miss both. From above the roof or outside the shell the halos are
    // depth-tested as before, which keeps the approved exterior's glow round the opening exactly as it was.
    const p = camera.position, inside = overOpening(p.x, p.z) || (Math.abs(p.x) < hx + back && Math.abs(p.z) < hy + back && p.y < ceil.at(p.x, p.z) - 0.2);
    lampVis(inside ? p : null);
    if (mats.lampHalo.depthTest === inside) { mats.lampHalo.depthTest = !inside; mats.lampHalo.needsUpdate = true; }
    // the goal reaction's light chase round the floodlight ring (goalFx.ts)
    for (const m of [mats.lampCore, mats.lampHalo]) { m.uniforms.uChase.value = 1; m.uniforms.uGoalT.value = GOAL_FX.since; m.uniforms.uGoalAng.value = Math.atan2(0, GOAL_FX.x); }
  });
  const membrane = P.skin > 0.5, finsOn = P.skin < 0.5 || P.skin > 1.5;
  return (
    <group>
      {interior ? <>
      <mesh geometry={G.roof} material={P.smoothShell > 0.5 ? mats.shell : mats.roof} castShadow={shadows} receiveShadow={shadows} />
      {G.roofBand && <mesh geometry={G.roofBand} material={mats.band} castShadow={shadows} receiveShadow={shadows} />}
      {G.roofLip && <mesh geometry={G.roofLip} material={mats.roof} castShadow={shadows} receiveShadow={shadows} />}
      <mesh geometry={G.lip} material={mats.under} />
      <mesh geometry={G.under} material={mats.under} />
      <mesh geometry={G.soffit} material={mats.soffit} receiveShadow={shadows} />
      </> : <>
      <mesh geometry={G.face} material={membrane ? mats.skin : mats.glass} castShadow={shadows} receiveShadow={shadows} />
      {G.shoulder && <mesh geometry={G.shoulder} material={P.smoothShell > 0.5 ? mats.shell : membrane ? mats.skin : mats.glass} castShadow={shadows} receiveShadow={shadows} />}
      {finsOn && <mesh geometry={G.fins} material={mats.fin} castShadow={shadows} receiveShadow={shadows} />}
      {finsOn && <mesh geometry={G.cap} material={mats.fin} castShadow={shadows} />}
      {finsOn && <mesh geometry={G.rim} material={mats.rim} castShadow={shadows} />}
      {P.signStyle > 0.5 && <YizhanSigns anchors={G.signs} wordPanel={P.signWordPanel > 0.5} symbolPanel={P.signSymbolPanel > 0.5} lit={P.glow > 0.4 ? 1.4 : 0} clip={clip} shadows={shadows} />}
      <mesh geometry={G.roof} material={P.smoothShell > 0.5 ? mats.shell : mats.roof} castShadow={shadows} receiveShadow={shadows} />
      {G.roofBand && <mesh geometry={G.roofBand} material={mats.band} castShadow={shadows} receiveShadow={shadows} />}
      {G.roofLip && <mesh geometry={G.roofLip} material={mats.roof} castShadow={shadows} receiveShadow={shadows} />}
      {objs.seams.map((l, k) => <primitive key={k} object={l} />)}
      <mesh geometry={G.lip} material={mats.under} />
      <mesh geometry={G.under} material={mats.under} />
      <mesh geometry={G.soffit} material={mats.soffit} receiveShadow={shadows} />
      <mesh geometry={G.podium} material={mats.podium} receiveShadow={shadows} />
      {P.landscape > 0.5
        ? <Landscape spec={G.ground} params={{ deckH: P.deckH, deckOut: P.deckOut, stepT: P.stepT, plazaW: P.plazaW, plaza: P.plaza, fountain: P.fountain, stepLed: P.stepLed, ground: P.ground, groundStyle: P.groundStyle, lampStep: P.lampStep, glow: P.glow }} clip={clip} shadows={shadows} />
        : <mesh geometry={G.apron} material={mats.apron} receiveShadow={shadows} />}
      <primitive object={objs.legs} />
      <primitive object={objs.feet} />
      {/* the cyan light lines (eave, base edge, folds, roof opening) are retired. Their geometry is kept
          for the night-lighting work, but nothing draws them, so an old link carrying ledGain or edgeLed cannot bring them back. */}
      <points geometry={lamps} material={mats.lampHalo} />
      <points geometry={lamps} material={mats.lampCore} />
      {P.landscape <= 0.5 && <points geometry={G.plazaGeo} material={mats.plazaHalo} />}
      {P.landscape <= 0.5 && <points geometry={G.plazaGeo} material={mats.plazaCore} />}
      </>}
    </group>
  );
}
