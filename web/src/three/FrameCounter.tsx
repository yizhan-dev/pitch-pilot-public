import { useFrame } from '@react-three/fiber';

/** counts rendered frames on window.__frames, so the screenshot and clip scripts can wait for a settled picture */
export function FrameCounter() {
  useFrame(() => { (window as unknown as { __frames: number }).__frames = ((window as unknown as { __frames?: number }).__frames ?? 0) + 1; });
  return null;
}
