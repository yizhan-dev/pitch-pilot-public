// The locked animation curves, transcribed from pitch_prism/freeze/anim.py (itself lifted from the approved
// prototypes; "do not improve these numbers").
//  - the marker, markers.html @keyframes A over 3.4 s: 0% scale .20 alpha 0, cubic-bezier(.15,.85,.3,1); 7% scale 1.06
//    (the blip, passed through), cubic-bezier(.5,0,.4,1); 11% scale 1; exit 80% to 90%, cubic-bezier(.5,0,.85,.4), to
//    scale .22 alpha 0
//  - the group cascade, anim.html over 4.5 s: rings stagger 0.03 s; edges from 0.176 s for 0.635 s; stripes from 0.405 s,
//    0.315 s each, 0.068 s apart; retract 0.27 s

/** CSS cubic-bezier(x1, y1, x2, y2) as a function of x: Newton, then bisection */
export function bezier(x1: number, y1: number, x2: number, y2: number) {
  const bx = (t: number) => 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3;
  const by = (t: number) => 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3;
  const dbx = (t: number) => 3 * (1 - t) ** 2 * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
  return (xIn: number) => {
    const x = Math.min(1, Math.max(0, xIn));
    let t = x;
    for (let i = 0; i < 6; i++) { const d = dbx(t); if (Math.abs(d) < 1e-6) break; t = Math.min(1, Math.max(0, t - (bx(t) - x) / d)); }
    if (Math.abs(bx(t) - x) > 1e-4) { let lo = 0, hi = 1; for (let i = 0; i < 24; i++) { t = (lo + hi) / 2; if (bx(t) < x) lo = t; else hi = t; } }
    return by(t);
  };
}

export const RING = { enterS: 0.374, blipS: 0.238, from: 0.2, blip: 1.06, exitS: 0.34, exitTo: 0.22 };
const ZOOM = bezier(0.15, 0.85, 0.3, 1), SETTLE = bezier(0.5, 0, 0.4, 1), SHRINK = bezier(0.5, 0, 0.85, 0.4);
export const EASE_OUT = bezier(0, 0, 0.58, 1);

/** [scale, alpha] at `age` seconds into the marker's entrance */
export function ringEnter(age: number): [number, number] {
  if (age >= RING.enterS) return [1, 1];
  if (age <= 0) return [RING.from, 0];
  if (age < RING.blipS) { const k = ZOOM(age / RING.blipS); return [RING.from + (RING.blip - RING.from) * k, k]; }
  const k = SETTLE((age - RING.blipS) / (RING.enterS - RING.blipS));
  return [RING.blip + (1 - RING.blip) * k, 1];
}

/** [scale, alpha] at `age` seconds into the marker's exit */
export function ringExit(age: number): [number, number] {
  if (age <= 0) return [1, 1];
  if (age >= RING.exitS) return [RING.exitTo, 0];
  const k = SHRINK(age / RING.exitS);
  return [1 - (1 - RING.exitTo) * k, 1 - k];
}

export const CASCADE = { ringStagger: 0.03, edgeDelay: 0.1755, edgeDur: 0.6345, areaDelay: 0.405, stripeDur: 0.315, stripeStagger: 0.0675, retract: 0.27 };

/** 0..1 of an edge drawn, `age` seconds after its draw began (both halves grow from the rings to the middle) */
export const edgeDraw = (age: number) => (age <= 0 ? 0 : age >= CASCADE.edgeDur ? 1 : EASE_OUT(age / CASCADE.edgeDur));
/** 1..0: what is left of an edge `age` seconds into its exit */
export const retract = (age: number | null) => (age === null || age <= 0 ? 1 : age >= CASCADE.retract ? 0 : 1 - EASE_OUT(age / CASCADE.retract));
