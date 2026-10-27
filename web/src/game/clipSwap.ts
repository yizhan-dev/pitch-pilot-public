import { store } from '../hud/draft';

// A clip change in place (Yi, 2026-10-26: "let's try to do the loading without refreshing the entire browser ... animate
// to the bird view of the pitch, and show the loading animation, and once loaded, we put the camera back to the pitch, to
// the broadcast view"). GameApp drives it; the stage reads it every frame:
// - out: the camera rises to the top-down view, the grass turns over into the board (the Tactics mode's hexagons) and,
//   once it has, the board's hexagons pulse while the next clip loads; the old clip's players go under the board
// - in: the next clip is in; the board turns back into grass from the centre, its players come up with it, and the camera
//   comes down to the broadcast view; play starts as it lands

export type SwapPhase = 'off' | 'out' | 'in';
export const clipSwap = store<SwapPhase>('off');
/** the clip on its way in (its moment path, <match>/<id>), from the click until the change is over: the replay
 *  plate shows it as the clip at once (Yi, 2026-10-26: "show that this new clip is selected, instead of still showing the
 *  old clip"); null otherwise */
export const swapTarget = store<string | null>(null);
/** where the board stands, as Stage's TacticalFlip last drew it: p 0 grass .. 1 board (it takes 2.4 s to turn over),
 *  pulseT how long the loading pulse has run; cam the camera director's blend to its view, 0 .. 1 (Director.tsx). GameApp waits on these rather than on timers, so a slow frame rate only
 *  slows the change down, never cuts it short */
export const swapBoard = { p: 0, pulseT: 0, cam: 1 };
/** the least the loading pulse runs once the board is down, so a quick load still shows it: about one ring (seconds) */
export const SWAP_PULSE_S = 1.2;
/** resolves on the first frame `ok` holds */
export const until = (ok: () => boolean) => new Promise<void>((r) => { const f = () => (ok() ? r() : requestAnimationFrame(f)); f(); });
/** the next clip mounted under the board before it turns back: its players and layers are built while hidden, so the
 *  stall of building them falls on the still board rather than on the flip (seconds) */
export const SWAP_SETTLE_S = 0.25;
/** the camera's blend to and from the top-down view during a change, slower than a viewer's own change of view (0.8 s)
 *  so it reads as a flight up and back down (seconds) */
export const SWAP_BLEND_S = 1.6;
