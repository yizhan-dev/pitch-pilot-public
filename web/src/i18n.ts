// The language viewers see (English: the demo is presented to Microsoft). English by default; the
// Chinese is kept and comes back with ?lang=zh (read once at load: nothing switches it live). Every viewer-facing string
// is written as tr('中文', 'English'), side by side, so the two stay in step; data files carry *_en fields beside *_zh.
export type Lang = 'en' | 'zh';
export const LANG: Lang = typeof location !== 'undefined' && new URLSearchParams(location.search).get('lang') === 'zh' ? 'zh' : 'en';
// the page's language, for the stylesheets (:lang(en)) and the browser
if (typeof document !== 'undefined') document.documentElement.lang = LANG;
/** a viewer-facing string in the current language */
export const tr = (zh: string, en: string) => (LANG === 'zh' ? zh : en);
/** of a data record's two fields (e.g. title_zh / title_en), the current language's, else the other */
export const pick = (zh: string | null | undefined, en: string | null | undefined) => (LANG === 'zh' ? zh ?? en : en ?? zh) ?? '';
