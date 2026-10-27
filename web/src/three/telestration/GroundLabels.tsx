// Labels lying on the pitch (distances in metres, areas in m²): paint, so matte white without a halo (pitch_prism: the
// m² number is painted on the ground and does not glow), sized in metres, turned about the vertical so they read
// upright from the camera's side (in the top-down view, along the screen's up). Faded out where the camera looks along
// the grass (flat text is unreadable there). A fixed pool of troika texts (drei <Text>), set imperatively each frame.
// Latin text only: Barlow Condensed has no CJK, and troika would fetch fallback fonts from a CDN for missing glyphs.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import fontUrl from '@fontsource/barlow-condensed/files/barlow-condensed-latin-600-normal.woff?url';

/** dir: the text's baseline along this ground direction (scene x, z), turned end for end when that would read
 *  backwards from the camera (Yi: the shot cone's distance along its edge, the angle tangent to its arc); without it
 *  the text reads upright across the camera's view */
export interface GroundLabel { x: number; z: number; text: string; alpha: number; sizeM: number; rgb: [number, number, number]; dir?: [number, number]; nudge?: number }
/** nudge: ems along the reading direction, to centre a part of the text on (x, z) (the shot cone's angle: the digits,
 *  not the digits and the degree sign) */
type Troika = THREE.Mesh & { text: string; sync: (cb?: () => void) => void; fillOpacity: number; fontSize: number; color: THREE.Color | string | number };

const POOL = 16;   // the pass chances' ten numbers and whatever else lies on the pitch at the time

export function GroundLabels({ store }: { store: { list: GroundLabel[] } }) {
  const refs = useRef<(Troika | null)[]>([]);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  const tmp = useMemo(() => ({ up: new THREE.Vector3(), right: new THREE.Vector3(), n: new THREE.Vector3(0, 1, 0), m: new THREE.Matrix4(), v: new THREE.Vector3(), last: [] as string[], col: new THREE.Color(), r2: new THREE.Vector3(), u2: new THREE.Vector3() }), []);
  useFrame(({ camera }) => {
    (window as unknown as { __teleLabels?: unknown }).__teleLabels = refs.current;   // for the headless checks
    // the text's up on the ground: the camera's up projected on the grass (away from the viewer; north when straight down)
    tmp.up.set(0, 1, 0).applyQuaternion(camera.quaternion).setY(0);
    if (tmp.up.lengthSq() < 1e-6) camera.getWorldDirection(tmp.up).setY(0);
    tmp.up.normalize(); tmp.right.set(-tmp.up.z, 0, tmp.up.x);
    for (let i = 0; i < POOL; i++) {
      const m = refs.current[i], L = store.list[i];
      if (!m) continue;
      if (!L) { m.visible = false; continue; }
      if (tmp.last[i] !== L.text) { tmp.last[i] = L.text; m.text = L.text; m.sync(); }
      if (m.fontSize !== L.sizeM) { m.fontSize = L.sizeM; m.sync(); }
      // fade where the view grazes the grass: below about 12 degrees of elevation the flat text cannot be read
      const d = tmp.v.set(L.x, 0, L.z).distanceTo(camera.position), elev = camera.position.y / Math.max(0.5, d);
      m.fillOpacity = L.alpha * THREE.MathUtils.smoothstep(elev, 0.12, 0.25);
      tmp.col.setRGB(L.rgb[0], L.rgb[1], L.rgb[2], THREE.SRGBColorSpace);
      m.color = '#' + tmp.col.getHexString(THREE.SRGBColorSpace);
      if (L.dir) {
        const s = L.dir[0] * tmp.right.x + L.dir[1] * tmp.right.z >= 0 ? 1 : -1;
        tmp.r2.set(L.dir[0] * s, 0, L.dir[1] * s).normalize(); tmp.u2.set(tmp.r2.z, 0, -tmp.r2.x);
        const nd = (L.nudge ?? 0) * L.sizeM;
        tmp.m.makeBasis(tmp.r2, tmp.u2, tmp.n).setPosition(L.x + tmp.r2.x * nd, 0, L.z + tmp.r2.z * nd);
      } else tmp.m.makeBasis(tmp.right, tmp.up, tmp.n).setPosition(L.x, 0, L.z);
      m.matrixAutoUpdate = false; m.matrix.copy(tmp.m);
      m.visible = m.fillOpacity > 0.01;
    }
  });
  return (
    <group>
      {Array.from({ length: POOL }, (_, i) => (
        // depthOffset: troika sets its material's polygon offset from this before every draw (it overrides the base
        // material's); without it the text fights the grass for depth and breaks up in the broadcast view
        <Text key={i} ref={(r: unknown) => { refs.current[i] = r as Troika | null; }} font={fontUrl} material={mat} depthOffset={-4} fontSize={1} anchorX="center" anchorY="middle" renderOrder={9} visible={false}>{''}</Text>
      ))}
    </group>
  );
}
