// The options' trials off the main thread: up to three module workers (optionsWorker.ts), a pick's men dealt round
// them, each man's result back as it comes and the list closed when every worker has finished its share. Without a
// Worker (an old browser, a test runner) or when one fails, the caller runs the trials itself on the main thread, one
// man a task (useWhatIf.tsx). Built as data.ts's cleaner is (data/cleanWorker.ts).
import type { Scene0 } from './onball';
import { hooked } from '../dev';
import type { Tried } from './chain';
import type { DroppedTry } from './options';

/** `real`: the real receiver among `list` (model index): his pass is tried whatever comes of it (chain.ts tryPass, not
 *  gated as an option), the yardstick by his name */
export interface Job { id: number; c: Scene0; list: number[]; real: number | null; debug: boolean; flags: Record<string, unknown> }
export type Reply = { id: number; i: number; tried: Tried | null; dropped: DroppedTry | null } | { id: number; done: true } | { id: number; failed: true };
interface Waiting { left: number; one: (i: number, t: Tried | null, dd: DroppedTry | null) => void; done: () => void; fail: () => void }

/** three workers at most (the clean worker and the page itself want cores too), one on a two-core machine */
const N = Math.max(1, Math.min(3, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2) - 1));
let workers: Worker[] | null | undefined;
let seq = 0;
const jobs = new Map<number, Waiting>();

function poolOf(): Worker[] | null {
  if (workers !== undefined) return workers;
  try {
    if (typeof Worker === 'undefined') { workers = null; return null; }
    const ws = Array.from({ length: N }, () => new Worker(new URL('./optionsWorker.ts', import.meta.url), { type: 'module' }));
    const failAll = () => { const all = [...jobs.values()]; jobs.clear(); for (const w of ws) w.terminate(); workers = null; for (const j of all) j.fail(); };
    for (const w of ws) {
      w.onmessage = (e: MessageEvent<Reply>) => {
        const j = jobs.get(e.data.id);
        if (!j) return;   // cancelled: the pick moved on
        if ('failed' in e.data) { failAll(); return; }
        if ('done' in e.data) { if (--j.left === 0) { jobs.delete(e.data.id); j.done(); } return; }
        j.one(e.data.i, e.data.tried, e.data.dropped);
      };
      w.onerror = failAll;
    }
    workers = ws;
  } catch { workers = null; }
  return workers;
}

/** start the workers (and their model fetches) ahead of the first pick: the moment plays in for 3.5 s first */
export function warmOptions() { poolOf(); }

/** try the men in `list` (model indices) on the workers: `one` per man as his result comes (in no order), `done` once
 *  all are in, `fail` if the workers fall over (nothing of this pick came back then, the caller starts over on the main
 *  thread); null when there are no workers or no men. `cancel` drops the pick's late results. */
export function tryOptions(c: Scene0, list: number[], real: number | null, debug: boolean, one: Waiting['one'], done: Waiting['done'], fail: Waiting['fail']): { cancel: () => void } | null {
  const ws = poolOf();
  if (!ws || !list.length) return null;
  const id = ++seq, parts = ws.map(() => [] as number[]);
  list.forEach((i, k) => parts[k % parts.length].push(i));
  jobs.set(id, { left: parts.filter((p) => p.length).length, one, done, fail });
  // (the page's debug switches go along: a worker has its own globals)
  const flags: Record<string, unknown> = {};
  for (const f of ['wiForceLoft', 'wiHold'] as const) { const v = hooked(f); if (v !== undefined) flags[`__${f}`] = v; }
  ws.forEach((w, k) => { if (parts[k].length) w.postMessage({ id, c, list: parts[k], real, debug, flags } satisfies Job); });
  return { cancel: () => { jobs.delete(id); } };
}
