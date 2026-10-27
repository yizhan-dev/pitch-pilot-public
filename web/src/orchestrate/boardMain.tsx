// The orchestrator's board, http://127.0.0.1:5174/src/orchestrate/board.html (Board.tsx): the plan played as the
// narration would play it, with the debug view over it.
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import { Board } from './Board';

createRoot(document.getElementById('root')!).render(<Board />);
