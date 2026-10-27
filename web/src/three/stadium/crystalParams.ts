// Parameters of the clean crystal envelope (see Crystal.tsx). Kept apart from the component so edits hot-refresh in place.
export interface CrystalParams {
  cornerClear: number;  // the rounded corners stand this much further out, so their curve clears the stands behind them
  cutMain: number;      // corner cut on the main-stand side, 0..1 of the largest cut that clears the stands
  cutOther: number;     // corner cut on the far side
  low: number;          // eave height at the ends, metres
  rise: number;         // the long sides stand this much higher
  mainRise: number;     // the main side stands higher again
  skew: number;         // the two ends differ by this much
  lean: number;         // every face leans out by this angle, degrees
  mainLean: number;     // the main face leans out further, a canopy over the main entrance
  lift: number;         // the volume floats this high above the plaza
  podInset: number;     // the glazed base sits this far in under the volume
  inDrop: number;       // the opening's edge sits this far below the eave
  openA: number;        // (unused since the opening follows the plan; kept so older links still parse)
  openB: number;
  openN: number;
  openInset: number;    // the roof opening is the plan outline drawn in by this much, metres
  openR: number;        // the opening's corners round over this half-length, metres
  bowLong: number;      // the long sides bow out in plan by this much at mid-length, metres
  bowEnd: number;       // the goal ends bow out by this much
  skin: number;         // 0 = straight fins over dark glass, 1 = silver membrane, 2 = fins in front of the membrane
  finStep: number;      // metres between fins
  finDepth: number;
  finThick: number;     // fin thickness at the root, metres; it tapers to 70% at the outer edge
  finUp: number;        // how far the fins climb onto the eave shoulder: 0 = they stop where it starts, 1 = over the top
  smoothShell: number;  // 1 = the shoulder and the roof are one smooth skin, without the membrane lattice
  // one rhythm round the stadium, anchored on the three-seven point of the main face: depth and yaw share its phase
  finWave: number;      // depth swing, as a share of finDepth (0 = every fin the same)
  finWaves: number;     // waves round the stadium
  finYaw: number;       // the fins turn about their root line by up to this much between the crests, degrees
  groundStyle: number;  // the octagon ground: 0 granite slabs (v0), 1 plain light grey, 2 polished light grey, 3 light grey with rings that follow the octagon
  finMirror: number;    // 1 = fins and their rhythm mirror north and south (v1); 0 = one wave train round the loop (v0)
  // the YIZHAN mark, after the Allianz Arena: the signature on each long side at the three-seven point, the symbol on each end
  signStyle: number;    // 0 = no signs, otherwise on
  signWordPanel: number;   // 1 = the long sides' signature sits on a black panel; 0 = the white mark alone
  signSymbolPanel: number; // 1 = the goal ends' symbol sits on a black panel
  signCenter: number;   // 1 = the signature is centred on each long side; 0 = at the three-seven point
  signEnds: number;     // 1 = the symbol on the two goal-end facades as well
  signWordRise: number;   // the signature's height on its face: 0 = as low as fits above the base line, 1 = as high as fits under the eave roll
  signSymbolRise: number; // the symbol on the east end (+x): 0 = just above the lower rim, 1 = up the shoulder
  signSymbolRiseWest: number; // and on the west end
  legs: number;         // 0 = legs only at the corners; otherwise legs about this many metres apart all the way round
  legV: number;         // 1 = the legs stand in V pairs: one foot, two heads either side
  legStyle: number;     // 0 = raked legs from the foot of the glass; 1 = V legs under the overhang; 2 = tree columns;
                        // 3 = slender vertical colonnade; 4 = no legs, the volume floats; 5 = a few great piers
  legIn: number;        // feet stand this far in from the edge of the overhang, on their own footings
  podSlant: number;     // the glazed base leans in towards the ground by this much, metres
  // the ground: 1 = a stone plinth with steps all round, a paved plaza, pools and lamp posts; 0 = a plain apron
  landscape: number;
  deckH: number;        // plinth height, metres (steps of 0.3 m)
  deckOut: number;      // the deck runs this far beyond the building's outline before the steps start
  stepT: number;        // tread depth
  plazaW: number;       // width of the paved plaza beyond the steps, before it fades
  plaza: number;        // 1 = the paved plaza and lamp posts beyond the steps
  fountain: number;     // 1 = the reflecting pools and their jets
  stepLed: number;      // 1 = light strips under every step's nosing, washing the riser below
  ground: number;       // 1 = an octagonal granite ground parallel to the building's faces, with street lamps
  groundD: number;      // its edges stand this far outside the eave lines, metres
  lampStep: number;     // street lamp spacing along its edges
  // the curves: hard planes, soft edges
  fillet: number;       // the roofline's shoulders are rounded over this length, metres (0 = sharp trapezoid)
  crown: number;        // the long sides' eaves bow up by this much at mid-length
  archMain: number;     // the main face's bottom edge arches up by this much between its folds: the main entrance
  archLong: number;     // the far long face
  archEnd: number;      // the two ends
  archPow: number;      // arch shape: 1 = sine, smaller = fuller with steeper springing
  sag: number;          // the roof hangs between eave and opening like a tensile membrane, metres at its lowest
  eaveR: number;        // the eave rolls over from facade to roof on this radius, metres (0 = a sharp edge)
  cornerR: number;      // the eight folds blend round over this half-length, metres (0 = sharp folds)
  // three-seven: the main gesture sits off centre
  split: number;        // where the crest and the main arch peak along the length, from the west end (0.5 = centred)
  peak: number;         // the long sides' eaves rise this much at the split, falling away over the rest of the length
  tail: number;         // the east end's corner cuts, as a share of the west end's (1 = the same; smaller = a squarer tail)
  // diagonal corners: one diagonal pair rounded, the other sharp, so the plan turns on itself
  diag: number;         // 1 = diagonal mode (cutMain, cutOther, tail and cornerR then don't shape the corners)
  diagFlip: number;     // 0 = rounded at north-east and south-west; 1 = at north-west and south-east
  roundCut: number;     // corner cut of the rounded pair, 0..1
  sharpCut: number;     // corner cut of the sharp pair
  roundR: number;       // fold blend of the rounded pair, metres
  sharpR: number;       // fold blend of the sharp pair
  crestTwist: number;   // 1 = the far side's crest and arch peak from the east, turning the elevation with the plan
  eaveRSharp: number;   // eave radius at the sharp diagonal pair; the roll eases between the pairs round the stadium
  edgeHard: number;     // the line between the white volume and the glazed base: 0 = smooth S curve, 1 = straight runs and crisp folds
  edgeLed: number;      // 1 = a light line along that edge
  band: number;         // 1 = a black glass band runs round the roof between a white eave rim and a white ring at the opening
  rimW: number;         // white rim width along the eave, metres
  lipW: number;         // white ring width round the opening, metres
  bandColor: string;
  glow: number;
  faceColor: string;
  roofColor: string;
  ledColor: string;
  ledGain: number;
}
export const DEFAULT_CRYSTAL: CrystalParams = {
  cornerClear: 3, cutMain: 1, cutOther: 0.8, low: 31, rise: 7, mainRise: 3, skew: 2.5, lean: 5, mainLean: 0, lift: 8, podInset: 10,
  inDrop: 3, openA: 74, openB: 55, openN: 3.6, openInset: 28, openR: 14, bowLong: 4, bowEnd: 4, skin: 2, finStep: 1.6, finDepth: 1.3, finThick: 0.3, finUp: 1, smoothShell: 0, finWave: 0.45, finWaves: 3, finYaw: 22, finMirror: 0, groundStyle: 0, signStyle: 1, signWordPanel: 0, signSymbolPanel: 0, signCenter: 1, signEnds: 1, signWordRise: 0.72, signSymbolRise: 0.32, signSymbolRiseWest: 0.4, legs: 18, legV: 1, legStyle: 1, legIn: 3.5, podSlant: 0, landscape: 1, deckH: 1.8, deckOut: 5, stepT: 0.8, plazaW: 55, plaza: 0, fountain: 0, stepLed: 1, ground: 1, groundD: 42, lampStep: 18,
  fillet: 34, crown: 0, archMain: 9, archLong: 6, archEnd: 5, archPow: 0.75, sag: 0, eaveR: 10, cornerR: 12, split: 0.3, peak: 3, tail: 0.45, diag: 1, diagFlip: 0, roundCut: 1, sharpCut: 1, roundR: 22, sharpR: 22, crestTwist: 0, eaveRSharp: 10, edgeHard: 1, edgeLed: 1, band: 0, rimW: 8, lipW: 7, bandColor: '#11151b',
  glow: 0.85, faceColor: '#dfe4ea', roofColor: '#e9edf1', ledColor: '#73d9ff', ledGain: 0,   // cyan light lines off (Yi, 2026-10-21)
};

import v0File from './stadium-v0.json';
/** Stadium exterior v0, fixed by Yi on 2026-10-21; kept unchanged. Studio work on DEFAULT_CRYSTAL never changes it. Missing keys (parameters added after v0) fall back to DEFAULT_CRYSTAL. */
export const STADIUM_V0: CrystalParams = { ...DEFAULT_CRYSTAL, ...(v0File.crystal as Partial<CrystalParams>) };

import v1File from './stadium-v1.json';
/** Stadium exterior v1, 2026-10-21: v0 made symmetric north and south on the lower far-side arch (archMain = archLong,
 *  no extra main-stand rise). The full stadium renders STADIUM_CURRENT. */
export const STADIUM_V1: CrystalParams = { ...DEFAULT_CRYSTAL, ...(v1File.crystal as Partial<CrystalParams>) };
export const STADIUM_CURRENT = STADIUM_V1;
