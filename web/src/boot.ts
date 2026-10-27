// The loader's progress from the app (index.html's window.__boot; Yi, 2026-10-27: "a percentage thing, so we know it is
// responding"). Imported first in main.tsx, before the release's data shim, so the shim's fetches pass through here and
// their bytes count as they arrive (the encrypted bytes, before the shim opens them). 0.6 once the bundle runs; the match
// data from 0.6 to 0.9 by its bytes, against what the release measured the landing page to need (window.__bootMain.data,
// scripts/release.mjs) or, past that, what has been asked for; 0.9 when the data is in and the 3D build starts (GameApp);
// done at a view's first frames (three/BootFrame.tsx). After that nothing is counted.

interface Boot { at(p: number, words?: string): void; done(): void; fail(words?: string): void }
const W = (typeof window !== 'undefined' ? window : undefined) as unknown as { __boot?: Boot; __bootMain?: { data?: number } } | undefined;
const B = W?.__boot ?? null;
let over = false, building = false;

export const boot = {
  at: (p: number, words?: string) => { if (over) return; if (p >= 0.9) building = true; B?.at(p, words); },
  done: () => { if (over) return; over = true; B?.done(); },
};

if (B) {
  const expected = W?.__bootMain?.data ?? 0;
  B.at(0.6, 'Decrypting match data');
  const files: { got: number; of: number; in: boolean }[] = [];
  const report = () => {
    if (over || !files.length) return;
    let share: number;
    if (expected > 0) {
      const got = files.reduce((a, f) => a + f.got, 0), of = files.reduce((a, f) => a + Math.max(f.of, f.got), 0);
      share = got / Math.max(expected, of);
    } else share = files.reduce((a, f) => a + (f.in ? 1 : f.of > 0 ? Math.min(1, f.got / f.of) : 0), 0) / files.length;   // (dev: no measure, each file its share)
    B.at(0.6 + 0.3 * Math.min(1, share), building ? undefined : 'Decrypting match data');
  };
  const plain = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await plain(input, init);
    if (over || !res.ok || !res.body) return res;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!new URL(url, location.href).pathname.includes('/data/')) return res;
    // read a copy for the count, leaving the response itself to its reader
    const copy = res.clone().body;
    if (!copy) return res;
    const f = { got: 0, of: Number(res.headers.get('content-length')) || 0, in: false };
    files.push(f);
    const rd = copy.getReader();
    (async () => { try { for (;;) { const { done, value } = await rd.read(); if (done) break; f.got += value.length; report(); } } catch { /* the reader's own error is the app's */ } f.in = true; report(); })();
    return res;
  };
}
