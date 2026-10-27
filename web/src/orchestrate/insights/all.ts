// Every insight detector of the library (catalogue.ts): the first batch (detect.ts) and the second (detect2.ts).
import { DETECTORS, runsIn, type Ctx } from './detect';
import { DETECTORS2 } from './detect2';
import type { Insight } from './types';

export { runsIn };
export type { Ctx };

/** every insight of the clip, by every detector; a detector that throws is skipped (logged) */
export function detectInsights(c: Ctx): Insight[] {
  const out: Insight[] = [];
  for (const d of [...Object.values(DETECTORS), ...Object.values(DETECTORS2)]) {
    try { out.push(...(d as (c: Ctx) => Insight[])(c)); } catch (e) { console.warn('insight detector failed', e); }
  }
  return out.sort((a, b) => a.t - b.t);
}
