// The shot's xG as a widget standing beside the shooter's head (Yi, 2026-10-22: when we pause, a widget animates in
// next to the player's head, the number rolling to its value, with a little digital glitch). A leader line draws out
// from the head, the plate opens from the leader's end with a glitch (chromatic split, slices torn sideways, flicker),
// the digits roll like a counter and stop one after another, a last glitch as the final digit lands. A DOM overlay
// pinned to the head (drei Html), the same size on screen at any distance (scaled with the view's height), driven every
// frame from the telestration's animation clock with hashed randomness (no CSS animations), so a pause, a scrub and a
// recording all show the same frames.
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { hash01 } from './sparks';

/** written by the telestration each frame: the head (scene metres), the value, the animation's age and exit age (s),
 *  the side of the head the plate stands on (1 the screen's right), the accent colour (the shooter's team colour) */
export interface XgWidgetState {
  on: boolean; head: [number, number, number]; value: number; age: number; exit: number | null; side: 1 | -1; accent: string;
  /** 'stand' beside the head; 'ground' lying on the grass beside his feet (Yi: from high views; XgGroundTag.tsx) */
  mode: 'stand' | 'ground'; feet: [number, number]; ringR: number; tagM: number;
}
export const newXgWidgetState = (): XgWidgetState => ({ on: false, head: [0, 0, 0], value: 0, age: 0, exit: null, side: 1, accent: '#6ab8ff', mode: 'stand', feet: [0, 0], ringR: 1, tagM: 1.4 });

const SLOTS = 4, CYCLES = 3, DELAY = 0.2;                                 // "0.08": four characters; the roll's turns
const START = 0.18, STOPS = [0, 0, 0.8, 1.05];                             // the decimals roll from START, stop in turn
const easeOut = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

/** one frame of the widget's animation, shared by the standing widget and the tag on the grass. Lengths in the plate's
 *  units (its height is 58) */
export interface XgFrame {
  lead: number; open: number; text: string; rolls: { ch: string; k: number; e: number }[];
  glitch: null | { dx: number; jitter: number; alpha: number; bars: { top: number; h: number; shift: number }[] };
}
export function xgFrame(S: XgWidgetState): XgFrame {
  const tw = S.age - DELAY, ex = S.exit;
  const lead = ex === null ? easeOut(tw / 0.14) : 1 - easeOut(ex / 0.3);
  const open = ex === null ? easeOut((tw - 0.1) / 0.2) : 1 - easeOut((ex - 0.05) / 0.22);
  // the digits: "0." stands (an xG never reaches 1, and a rolling leading digit reads as 3.66 or 9.1); the tenths roll
  // two turns and stop, then the hundredths three
  const text = Math.min(0.99, Math.max(0, S.value)).toFixed(2);
  const rolls = [...text].map((ch, i) => {
    if (ch === '.') return { ch, k: 0, e: 1 };
    const v = +ch, fixed = i < 2, turns = fixed ? 0 : Math.min(CYCLES, i), stop = STOPS[i];
    const e = fixed || ex !== null ? 1 : easeOut((tw - START) / (stop - START));
    return { ch, k: (turns * 10 + v) * e, e };
  });
  // the glitch: as the plate opens, as the last digit lands, and as it leaves; hashed per 1/30 s
  const fi = Math.floor((ex === null ? tw : 10 + ex) * 30), lastStop = STOPS[text.length - 1] ?? STOPS[3];
  const win = ex !== null ? ex < 0.3 : (tw > 0.08 && tw < 0.44) || (tw > lastStop - 0.02 && tw < lastStop + 0.14);
  const h = (k: number) => hash01(fi, k, 11);
  const glitch = win && hash01(fi, 7, 3) < 0.65 ? {
    dx: 1.5 + 3 * h(1), jitter: (h(2) - 0.5) * 9, alpha: 0.6 + 0.4 * h(3),
    bars: [0, 1].map((j) => ({ top: h(4 + j) * 0.92, h: 2 + 6 * h(6 + j), shift: (h(8 + j) - 0.5) * 22 })),
  } : null;
  return { lead, open, text, rolls, glitch };
}

export function XgWidget({ store }: { store: { s: XgWidgetState } }) {
  const group = useRef<THREE.Group>(null);
  const el = useRef<{ col?: HTMLDivElement; root?: HTMLDivElement; plate?: HTMLDivElement; line?: SVGPolylineElement; dot?: SVGCircleElement; svg?: SVGSVGElement; num?: HTMLDivElement; accent?: HTMLDivElement; caption?: HTMLDivElement; bars: HTMLDivElement[]; slots: { col: HTMLDivElement; strip: HTMLDivElement; dot: HTMLSpanElement }[] }>({ bars: [], slots: [] });
  const digits = useMemo(() => Array.from({ length: (CYCLES + 1) * 10 }, (_, i) => i % 10), []);

  useFrame(({ size }) => {
    const S = store.s, E = el.current, root = E.root;
    if (!root || !group.current) return;
    if (!S.on || S.mode !== 'stand') { root.style.display = 'none'; return; }
    root.style.display = 'block';
    group.current.position.set(S.head[0], S.head[1], S.head[2]);
    const u = (1.2 * size.height) / 900, side = S.side, F = xgFrame(S);
    root.style.setProperty('--u', `${u}px`);
    // the leader: out and up from the head, then level to the plate
    const lx = side * 26 * u, ly = -24 * u, px = side * 44 * u, len = Math.hypot(lx, ly) + Math.abs(px - lx);
    E.line!.setAttribute('points', `0,0 ${lx},${ly} ${px},${ly}`);
    E.line!.style.strokeDasharray = `${len}`; E.line!.style.strokeDashoffset = `${len * (1 - F.lead)}`;
    E.dot!.style.opacity = `${Math.min(1, F.lead * 3)}`;
    // the plate: opens from the leader's end
    const P = E.plate!, C = E.col!;
    C.style.left = `${px}px`; C.style.top = `${ly - 29 * u}px`;
    C.style.transform = `translateX(${side > 0 ? 0 : -100}%)`;
    P.style.clipPath = side > 0 ? `inset(-20% ${(1 - F.open) * 100}% -20% 0)` : `inset(-20% 0 -20% ${(1 - F.open) * 100}%)`;
    P.style.visibility = F.open > 0.001 ? 'visible' : 'hidden';
    E.accent!.style.order = side > 0 ? '0' : '9';
    E.slots.forEach((sl, i) => {
      const r = F.rolls[i];
      if (!r) { sl.col.style.display = 'none'; sl.dot.style.display = 'none'; return; }
      if (r.ch === '.') { sl.col.style.display = 'none'; sl.dot.style.display = 'inline-block'; return; }
      sl.col.style.display = 'inline-block'; sl.dot.style.display = 'none';
      sl.strip.style.transform = `translateY(${-r.k}em)`;
      sl.strip.style.filter = r.e < 1 ? `blur(${(1 - r.e) * 1.4 * u}px)` : 'none';
      // the drum's edges fade only while it turns; a settled digit stands whole
      sl.col.style.setProperty('-webkit-mask-image', r.e < 1 ? 'linear-gradient(180deg, transparent 0, #000 18%, #000 82%, transparent 100%)' : 'none');
    });
    const G = F.glitch;
    if (G) {
      P.style.translate = `${G.jitter * u}px 0`; P.style.opacity = `${G.alpha}`;
      E.num!.style.textShadow = `${G.dx * u}px 0 rgba(255,46,96,0.85), ${-G.dx * u}px 0 rgba(40,226,255,0.85)`;
      E.bars.forEach((b, j) => {
        b.style.display = 'block'; b.style.top = `${G.bars[j].top * 100}%`; b.style.height = `${G.bars[j].h * u}px`;
        b.style.transform = `translateX(${G.bars[j].shift * u}px)`;
      });
    } else {
      P.style.translate = '0 0'; P.style.opacity = '1'; E.num!.style.textShadow = 'none';
      E.bars.forEach((b) => { b.style.display = 'none'; });
    }
    E.accent!.style.background = S.accent;
  });

  return (
    <group ref={group}>
      <Html zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
        <div ref={(r) => { if (r) el.current.root = r; }} style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, display: 'none', fontFamily: '"Barlow Condensed", "Arial Narrow", sans-serif' }}>
          <svg ref={(r) => { if (r) el.current.svg = r; }} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }} width="1" height="1">
            <circle ref={(r) => { if (r) el.current.dot = r; }} cx="0" cy="0" r="3" fill="none" stroke="rgba(242,244,247,0.9)" strokeWidth="1.5" />
            <polyline ref={(r) => { if (r) el.current.line = r; }} points="0,0" fill="none" stroke="rgba(242,244,247,0.85)" strokeWidth="1.5" />
          </svg>
          <div ref={(r) => { if (r) el.current.col = r; }} style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 'calc(var(--u) * 3)' }}>
          <div ref={(r) => { if (r) el.current.plate = r; }} style={{
            position: 'relative', display: 'flex', alignItems: 'stretch', height: 'calc(var(--u) * 58)', whiteSpace: 'nowrap',
            background: 'linear-gradient(180deg, rgba(16,21,30,0.94), rgba(6,9,14,0.9))', border: '1px solid rgba(255,255,255,0.14)',
            boxShadow: '0 calc(var(--u) * 6) calc(var(--u) * 18) rgba(0,0,0,0.38)', overflow: 'hidden', visibility: 'hidden',
          }}>
            <div ref={(r) => { if (r) el.current.accent = r; }} style={{ width: 'calc(var(--u) * 4)', flex: 'none' }} />
            <div ref={(r) => { if (r) el.current.caption = r; }} style={{ alignSelf: 'flex-end', lineHeight: 1, padding: '0 calc(var(--u) * 6) calc(var(--u) * 9.7) calc(var(--u) * 12)', fontSize: 'calc(var(--u) * 17)', fontWeight: 600, letterSpacing: '0.06em', color: 'rgba(242,244,247,0.66)' }}>xG</div>
            {/* the digits' bottom on the caption's (Yi, 2026-10-26: the number sat 8 px, 6.8 units, lower than "xG"; its padding is inside its
                1em box (border-box), so a translate lifts it) */}
            <div ref={(r) => { if (r) el.current.num = r; }} style={{ alignSelf: 'flex-end', marginLeft: 'auto', padding: '0 calc(var(--u) * 14) calc(var(--u) * 7) calc(var(--u) * 2)', translate: '0 calc(var(--u) * -6.8)', fontSize: 'calc(var(--u) * 44)', fontWeight: 700, lineHeight: 1, height: '1em', color: '#f2f4f7', fontVariantNumeric: 'tabular-nums' }}>
              {Array.from({ length: SLOTS }, (_, i) => (
                <span key={i}>
                  <span ref={(r) => { if (r) { el.current.slots[i] ??= {} as never; el.current.slots[i].dot = r; } }} style={{ display: 'none' }}>.</span>
                  <div ref={(r) => { if (r) { el.current.slots[i] ??= {} as never; el.current.slots[i].col = r; } }} style={{ display: 'none', height: '1em', overflow: 'hidden', verticalAlign: 'top' }}>
                    <div ref={(r) => { if (r) { el.current.slots[i] ??= {} as never; el.current.slots[i].strip = r; } }} style={{ display: 'flex', flexDirection: 'column' }}>
                      {digits.map((d, j) => <span key={j} style={{ height: '1em', lineHeight: 1 }}>{d}</span>)}
                    </div>
                  </div>
                </span>
              ))}
            </div>
            {[0, 1].map((j) => <div key={j} ref={(r) => { if (r) el.current.bars[j] = r; }} style={{ position: 'absolute', left: 0, right: 0, display: 'none', background: 'rgba(242,244,247,0.22)', mixBlendMode: 'screen' }} />)}
          </div>
          </div>
        </div>
      </Html>
    </group>
  );
}
