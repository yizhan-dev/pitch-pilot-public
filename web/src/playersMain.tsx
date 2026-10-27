import { createRoot } from 'react-dom/client';
import { PlayerViewer } from './three/players/Viewer';

// the cartoon players' look-book: /players.html on the workbench server
createRoot(document.getElementById('root')!).render(<PlayerViewer />);
