import { useEffect, useState } from 'react';
import type { Clock } from '../clock';

/** the shared clock's time in a React component, refreshed at most `hz` times a second. The HUD only reads the clock;
 *  whoever owns it (the 3D loop, or the preview page) advances it. */
export function useClockTime(clock: Clock, hz = 15): number {
  const [t, setT] = useState(clock.t);
  useEffect(() => {
    let raf = 0, last = 0;
    const tick = (now: number) => {
      if (now - last >= 1000 / hz) { last = now; setT(clock.t); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clock, hz]);
  return t;
}
