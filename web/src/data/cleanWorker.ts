// The joints cleaned off the page (data/clean.ts, the same code): the clip's joint array comes in transferred, is
// cleaned in place and goes back transferred, with the counts.
import { cleanJoints } from './clean';

self.onmessage = (e: MessageEvent<{ id: number; names: string[]; frames: number; players: number; buf: ArrayBuffer }>) => {
  const { id, names, frames, players, buf } = e.data, data = new Float32Array(buf);
  const stats = cleanJoints({ names, frames, players, data });
  (self as unknown as Worker).postMessage({ id, buf: data.buffer, stats }, [data.buffer]);
};
