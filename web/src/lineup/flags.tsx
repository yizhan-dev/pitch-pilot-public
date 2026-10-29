import { tr } from '../i18n';
import al from './flags/al.svg?url';
import ar from './flags/ar.svg?url';
import br from './flags/br.svg?url';
import cn from './flags/cn.svg?url';
import dk from './flags/dk.svg?url';
import fr from './flags/fr.svg?url';
import gbEng from './flags/gb-eng.svg?url';
import gbSct from './flags/gb-sct.svg?url';
import gbWls from './flags/gb-wls.svg?url';
import hr from './flags/hr.svg?url';
import ie from './flags/ie.svg?url';
import nl from './flags/nl.svg?url';
import no from './flags/no.svg?url';
import pt from './flags/pt.svg?url';

// The line-up show's flags (each player's nationality beside his name). The squads
// read like the Premier League's (mostly British, the rest from Ireland, Norway, the Netherlands, France, Denmark,
// Portugal, Brazil); the earlier six stay for older rosters. The flags themselves are flag-icons' 4:3 SVGs (MIT, see
// ./flags/README.md; the hand-drawn ones, the Welsh dragon above all, were too simplified), by ISO 3166-1 code, or
// ISO 3166-2 for the home nations (gb-eng, gb-sct, gb-wls).

export const NATION_ZH: Record<string, string> = { cn: '中国', br: '巴西', ar: '阿根廷', hr: '克罗地亚', pt: '葡萄牙', al: '阿尔巴尼亚', 'gb-eng': '英格兰', 'gb-sct': '苏格兰', 'gb-wls': '威尔士', ie: '爱尔兰', no: '挪威', nl: '荷兰', fr: '法国', dk: '丹麦' };
export const NATION_EN: Record<string, string> = { cn: 'China', br: 'Brazil', ar: 'Argentina', hr: 'Croatia', pt: 'Portugal', al: 'Albania', 'gb-eng': 'England', 'gb-sct': 'Scotland', 'gb-wls': 'Wales', ie: 'Ireland', no: 'Norway', nl: 'Netherlands', fr: 'France', dk: 'Denmark' };
/** a nationality's name in the viewer's language */
export const nationName = (iso: string) => tr(NATION_ZH[iso] ?? iso, NATION_EN[iso] ?? iso);

const FLAG: Record<string, string> = { al, ar, br, cn, dk, fr, 'gb-eng': gbEng, 'gb-sct': gbSct, 'gb-wls': gbWls, hr, ie, nl, no, pt };

/** a flag (4:3), sized by the caller's CSS; nothing for a nation without one */
export function Flag({ iso, className }: { iso: string | null | undefined; className?: string }) {
  if (!iso || !FLAG[iso]) return null;
  return <img className={className} src={FLAG[iso]} alt={nationName(iso)} draggable={false} />;
}
