import { useFrame } from '@react-three/fiber';
import { hook, hooked } from '../dev';

/** counts rendered frames on window.__frames, so the screenshot and clip scripts can wait for a settled picture */
export function FrameCounter() {
  useFrame(() => { hook('frames', (hooked<number>('frames') ?? 0) + 1); });
  return null;
}
