import { useLayoutEffect, useRef } from 'react';
import hawkeye from './logos/hawk-eye.png?url';
import sony from './logos/sony-white.png?url';
import opta from './logos/opta.png?url';
import statsbomb from './logos/statsbomb.png?url';
import mixamo from './logos/mixamo.png?url';
import microsoft from './logos/microsoft.svg?url';
import openai from './logos/openai.svg?url';
import claude from './logos/claude.svg?url';
import grok from './logos/grok.svg?url';
import three from './logos/threedotjs.svg?url';
import react from './logos/react.svg?url';
import vite from './logos/vite.svg?url';
import './credits.css';

// The credits panel (TopBar's "i", left of the score bug): what the demo uses from others (data, models, papers,
// animation and voice, libraries, type), listed by name with the credit each asks for, not a tour of our own features.
// Yi, 2026-10-26: "we do not need these [3D replay, camera director], because it is developed by us", "we do not explain
// what it is, but just list what we use", "this is more like a credit page", then "let's add statsperform and sony ...
// so everyone can see immediately all the ingredients we have": each company's own logo, in its positive colours on a
// light tile. One tile per data source (Yi: Opta is Stats Perform's brand and Hawk-Eye a Sony company, so not four
// brands): Hawk-Eye with Sony's mark beside it in its tile (Yi, later the same day: "it would be better to show both
// logos"), and Opta's own "by Stats Perform" lockup. StatsBomb's logo is also
// the credit its open-data licence asks for (it trained the xG model). Logo
// sources: <private-workspace>; the full credits for the README in
// docs/plans/credits-draft.md. The release build leaves this folder out of its renaming of the data providers
// (vite.config.ts, scripts/release-scrub.json), so this is the one place that names them.

/** dark: the logo is made for a dark ground (Hawk-Eye's white lettering), so its tile is dark; parent: the owner
 *  company's mark, drawn beside the logo after a hairline */
/** label: the word beside a bare mark, inside its tile, as the brand's own lockup has it (no caption line under); h: the
 *  mark's height in px where its file's own margins or lettering would make it read smaller or larger than the rest */
interface Logo { src: string; alt: string; label?: string; dark?: boolean; h?: number }
interface Credit { name: string; by?: string; logo?: Logo }
/** every group's tiles one size, four to a row (credits.css; Yi, 2026-10-27: "make the widget the same size", then "make
 *  it one pager"); beside: the names to the right of the group's one tile, not under it */
interface Group { title: string; logos?: Logo[]; items?: Credit[]; beside?: boolean }

export const CREDITS: Group[] = [
  {
    title: 'Data',
    // StatsBomb beside them (Yi, 2026-10-27: "put Statsbomb logo at top, parallel to Opta, and sony"), the credit its
    // open-data licence asks for; Sony a brand of its own, not a mark inside Hawk-Eye's tile (Yi: "display SONY and
    // HAWKeye as two brands")
    logos: [{ src: hawkeye, alt: 'Hawk-Eye', dark: true, h: 30 }, { src: sony, alt: 'Sony', dark: true }, { src: opta, alt: 'Opta by Stats Perform' }, { src: statsbomb, alt: 'StatsBomb' }],
  },
  // what runs on Microsoft (Yi, 2026-10-27: "since now we are wired in microsoft"; docs/plans/microsoft-integration.md)
  {
    title: 'Microsoft',
    // its tile with the names only beside it (Yi, 2026-10-27: "simplify this just to make it Foundry, Agent Framework,
    // Azure AI Speech, and Static Web Apps", "put Microsoft icon widget back", "a regular title like other compartment")
    logos: [{ src: microsoft, alt: 'Microsoft' }],
    beside: true,
    items: [{ name: 'Foundry' }, { name: 'Agent Framework' }, { name: 'Azure AI Speech' }, { name: 'Static Web Apps' }],
  },
  // the AI that built it and writes the commentary (Yi, 2026-10-27: "for AI usage, we used codex, claude, and grok")
  // (Grok's file is its lockup already)
  { title: 'AI', logos: [{ src: openai, alt: 'OpenAI Codex', label: 'Codex' }, { src: claude, alt: 'Claude', label: 'Claude' }, { src: grok, alt: 'Grok', h: 19 }] },
  {
    title: 'Models',
    // (a paper named on its model's line, no list of papers; the passing network is project_kick's own design, Yi; each
    // on one line, Yi 2026-10-27)
    items: [
      { name: 'Pitch control', by: 'Fernández and Bornn (2018); Spearman (2018)' },
      { name: 'Pass probability', by: "distilled from Opta's xPass" },
      { name: 'Expected goals (xG)', by: 'trained on StatsBomb open data' },
      { name: 'Expected threat (xT)', by: 'Singh (2018), on StatsBomb open data' },
      // the What-if's own models, credited for the data they learnt from (private/response/README.md)
      { name: 'Player movement (What-if)', by: 'trained on Hawk-Eye tracking' },
      { name: 'Turnover risk (What-if)', by: 'fitted on Hawk-Eye tracking' },
    ],
  },
  // the voice is Azure AI Speech's now (Microsoft, above): Chatterbox and VoxCPM2 left; the animation beside the
  // libraries, one row of four
  {
    title: 'Animation and libraries',
    // the tiles only, React Three Fiber, drei and Framer Motion left to the README (Yi, 2026-10-27: "maybe drop these?
    // so the compartment looks cleaner")
    logos: [{ src: mixamo, alt: 'Mixamo' }, { src: three, alt: 'three.js', label: 'three.js' }, { src: react, alt: 'React', label: 'React' }, { src: vite, alt: 'Vite', label: 'Vite' }],
  },
  // each with what it sets (Yi, 2026-10-27: "we should say each font's function"; Inter at 400 and 600, Barlow Condensed
  // at 500 to 700, as main.tsx loads them; Jost the brand's, loaded where it draws)
  {
    title: 'Type and icons',
    items: [
      { name: 'Inter', by: 'the interface' },
      { name: 'Barlow Condensed', by: 'scores, numbers and titles' },
      { name: 'Jost', by: 'the kits, the boards and the big screen' },
      { name: 'flag-icons', by: "the players' flags" },
      // (the summary's ball and boot are SVG Repo's, CC0, so not named here: Yi, 2026-10-27, "so we do not leave
      // information about that in credit page at all"; MatchSummary.tsx SR_BALL, SR_SHOE)
    ],
  },
];

function LogoTile({ l }: { l: Logo }) {
  return (
    <figure className={`hud-logo${l.dark ? ' dark' : ''}${l.label ? ' lockup' : ''}`}>
      <span><img src={l.src} alt={l.alt} title={l.alt} style={l.h ? { height: l.h, maxHeight: 'none' } : undefined} />{l.label && <em aria-hidden="true">{l.label}</em>}</span>
    </figure>
  );
}

/** below this the panel scrolls rather than set its type any smaller */
const ZOOM_MIN = 0.8;

/** the panel scaled whole so its right edge meets the score bug's line between the away crest and the clock, clear of
 *  the match summary's panel (Yi, 2026-10-27: "shrink everything, so the credit widget is right aligned with the
 *  dividing line between WIL's icon and FT ... they won't block each other"); not on a phone's width, where the bar
 *  is laid out otherwise (hud.css) */
const PHONE_W = 720;
/** the panel's body, zoomed down to the window's height where it is short (Yi, 2026-10-27: "make it one pager"); the
 *  panel's own max-height (credits.css) stays as it is, so only the body under the title shrinks */
export function CreditsList() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const body = ref.current;
    const pop = body?.parentElement;
    if (!body || !pop) return;
    const fit = () => {
      const line = document.querySelector('.hud-bug .hud-clock')?.getBoundingClientRect().left;
      const z = line && innerWidth > PHONE_W ? Math.min(1, (line + 0.5 - pop.getBoundingClientRect().left) / pop.offsetWidth) : 1;
      pop.style.setProperty('--cr-z', String(z));
      body.style.zoom = '';
      const over = pop.scrollHeight - pop.clientHeight;
      const h = body.offsetHeight;
      body.style.zoom = over > 0 && h > 0 ? String(Math.max(ZOOM_MIN, (h - over) / h)) : '';
    };
    fit();
    document.fonts?.ready.then(fit);
    addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  }, []);
  return (
    <div className="hud-credits" ref={ref}>
      {CREDITS.map((g) => (
        <section key={g.title}>
          <p className="hud-credits-h">{g.title}</p>
          {g.logos && (
            <div className={g.beside ? 'hud-logos beside' : 'hud-logos'}>
              {g.logos.map((l) => <LogoTile key={l.alt} l={l} />)}
              {/* two to a line (Yi, 2026-10-27: "Azure AI Speech · Static Web Apps - make these one second line") */}
              {g.beside && g.items && (
                <p className="hud-credit-names">
                  {[g.items.slice(0, 2), g.items.slice(2)].map((line, i) => <span key={i}>{line.map((c) => c.name).join(' · ')}</span>)}
                </p>
              )}
            </div>
          )}
          {g.items && !g.beside && g.items.every((c) => !c.by && !c.logo) && <p className="hud-credit-names">{g.items.map((c) => c.name).join(' · ')}</p>}
          {g.items && !g.beside && !g.items.every((c) => !c.by && !c.logo) && (
            <ul className="hud-credit-list">
              {g.items.map((c) => (
                <li key={c.name}>
                  <b>{c.name}</b>{c.by && <span>{c.by}</span>}
                  {c.logo && <div className="hud-logos hud-logos-inline"><LogoTile l={c.logo} /></div>}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {/* what it is and why the data is sealed (Yi, 2026-10-27: "claim that this is a non profit presentation, and to
          protect our data provider's integrity of data, we encrypt the data, and make the team and names fictional") */}
      <p className="hud-credits-foot">Pitch Pilot is a non-commercial demonstration. To safeguard our data providers' data,
        all match data is encrypted and all team and player names are fictional.</p>
      {/* (no line on who made it, nor a link: Yi, 2026-10-27, "these are not credit") */}
    </div>
  );
}
