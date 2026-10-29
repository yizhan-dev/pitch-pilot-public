// The head's stack, for one standard (name and stamina for the MVP; how far from the player; what to do
// with the floating triangle). A copy of the Show layer's tag (three/layers/ShowLayer.tsx and app.css .gm-tag:
// the shirt number in the team's colour and the shirt name, the stamina bar under it, DOM over the canvas at one pixel
// size), for the sandbox only, with the layouts to compare:
//   &stack=v1  the tag still over the head; the triangle on top of it, without a name of its own (the tag has it)
//   &stack=v2  the triangle at the head as if untagged; the tag over it, rising while he is hovered or selected
//   &stack=v3  no triangle over a tagged player; a small triangle before his number, in the cue's colour
//   &stack=v4  eFootball's: the triangle just over the head, the tag (name over the bar) just over it, in pixels
//   &anchor=m  the tag's foot 0.42 m over the neck (the first anchor) | px: the top of the head (0.28 m over the neck) and 6 px
//   &tags=7,20 the players tagged
// With `chances` (the pass chances, over each player like his name tag): each team-mate's
// chance in chanceColour, to the right of his name, else of his stamina bar, else alone over his head (`show`), hung off
// the row so the tag stays centred on him
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { Loaded } from '../../../data';
import type { Clock } from '../../../clock';
import type { Look } from '../../players/looks';
import type { HideRef } from '../../players/Styles';
import { jointAt } from '../../camera/Director';
import { getSettings, showTagged, SHOW_TAG } from '../../../game/settings';
import { instantStamina, sampleAt, staminaBand } from '../../../hud/playerStats';
import type { ClipPkg } from '../../../hud/match';
import { TELE, inkColour, stackScale, chanceColour } from '../style';

export type StackLayout = 'v1' | 'v2' | 'v3' | 'v4';

// sized by --s (stackScale) from TELE.pointer's stack numbers: the name, the bar under it, one length for everyone
const CSS = `
.st-tags { position: absolute; inset: 0; z-index: 5; overflow: hidden; pointer-events: none; }
.st-tag { position: absolute; left: 0; top: 0; display: grid; justify-items: center; gap: calc(var(--row) * var(--s)); will-change: transform; }
.st-name { font: 600 calc(var(--name) * var(--s))/1 'Barlow Condensed', sans-serif; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; color: #f2f4f7;
  text-shadow: 0 1px 2px rgba(0, 0, 0, .9), 0 0 6px rgba(0, 0, 0, .55); display: flex; align-items: center; justify-content: center; }
.st-name b { margin-right: .3em; font-weight: 700; }
.st-name .cue { width: 0; height: 0; margin-right: 4px; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 7px solid currentColor;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, .8)); }
.st-bar { display: block; width: calc(var(--barw) * var(--s)); height: calc(var(--bar) * var(--s)); background: rgba(4, 6, 10, .7); box-shadow: 0 0 0 1px rgba(0, 0, 0, .35); }
.st-bar > i { display: block; height: 100%; background: #3fd68c; }
.st-bar > i.warn { background: #ffc94d; }
.st-bar > i.bad { background: #ff5a52; }
.st-name, .st-barrow { position: relative; }
.st-barrow { display: block; }
.st-chance { font: 700 calc(var(--name) * var(--s))/1 'Barlow Condensed', sans-serif; letter-spacing: .02em; font-variant-numeric: tabular-nums; white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0, 0, 0, .9), 0 0 6px rgba(0, 0, 0, .55); }
.st-chance.hang { position: absolute; left: 100%; margin-left: calc(6px * var(--s)); }
.st-barrow .st-chance.hang { top: 50%; transform: translateY(-50%); }
.st-name .st-chance.hang { top: 0; }`;

const hexOf = (c: [number, number, number]) => `rgb(${c.map((x) => Math.round(x * 255)).join(',')})`;

export function StackTags({ data, clock, looks, hover, layout, anchor, players, chances, show = { name: true, bar: true } }: { data: Loaded; clock: Clock; looks: Look[] | undefined; hover: HideRef; layout: StackLayout; anchor: 'm' | 'px'; players: number[]; chances?: Map<number, number | null>; show?: { name: boolean; bar: boolean } }) {
  const { gl, camera } = useThree();
  const J = data.joints, nAtt = data.pkg.frames[0]?.att.length ?? 11;
  const neck = useMemo(() => J?.names.indexOf('neck') ?? -1, [J]);
  const stamina = useMemo(() => instantStamina(data.pkg as unknown as ClipPkg), [data]);
  // the pointer and the shared tag numbers follow the layout (sandbox only)
  useEffect(() => {
    TELE.pointer.tagged = layout === 'v1' ? 'stack-noname' : layout === 'v2' ? 'none' : layout === 'v4' ? 'under' : 'hide';
    SHOW_TAG.upM = anchor === 'px' ? 0.28 : 0.42;
    (SHOW_TAG as { gapPx?: number }).gapPx = anchor === 'px' ? 6 : 0;
  }, [layout, anchor]);
  const tags = useMemo(() => {
    const box = document.createElement('div'), style = document.createElement('style');
    box.className = 'st-tags'; style.textContent = CSS; box.appendChild(style);
    const list = players.map((p) => {
      const el = document.createElement('div'), name = document.createElement('span'), cue = document.createElement('i'), no = document.createElement('b'), bar = document.createElement('i'), fill = document.createElement('i');
      const barrow = document.createElement('span'), chance = document.createElement('span');
      el.className = 'st-tag'; name.className = 'st-name'; cue.className = 'cue'; bar.className = 'st-bar'; barrow.className = 'st-barrow'; chance.className = 'st-chance';
      const text = document.createTextNode('');
      name.append(cue, no, text); bar.appendChild(fill); barrow.appendChild(bar);
      if (!show.name) name.style.display = 'none';
      if (!show.bar) barrow.style.display = 'none';
      // the chance hangs off the name, else off the bar, else stands alone where the tag would be
      if (show.name) { chance.classList.add('hang'); name.appendChild(chance); }
      else if (show.bar) { chance.classList.add('hang'); barrow.appendChild(chance); }
      el.append(name, barrow);
      if (!show.name && !show.bar) el.appendChild(chance);
      box.appendChild(el);
      return { p, el, name, cue, no, text, fill, chance };
    });
    return { box, list };
  }, [players, show.name, show.bar]);
  useEffect(() => {
    gl.domElement.parentElement?.appendChild(tags.box);
    return () => { tags.box.remove(); showTagged.clear(); };
  }, [gl, tags]);
  useEffect(() => {
    for (const g of tags.list) {
      const L = looks?.[g.p];
      g.no.textContent = L ? String(L.number) : '';
      g.text.textContent = L ? L.name : '';
      g.no.style.color = hexOf(inkColour('team', g.p < nAtt ? 'att' : 'def', 0, [0, 0, 0]));
    }
  }, [tags, looks, nAtt]);

  const st = useMemo(() => ({ v: new THREE.Vector3(), w: new THREE.Vector3(), fwd: new THREE.Vector3() }), []);
  useFrame((state) => {
    const t = clock.t, W = gl.domElement.clientWidth, H = gl.domElement.clientHeight, sel = getSettings().selected, P = TELE.pointer;
    const cam = state.camera as THREE.PerspectiveCamera, unit = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    cam.getWorldDirection(st.fwd);
    showTagged.clear();
    for (const g of tags.list) {
      if (!J || neck < 0 || !jointAt(J, g.p, neck, t, st.v)) { g.el.style.display = 'none'; continue; }
      st.v.y += SHOW_TAG.upM;
      const depth = Math.max(0.1, st.w.copy(st.v).sub(camera.position).dot(st.fwd));
      st.v.project(camera);
      if (st.v.z >= 1) { g.el.style.display = 'none'; continue; }
      const ss = stackScale(depth);
      g.el.style.setProperty('--s', ss.toFixed(3)); g.el.style.setProperty('--name', `${P.stackName}px`); g.el.style.setProperty('--row', `${P.stackRow}px`); g.el.style.setProperty('--bar', `${P.stackBarH}px`); g.el.style.setProperty('--barw', `${P.stackBarW}px`);
      let lift = P.stackGap * ss;
      const cued = g.p === hover.current || g.p === sel;
      // v2: over the cue while he has one (the cue's top over its own anchor at the head, 0.45 m over the neck)
      if (layout === 'v2' && cued) {
        const half = THREE.MathUtils.clamp(P.halfM / (depth * unit), P.sizeMin, P.sizeVH) * H, pxPerM = H / (depth * unit);
        lift += (0.45 - SHOW_TAG.upM) * pxPerM + half * (P.lift + P.bob) + 0.833 * half + 4;
      }
      // v4: over the cue while he has one, the cue's full height (its tip at the tag's foot) and 4 px
      if (layout === 'v4' && cued) lift += 2 * 0.833 * P.stackTri * ss + P.stackGap * ss;
      // v3: the cue before the number, white over the hovered, his team's colour over the selected
      g.cue.style.display = layout === 'v3' && cued ? '' : 'none';
      if (layout === 'v3' && cued) g.cue.style.color = g.p === sel ? hexOf(inkColour('team', g.p < nAtt ? 'att' : 'def', 0, [0, 0, 0])) : '#ffffff';
      g.el.style.display = '';
      g.el.style.transform = `translate3d(${(((st.v.x + 1) / 2) * W).toFixed(1)}px, ${(((1 - st.v.y) / 2) * H - lift).toFixed(1)}px, 0) translate(-50%, -100%)`;
      const c = chances?.get(g.p);
      g.chance.style.display = typeof c === 'number' ? '' : 'none';
      if (typeof c === 'number') {
        const q = Math.min(0.99, Math.max(0, c)), col = chanceColour(q);
        g.chance.textContent = `${Math.round(q * 100)}%`;
        g.chance.style.color = hexOf(col);
      }
      const v = sampleAt(stamina[g.p], t, data.pkg.meta.fps), band = staminaBand(v);
      g.fill.style.width = `${Math.max(0, Math.min(100, v)).toFixed(1)}%`;
      g.fill.className = band;
      showTagged.add(g.p);
    }
  });
  return null;
}
