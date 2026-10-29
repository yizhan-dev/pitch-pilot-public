import { useEffect, useMemo, useRef } from 'react';
import { addAfterEffect, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Clock } from '../../clock';
import type { Loaded } from '../../data';
import type { Look } from '../players/looks';
import { jointAt } from '../camera/Director';
import { land, wiTagged } from '../../whatif/state';
import { attackingOf, playerTeam } from '../coords';
import { TELE, inkColour, stackScale, chanceColour } from '../telestration/style';

// The names over the What-if's players (a player shown carries his name and shirt number, in the Watch mode's
// style): the Watch mode's Show tag (three/layers/ShowLayer.tsx, eFootball's way: the shirt number in the team's colour and the shirt name over the head,
// sized by TELE.pointer.stack* and stackScale(depth)), drawn here for the What-if's own set: while
// he picks, the man on the ball and his lit options; while a pass plays and at its end, the passer and the receiver.
// DOM over the canvas, placed after the frame is rendered (addAfterEffect, the frame's own camera), on whole pixels.
// While he picks, each option's chance of the pass reaching him hangs off the right of his name, as the Tactics mode's
// pass chance (ShowLayer.tsx: its .gm-tag-chance, chanceColour: the percentage to the right of the player's
// name); offside, no number.
// The Show layer skips the men tagged here (state.ts wiTagged), so a name is never printed twice: both stood 0.28 m over
// the neck, and the Show tag's stamina bar set the two names apart.

const UP_M = 0.28;
type Tag = { el: HTMLDivElement; no: HTMLElement; chance: HTMLSpanElement; cv: string; shown: boolean; s: string; bw: number; bh: number };
const css = (c: [number, number, number]) => `rgb(${c.map((x) => Math.round(x * 255)).join(',')})`;

export function WhatIfTags({ data, clock, looks }: { data: Loaded; clock: Clock; looks: Look[] }) {
  const { gl, camera } = useThree();
  const J = data.joints, nAtt = data.pkg.frames[0]?.att.length ?? 11, P = J?.players ?? 0, attacking = attackingOf(data.pkg.meta);
  const neck = useMemo(() => J?.names.indexOf('neck') ?? -1, [J]);
  const tags = useMemo(() => {
    const box = document.createElement('div'), S = TELE.pointer;
    box.className = 'wi-ntags';
    box.style.setProperty('--name', `${S.stackName}px`);
    const list: Tag[] = Array.from({ length: P }, () => {
      const el = document.createElement('div'), name = document.createElement('span'), no = document.createElement('b'), chance = document.createElement('span');
      el.className = 'wi-ntag'; name.className = 'wi-ntag-name'; chance.className = 'gm-tag-chance hang';
      name.append(no, document.createTextNode('')); el.append(name); el.style.display = 'none'; box.appendChild(el);
      return { el, no, chance, cv: '', shown: false, s: '', bw: 0, bh: 0 };
    });
    return { box, list };
  }, [P]);
  useEffect(() => { gl.domElement.parentElement?.appendChild(tags.box); return () => tags.box.remove(); }, [gl, tags]);
  useEffect(() => {
    tags.list.forEach((g, p) => {
      const L = looks[p];
      g.no.textContent = L ? String(L.number) : '';
      g.el.firstChild!.childNodes[1].textContent = L ? L.name : '';
      g.no.style.color = css(inkColour('team', playerTeam(p, nAtt, attacking) === 'home' ? 'att' : 'def', 0, [0, 0, 0]));
      g.bw = 0;
    });
  }, [tags, looks, nAtt, attacking]);

  const st = useMemo(() => ({ v: new THREE.Vector3(), w: new THREE.Vector3(), fwd: new THREE.Vector3(), chances: new Map<number, number>(), on: new Set<number>() }), []);
  const frame = useRef(() => {});
  useEffect(() => addAfterEffect(() => frame.current()), []);
  frame.current = () => {
    // (who: state.ts wiTagged, the set the Show layer skips)
    const L = land.get(), on = wiTagged(st.on), chances = st.chances;
    chances.clear();
    if (L.phase === 'pick' && on.size) for (const o of L.options ?? []) if (o.chance !== null && o.who !== L.carrier) chances.set(o.who, o.chance);
    const t = clock.t, w = gl.domElement.clientWidth, h = gl.domElement.clientHeight, S = TELE.pointer;
    camera.getWorldDirection(st.fwd);
    for (let p = 0; p < P; p++) {
      const g = tags.list[p];
      let place = on.has(p) && !!J && jointAt(J, p, neck, t, st.v), depth = 0;
      if (place) {
        st.v.y += UP_M;
        depth = Math.max(0.1, st.w.copy(st.v).sub(camera.position).dot(st.fwd));
        st.v.project(camera);
        place = st.v.z < 1 && Math.abs(st.v.x) < 1.15 && Math.abs(st.v.y) < 1.15;
      }
      if (!place) { if (g.shown) { g.el.style.display = 'none'; g.shown = false; } continue; }
      if (!g.shown) { g.el.style.display = ''; g.shown = true; }
      // the chance, out of the flow (the tag stays centred on him), as Tactics shows it
      const c = chances.get(p), cv = c === undefined ? '' : `${Math.round(Math.min(0.99, Math.max(0, c)) * 100)}%`;
      if (cv !== g.cv) {
        if (!cv) g.chance.remove();
        else { g.chance.textContent = cv; g.chance.style.color = css(chanceColour(Math.min(0.99, Math.max(0, c!)))); if (!g.chance.parentNode) g.el.firstChild!.appendChild(g.chance); }
        g.cv = cv;
      }
      const k = stackScale(depth), ks = k.toFixed(3);
      if (ks !== g.s) { g.el.style.setProperty('--s', ks); g.s = ks; }
      if (!g.bw) { g.bw = g.el.offsetWidth / k; g.bh = g.el.offsetHeight / k; }
      // over the hover triangle (the kit's HoverPointer) when he has one
      const lift = (S.stackGap + (p === L.hoverWho ? 2 * 0.833 * S.stackTri + S.stackGap : 0)) * k;
      g.el.style.transform = `translate3d(${Math.round(((st.v.x + 1) / 2) * w - (g.bw * k) / 2)}px, ${Math.round(((1 - st.v.y) / 2) * h - lift - g.bh * k)}px, 0)`;
    }
  };
  return null;
}
