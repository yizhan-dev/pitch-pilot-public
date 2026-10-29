// The telestration style: every value a parameter with a good default (pitch_prism's rule: "we design defaults, the
// user customises"). Metric values are pitch_prism's locked ratios at its metric ring radius, R = 0.8 m
// (docs/research/telestration.md, section 1). Mutable on purpose: the sandbox's sliders write into it and the
// renderer reads it every frame.
import type { ViewMode } from '../../game/settings';
import { KIT, roleTeam, type Team } from '../coords';
import type { MarkRule } from './marking';

/** a value for each surface: the grass, and the dark board of the tactical mode; blended by the pitch's mode progress */
export interface Pair<T> { grass: T; board: T }

export type Colour = 'amber' | 'white' | 'blue';
/** a meaning colour, or the player's team colour */
export type Ink = Colour | 'team';
export type TeamMode = 'kit' | 'lift' | 'layers' | 'mix';
export type PointerShape = 'tri' | 'barb' | 'chev';
export type BallMode = 'shadow' | 'drop' | 'plain';
export type ReadoutMode = 'off' | 'speed';
export type SparkStyle = 'burst' | 'weld' | 'dust' | 'flow' | 'ripple';
export type MarkStyle = 'rings' | 'tether' | 'capsule' | 'dumbbell' | 'guard' | 'pool' | 'line' | 'hoops';
export type MarkGrad = 'none' | 'lab' | 'hue';
/** the Tactics pen's tools and inks (hud/draft.ts Tool and Ink) */
export type StrokeTool = 'pass' | 'run' | 'dribble' | 'circle' | 'zone' | 'pen' | 'measure';
export type StrokeInk = 'white' | 'blue' | 'orange' | 'yellow';
export type MarkAnim = 'stretch' | 'snap' | 'merge' | 'lasso' | 'embrace' | 'sonar' | 'fade';
export type UnitLook = 'full' | 'plain' | 'minimal';
export type ZoneAnim = 'corners' | 'scan' | 'unfold' | 'trace' | 'glint';

export const TELE = {
  /** the meaning colours: amber is a player, white is the ball, blue is anything else. Blue is pitch_prism's #2f8bff
   *  lifted to amber's luminance: #2f8bff measured 1.1:1 against the light mowing bands, #8fd0ff matches amber's
   *  contrast on both bands and the board (research doc, section 4.9) */
  color: {
    amber: { grass: '#fbbf24', board: '#fbbf24' } as Pair<string>,
    white: { grass: '#ffffff', board: '#e6e9ee' } as Pair<string>,
    blue: { grass: '#8fd0ff', board: '#8fd0ff' } as Pair<string>,
  } as Record<Colour, Pair<string>>,
  /** light marks never draw thinner than this across their own edge, in pixels; paint fades instead */
  minPx: 1.5,
  /** the digital layer's halo. pitch_prism blurred the ink at alpha 0.20 with sigma 0.17 R; a blurred thin line is about
   *  half strength at its edge, so the analytic halo starts at 0.10 there and falls off with the same sigma */
  glow: { strength: 0.1, sigma: 0.136, minPx: 2, gain: { grass: 1, board: 0.6 } as Pair<number> },
  /** every metric size times this, per view: the top-down view is far and flat, the eyes are close */
  viewGain: { broadcast: 1, free: 1, tactical: 1.25, referee: 1, ar1: 1, ar2: 1, first: 0.8, third: 1 } as Record<ViewMode, number>,   // tactical 1.25: tuned by eye in the sandbox
  /** the selected player's ring (tier 1): pitch_prism's locked double ring (outer band 7.5/24 R, inner ring at 15/24 R,
   *  ten dashed arcs painted 11.16/15.08 of each period), as tuned in the sandbox: about 19% larger
   *  (R 0.80 to 0.95 m, outer band 0.25 to 0.29, inner ring 0.50 to 0.60), the inner band kept at 0.167 m, a turn every
   *  20 s instead of 5. The inner ring takes the player's team colour, the outer stays white */
  ring: { R: 0.95, outerW: 0.29, innerR: 0.6, innerW: 0.167, arcs: 10, dashFill: 11.16 / 15.08, spinS: 20, outer: 'white' as Ink, inner: 'team' as Ink },
  /** the team colour (the keepers carry their side's colour, not their own kit). Of three versions compared on grass
   *  and board (r3-team-sheet.png), the display layers' team colours read best: the shirts' hues a step lighter
   *  (#62b0ff, #ff8a4c, as GameLayers' trails; 1.6:1 on the light mowing bands against the kit's 1.0:1).
   *  The others stay selectable: the kit as it is, and the kit lifted to amber's luminance. 'mix' sits between the
   *  lifted and the layers' colours: mixW 0 = the layers' colours, 1 = lifted; at
   *  0.25 (r4-mix-sheet.png): attack #6ab8ff, defence #ff9560 */
  team: { mode: 'mix' as TeamMode, mixW: 0.25, kit: { att: KIT.att.shirt, def: KIT.def.shirt }, layers: { att: '#62b0ff', def: '#ff8a4c' } },
  /** the hover cue (HoverPointer.tsx): A, the triangle (r5-ptr-sheet.png), but smaller in the broadcast
   *  view: it is sized in metres like the stamina bar, so it shrinks with distance like the player, held between
   *  sizeMin and sizeVH of the view's height (the near views slightly bigger than the old 0.01125, so 0.0145). The lift of its centre
   *  over the head and the bob are in half-sizes, as the old HoverMarker's (0.15 to 0.4 of its sprite, 6 rad/s) */
  /** the name over the pointer, as in a video game: its
   *  cap height `nameK` times the triangle's half-size, never under `nameMinVH` nor over `nameMaxVH` of the view's
   *  height (readable at broadcast distance), `nameGap` half-sizes above the triangle's top, at least `nameGapVH` of
   *  the view's height */
  pointer: { shape: 'tri' as PointerShape, halfM: 0.22, sizeMin: 0.0055, sizeVH: 0.0145, lift: 1.73, bob: 0.67, bobHz: 0.955, color: 'white' as Colour, shadow: 0.45, shadowSigma: 0.28,
    nameK: 1.7, nameMinVH: 0.016, nameMaxVH: 0.026, nameGap: 1.0, nameGapVH: 0.005,
    /** over a player the Show layer tags: the gap from the tag's top to the cue's tip, pixels (the name centred between
     *  the stamina bar and the tip), and the bob there, pixels */
    tagGapPx: 4.5, tagBobPx: 2,
    /** the head's stack, in design (sized so the tag is not too small beside the triangle): the name `stackName` px,
     *  the bar `stackBarW` x `stackBarH` px `stackRow` px under it (one length for everyone: a gauge; when it followed
     *  the name's width, one man's stamina bar ran longer than another's for no reason), the
     *  tag `stackGap` px over the head's top, the cue's half-size `stackTri` px (its height about the name's capitals,
     *  so the two balance); all scaled together by stackScale(depth): 1 beyond `stackFar` m, nearer
     *  growing as `stackGrow` of the player's own growth on screen ((stackFar / depth) ^ stackGrow), at most `stackMax`
     *  (a player closer to the camera gets slightly bigger bars, gaps and text; it was 1 to 1.3 between 35 and 12 m).
     *  Used by the cue's 'stack-noname' and 'under' modes, the
     *  Show layer's tag (ShowLayer.tsx) and the sandbox's */
    stackName: 16, stackBarW: 44, stackBarH: 4, stackRow: 4, stackGap: 6, stackTri: 6.5, stackFar: 35, stackGrow: 0.35, stackMax: 1.7,
    /** what the cue does over a tagged player (one standard for the head's stack, the rest as options):
     *  'stack' on top of the tag with its own name, 'stack-noname' on top without its name (the tag has it),
     *  'none' at the head as if untagged, without its name (the tag moves up over it instead), 'hide' none (the tag
     *  marks him itself), 'under' its tip at the tag's foot and the tag over it, in pixels (eFootball's way; V4, the
     *  default since the Show layer's tag) */
    tagged: 'under' as 'stack' | 'stack-noname' | 'none' | 'hide' | 'under' },
  /** the ball's trace (BallTrace.tsx): the last `seconds` of its flight, `half` metres wide at the ball (the ball's
   *  radius is 0.11) tapering to `taper` of it, fading as f^fade to the old end and over `headGap` s behind the ball;
   *  a halo of `glowPx` pixels; while the ball is over `shadowFrom` m, a soft shadow on the grass below it. The default
   *  is the trace alone ('plain', r8-ball-variants.png), with the read-out as an option (below) */
  /** `look` (flat on the grass while the ball rolls, a constant-width ribbon in the air, never
   *  over the ball): 'comet' the first trace; 'track' the default (B without the ground track, r62); the others in
   *  BallTrace.tsx */
  /** `groundMinPx`, `groundFlatMin`: the ribbon on the grass far away (it had thinned to a pitch line):
   *  never under that many pixels across, and far away widened to keep that share of the width it would show turned
   *  to the view (none within 35 m of the camera, so the near side is unchanged; all of it from 70 m; 0 turns it off) */
  ball: { look: 'track' as string, groundMinPx: 3, groundFlatMin: 0.85, mode: 'plain' as BallMode, seconds: 1.2, half: 0.09, taper: 0.25, alpha: 0.85, fade: 1.3, headGap: 0.05, glowPx: 2.5, glow: 0.3, shadowFrom: 0.3, shadowHalf: 0.16, shadowAlpha: 0.32, cutS: 0.15 },
  /** the ball's speed (BallReadout.tsx; an option, for the shots; the height was tried and dropped): held at its
   *  peak for holdS s; shown above minKmh; the number numPx pixels tall with its unit at unitRatio (pitch_prism's trace
   *  label: 0.47), offsetPx right and up of the ball */
  /** the ball's speed read-out: off (messy; usable only under a camera that keeps the ball at
   *  the centre of the frame) */
  readout: { mode: 'off' as ReadoutMode, holdS: 1.0, minKmh: 15, numPx: 30, unitRatio: 0.47, offsetPx: [18, 8] as [number, number] },
  /** a side's units (back line, midfield, front line): every member carries the selected player's double ring (no
   *  second ring design), joined across the pitch by lines in the team colour welded to the inner ring,
   *  `lineW` wide (pitch_prism's measured edge: 0.29 of the outer radius); the gaps between the units in metres lying
   *  on the pitch (paint, `labelM` tall). `look` ('full' was too fancy beside the other, more
   *  minimal styles): 'full' the first version (the double ring popping in one by one, welding sparks); 'plain'
   *  the same without the sparks (the default, A, r54); 'minimal' one solid ring in the team colour on each member (the inner ring, no
   *  white spinning dashes), all fading in together, then the lines drawn from both ends, no sparks */
  unit: { look: 'plain' as UnitLook, lineW: 0.29 * 0.95, labels: true, labelM: 1.3, labelAlpha: 0.86, fadeS: 0.3 },
  /** sparks at the growing tips of the lines while they draw in, for a livelier entrance: one spark every
   *  `dt` s from each tip, living `life` s, thrown sideways (`spread` m/s), back from the tip's motion (`back`) and up
   *  (`upMin`..`upMax`), falling at `gravity`; a bright point on each tip; a burst of `burst` where the halves meet.
   *  The team colour mixed towards white by `hot`.
   *  These values are the louder of the first two variants (B: denser, bigger, wider); more directions followed:
   *  `style` 'burst' | 'weld' | 'dust' | 'flow' | 'ripple' (Telestration.tsx, lineSparks); 'weld' is the default, welding
   *  sparks, short bright streaks that bounce once (r14-effects-compare.mp4) */
  spark: { on: true, style: 'weld' as SparkStyle, dt: 0.01, life: 0.45, spread: 2.2, back: 0.8, upMin: 0.6, upMax: 2.6, gravity: 5, sizePx: 5, alpha: 0.9, hot: 0.55, tipPx: 14, tipAlpha: 0.95, burst: 40, burstSpeed: 3.5, burstLife: 0.55 },
  /** the passing network at a pause (network.ts): the carrier's options in white (the ball), half-width minHW..maxHW and
   *  opacity minA..1 by the chance, drawn out best first `stagger` s apart; the best `labelTop` with their percentages
   *  (`labelM` tall, `labelOff` m beside the line); options under `minP` are not drawn; the support links between
   *  neighbours, faint. As set: the best `top` options only (5), no percentages (the lines cover them), no
   *  support links, no arrowheads; rings on the carrier and the shown receivers only */
  /** marking links (who is tracking whom): a dashed line in the markers' team colour, drawn out from
   *  each marker to his man, `hw` half-width, dashes `dashM` long with `fill` painted, marching towards the man at
   *  `march` m/s; the links one after another `stagger` s apart. `rule`: 'engine' (mutual nearest within `maxM` m, the
   *  response engine's own pairs) or 'tracking' (who copied whose movement over the last `windowS` s; marking.ts).
   *  `style`, the first three: 'rings' (the double ring on both men, the dashed line between), 'tether' (the
   *  dashed line alone, foot to foot, cut `footR` m from each man), 'capsule' (an outline of radius `capR` round the
   *  pair, stretching out from the marker to take in his man, a faint wash inside) */
  /** `grad` (the blue side's end bluish, turning orange towards the other): the capsule's
   *  colour from the marker's team at his end to his man's team at the other; 'none' one colour (the marker's), 'lab'
   *  straight through OKLab (greys in the middle: the two are complementary; the default, A, r56), 'hue' round the hue
   *  circle the short way (blue, violet, pink, orange) */
  mark: { style: 'hoops' as MarkStyle, grad: 'lab' as MarkGrad, footR: 0.45, capR: 1.0, capHW: 0.07, capWash: 0.14,
    /** the capsule's entrance (six to choose from, ground.ts kind 7; 'merge': a circle
     *  under each man, liquid tendrils from both fuse into the capsule; r24-mark-anims.mp4) and its seconds; `pulse`: a
     *  soft wave of light running from the marker to his man every `pulseS` s once it is in, crossing in `pulseCrossS`.
     *  The default is 'fade', the whole capsule fading in: the animated entrances were too much. */
    anim: 'fade' as MarkAnim, durS: { stretch: 0.8, snap: 1.0, merge: 1.1, lasso: 1.1, embrace: 1.1, sonar: 1.0, fade: 0.4 } as Record<MarkAnim, number>,
    /** the plainer styles, all fading in, no glow:
     *  'dumbbell' a slim line (`lineHW`) between dots (`dotR`) under both men; 'guard' an arc (`guardR`, `guardHW`,
     *  `guardDeg` either side) round his man on the marker's side in the marker's colour, a slim line from the marker
     *  (cut `footR` from his feet) fading towards it; 'pool' a soft filled capsule (radius `capR`, `poolA` at its core),
     *  no outline; 'line' the slim line alone, cut `footR` from both men; 'hoops' a thin plain ring (`hoopR`, the line's
     *  width) under each man in his team colour, the line between them (the default, F in r78) */
    dotR: 0.42, hoopR: 0.55, lineHW: 0.08, guardR: 0.62, guardHW: 0.09, guardDeg: 70, poolA: 0.45,
    pulse: false, pulseS: 2.4, pulseCrossS: 1.0, rule: 'engine' as MarkRule, maxM: 12, windowS: 3, hw: 0.1, dashM: 0.9, fill: 0.55, march: 0.6, stagger: 0.05, labels: false, labelM: 1.3, labelOff: 1.0, looseA: 0.45 },
  /** the passing network; `sparks`: the welding sparks at the lines' growing tips (off:
   *  simplified as the units were) */
  net: { sparks: false, top: 5, support: false, minHW: 0.03, maxHW: 0.14, minA: 0.25, minP: 0.1, stagger: 0.06, labelTop: 0, labelM: 1.5, labelOff: 1.2, supportHW: 0.03, supportA: 0.3 },
  /** the pass chances (Tactics' passing mark: the chance a pass to each team-mate is
   *  completed, a link to every one), four looks: 'width' white links, wider and brighter the surer, no numbers;
   *  'mid' even links, the chance lying on the link `midAt` of the way out; 'feet' links by width, the chance on the
   *  grass `feetOff` m from the team-mate towards the camera; 'ramp' the links and numbers on the traffic ramp (the
   *  speed trail's) from `rampLo` (red) to `rampHi` (green). Links `minHW`..`maxHW` half-wide (`midHW` even), cut
   *  `endR` m short of the team-mate, drawn out best first `stagger` s apart; an offside team-mate gets no link, an amber
   *  ring `offR` m (band `offW`), no number. Numbers `labelM` m tall, never "100%". The numbers sit in
   *  the head's stack instead (chanceColour, the Show tag), so the links are 'width' and the grass carries none;
   *  'width' is the passing network's look (TELE.net's widths, the double ring on every team-mate), so the two marks
   *  read as one family */
  passProb: { look: 'width' as 'width' | 'mid' | 'feet' | 'ramp', minHW: 0.035, maxHW: 0.15, midHW: 0.06, minA: 0.3, endR: 0.7, stagger: 0.04,
    midAt: 0.6, midOff: 0.9, feetOff: 1.6, labelM: 1.3, rampLo: 0.5, rampHi: 0.95, offR: 0.8, offW: 0.12,
    /** the chance in the head's stack, over each player like his name tag, light cyan to red
     *  (chanceColour): red `headRed` at or under `headLo`, light cyan `headCyan` at or over `headHi`;
     *  `headPath` 'hue' round the hue circle the warm way (red, orange, yellow, green, cyan) or 'lab' straight (greys
     *  between) */
    headLo: 0.35, headHi: 0.9, headRed: '#ff5a5f', headCyan: '#8ff0ff', headPath: 'hue' as 'hue' | 'lab',
    /** the 'width' links' colour: the carrier's team colour (as the units' and the hull's lines; their
     *  double rings as everywhere, team colour inside) or 'white' (the passing network's) */
    ink: 'team' as 'team' | 'white' },
  /** a number on the pitch (for narration such as "the Pelicans controlled about 30% of the spot ... Now, 98%";
   *  a plain ring with "98%" looked shabby, hence the looks, GaugeItem): 'ring' a gauge band `bandW`
   *  wide, radius `r`, filling clockwise from the screen's top in the team colour over a faint track, the number at its
   *  centre; 'target' the selected player's double ring `targetK` times its size on the spot, the number beside it;
   *  'pie' a sector filling the disc (`pieA`) over a faint disc, a thin edge, the number at its centre (the default is
   *  'ring'). The number `labelM` m tall. Entrance (render time; a growing circle): the track
   *  fades in over `trackS` s as the gauge grows from `startK` of its size; after `delayS` (the item's own, else
   *  `growDelayS`) the arc grows from nothing to `from` over `growS` s, the number counting with it; it holds there
   *  `holdS` s (the item's), then grows on to the value over `countS` s. Without `from` it grows straight to the value.
   *  The arc's colour is the share's (orange-ish at 30%, turning blue as the
   *  share grows): the other team's colour up to `colourLo`, the side's from `colourHi`, round the hue circle
   *  between (`colourPath` 'hue'; 'lab' straight, greyer in the middle) */
  gauge: { look: 'ring' as 'ring' | 'target' | 'pie', r: 3.2, bandW: 0.55, trackA: 0.22, pieA: 0.55, labelM: 2.4, targetK: 2.2,
    trackS: 0.3, startK: 0.9, growDelayS: 0.3, growS: 0.7, countS: 1.6, colourLo: 0.25, colourHi: 0.9, colourPath: 'hue' as 'hue' | 'lab' },
  /** a zone (a drawing tool for any zone, the orchestrator decides which; the lanes became zones): the matte
   *  zebra (`stripeW` m stripes, alpha by surface) inside a glowing outline (`outlineHW` half-width) with square corners;
   *  the paint arrives over `paintS` s after the outline. `bounds`: the five lanes' edges across the pitch (|y| 9.16 and
   *  20.16 m, the boxes' edges; research doc 3.3), left to right facing the attack */
  zone: { bounds: [-34, -20.16, -9.16, 9.16, 20.16, 34], outlineHW: 0.09, stripeW: 0.68, zebra: { grass: 0.52, board: 0.4 } as Pair<number>, paintS: 0.6,
    /** the entrance (not the lines' corners-and-sparks again, or the eye tires): 'corners' | 'scan' | 'unfold' | 'trace' |
     *  'glint'; 'unfold' is the default (a line along the middle stretches out, then opens into the box; r21-zone-anims.mp4) */
    anim: 'unfold' as ZoneAnim, durS: { corners: 1.0, scan: 0.9, unfold: 0.9, trace: 1.3, glint: 1.0 } as Record<ZoneAnim, number>, exitS: 0.35,
    /** the look (the hull's look, and a zoom in instead of a drawing entrance, which is slow): 'rings', a double ring
     *  on every corner, welded lines along the
     *  edges, the zebra inside with the rings cut out, the whole zone zooming in from its centre on the ring's own curve;
     *  'lines' (the rings mean a player, and a zone's corners are none): the same zoom and stripes,
     *  the edges a solid line of the units' width, no rings; 'outline', the first version (glowing outline, entrance `anim`). Drawn zones only: a pocket (made by the players'
     *  lines) always keeps the outline and its unfold */
    look: 'lines' as 'lines' | 'rings' | 'outline',
    /** a preset's name on the pitch (ZONE 14, HALF-SPACE), metres high; Latin only: the ground labels' face has no CJK */
    labelM: 2.2,
    /** a pocket's sides stand this far off the two unit lines, metres along the pitch (0: on the lines) */
    pocketInset: 0 },
  /** pitch control, restyled (ControlLayer.tsx): the wash's strongest alpha by surface, shown where control is
   *  sure: alpha x margin^`bandM`, the margin |v - 0.5| x 2 (the whole pitch, faint only where it is
   *  contested; a contested-only wash left each side's own ground blank); `line`
   *  the 0.5 frontier as a line of light (off: no white dividing line), its
   *  half-width (m) and its glow; the ring spreading from the ball over `revealS` s; the grid recomputed every
   *  `everyS` s while the clock runs */
  control: { line: false, washA: { grass: 0.5, board: 0.42 } as Pair<number>, bandM: 0.7, lineHW: 0.05, glow: 0.35, glowM: 0.25, revealS: 0.9, everyS: 0.33 },
  /** a player's vision: where his head points (nose from between his ears), his central view within
   *  `centralDeg` and his peripheral view to `peripheralDeg` either side (the decision lab's own assumption), everything
   *  beyond darkened by `darkBack` (behind him) and `darkPeri` (peripheral) through every scene material (visionDim.ts);
   *  the two central edges drawn on the grass out to `edgeM` m, fading, if `edges` (off: the white
   *  lines looked bad); the darkness opens from behind him over `openS` s */
  /** `anim` (as if the view came out of his head): 'open' the darkness opening from behind
   *  him (`openS`); 'eyes' the scene dims (`dimS`), then his sight spreads out from his eyes to `revealM` m over
   *  `revealS` s from `revealAt`, a bright band (`wash`) at its front; `beam`: a faint fan of light from his eyes down to
   *  the grass (`beamA`, landing `beamLandM` m out, `beamLenM` long) */
  vision: { centralDeg: 60, peripheralDeg: 100, darkBack: 0.62, darkPeri: 0.3, keepM: 1.2, edges: false, edgeM: 22, edgeHW: 0.05, openS: 0.6,
    anim: 'open' as 'open' | 'eyes', dimS: 0.35, revealAt: 0.3, revealS: 1.6, revealM: 75, wash: 0.22, beam: false, beamA: 0.4, beamLandM: 12, beamLenM: 26 },
  /** a line-breaking pass (research doc 6): the defending units at the kick, the ones Opta says the pass broke at full
   *  strength and the others at `dimA`; as the ball crosses a broken line it flashes white (`flashS` s) with a burst of
   *  sparks at the crossing and opens a `gapM` m crack there; the count ("2 LINES BROKEN") lies on the pitch by the
   *  receiver, `labelM` m high */
  linebreak: { dimA: 0.4, flashS: 0.35, gapM: 1.6, gapS: 0.3, burst: 36, labelM: 1.9 },
  /** the speed trail (pitch_prism's locked trace, freeze/trace.py): the last `tailS` s of a player's hips as a comet
   *  tail on the grass, `coreHalf` m half-wide at the head (pitch_prism's 0.085 m is 5 px at its video's 30 px/m, one
   *  or two pixels in our broadcast view, so widened to the unit lines' width) over a soft `glowHalf` m glow at
   *  `glowA`, and under both a soft dark shadow `shadowHalf` m at `shadowA` so its colours read on the grass (the ramp's
   *  green on green had no contrast), tapering to 10% and fading towards the old end as frac^`fadePow` (pitch_prism's 2
   *  left the older half invisible on grass), on the grass the ramp lifted to amber's luminance (`liftGrass`), and
   *  fading as frac^2 towards the old end and over the last `feetFade` share at his feet; each point coloured by his
   *  speed there on the traffic ramp (slow red, amber, fast green at `speedMax` m/s). The read-out (SpeedTags.tsx): the
   *  number `numM` m high (0.88 of a `playerH` m player, pitch_prism's 58 px to 66 px), held between `minPx` and `maxPx`
   *  on screen. The tail grows out behind him over `growS` s and drains to leave */
  trail: { tailS: 1.5, coreHalf: 0.2, glowHalf: 0.38, glowA: 0.3, shadowHalf: 0.55, shadowA: 0.3, fadePow: 1.0, liftGrass: true, feetFade: 0.2, speedMax: 9, ramp: ['#ef3b5b', '#fbbf24', '#22c55e'] as [string, string, string],
    label: true, numM: 1.58, unitRatio: 0.47, playerH: 1.8, minPx: 22, maxPx: 96, growS: 0.5 },
  /** the running direction (the pressure's first animation, its ripple and its chevron stack, suits a
   *  player's run): ripples in his team colour spreading from his feet to `rippleR` m and fading out completely over
   *  `rippleS` s (`rings` of them, `gapS` apart), then TELE.press's chevrons drawn from his feet towards where he is
   *  `aheadS` s later, at most `lenM` m long (kept short), flowing at its `flow` times his speed */
  heading: { rippleR: 3.2, rippleS: 0.6, rings: 3, gapS: 0.12, arrowDelayS: 0.3, aheadS: 1.0, lenM: 4.5,
    /** a run to a chosen point (the Tactics pen's drag): no length cap; the chevrons flow at `toFlow` m/s;
     *  its end `toEnd` 'fade' (as the running direction's; the default, r100 A) or 'hold' (a still chevron
     *  with its tip on the point, kept behind the switch) */
    toFlow: 2.5, toEnd: 'fade' as 'fade' | 'hold' },
  /** the pass arrow (§13; the Tactics pen's pass arrow, in the run's family), white (the ball):
   *  `look` 'barbed' pitch_prism's solid arrow (§13), 'chevrons' the running direction's chevrons in white, `gapM`
   *  apart, flowing at `flow` m/s; 'line' a slim line (`lineHW`) with sparser chevrons (`lineGapM`) flowing along it;
   *  'landing' the slim line drawn out from the passer and a small ring (`landR`, `landW`) where it lands. All start
   *  `footR` from the passer's feet and draw on from him over TELE.arrow.drawS. 'barbed' is the default (a regular
   *  white arrow, as in pitch_prism); the others stay behind the switch */
  passArrow: { look: 'barbed' as 'barbed' | 'chevrons' | 'line' | 'landing', gapM: 1.3, lineGapM: 2.6, flow: 4, lineHW: 0.045, landR: 0.45, landW: 0.09, footR: 0.5,
    /** lofted (ground or lofted, as the request says; a real path in the 3D scene, LoftArrows.tsx): the
     *  arc's peak for `loft: true` is `loftK` of the pass's length within `loftMin`..`loftMax` m; on the grass the shadow
     *  of its flat track, blurred, pitch_prism's dark green-black, `shadowHalfK` of the width either side at `shadowA`
     *  (no ring at the tip). `loftHead` (LoftHead): 'flat' is the default, a flat arrow bent along the path, seen edge-on
     *  from the side (the camera is at the side, and the tip must not face it); the others stay
     *  behind the switch */
    loftK: 0.18, loftMin: 1.5, loftMax: 9, shadowRGB: '#0c1a0c', shadowA: 0.22, shadowHalfK: 0.6, loftHead: 'flat' as 'face' | 'plane' | 'flat' | 'cross' },
  /** arrows (pitch_prism's locked three, freeze/arrows.py): shaft `w` m wide, head `head` x w with the barbs at
   *  `spread` rad and the rear notch at `notch` of the head; a run's octagon dashes `period` x w apart, `fill` of it
   *  painted, marching a period every `marchS` s; a pass's tail dissolving over `tailFade` of the shaft; drawn on over
   *  `drawS` s, tail to head. Colours by meaning: a run amber (a player), a pass white (the ball) */
  /** the Tactics pen's strokes (the pen draws in this layer's style): the four inks of
   *  hud/draft.ts INKS; lines `w` wide (pass, run, dribble, pen, distance), round-ended, smoothed `smooth` times
   *  (Chaikin); the arrows' barbed head `head` times the width (TELE.arrow's spread and notch), no glow; run dashes
   *  `dashFill` of a `dashM` period; the dribble's wave `waveAmp` either side, `waveM` long, flattening into the head;
   *  a circled player's plain ring `ringR` with a `ringW` band; a zone's edge `zoneHW` and the zones' stripes; the
   *  distance's end dots `dotR` and its metres `labelM` tall beside it, `labelOff` off the line towards the camera. A
   *  stroke appears at once (the pen is its entrance) and fades out over `exitS` s when removed */
  stroke: { inks: { white: '#f2f4f7', blue: '#6ab8ff', orange: '#ff9560', yellow: '#ffd166' } as Record<StrokeInk, string>, w: 0.26, head: 3.1, smooth: 2,
    dashM: 1.6, dashFill: 0.6, waveAmp: 0.45, waveM: 1.8, ringR: 1.3, ringW: 0.16, zoneHW: 0.12, dotR: 0.3, labelM: 1.3, labelOff: 1.0, exitS: 0.25 },
  arrow: { w: 0.23, head: 3.1, spread: 0.66, notch: 0.55, period: 2.35, fill: 11.16 / 15.08, marchS: 0.85, tailFade: 0.34, drawS: 0.45 },
  /** the offside wall (pitch_prism's look, but white, and higher than its 2 m): `heightM` tall, `color`, alpha `baseA` at the base,
   *  x`midK` at mid-height, x`topK` at the top; the base line on the grass `lineHW` half-wide; the entrance sweeps the
   *  line out from the defender who sets it over `sweepS` s, then the wall rises over `riseS` s; the focus attacker's
   *  margin, a thin line from his feet to the wall with the metres beside it */
  offside: { heightM: 4.0, color: '#ffffff', baseA: 0.34, midK: 0.62, topK: 0.16, lineHW: 0.05, sweepS: 0.55, riseS: 0.5, marginHW: 0.035, labelM: 1.2,
    /** `highlight: 'all'` (the Tactics one-click line): a plain amber ring `posR` m
     *  round every attacker in an offside position, its band `posW` wide */
    posR: 0.8, posW: 0.12,
    /** the close-up after the wide view (var.ts; as an actual VAR check): the wide view held `holdS` s, the
     *  camera's flight `flyS` s, the marks coming in over `marksS` s from 60% of the flight; dots `dotM` m, drop lines
     *  `dropR` m, the verdict `tagM` m tall at `tagUpM` m over the attacker; the rings give way to the dots in flight */
    /** the target on each deciding part (a dot was too big to see the part): a ring of `ringM` m at
     *  its depth held to `ringPx` pixels, `ringLinePx` thick, a `dotPx` dot; the drop line `dropR` m. The verdict (ONSIDE /
     *  OFFSIDE and the metres) from the wide view on, to his left on screen (`tagLeftM` m and a few pixels), `tagUpM` m up,
     *  its number held to `tagPx` pixels (over his head it ran into the boards) */
    var: { holdS: 1.6, flyS: 1.8, marksS: 0.6, ringM: 0.06, ringPx: [7, 13] as [number, number], ringLinePx: 1.6, dotPx: 2.2, dropR: 0.008, tagM: 0.5, tagPx: [18, 34] as [number, number], tagLeftM: 0.45, tagUpM: 1.15, turnDeg: 12,
      /** ripples over the wall from where a body touches it: the line-setter's deciding part, and the
       *  attacker's when he is through it; a ring every `periodS` s at `speed` m/s, `widthM` thin, fading over `fadeS` s */
      rip: { periodS: 0.9, speed: 1.8, widthM: 0.07, fadeS: 1.6 },
      /** onside: the ruler on the grass from the wall to his line (the distance shown, not only the
       *  number), `offM` m in front of him towards the camera; half-widths of its body and of its 10 cm and 50 cm ticks */
      ruler: { offM: 0.75, bodyHW: 0.02, minorHW: 0.07, majorHW: 0.13 } } },
  /** the spotlight (pitch_prism's locked column, Spotlights.tsx): radius `r` m (pitch_prism's 0.87 m at its ring's
   *  0.80 m, scaled with the enlarged ring), up-fade height `height` radii and sharpness `fadeExp`, wall feather, additive
   *  intensity, colour; the painted base ring at `ringRatio` of the radius, crisp and feathered widths (radii), near
   *  alpha and the far arc's share; grows over `growS`, leaves over `exitS` */
  spot: { r: 1.03, height: 1.58, fadeExp: 1.15, feather: 0.1, intensity: 0.5, color: '#ffffff', ringRatio: 0.92, ringCrisp: 0.042, ringFeather: 0.084, ringNearA: 0.82, ringFarK: 0.34, ringFeatherA: 0.24, growS: 0.6, exitS: 0.34 },
  /** pressure on the carrier (the defenders within 5 m of the carrier, linked to him): a thin circle of
   *  `radiusM` round him in the defending colour, a radar ping out to it over `pingS` s; each defender inside it with the
   *  chevrons running in from the circle to his feet, on at the carrier (no rings; the carrier lit by the spotlight),
   *  flowing at `flow` times his closing speed (m/s), still and faint (`idleA`) when he is not closing in (under
   *  `closeMin` m/s) */
  /** the pressers' look (the ping and chevrons went to the running-direction arrow; the defenders need
   *  their own): 'wedge' a tapered beam from each presser to the carrier, 'arc' a threat arc on a ring round the
   *  carrier facing each presser, its `arcR` m ring and half-angle from the presser's body; both stronger with his
   *  closing speed (full at `closeFull` m/s) */
  press: { look: 'wedge' as 'wedge' | 'arc', wedgeW: 0.75, arcR: 2.2, arcBW: 0.12, closeFull: 3, radiusM: 5, circleHW: 0.035, circleA: 0.75, pingS: 0.7, chevHalf: 0.36, chevStroke: 0.07, chevGap: 0.9, flow: 0.5, closeMin: 0.4, idleA: 0.45 },
  /** a side's block (the defending block's hull with its area in m²; Opta reads below 600 m² as compact,
   *  above 900 m² as loose; the rotating ring on every player, lines round the edge, stripes inside):
   *  zebra (`zebra` alpha by surface) arriving over `durS` s; the area painted at its middle (`labelM` m high). `look`
   *  (simplified as the units were): 'full' the first entrance (welding sparks on the edges,
   *  the stripes laid one after another, the area counting up); 'plain' the same without the sparks; 'calm' no sparks,
   *  the stripes fading in together, the area shown at its value (the default, B, r58: clearly better) */
  hull: { look: 'calm' as 'full' | 'plain' | 'calm', zebra: { grass: 0.32, board: 0.26 } as Pair<number>, durS: 0.9, labelM: 2.2 },
  /** the shot cone: light from the shooter to the posts, white (the ball's
   *  meaning colour); `wash` its alpha by surface; each opponent's shadow (the xG model's 0.5 m half-width) a dark tint
   *  `shadowA`, at most `shadows` of them, the widest; thin edges `edgeHW`; the beam sweeps out over `durS` s. Labels:
   *  xG on a widget beside his head (XgWidget.tsx), lying on the grass instead (XgGroundTag.tsx, `tagM` m high) when
   *  the camera looks down at him from above `flatAboveDeg` degrees; the distance along the cone, the angle */
  shot: { flatAboveDeg: 40, tagM: 1.4, wash: { grass: 0.24, board: 0.2 } as Pair<number>, shadowA: 0.3, shadowTint: '#05070a', shadows: 5, edgeHW: 0.035, durS: 1.2, ring: true, labels: true, xgM: 1.8, labelM: 1.2 },
  /** anchors on players are averaged over this centred window, seconds, so marks do not sway with the skeleton */
  smoothS: 0.3,
};
export type TeleStyle = typeof TELE;

/** an sRGB hex colour as 0..1 floats, blended between the two surfaces (k = 0 grass, 1 board) */
export function surfaceColour(p: Pair<string>, k: number, out: [number, number, number] = [0, 0, 0]) {
  const a = hex(p.grass), b = hex(p.board);
  for (let i = 0; i < 3; i++) out[i] = a[i] + (b[i] - a[i]) * k;
  return out;
}
const cache = new Map<string, [number, number, number]>();
// OKLab (Björn Ottosson), for the chance's colour between red and light cyan
function toLab(c: [number, number, number]): [number, number, number] {
  const lin = c.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  const l = Math.cbrt(0.4122214708 * lin[0] + 0.5363325363 * lin[1] + 0.0514459929 * lin[2]), m = Math.cbrt(0.2119034982 * lin[0] + 0.6806995451 * lin[1] + 0.1073969566 * lin[2]), s = Math.cbrt(0.0883024619 * lin[0] + 0.2817188376 * lin[1] + 0.6299787005 * lin[2]);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromLab(c: [number, number, number]): [number, number, number] {
  const l = (c[0] + 0.3963377774 * c[1] + 0.2158037573 * c[2]) ** 3, m = (c[0] - 0.1055613458 * c[1] - 0.0638541728 * c[2]) ** 3, s = (c[0] - 0.0894841775 * c[1] - 1.291485548 * c[2]) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin.map((v) => { const x = Math.min(1, Math.max(0, v)); return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; }) as [number, number, number];
}
/** a straight blend of two sRGB colours (0..1) through OKLab */
export function mixLab(a: [number, number, number], b: [number, number, number], u: number): [number, number, number] {
  const A = toLab(a), B = toLab(b);
  return fromLab([A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u]);
}

/** a blend of two sRGB colours (0..1) round the hue circle the short way in OKLCh, so it keeps its saturation (orange to
 *  blue runs through red, magenta and violet, not through grey) */
export function mixHue(a: [number, number, number], b: [number, number, number], u: number): [number, number, number] {
  const A = toLab(a), B = toLab(b), ha = Math.atan2(A[2], A[1]), ca = Math.hypot(A[1], A[2]), cb = Math.hypot(B[1], B[2]);
  let dh = Math.atan2(B[2], B[1]) - ha; dh -= 2 * Math.PI * Math.round(dh / (2 * Math.PI));
  const h = ha + dh * u, C = ca + (cb - ca) * u;
  return fromLab([A[0] + (B[0] - A[0]) * u, C * Math.cos(h), C * Math.sin(h)]);
}

/** a pass chance's colour (TELE.passProb.head*): red when it is risky, light cyan when it is safe, sRGB 0..1 */
export function chanceColour(p: number): [number, number, number] {
  const S = TELE.passProb, u = Math.min(1, Math.max(0, (p - S.headLo) / (S.headHi - S.headLo)));
  const a = toLab(hex(S.headRed)), b = toLab(hex(S.headCyan));
  if (S.headPath === 'lab') return fromLab([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]);
  // round the hue circle from red's hue up through orange, yellow and green to cyan's
  const ha = Math.atan2(a[2], a[1]), hb = Math.atan2(b[2], b[1]), ca = Math.hypot(a[1], a[2]), cb = Math.hypot(b[1], b[2]);
  const dh = ((hb - ha) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI), h = ha + dh * u, C = ca + (cb - ca) * u;
  return fromLab([a[0] + (b[0] - a[0]) * u, C * Math.cos(h), C * Math.sin(h)]);
}

/** the head's stack's scale at a depth (m from the camera along its view): 1 from TELE.pointer.stackFar out, nearer a
 *  fixed share (stackGrow) of the player's own growth on screen, at most stackMax: 20 m 1.22, 12 m 1.45, 8 m 1.68 */
export function stackScale(depth: number) {
  const P = TELE.pointer;
  return Math.min(P.stackMax, Math.max(1, Math.pow(P.stackFar / Math.max(0.1, depth), P.stackGrow)));
}

export function hex(h: string): [number, number, number] {
  let c = cache.get(h);
  if (!c) { const n = parseInt(h.slice(1), 16); c = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; cache.set(h, c); }
  return c;
}
export const mixPair = (p: Pair<number>, k: number) => p.grass + (p.board - p.grass) * k;

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const enc = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** a colour raised to relative luminance Y, keeping its hue: scaled in linear light, then mixed towards white for what
 *  the clipped channels cannot carry */
export function liftTo(h: string, Y: number): [number, number, number] {
  const c = hex(h).map(lin) as [number, number, number], y0 = lum(...c);
  if (y0 >= Y) return hex(h);
  let s = c.map((v) => Math.min(1, v * (Y / Math.max(y0, 1e-4)))) as [number, number, number];
  const y1 = lum(...s);
  if (y1 < Y) { const t = (Y - y1) / (1 - y1); s = s.map((v) => v + (1 - v) * t) as [number, number, number]; }
  return s.map(enc) as [number, number, number];
}
export const AMBER_Y = lum(...hex('#fbbf24').map(lin) as [number, number, number]);

/** an ink as 0..1 sRGB floats: a meaning colour blended between the surfaces, or the team colour of `side` */
/** the clip's attacking team, so a side named by its role is drawn in its own team's colour (each team keeps its
 *  colours in every clip, home blue and away orange; without it a selected orange attacker had a blue ring and triangle).
 *  Telestration names sides by role ('att', 'def': players attackers first); inkColour turns the role into the team
 *  through this. The scene sets it for the clip on show (Telestration, HoverPointer); 'home' draws as before */
export const TEAM_SIDE: { attacking: Team } = { attacking: 'home' };

export function inkColour(ink: Ink, role: 'att' | 'def', k: number, out: [number, number, number]) {
  if (ink !== 'team') return surfaceColour(TELE.color[ink], k, out);
  const T = TELE.team;
  // TELE.team's att entries are the home team's blue, its def entries the away team's orange
  const side = roleTeam(role, TEAM_SIDE.attacking) === 'home' ? 'att' : 'def';
  if (T.mode === 'mix') {
    const a = hex(T.layers[side]), b = liftTo(T.kit[side], AMBER_Y);
    for (let i = 0; i < 3; i++) out[i] = a[i] + (b[i] - a[i]) * T.mixW;
    return out;
  }
  const c = T.mode === 'kit' ? hex(T.kit[side]) : T.mode === 'layers' ? hex(T.layers[side]) : liftTo(T.kit[side], AMBER_Y);
  out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  return out;
}
