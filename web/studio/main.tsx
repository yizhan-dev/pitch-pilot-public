import { createRoot } from 'react-dom/client';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '../src/styles/tokens.css';
import './studio.css';
import { Studio } from './Studio';

createRoot(document.getElementById('root')!).render(<Studio />);
