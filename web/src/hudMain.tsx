import { createRoot } from 'react-dom/client';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import './styles/hud.css';
import { HudPreview } from './hud/HudPreview';

// the HUD's preview page: /hud.html on the workbench server
createRoot(document.getElementById('root')!).render(<HudPreview />);
