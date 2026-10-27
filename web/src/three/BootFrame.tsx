import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { boot } from '../boot';

/** the loader's end (index.html, src/boot.ts): its 100 at the second frame this view draws, so the fade shows a picture;
 *  in the game's view and the line-up show's, whichever draws first (with the show on, the game's waits off screen) */
export function BootFrame() {
  const n = useRef(0);
  useFrame(() => { if (++n.current === 2) boot.done(); });
  return null;
}
