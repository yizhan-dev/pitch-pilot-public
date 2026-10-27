import { useEffect, useMemo, useRef } from 'react';
import { addAfterEffect, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Clock } from '../../clock';
import type { Loaded } from '../../data';
import type { Look } from '../players/looks';
import type { HideRef } from '../players/Styles';
import { jointAt } from '../camera/Director';
import { getSettings, showTagged, showChosen, showNamed, showOf, SHOW_TAG, type ShowOpts } from '../../game/settings';
import { attackingOf, playerTeam } from '../coords';
import { instantStamina, sampleAt, staminaBand } from '../../hud/playerStats';
import { momentAt } from '../../hud/analysis';
import type { ClipPkg } from '../../hud/match';
import { TELE, inkColour, stackScale, chanceColour } from '../telestration/style';
import { passChances } from '../../hud/passProb';
import { clipSwap } from '../../game/clipSwap';
import { wiTagged } from '../../whatif/state';

// What the Show menu draws on the players (hud/ShowMenu.tsx, settings.ts `show`; Yi, 2026-10-24/25), in every mode: one
// tag over the head, eFootball's way (Yi chose V4 with chat 1, telestration-notes §23): from the head up the hover /
// selection cue (chat 1's HoverPointer), the stamina bar, the name. The name is the shirt number in the team's colour and
// the shirt name; the bar is a gauge of one length for everyone, the instant stamina (the player card's bottom-edge bar,
// playerStats.instantStamina). All sizes are chat 1's TELE.pointer.stack* in pixels, scaled together by stackScale(depth),
// so the tag and the cue never drift apart. On whom: the player on the ball (he keeps it while his pass travels, until
// someone else has it), the selected one, either team. DOM over the canvas, placed every frame from the neck joint,
// after the frame is rendered (addAfterEffect), so with the frame's own camera: placed in useFrame they ran before the
// camera director moved the camera and trailed it by a frame while the view was dragged (Yi, 2026-10-25).
// The pass chance (chat 1's spec in hud-notes, r102; chat 3's request 16, Yi 2026-10-26): while Tactics' passing mark
// publishes hud/passProb.ts `passChances`, every team-mate of the carrier gets a tag, whatever the On setting, with his
// chance in chanceColour hung off the right of the name, else of the stamina bar, else alone; offside, no number.

const CARRIER_M = 2.5;                             // on the ball: the nearest player within this of it
const CARRIER_HOLD_M = 1.0;                        // ... unless the one on it the tenth before is still within this
const CARRIER_BACK_S = 6;                          // how far back the last carrier is looked for while the ball travels

/** bw, bh: the tag's size at scale 1, measured when its text or what it shows changes (everything in it scales by --s);
 *  txt: the shirt name's text; chance: the pass chance, cv the text it shows */
type Tag = { el: HTMLDivElement; name: HTMLSpanElement; no: HTMLElement; txt: Text; bar: HTMLElement; fill: HTMLElement; chance: HTMLSpanElement; cv: string; shown: boolean; band: string; s: string; bw: number; bh: number; what: string };
const css = (c: [number, number, number]) => `rgb(${c.map((x) => Math.round(x * 255)).join(',')})`;

export function ShowLayer({ data, clock, looks, hide, hover }: { data: Loaded; clock: Clock; looks: Look[] | undefined; hide: HideRef; hover?: HideRef }) {
  const { gl, camera } = useThree();
  const pkg = data.pkg as unknown as ClipPkg, J = data.joints;
  const nAtt = data.pkg.frames[0]?.att.length ?? 11, P = J?.players ?? 0, attacking = attackingOf(data.pkg.meta);
  const neck = useMemo(() => J?.names.indexOf('neck') ?? -1, [J]);
  const stamina = useMemo(() => instantStamina(pkg), [pkg]);

  // the tags, one per player, in a layer over the canvas (under the HUD); their sizes are CSS variables of the stack's
  const tags = useMemo(() => {
    const box = document.createElement('div'), S = TELE.pointer;
    box.className = 'gm-tags';
    for (const [k, v] of [['--name', S.stackName], ['--row', S.stackRow], ['--bar', S.stackBarH], ['--barw', S.stackBarW]] as const) box.style.setProperty(k, `${v}px`);
    const list: Tag[] = Array.from({ length: P }, () => {
      const el = document.createElement('div'), name = document.createElement('span'), no = document.createElement('b'), bar = document.createElement('i'), fill = document.createElement('i');
      const txt = document.createTextNode(''), chance = document.createElement('span');
      el.className = 'gm-tag'; name.className = 'gm-tag-name'; bar.className = 'gm-tag-bar'; chance.className = 'gm-tag-chance';
      name.append(no, txt); bar.appendChild(fill); el.append(name, bar); el.style.display = 'none'; box.appendChild(el);
      return { el, name, no, txt, bar, fill, chance, cv: '', shown: false, band: '', s: '', bw: 0, bh: 0, what: '' };
    });
    return { box, list };
  }, [P]);
  useEffect(() => {
    const parent = gl.domElement.parentElement;
    parent?.appendChild(tags.box);
    return () => { tags.box.remove(); showTagged.clear(); };
  }, [gl, tags]);
  // the names, the number in his team's colour (the cue's, chat 1's inkColour)
  useEffect(() => {
    tags.list.forEach((g, p) => {
      const L = looks?.[p];
      g.no.textContent = L ? String(L.number) : '';
      g.txt.textContent = L ? L.name : '';
      g.no.style.color = css(inkColour('team', playerTeam(p, nAtt, attacking) === 'home' ? 'att' : 'def', 0, [0, 0, 0]));
      g.bw = 0;   // measured again
    });
  }, [tags, looks, nAtt, attacking]);

  const st = useMemo(() => ({ v: new THREE.Vector3(), w: new THREE.Vector3(), fwd: new THREE.Vector3(), chances: new Map<number, number | null>(), wt: new Set<number>() }), []);
  /** who is within reach of the ball at each tenth of a second of the clip (null: nobody, or the ball not tracked), worked
   *  out once per tenth and kept for the clip: the search back through a pass in flight asked for up to 60 of them on every
   *  new tenth (profiled 2026-10-26) */
  //   The man on it the tenth before keeps it while he is still within CARRIER_HOLD_M (the What-if chat, 2026-10-27: at
  // a What-if stop the defender who closed the receiver down stood as near the ball as he did, 0.30 m against 0.34 m at
  // 74:31, and the name flipped to the defender), so the tenths are worked out in order, from the last one known
  const near = useMemo(() => new Map<number, number | null>(), [pkg]);
  const nearAt = (tenth: number) => {
    const known = near.get(tenth);
    if (known !== undefined) return known;
    let k = tenth;
    while (k > 0 && !near.has(k - 1)) k--;
    for (; k <= tenth; k++) {
      const m = momentAt(pkg, k / 10), had = k > 0 ? near.get(k - 1) ?? null : null, off = (i: number) => Math.hypot(m.pos[i][0] - m.ball[0], m.pos[i][1] - m.ball[1]);
      let found: number | null = null;
      if (m.hasBall && had !== null && had < m.pos.length && off(had) < CARRIER_HOLD_M) found = had;
      else if (m.hasBall) { let d = CARRIER_M; for (let i = 0; i < m.pos.length; i++) { const x = off(i); if (x < d) { d = x; found = i; } } }
      near.set(k, found);
    }
    return near.get(tenth) ?? null;
  };
  /** the player on the ball at t: the nearest within reach, else the last one who had it (up to CARRIER_BACK_S back) */
  const carrierAt = (t: number) => {
    const tenth = Math.round(t * 10);
    for (let k = 0; k <= CARRIER_BACK_S * 10; k++) { const p = nearAt(tenth - k); if (p !== null) return p; }
    return null;
  };
  const shownOn = (show: ShowOpts, selected: number | null, t: number) => {
    const on = new Set<number>();
    if (show.who === 'ball') { const c = carrierAt(t); if (c !== null) on.add(c); }
    if (show.who === 'selected' && selected !== null) on.add(selected);
    if (show.who === 'all' || show.who === 'home' || show.who === 'away') for (let p = 0; p < P; p++) if (show.who === 'all' || show.who === playerTeam(p, nAtt, attacking)) on.add(p);
    for (const p of showNamed) on.add(p);   // the Explain mode's call-outs (chat 4)
    return on;
  };

  const frame = useRef(() => {});
  useEffect(() => addAfterEffect(() => frame.current()), []);
  frame.current = () => {
    const s = getSettings(), show = showOf(s), t = clock.t, S = TELE.pointer, swapping = clipSwap.get() !== 'off';   // the Explain mode's own (no Show menu there)
    const name = show.what.includes('name'), bar = show.what.includes('stamina'), styled = show.style !== 'toon';
    const on = name || bar || styled ? shownOn(show, s.selected, t) : new Set<number>();
    // the chosen players, for Stage's two sets (the Show style on them, toon on the rest)
    showChosen.clear(); for (const p of on) showChosen.add(p);
    const w = gl.domElement.clientWidth, h = gl.domElement.clientHeight;
    // the players with the cue (hovered, or selected unless we look through his eyes): their tag stands over it
    const sel = s.selected !== null && s.view !== 'first' ? s.selected : -1, hv = hover?.current ?? -1;
    camera.getWorldDirection(st.fwd);
    showTagged.clear();
    // the carrier's team-mates and their pass chances (null: offside, no number); the carrier none
    const pc = passChances.get(), chances = st.chances;
    chances.clear();
    if (pc && pc.carrier !== null && pc.opts) for (const o of pc.opts) if (o.p !== pc.carrier) chances.set(o.p, o.offside ? null : o.prob);
    // the men the What-if mode names itself (WhatIfTags.tsx): no Show tag on them, so each name is printed once (the
    // What-if chat, 2026-10-26); they stay out of showTagged, so the hover cue sits on them as on an untagged man
    const wt = wiTagged(st.wt);
    for (let p = 0; p < P; p++) {
      const g = tags.list[p], c = chances.get(p), num = typeof c === 'number';
      // at the top of the head; hidden behind the camera, off screen, when we look through his eyes, or while a clip
      // changes in place (the players are under the board)
      let place = !swapping && !wt.has(p) && ((name || bar) && (on.has(p) || chances.has(p)) || num) && p !== hide.current && !!J && jointAt(J, p, neck, t, st.v);
      let depth = 0;
      if (place) {
        st.v.y += SHOW_TAG.upM;
        depth = Math.max(0.1, st.w.copy(st.v).sub(camera.position).dot(st.fwd));
        st.v.project(camera);
        place = st.v.z < 1 && Math.abs(st.v.x) < 1.15 && Math.abs(st.v.y) < 1.15;
      }
      if (!place) { if (g.shown) { g.el.style.display = 'none'; g.shown = false; } continue; }
      if (!g.shown) { g.el.style.display = ''; g.shown = true; }
      const k = stackScale(depth), ks = k.toFixed(3);
      if (ks !== g.s) { g.el.style.setProperty('--s', ks); g.s = ks; }
      // over the cue while he has one, once chat 1's cue sits under the tag (TELE.pointer.tagged 'under', eFootball's way)
      const lift = (S.stackGap + (S.tagged === 'under' && (p === sel || p === hv) ? 2 * 0.833 * S.stackTri + S.stackGap : 0)) * k;
      const what = `${name ? 'n' : ''}${bar ? 'b' : ''}${num ? 'c' : ''}`;
      if (what !== g.what) {
        g.name.style.display = name ? '' : 'none'; g.bar.style.display = bar ? '' : 'none'; g.what = what; g.bw = 0;
        // the chance hangs off the name, else off the bar (out of the flow, so the tag stays centred), else stands alone
        if (!num) g.chance.remove();
        else if (name || bar) { g.chance.className = 'gm-tag-chance hang'; (name ? g.name : g.bar).appendChild(g.chance); }
        else { g.chance.className = 'gm-tag-chance'; g.el.appendChild(g.chance); }
      }
      if (num) {
        const q = Math.min(0.99, Math.max(0, c)), cv = `${Math.round(q * 100)}%`;
        if (cv !== g.cv) { g.chance.textContent = cv; g.chance.style.color = css(chanceColour(q)); g.cv = cv; if (!name && !bar) g.bw = 0; }
      }
      if (!g.bw) { g.bw = g.el.offsetWidth / k; g.bh = g.el.offsetHeight / k; }
      // on whole pixels, so the text is drawn on the same grid every frame (at fractional places the figures and the
      // caps were rounded apart, the number reading now high, now low; Yi, 2026-10-25); centred by its own size
      g.el.style.transform = `translate3d(${Math.round(((st.v.x + 1) / 2) * w - (g.bw * k) / 2)}px, ${Math.round(((1 - st.v.y) / 2) * h - lift - g.bh * k)}px, 0)`;
      if (bar) {
        const v = sampleAt(stamina[p], t, data.pkg.meta.fps), band = staminaBand(v);
        g.fill.style.width = `${Math.max(0, Math.min(100, v)).toFixed(1)}%`;
        if (band !== g.band) { g.fill.className = band; g.band = band; }
      }
      showTagged.add(p);
    }
  };
  return null;
}
