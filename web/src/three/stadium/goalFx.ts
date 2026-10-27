// Goal reactions in the stadium (Yi, 2026-10-22: chose three of five, page review/goal-fx/). After a goal they spread
// out from the scored end:
// - a bright ring runs out through the crowd dots at 28 m/s, the dots turning white and swelling as it passes;
// - behind the ring the crowd jumps, most at the scoring end, for about nine seconds (both in Procedural.tsx's crowd
//   shader);
// - a bright pulse runs round the floodlight ring, then the lamps breathe once a second, fading by 6 s (glow.ts, driven
//   from Crystal.tsx).
// Not chosen: the crowd flooding to the scoring team's colour, and the LED ribbon and boards inverting in a chase (the
// mockups: <private-workspace>).
// ProceduralStadium writes GOAL_FX every frame from the clip's goal events (it is mounted with the clip's time and
// events); the floodlight ring reads it.

/** since: seconds since the latest goal (-1 when none in the last 12 s); x: the scored goal's x (three.js); team: the
 *  scoring team's name as the boards spell it */
export const GOAL_FX = { since: -1, x: 52.5, team: 'PELICANS', clock: 0, last: -Infinity };   // clock: the stadium's clock, s (the boards' banners run on it); last: the latest goal's time on it, any age
