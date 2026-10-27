// Where marks stand: a fixed pitch point, a player, or the ball, at clip time. Data frame metres: x along the pitch (the
// attack towards +x), y across; the scene's x and z are the same numbers.
import * as THREE from 'three';
import type { Loaded } from '../../data';
import { jointAt } from '../camera/Director';
import { ballAt } from '../Ball';

export type XY = [number, number];
/** a pitch point; or a player (index into the package's players, attackers first); or the ball. `at` pins it to that
 *  clip time instead of following the clock */
export type Anchor = XY | { player: number; at?: number } | { ball: true; at?: number };

const W7 = [1, 2, 3, 4, 3, 2, 1];   // a triangle window over seven samples

export function makeAnchors(data: Loaded) {
  const J = data.joints, hip = J ? J.names.indexOf('midHip') : -1, v = new THREE.Vector3(), pkg = data.pkg;
  /** one sample of a player's hips on the ground: the joints at 25 Hz when there are any, else the 10 Hz positions */
  const raw = (p: number, t: number, out: XY): boolean => {
    if (J && hip >= 0 && jointAt(J, p, hip, t, v)) { out[0] = v.x; out[1] = v.z; return true; }
    const F = pkg.frames, f = F[Math.max(0, Math.min(F.length - 1, Math.round(t * pkg.meta.fps)))];
    const a = p < f.att.length ? f.att[p] : f.def[p - f.att.length];
    if (!a) return false;
    out[0] = a[0]; out[1] = a[1]; return true;
  };
  const s: XY = [0, 0];
  /** a player's ground position averaged over a centred window of `win` seconds (centred, so a running player gets no
   *  lag; the skeleton's sway is what goes) */
  const player = (p: number, t: number, win: number, out: XY): boolean => {
    if (win <= 0) return raw(p, t, out);
    let x = 0, y = 0, w = 0;
    for (let k = 0; k < 7; k++) if (raw(p, t + ((k - 3) / 6) * win, s)) { x += s[0] * W7[k]; y += s[1] * W7[k]; w += W7[k]; }
    if (!w) return false;
    out[0] = x / w; out[1] = y / w; return true;
  };
  const resolve = (a: Anchor, t: number, win: number, out: XY): boolean => {
    if (Array.isArray(a)) { out[0] = a[0]; out[1] = a[1]; return true; }
    const tt = a.at ?? t;
    if ('player' in a) return player(a.player, tt, win, out);
    const b = ballAt(pkg, tt);
    if (!b) return false;
    out[0] = b[0]; out[1] = b[1]; return true;
  };
  return { raw, player, resolve };
}
export type Anchors = ReturnType<typeof makeAnchors>;
