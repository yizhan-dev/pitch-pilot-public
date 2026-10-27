// The offside close-up (Yi, 2026-10-23: "we need one 远景, like what we see now, and a follow up close up, like actual
// VAR"). The wall comes in on the wide view as before; after `TELE.offside.var.holdS` the camera flies to the offside line
// and looks along it at about head height, as the semi-automated offside replays do, and the close-up marks come in:
// a dot on each man's deciding body part (the part nearest the goal that may play the ball) with a drop line to the
// grass, the attacker's own line across the pitch beside the wall, and an upright verdict with the margin.
// drawOffside writes the facts here every frame; VarMarks draws the dots and the verdict from them, and the camera
// (the sandbox's, or the main session's director) reads varCamera() for where to fly.

export interface VarFacts {
  /** an offside item with the close-up is on screen this frame */
  on: boolean;
  /** seconds since the item came in (the sequence's clock) and its exit's seconds (null while it stays) */
  age: number; exit: number | null;
  /** the wall's x (scene metres); +1 when the attack runs towards +x */
  lx: number; sg: number;
  /** the deciding body parts in scene metres (x, up, z): the line-setter's (null when the ball sets the line) and the
   *  focus attacker's */
  def: [number, number, number] | null; att: [number, number, number] | null;
  /** the attacker's margin beyond the line in metres (positive: offside) */
  margin: number;
  /** the close-up marks' entrance 0..1 */
  close: number;
  /** the marks' colours (0..1 sRGB): the line-setter's, the attacker's */
  defRgb: [number, number, number]; attRgb: [number, number, number];
  /** everyone else on the pitch (scene x, z), so the camera can keep them out of the foreground */
  others: [number, number][];
  /** the verdict's entrance 0..1 (from the wide view on) and where the attacker stands (scene x, z) */
  tag: number; feet: [number, number];
}

export const VAR_FACTS: VarFacts = { on: false, age: 0, exit: null, lx: 0, sg: 1, def: null, att: null, margin: 0, close: 0, defRgb: [1, 1, 1], attRgb: [1, 1, 1], others: [], tag: 0, feet: [0, 0] };

/** the close-up's camera for window.__camSet (orbit target x, y, z; yaw, pitch in degrees; distance): on the offside
 *  line, looking along it from the end nearer the view it comes from (`fromYawDeg`, the camera's yaw now: the flight is
 *  a push in and down, not a swing round the stadium; without it, from the touchline nearer the two men), turned
 *  `turnDeg` towards the halfway line so the wall shows as a sliver and the attacker stands clear of it, `pitchDeg` up,
 *  far enough back to hold both men. Someone standing in the near foreground (within 7 m of the camera and 40 degrees
 *  of its axis) would show as a head cut by the frame: the camera then comes closer, then tries the line's other end,
 *  and takes the clearest. Null without the attacker. */
export function varCamera(f: VarFacts, fromYawDeg?: number, turnDeg = 12, pitchDeg = 13): [number, number, number, number, number, number] | null {
  if (!f.att) return null;
  const a = f.att, d = f.def ?? [f.lx, 1, a[2]];
  const zMid = (a[2] + d[2]) / 2, span = Math.abs(a[2] - d[2]);
  // which end of the line (yaw 0 puts the camera at +z of its target): the one nearer the view now, else the touchline
  // nearer the men
  const off0 = (y: number) => Math.abs(((y % 360) + 540) % 360 - 180);   // degrees from yaw 0, 0..180
  const prefPlus = fromYawDeg !== undefined ? off0(fromYawDeg) < 90 : zMid >= 0;
  const tx = (f.lx + a[0]) / 2, d0 = Math.min(26, Math.max(10, 8 + 0.6 * span)), cp = Math.cos((pitchDeg * Math.PI) / 180);
  // turned towards the halfway line (-x when the attack runs to +x); at yaw 180 a positive turn moves the camera to -x
  const yawOf = (plus: boolean) => (plus ? 0 : 180) + (plus ? -1 : 1) * f.sg * turnDeg;
  const clutter = (yaw: number, dist: number) => {
    const r = (yaw * Math.PI) / 180, cx = tx + dist * cp * Math.sin(r), cz = zMid + dist * cp * Math.cos(r);
    const fx = -Math.sin(r), fz = -Math.cos(r);
    let n = 0;
    for (const [x, z] of f.others) {
      const dx = x - cx, dz = z - cz, along = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
      if (Math.hypot(dx, dz) < 1.5 || (along > 0 && along < 7 && Math.atan2(lat, along) < (40 * Math.PI) / 180)) n++;
    }
    return n;
  };
  let best: [number, number] = [yawOf(prefPlus), d0], bestN = Infinity;
  for (const [plus, k] of [[prefPlus, 1], [prefPlus, 0.8], [!prefPlus, 1], [!prefPlus, 0.8], [prefPlus, 0.65], [!prefPlus, 0.65]] as [boolean, number][]) {
    const yaw = yawOf(plus), dist = Math.max(8, d0 * k), n = clutter(yaw, dist);
    if (n < bestN) { best = [yaw, dist]; bestN = n; }
    if (n === 0) break;
  }
  return [tx, 1.0, zMid, best[0], pitchDeg, best[1]];
}
