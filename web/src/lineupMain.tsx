import { matchFile, clipAddr } from './data/paths';
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import '@fontsource/inter/400.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
// the HUD's design tokens (glass, hairlines, the kit colours, the fonts), so the show's overlays match the game's
import './styles/tokens.css';
// the HUD's stylesheet, for its score bug the title docks into at the end (every rule in it is scoped to .hud)
import './styles/hud.css';
import { loadMoment, type Loaded } from './data';
import { LineupShow, type LineupFile } from './lineup/LineupShow';
import { ROSTER_FILE, type Roster } from './lineup/roster';

// /lineup.html: the pre-match line-up show's prototype (src/lineup/LineupShow.tsx); ?t=<s> holds a moment. The roster
// gives each player his one name and look (lineup/roster.ts); without it the show still plays, with invented looks.
function App() {
  const [data, setData] = useState<{ lineup: LineupFile; roster: Roster | null; kickoff: Loaded | null } | null>(null);
  useEffect(() => {
    Promise.all([
      fetch(matchFile('lineup.json')).then((r) => r.json()),
      fetch(ROSTER_FILE).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      // the kick-off clip, for the hand-off at the end (the teams stay staged without it)
      loadMoment(clipAddr('kickoff-00-00')).catch(() => null),
    ]).then(([lineup, roster, kickoff]) => setData({ lineup, roster, kickoff }));
  }, []);
  return data ? <LineupShow lineup={data.lineup} roster={data.roster} kickoff={data.kickoff} /> : null;
}
createRoot(document.getElementById('root')!).render(<App />);
