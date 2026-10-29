import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import { ScreenLab } from './three/stadium/screen/ScreenLab';

// the big-screen testbed: /screen.html on the workbench server
createRoot(document.getElementById('root')!).render(<ScreenLab />);
