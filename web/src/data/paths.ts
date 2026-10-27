/** The browser data layout. Addresses stored in the URL are logical clip IDs. */
export const DATA = '/data/';
export const MATCH = 'pel-wil';

const segment = (value: string) => {
  if (!value || value === '.' || value === '..' || /[\\/?#]/.test(value)) throw new Error(`Invalid data path segment: ${value}`);
  return value;
};
const relative = (value: string) => value.split('/').map(segment).join('/');

/** Accept existing bookmarks as well as the current <match>/<id> form. */
export function parseClip(addr: string): { match: string; id: string } {
  const parts = addr.replace(/\.json$/, '').split('/');
  if (parts[0] === 'clips') parts.shift();
  if (parts.length === 1) return { match: MATCH, id: segment(parts[0]) };
  if (parts.length !== 2) throw new Error(`Invalid clip address: ${addr}`);
  const match = parts[0] === 'legacy-match' ? MATCH : segment(parts[0]);
  return { match, id: segment(parts[1]) };
}
export const clipAddr = (id: string, match = MATCH) => `${segment(match)}/${segment(id.replace(/\.json$/, ''))}`;
export const matchFile = (name: string, match = MATCH) => `${DATA}matches/${segment(match)}/${relative(name)}`;
export function inMatch(rel: string, match = MATCH) {
  // Retained narration cues may still contain URLs written by older exporters.
  // Decode only a known match prefix; all output still uses this layout.
  const local = rel.replace(/^(?:\/[^/?#]+)*\/data\//, '');
  const old = local.match(/^(?:clips|matches)\/([^/]+)\/(.+)$/);
  if (old) {
    const sourceMatch = old[1] === 'legacy-match' ? MATCH : segment(old[1]);
    return matchFile(old[2], sourceMatch);
  }
  return matchFile(local, match);
}
export const clipFile = (addr: string, ext = '.json') => {
  const { match, id } = parseClip(addr);
  return matchFile(`clips/${id}${ext}`, match);
};
export const directorFile = (addr: string) => { const { match, id } = parseClip(addr); return matchFile(`director/${id}.json`, match); };
export const directorIndex = (match = MATCH) => matchFile('director/index.json', match);
export const modelFile = (name: string) => `${DATA}models/${relative(name)}`;
export const animFile = (name: string) => `${DATA}anim/${segment(name)}.json`;
export const assetFile = (rel: string) => `${DATA}assets/${relative(rel)}`;
