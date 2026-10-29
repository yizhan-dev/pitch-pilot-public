import * as THREE from 'three';
import type { MomentPkg } from '../../types';
import jostUrl from '../../assets/brand/fonts/jost-latin.woff2?url';
import type { Shape } from './body';

// How each cartoon player looks: skin tone, hair style and colour, shirt number, build. All of it comes from four seeds,
// one per attribute, so any line-up can be reproduced or re-rolled one attribute at a time. Nothing here comes from the
// tracking: the players are drawn as anonymous, invented people.

export type HairStyle = 'bald' | 'buzz' | 'crop' | 'quiff' | 'curly' | 'bun' | 'long' | 'mohawk' | 'ponytail';
export const HAIR_STYLES: HairStyle[] = ['buzz', 'crop', 'quiff', 'curly', 'bun', 'long', 'mohawk', 'bald'];
export const HAIR_LABEL: Record<HairStyle, string> = { bald: '光头', buzz: '寸头', crop: '短发', quiff: '飞机头', curly: '卷发', bun: '丸子头', long: '长发', mohawk: '莫西干', ponytail: '马尾' };
/** how often each style is drawn, relative: the mohawk is rare (about one in 30; at one in eight it was far too common) */
/** the ponytail is the cast's (src/cast) and never drawn for a player: it is not in HAIR_STYLES */
export const HAIR_WEIGHT: Record<HairStyle, number> = { buzz: 1, crop: 1, quiff: 1, curly: 1, bun: 1, long: 1, mohawk: 0.25, bald: 1, ponytail: 0 };
/** a spread of human skin tones, light to dark */
export const SKIN_TONES = ['#f3d2b3', '#e8b994', '#d29a6e', '#b57a50', '#8f5a36', '#6a3f24', '#4b2b18'];
/** natural hair colours, black to fair */
export const HAIR_COLOURS = ['#15110f', '#2b1d15', '#4a3221', '#7a5434', '#a8794a', '#cfae72', '#8e3b1e'];

/** a hair piece: an ellipsoid in the head's frame, offset (right, up, forward) from the head's centre, metres, and
 *  tilted about the ears by tilt radians, front up */
export interface HairPiece { off: [number, number, number]; r: [number, number, number]; tilt?: number }
export const HAIR_PIECES: Record<string, HairPiece> = {
  // short hair over the top and back, the face clear. Tilted 35 degrees so the hairline runs high over the forehead
  // (7 cm above the head's centre; at 3.7 it was far too low) and low at the nape (-5 cm), 1.4 cm thick on top
  cap: { off: [0, 0.035, -0.02], r: [0.108, 0.095, 0.122], tilt: 0.61 },
  buzz: { off: [0, 0.018, -0.008], r: [0.108, 0.119, 0.119] },    // a thin layer, close to the head
  // the front hair swept up: a wide volume over the forehead, 18 cm across, its crest about 4 cm above the scalp and
  // reaching about 4 cm out over the forehead, its back sinking into the cap at the crown (it was a narrow lump on the
  // crown that read as a bun and looked odd)
  quiff: { off: [0, 0.09, 0.04], r: [0.088, 0.06, 0.07], tilt: 0.6 },
  afro: { off: [0, 0.05, -0.03], r: [0.135, 0.125, 0.13] },       // a round mass of curls
  bun: { off: [0, 0.1, -0.09], r: [0.038, 0.038, 0.038] },        // tied up at the back
  long: { off: [0, -0.04, -0.07], r: [0.1, 0.12, 0.06] },         // falling to the collar at the back
  ridge: { off: [0, 0.1, -0.005], r: [0.028, 0.055, 0.115] },     // a mohawk's crest, the sides shaved
  // a ponytail tied high at the back, hanging down behind the neck, its end a little out from the nape
  tail: { off: [0, -0.055, -0.152], r: [0.042, 0.105, 0.046], tilt: -0.3 },
};
export const PIECE_NAMES = Object.keys(HAIR_PIECES);
export const STYLE_PIECES: Record<HairStyle, string[]> = {
  bald: [], buzz: ['buzz'], crop: ['cap'], quiff: ['cap', 'quiff'], curly: ['afro'], bun: ['cap', 'bun'], long: ['cap', 'long'], mohawk: ['ridge'], ponytail: ['cap', 'tail'],
};

/** body type: how much wider than the base body the arms, legs, torso and head are (1 = the base) */
export interface Build { arm: number; leg: number; torso: number; head: number }
/** a costume over the kit, for figures who are not players (the cast, src/cast): a colour per zone, the rest as a
 *  player's. top: the shirt, sleeves and shoulders; arm: the bare arm (long sleeves); hand: the fists (gloves); bottom: the
 *  shorts; leg: the bare leg (trousers); sock; shoe; neck: the neck and the collar's opening (a scarf, a turtleneck) */
export type Zone = 'top' | 'arm' | 'hand' | 'bottom' | 'leg' | 'sock' | 'shoe' | 'neck';
/** dress: a costume (Zone); shape: a woman's figure (body.ts Shape); number -1: a plain shirt, no number and no name */
export interface Look { skin: string; hair: string; style: HairStyle; number: number; name: string; keeper: boolean; build: Build; boot: string; dress?: Partial<Record<Zone, string>>; shape?: Shape }
export interface Seeds { hair: number; number: number; skin: number; build?: number; boots?: number }

/** boot colours as seen on match days: volt yellow, orange, white and dark blue are all common, black is rare now */
export const BOOTS: { color: string; label: string; w: number }[] = [
  { color: '#d8f230', label: '荧光黄', w: 0.27 }, { color: '#ff6b1f', label: '橙色', w: 0.22 },
  { color: '#f1f2ee', label: '白色', w: 0.22 }, { color: '#1d2c52', label: '深蓝', w: 0.21 }, { color: '#15171b', label: '黑色', w: 0.08 },
];

/** Goalkeepers wear a kit unlike both teams': long sleeves and gloves, in a colour of their own (Law 4: colours that
 *  distinguish them from the other players and the officials). By team, as the kits (coords.ts), not by role (the
 *  attacking keeper green and the defending one yellow), so a keeper keeps his colour from clip to clip. */
export const GK_KIT = {
  home: { shirt: '#22b36b', shorts: '#16241c', socks: '#22b36b' },    // green against the home side's blue
  away: { shirt: '#e8cf2a', shorts: '#222225', socks: '#e8cf2a' },    // yellow against the away side's orange
  glove: '#f1f2ee',
};

// Invented surnames for the shirts, put together from syllables, so they belong to nobody in particular.
const ONSET = ['B', 'D', 'F', 'G', 'K', 'L', 'M', 'N', 'P', 'R', 'S', 'T', 'V', 'Z', 'BR', 'DR', 'KR', 'ST', 'TR', 'H', 'J', 'C'];
const VOWEL = ['A', 'E', 'I', 'O', 'U', 'A', 'E', 'O', 'AI', 'IA', 'EO'];
const CODA = ['', '', 'N', 'R', 'S', 'L', 'NZ', 'RT', 'ND', 'K', 'X', 'TT'];
const ENDING = ['O', 'A', 'EZ', 'INI', 'SEN', 'OV', 'ELLI', 'AND', 'ER', 'IC', 'OS', 'TON', 'ARD', 'EIRA', 'MAN'];
function inventName(r: () => number) {
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const syl = () => pick(ONSET) + pick(VOWEL) + pick(CODA);
  const name = (r() < 0.45 ? syl() : '') + syl() + pick(ENDING);
  return name.replace(/([AEIOU])\1+/g, '$1').slice(0, 11);
}

/** a hair style from one uniform draw u in [0, 1), by HAIR_WEIGHT */
function hairStyle(u: number): HairStyle {
  const total = HAIR_STYLES.reduce((a, h) => a + HAIR_WEIGHT[h], 0);
  let x = u * total;
  for (const h of HAIR_STYLES) { if ((x -= HAIR_WEIGHT[h]) < 0) return h; }
  return HAIR_STYLES[HAIR_STYLES.length - 1];
}

/** a small seeded generator (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** the goalkeepers: in a package the attackers attack +x, so their keeper is the deepest attacker and the defenders'
 *  keeper the defender nearest +x, at the first frame */
export function keepersOf(pkg: MomentPkg): number[] {
  if (pkg.keepers?.length) return pkg.keepers;
  const f = pkg.frames[0];
  const att = f.att.reduce((k, p, i) => (p[0] < f.att[k][0] ? i : k), 0), def = f.def.reduce((k, p, i) => (p[0] > f.def[k][0] ? i : k), 0);
  return [att, f.att.length + def];
}

/** a shirt number as a squad list hands them out (random, but 1-20 the common ones): about
 *  three quarters from 2-20, most of the rest from 21-40, and now and then a high number up to 99 */
function drawNumber(r: () => number) {
  const u = r();
  return u < 0.75 ? 2 + Math.floor(r() * 19) : u < 0.92 ? 21 + Math.floor(r() * 20) : 41 + Math.floor(r() * 59);
}

/** looks for P players (the first nAtt attack); each keeper wears 1, the others unique numbers within the team, mostly 2-20 */
export function makeLooks(P: number, nAtt: number, seeds: Seeds, keepers: number[] = []): Look[] {
  const rh = rng(seeds.hair * 7919 + 1), rs = rng(seeds.skin * 104729 + 2), rn = rng(seeds.number * 1299709 + 3), rb = rng((seeds.build ?? 1) * 15485863 + 4);
  const rk = rng((seeds.boots ?? 1) * 32452843 + 5);
  const boot = () => { let x = rk(); for (const b of BOOTS) { if ((x -= b.w) < 0) return b.color; } return BOOTS[0].color; };
  const used: Record<string, Set<number>> = { att: new Set([1]), def: new Set([1]) };
  return Array.from({ length: P }, (_, p) => {
    const team = p < nAtt ? 'att' : 'def';
    let number = 1;
    if (!keepers.includes(p)) { do number = drawNumber(rn); while (used[team].has(number)); used[team].add(number); }
    const name = inventName(rn);                     // re-rolled with the numbers: both are the shirt's print
    // build: one overall mass, slight to stocky, and a little of each part's own; footballers stay within a lean range
    const m = rb() * 2 - 1, own = () => (rb() * 2 - 1);
    const build = { arm: 1 + 0.13 * m + 0.05 * own(), leg: 1 + 0.11 * m + 0.05 * own(), torso: 1 + 0.07 * m + 0.03 * own(), head: 1 + 0.035 * own() };
    return {
      keeper: keepers.includes(p), build, name, boot: boot(),
      skin: SKIN_TONES[Math.floor(rs() * SKIN_TONES.length)],
      style: hairStyle(rh()),
      hair: HAIR_COLOURS[Math.floor(rh() * HAIR_COLOURS.length)],
      number,
    };
  });
}

/** the shirt numbers 0-99 in a 10 x 10 atlas (cell = number % 10, row = floor(number / 10)), white on transparent,
 *  set in Jost, the brand typeface, at a heavy weight */
let atlas: THREE.CanvasTexture | null = null;
export function numberAtlas() {
  if (atlas) return atlas;
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const t = new THREE.CanvasTexture(c); t.anisotropy = 8; atlas = t;
  const draw = (family: string) => {
    const g = c.getContext('2d')!; g.clearRect(0, 0, 1024, 1024);
    // 80 px figures in 102 px cells, condensed a little so two digits fit, and clear of the neighbouring cells
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 80px ${family}`;
    for (let n = 0; n < 100; n++) {
      const x = (n % 10) * 102.4 + 51.2, y = Math.floor(n / 10) * 102.4 + 54, w = g.measureText(String(n)).width, k = Math.min(1, 92 / w);
      g.save(); g.translate(x, y); g.scale(k, 1); g.fillText(String(n), 0, 0); g.restore();
    }
    t.needsUpdate = true;
  };
  draw('sans-serif');
  const face = new FontFace('JostNumbers', `url(${jostUrl})`, { weight: '100 900' });
  face.load().then((f) => { document.fonts.add(f); draw('JostNumbers'); }).catch(() => { /* keep the fallback face */ });
  return t;
}

/** the players' names, one row each, white on transparent in Jost; row p belongs to player p */
export function nameAtlas(names: string[]) {
  const RH = 96, c = document.createElement('canvas'); c.width = 1024; c.height = RH * Math.max(1, names.length);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 8;
  const draw = (family: string) => {
    const g = c.getContext('2d')!; g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `600 66px ${family}`;
    names.forEach((n, r) => {
      const text = n.split('').join('\u200A'), w = g.measureText(text).width, k = Math.min(1, 940 / w);
      g.save(); g.translate(512, r * RH + RH / 2 + 3); g.scale(k, 1); g.fillText(text, 0, 0); g.restore();
    });
    t.needsUpdate = true;
  };
  draw('sans-serif');
  const face = new FontFace('JostNames', `url(${jostUrl})`, { weight: '100 900' });
  face.load().then((f) => { document.fonts.add(f); draw('JostNames'); }).catch(() => { /* keep the fallback face */ });
  return t;
}
