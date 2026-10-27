// The release's data files (scripts/release.mjs): the tracking-derived ones are stored gzipped and encrypted (AES-GCM,
// "FWEZ", a 12-byte nonce, then the ciphertext and its tag). This is packaging, not a confidentiality boundary:
// the original browser deployment also receives the decryption capability. Every fetch under /data/ passes through here: a file the release lists as sealed (data/sealed.json) is
// decrypted and unzipped in the browser and handed on as the original file, so no loader changes; any other file is
// passed on untouched. In dev (no key) nothing is touched. Imported first, in main.tsx.

declare const __FWI_KA__: number[] | null;
declare const __FWI_KB__: number[] | null;

const KA = __FWI_KA__, KB = __FWI_KB__;
/** where the data lives: '/data/' in the source, rebased by the release build to the site's own ('/pitch-pilot/data/'),
 *  so every offset below is taken from this one string */
const DATA_DIR = '/data/';
let key: Promise<CryptoKey> | null = null;
const getKey = () => (key ??= crypto.subtle.importKey('raw', new Uint8Array(KA!.map((v, i) => v ^ KB![i])), 'AES-GCM', false, ['decrypt']));

/** a small JSON list beside the data, fetched once; a failed fetch is tried again next time rather than kept */
function list(plain: typeof fetch, url: string, field: string) {
  let p: Promise<Set<string> | null> | null = null;
  return () => (p ??= plain(url).then((r) => (r.ok ? r.json() : null)).then((j: Record<string, string[]> | null) => {
    if (!j?.[field]) { p = null; return null; }
    return new Set(j[field]);
  }).catch(() => { p = null; return null; }));
}

if (KA && KB && typeof window !== 'undefined') {
  const plain = window.fetch.bind(window);
  let sealed: (() => Promise<Set<string> | null>) | null = null;
  // the clips with a director script, per folder (director/index.json): a script asked for any other clip is answered
  // here as missing, without a request (the Explain loader asks for every clip; on Pages each would be a 404)
  const directed = new Map<string, () => Promise<Set<string> | null>>();
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, location.href).pathname, at = path.indexOf(DATA_DIR);
    if (at < 0) return plain(input, init);
    const dm = path.match(/^(.*\/director\/)([^/]+)\.json$/);
    if (dm && dm[2] !== 'index') {
      let d = directed.get(dm[1]);
      if (!d) { d = list(plain, `${dm[1]}index.json`, 'clips'); directed.set(dm[1], d); }
      const set = await d();
      if (set && !set.has(dm[2])) return new Response(null, { status: 404, statusText: 'Not Found' });
    }
    sealed ??= list(plain, `${path.slice(0, at)}${DATA_DIR}sealed.json`, 'files');
    const [res, set] = await Promise.all([plain(input, init), sealed()]);
    if (!res.ok || !set?.has(path.slice(at + DATA_DIR.length))) return res;
    if (!crypto.subtle) throw new Error('This page needs a secure (https) connection to open its data.');
    const body = new Uint8Array(await res.arrayBuffer());
    const zipped = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: body.subarray(4, 16) }, await getKey(), body.subarray(16));
    return new Response(new Blob([zipped]).stream().pipeThrough(new DecompressionStream('gzip')), {
      status: 200, headers: { 'content-type': res.headers.get('content-type') ?? 'application/octet-stream' },
    });
  };
}

export {};
