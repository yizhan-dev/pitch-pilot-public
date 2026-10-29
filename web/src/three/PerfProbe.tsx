import { useEffect, useRef } from 'react';
import { hook, hooked } from '../dev';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

// ?perf=1: the renderer's counts and the scene's parts, for the performance checks (scripts/perfbench.mjs). It reads
// and toggles; it draws nothing and costs nothing without the flag.
const ON = typeof location !== 'undefined' && new URLSearchParams(location.search).get('perf') === '1';
// ?blinklog=1: what could show a black frame, logged in a corner as it happens (the screen going
// black for one frame): a frame that drew far fewer calls than usual, a camera with NaN in it, the canvas resized, shaders
// compiled, a frame over 100 ms; with the clip clock, so a blink seen can be matched to its line
const BLINK = typeof location !== 'undefined' && new URLSearchParams(location.search).get('blinklog') === '1';

/** triangles an object draws (an instanced mesh's per instance times its count), for the parts' budget */
function trisOf(o: THREE.Object3D): number {
  const m = o as THREE.Mesh;
  if (!m.isMesh || !m.geometry) return 0;
  const g = m.geometry, n = g.index ? g.index.count : (g.attributes.position?.count ?? 0);
  const inst = (m as unknown as THREE.InstancedMesh).isInstancedMesh ? (m as unknown as THREE.InstancedMesh).count : 1;
  return (n / 3) * inst;
}

function blinkLine(msg: string) {
  let box = document.getElementById('pp-blinklog');
  if (!box) {
    box = document.createElement('div'); box.id = 'pp-blinklog';
    Object.assign(box.style, { position: 'fixed', left: '8px', bottom: '150px', zIndex: '99', maxWidth: '420px', padding: '6px 8px', background: 'rgba(0,0,0,.7)', color: '#9fe', font: '11px/1.35 ui-monospace, monospace', pointerEvents: 'none', whiteSpace: 'pre' });
    document.body.appendChild(box);
  }
  const clock = document.querySelector('.hud-replay-clock')?.textContent ?? '';
  const log = hooked<string[]>('blinklog') ?? []; if (!hooked('blinklog')) hook('blinklog', log);
  log.push(`${Math.round(performance.now())} ${clock} ${msg}`);   // (the whole log, for the checks)
  const t = new Date(), stamp = `${t.toLocaleTimeString('en-GB')}.${String(t.getMilliseconds()).padStart(3, '0')}`;
  box.textContent = [`${stamp} ${clock} ${msg}`, ...(box.textContent ? box.textContent.split('\n') : [])].slice(0, 12).join('\n');
}

/** name: the hook (`perf` for the game's stage; the line-up show's canvas registers as `perfShow`) */
export function PerfProbe({ name = 'perf' }: { name?: 'perf' | 'perfShow' } = {}) {
  const gl = useThree((s) => s.gl), scene = useThree((s) => s.scene), camera = useThree((s) => s.camera);
  const bl = useRef({ last: 0, calls: [] as number[], progs: -1, w: 0, h: 0 });
  useFrame(() => {
    if (!BLINK) return;
    const b = bl.current, now = performance.now(), calls = gl.info.render.calls, progs = gl.info.programs?.length ?? 0;
    // (gl.info holds the frame drawn before this one)
    if (b.last) {
      const dt = now - b.last, med = b.calls.length ? b.calls.slice().sort((x, y) => x - y)[b.calls.length >> 1] : calls;
      if (b.calls.length > 30 && calls < Math.min(20, med * 0.5)) blinkLine(`EMPTY frame: ${calls} draw calls (usual ${med})`);
      if (dt > 100) blinkLine(`long frame ${Math.round(dt)} ms`);
      if (b.progs >= 0 && progs > b.progs) blinkLine(`shaders compiled: ${progs - b.progs} new (${progs})`);
      if (gl.domElement.width !== b.w || gl.domElement.height !== b.h) blinkLine(`canvas resized ${b.w}x${b.h} -> ${gl.domElement.width}x${gl.domElement.height}`);
      if (camera.matrixWorld.elements.some((x) => !Number.isFinite(x)) || !Number.isFinite(camera.position.x)) blinkLine('camera has NaN');
      if (gl.getRenderTarget() !== null) blinkLine('a render target left bound');
    }
    b.calls.push(calls); if (b.calls.length > 120) b.calls.shift();
    b.last = now; b.progs = progs; b.w = gl.domElement.width; b.h = gl.domElement.height;
  });
  useEffect(() => {
    if (!BLINK) return;
    blinkLine('blink log on');
    const lost = () => blinkLine('WebGL context LOST'), back = () => blinkLine('WebGL context restored');
    gl.domElement.addEventListener('webglcontextlost', lost); gl.domElement.addEventListener('webglcontextrestored', back);
    const hidden = () => blinkLine(`tab ${document.hidden ? 'hidden' : 'shown'}`);
    document.addEventListener('visibilitychange', hidden);
    return () => { gl.domElement.removeEventListener('webglcontextlost', lost); gl.domElement.removeEventListener('webglcontextrestored', back); document.removeEventListener('visibilitychange', hidden); };
  }, [gl]);
  useEffect(() => {
    if (!ON) return;
    hook(name, {
      info: () => ({
        calls: gl.info.render.calls, tris: gl.info.render.triangles, geos: gl.info.memory.geometries, tex: gl.info.memory.textures,
        progs: gl.info.programs?.length ?? 0, renders: gl.info.render.frame, dpr: gl.getPixelRatio(), size: [gl.domElement.width, gl.domElement.height], shadows: gl.shadowMap.enabled,
      }),
      // the scene's parts, by path of child indices ("3.0.1"), with triangles, meshes and a signature (materials and
      // geometries met first), down to three levels where a part is large
      parts: (min = 5000) => {
        const rows: { path: string; tris: number; meshes: number; visible: boolean; sig: string }[] = [];
        const walk = (o: THREE.Object3D, path: string, depth: number) => {
          o.children.forEach((c, i) => {
            let tris = 0, meshes = 0; const sig = new Set<string>();
            c.traverse((x) => {
              const t = trisOf(x);
              if (t) { tris += t; meshes++; const m = x as THREE.Mesh; if (sig.size < 4) sig.add(`${(m as unknown as THREE.InstancedMesh).isInstancedMesh ? 'I:' : ''}${m.geometry.type.replace('Geometry', '')}/${(Array.isArray(m.material) ? m.material[0] : m.material)?.type?.replace('Material', '') ?? ''}${x.name ? `:${x.name}` : ''}`); }
            });
            const p = path ? `${path}.${i}` : `${i}`;
            if (tris >= min) rows.push({ path: p, tris: Math.round(tris), meshes, visible: c.visible, sig: [...sig].join(' ') });
            if (depth < 3 && tris > 40000) walk(c, p, depth + 1);
          });
        };
        walk(scene, '', 0);
        return rows;
      },
      // what the shadow pass draws: the casting meshes, by the scene's top part, with their triangles
      casters: () => {
        const by: Record<string, { meshes: number; tris: number }> = {};
        scene.children.forEach((c, i) => c.traverse((x) => { const m = x as THREE.Mesh; if (m.isMesh && m.castShadow && m.visible) { const k = String(i); (by[k] ??= { meshes: 0, tris: 0 }).meshes++; by[k].tris += Math.round(trisOf(m)); } }));
        return by;
      },
      // a part's meshes by material: how many meshes, how many materials, and how many could be merged (static, not
      // instanced, one material shared by two or more)
      share: (path: string) => {
        let o: THREE.Object3D | undefined = scene;
        for (const k of path.split('.')) o = o?.children[+k];
        const by = new Map<string, number>(); let meshes = 0, inst = 0, multi = 0;
        o?.traverse((x) => { const m = x as THREE.Mesh; if (!m.isMesh || !m.visible) return; meshes++; if ((m as unknown as THREE.InstancedMesh).isInstancedMesh) { inst++; return; } if (Array.isArray(m.material)) { multi++; return; } by.set(m.material.uuid, (by.get(m.material.uuid) ?? 0) + 1); });
        const shared = [...by.values()].filter((n) => n > 1);
        return { meshes, instanced: inst, multiMaterial: multi, materials: by.size, sharedMaterials: shared.length, meshesOnShared: shared.reduce((a, b) => a + b, 0) };
      },
      // the big background surfaces drawn after everything opaque (so the depth test rejects what the stands and the grass
      // cover), or back to where they were: the ground disc (a Ring 1000 m or more) and the sky dome (a Sphere as large)
      late: (on: boolean) => {
        const out: string[] = [];
        scene.traverse((x) => {
          const m = x as THREE.Mesh & { __ro?: number }, g = m.geometry as THREE.BufferGeometry & { parameters?: { outerRadius?: number; radius?: number } };
          if (!m.isMesh || !g?.parameters) return;
          const big = (g.type === 'RingGeometry' && (g.parameters.outerRadius ?? 0) >= 1000) || (g.type === 'SphereGeometry' && (g.parameters.radius ?? 0) >= 1000);
          if (!big) return;
          if (on) { m.__ro ??= m.renderOrder; m.renderOrder = 10; } else if (m.__ro !== undefined) m.renderOrder = m.__ro;
          out.push(`${g.type}:${m.__ro}->${m.renderOrder}`);
        });
        return out;
      },
      // a part by its path, hidden or shown
      showPath: (path: string, on: boolean) => {
        let o: THREE.Object3D | undefined = scene;
        for (const k of path.split('.')) o = o?.children[+k];
        if (o) o.visible = on;
        return !!o;
      },
      // hide or show every object whose name matches (for an A/B of a part's cost)
      show: (re: string, on: boolean) => { let n = 0; scene.traverse((o) => { if (new RegExp(re).test(o.name)) { o.visible = on; n++; } }); return n; },
      shadows: (on: boolean) => {
        gl.shadowMap.enabled = on;
        scene.traverse((o) => { const m = o as THREE.Mesh; if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => { x.needsUpdate = true; }); });
        return on;
      },
      dpr: (r: number) => { gl.setPixelRatio(r); return gl.getPixelRatio(); },
      // the shadow map's size (every casting light), its texture made anew at the next frame
      shadowSize: (n: number) => { let k = 0; scene.traverse((o) => { const l = o as THREE.DirectionalLight; if (l.isDirectionalLight && l.castShadow) { l.shadow.mapSize.set(n, n); l.shadow.map?.dispose(); l.shadow.map = null; k++; } }); return k; },
      // the shadow pass on or off (the map kept as last drawn): the pass's own cost, apart from the receive's
      shadowPass: (on: boolean) => { gl.shadowMap.autoUpdate = on; gl.shadowMap.needsUpdate = true; return on; },
      // the shadow map's filter: 'soft' (PCFSoft, the default), 'pcf', 'basic'; every material recompiled
      shadowType: (t: 'soft' | 'pcf' | 'basic') => {
        gl.shadowMap.type = t === 'soft' ? THREE.PCFSoftShadowMap : t === 'pcf' ? THREE.PCFShadowMap : THREE.BasicShadowMap;
        scene.traverse((o) => { const m = o as THREE.Mesh; if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => { x.needsUpdate = true; }); });
        return gl.shadowMap.type;
      },
      // the standard materials with their own shader code, by mesh: triangles, the material's name and type
      customs: () => { const out: string[] = []; scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !Array.isArray(m.material) && m.material?.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) out.push(`${m.material.type}:${m.material.name || m.name || '?'}:${Math.round(trisOf(m))}:${m.visible}`); }); return out; },
      // the meshes with a custom shader material, hidden or shown (a cost probe)
      customHide: (on: boolean) => { let n = 0; scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !Array.isArray(m.material) && m.material?.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) { m.visible = !on; n++; } }); return n; },
      // the fill lights (the directional lights that cast no shadow) on or off, every material recompiled
      fills: (on: boolean) => {
        let n = 0;
        scene.traverse((o) => { const l = o as THREE.DirectionalLight; if (l.isDirectionalLight && !l.castShadow) { l.visible = on; n++; } });
        scene.traverse((o) => { const m = o as THREE.Mesh; if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => { x.needsUpdate = true; }); });
        return n;
      },
      // every plain standard material swapped for a Lambert one with the same colour, map and transparency (and back)
      // (custom: those with their own shader code too; without it, they are left as they are)
      lambert: (on: boolean, custom = false) => {
        let n = 0;
        scene.traverse((o) => {
          const m = o as THREE.Mesh & { __std?: THREE.Material };
          if (!m.isMesh) return;
          const own = !Array.isArray(m.material) && m.material?.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile;
          if (on && (m.material as THREE.MeshStandardMaterial)?.isMeshStandardMaterial && !Array.isArray(m.material) && (custom || !own)) {
            const a = m.material as THREE.MeshStandardMaterial;
            const b = new THREE.MeshLambertMaterial({ color: a.color, map: a.map, transparent: a.transparent, opacity: a.opacity, side: a.side, emissive: a.emissive, emissiveMap: a.emissiveMap, emissiveIntensity: a.emissiveIntensity, alphaTest: a.alphaTest, clippingPlanes: a.clippingPlanes ?? undefined, depthWrite: a.depthWrite, vertexColors: a.vertexColors });
            m.__std = a; m.material = b; n++;
          } else if (!on && m.__std) { m.material = m.__std; delete m.__std; n++; }
        });
        return n;
      },
    });
  }, [gl, scene, name]);
  return null;
}
