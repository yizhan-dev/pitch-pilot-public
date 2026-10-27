import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import { Sandbox } from './three/telestration/sandbox/Sandbox';

// the telestration sandbox: /tele.html on the workbench server (docs/research/telestration.md)
createRoot(document.getElementById('root')!).render(<Sandbox />);
