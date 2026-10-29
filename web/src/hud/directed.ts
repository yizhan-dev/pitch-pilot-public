import { parseClip, directorIndex, directorFile, clipAddr, MATCH } from '../data/paths';
import { useEffect, useState } from 'react';
import { store } from './draft';
import { byMatchTime, type ClipIndex, type ClipPkg, type ClipRow } from './match';
import { MOMENTS } from '../whatif/moments';

// Which clips have a baked Explain script (explain/director.ts loads matches/<match>/director/<clip>.json and plays
// it): the Explain mode is open only on those (Watch is every clip's way in; Explain lights up where there is
// commentary). One probe per clip, shared by the mode menu and the Explain replay plate's list.

const cache = new Map<string, Promise<boolean>>(), listed = new Map<string, Promise<Set<string> | null>>();
const isJson = (r: Response) => r.ok && (r.headers.get('content-type') ?? '').includes('json');
/** a clip's moment path (<match>/<clip>, as index.json lists it) has a director script: from the folder's list
 *  (director/index.json, which the release writes), else a HEAD request for the script itself (dev; a missing file comes
 *  back as the dev server's index page, so a JSON content type is the test). Never the script's body */
export function hasDirector(moment: string): Promise<boolean> {
  let p = cache.get(moment);
  if (!p) {
    const { match: dir, id } = parseClip(moment);
    let l = listed.get(dir);
    if (!l) {
      l = fetch(directorIndex(dir)).then((r) => (isJson(r) ? r.json() : null)).then((j: { clips?: string[] } | null) => (j?.clips ? new Set(j.clips) : null)).catch(() => null);
      listed.set(dir, l);
    }
    p = l.then((set) => set ? set.has(id) : fetch(directorFile(moment), { method: 'HEAD' }).then(isJson).catch(() => false));
    cache.set(moment, p);
  }
  return p;
}
/** the ids of the index's clips with a director script, once probed (the Explain player's list, the Explain tags) */
export function useDirectedIds(index: ClipIndex | null) {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!index) return;
    let live = true;
    Promise.all(index.clips.map((c) => hasDirector(c.moment).then((ok) => (ok ? c.id : null)))).then((r) => { if (live) setIds(new Set(r.filter((x): x is string => x !== null))); });
    return () => { live = false; };
  }, [index]);
  return ids;
}
/** the clip after this one in match time, among those `keep` accepts (all without it); null after the last */
export function nextClipOf(index: ClipIndex | null, id: string, keep?: (c: ClipRow) => boolean): ClipRow | null {
  const list = [...(index?.clips ?? [])].filter((c) => c.id === id || !keep || keep(c)).sort(byMatchTime), i = list.findIndex((c) => c.id === id);
  return i < 0 ? list[0] ?? null : list[i + 1] ?? null;
}
/** the moment path of a loaded clip package */
export const momentOf = (pkg: ClipPkg) => clipAddr(pkg.meta.id, pkg.teams?.match ?? MATCH);
/** the clip on screen has a director script; null while it is being checked. Kept by the HUD */
export const explainable = store<boolean | null>(null);

/** the What-if clips approved for the release, each examined before it goes in: 26:40, the chip over the back line, and
 *  74:33's blocked shot. Add a clip here once it is approved. 48:14's offside is left out: the real man was offside,
 *  so it had one option */
export const WHATIF_APPROVED = new Set(['pass-26-40', 'shot-74-33', 'shot-17-30', 'shot-90-04']);   // + 17:28's lay-off and 90:10's cross
/** the clips the What-if mode is open on, and the replay plate tags: a moment in whatif/moments.ts (the What-if mode's
 *  list) that is approved (as Explain is open only where a script exists) */
export const WHATIF_CLIPS = new Set(MOMENTS.map((m) => m.clip).filter((c) => WHATIF_APPROVED.has(c)));
/** the clip on screen has a What-if moment. Kept by the HUD */
export const whatifable = store<boolean>(false);
