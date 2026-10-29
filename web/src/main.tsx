import './boot';   // first: the loader's percentage counts the data's bytes as they come (index.html, src/boot.ts)
import { createRoot } from 'react-dom/client';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import './styles/app.css';
import { PublicSample } from './sample/PublicSample';

// The page is the game, in dev as in the release, with or without ?ui=game (old links keep it). The early
// prototype pages it used to open without it (the workbench, ?ui=full, ?ui=events) were removed with
// their data (docs/plans/data-restructure.md, "Legacy removed").
createRoot(document.getElementById('root')!).render(<PublicSample />);
