// The options' pass trials off the main thread, so the dark behind the what-if fades without a stall: on it, each man's
// trial (options.ts optionFor: four ways to pass to him, the resolver on each, his shot)
// took about 200 ms, nine men in a row, and the dark's 0.35 s fade (three/whatif/WhatIfScene.tsx Dim) was drawn in
// three frames, the pitch frozen in 200 ms steps for 1.7 s (measured: frame gaps of 223, 200, 183, 185, 185, 157 ms
// right after the pause; 17 ms before and after). Pure data in and out: the scene at the pause (onball.ts Scene0) and
// the men to try (model indices); back, one message per man with his Tried (chain.ts) or null, and when asked the pass
// tried for a man left out (window.__wiOptions), then one closing the list. The models are fetched once per worker
// (the browser's cache, the same files the page has). Built as data/cleanWorker.ts is (the same Vite form).
import { loadModels } from './onball';
import { loadXgModel, loadAerial } from './shot';
import { optionFor, droppedTry } from './options';
import { tryPass } from './chain';
import type { Job, Reply } from './optionsPool';

const ready = Promise.all([loadModels(), loadXgModel(), loadAerial()]);
const post = (r: Reply) => (self as unknown as Worker).postMessage(r);
self.onmessage = async (e: MessageEvent<Job>) => {
  const { id, c, list, real, debug, flags } = e.data;
  Object.assign(globalThis, flags);   // (the page's debug switches, chain.ts __wiForceLoft and onball.ts __wiHold, read here too)
  let M, xg;
  try { [M, xg] = await ready; } catch { post({ id, failed: true }); return; }
  for (const i of list) {
    // (a man whose trial throws is a man left out, not a list that never closes)
    try {
      const t = i === real ? tryPass(M, c, xg, i) : optionFor(M, c, xg, i);
      post({ id, i, tried: t, dropped: !t && debug ? droppedTry(M, c, xg, i) : null });
    } catch { post({ id, i, tried: null, dropped: null }); }
  }
  post({ id, done: true });
};
