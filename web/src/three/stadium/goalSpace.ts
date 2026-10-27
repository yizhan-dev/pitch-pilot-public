import * as THREE from 'three';

// The goal's shape, shared by the goals (Furniture) and the ball, which the net must hold.
// After a Premier League match goal: 7.32 m by 2.44 m, 12 cm posts; the net's support runs level back to TOP_D, then a
// straight stay slopes to the ground frame 2 m behind the line.
export const GOAL = { hw: 3.66, h: 2.44, r: 0.06, depth: 2.0, mesh: 0.12, sag: 0.14 };
export const TOP_D = 0.9, FILLET = 0.12;
const HALF_L = 52.5, R = 0.11;

/** how far behind the line the net is at height y (the trapezoid profile, fillets aside) */
export function netDepth(y: number) {
  return y >= GOAL.h ? TOP_D : TOP_D + ((GOAL.h - y) / GOAL.h) * (GOAL.depth - TOP_D);
}
const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Keeps a ball that is in a goal inside its net (world coordinates, changed in place). The tracking can put the ball
 *  past where our net hangs (real nets are looser, and tracking inside the net is rougher), so the ball is held: the
 *  open net may stretch up to 40 cm round it, less towards the frame and the ground, and not at all at the frame. */
export function holdInNet(p: THREE.Vector3) {
  for (const side of [1, -1]) {
    const d = (p.x - side * HALF_L) * side;
    if (d <= 0 || d > GOAL.depth + 3 || Math.abs(p.z) > GOAL.hw + 1 || p.y > GOAL.h + 0.6) continue;
    const z = THREE.MathUtils.clamp(p.z, -(GOAL.hw - R), GOAL.hw - R);
    const free = ss(0, 0.5, GOAL.hw - Math.abs(z));
    const y = THREE.MathUtils.clamp(p.y, R, GOAL.h - R + 0.3 * free);
    const pin = free * ss(0.1, 0.5, y);          // on the ground the net is tied to the ground frame: the ball stays inside it
    const dMax = netDepth(y) + 0.4 * pin - R * (1 - pin);
    p.set(side * HALF_L + side * Math.min(d, dMax), y, z);
  }
  return p;
}
