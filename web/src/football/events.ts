// Event classifiers shared by every view, so the same Opta-style event types mean the same thing everywhere (the shot
// types had been listed separately in several files). Pure data: no React, no three.js.
// The HUD imports these; the other views' own copies (pause, explain, orchestrate, three) can move here as
// their owners touch them.

/** the synced event types that are shots */
export const SHOT_TYPES: ReadonlySet<string> = new Set(['MissedShots', 'SavedShot', 'Goal', 'ShotOnPost']);

export const isShot = (type: string) => SHOT_TYPES.has(type);
