import * as THREE from 'three';
import { SKIN_TONES, HAIR_COLOURS, type Look } from '../three/players/looks';
import type { Prop } from './Props';

// The cast: five characters built from the players' cartoon body, one per mode and one for the tour (Yi, 2026-10-26,
// option B: portraits and small full-body animations for the tour's cards and the mode menu). Each wears a costume over
// the kit (looks.ts Zone), carries a few props (Props.tsx) and loops one Mixamo animation (scripts/mixamo_joints.mjs).

export interface Anim {
  /** anim/<name>.json */
  name: string;
  /** keep the hips over one spot (the animation walks about) */
  pin?: boolean;
  /** played forward then back, for a short gesture whose ends do not meet */
  pingpong?: boolean;
  /** both hands held together in front (hold.ts), over the animation's arms */
  hold?: boolean;
  /** a smaller frame (resize.ts): the height's factor and how far each arm moves in, metres */
  size?: { k: number; inward: number };
}
export interface Role { key: string; name: string; mode: string; anim: Anim; look: Look; props: Prop[] }

const look = (o: Partial<Look> & Pick<Look, 'skin' | 'hair' | 'style'>): Look => ({
  number: -1, name: '', keeper: false, boot: '#f1f1ee', build: { arm: 1, leg: 1, torso: 1, head: 1 }, ...o,
});

/** a texture of stripes along v, for the fan's scarf: the club's blue and white */
function stripes(colors: string[], n = 8) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 64 * n;
  const g = c.getContext('2d')!;
  for (let k = 0; k < n; k++) { g.fillStyle = colors[k % colors.length]; g.fillRect(0, k * 64, 4, 64); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t;
}
/** the coach's clipboard face: a small pitch in chalk on green */
function board() {
  const c = document.createElement('canvas'); c.width = 192; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f2ec'; g.fillRect(0, 0, 192, 256);
  g.fillStyle = '#2f7d4f'; g.fillRect(14, 30, 164, 212);
  g.strokeStyle = '#eef3ee'; g.lineWidth = 4;
  g.strokeRect(24, 40, 144, 192); g.beginPath(); g.moveTo(24, 136); g.lineTo(168, 136); g.stroke();
  g.beginPath(); g.arc(96, 136, 22, 0, Math.PI * 2); g.stroke();
  g.strokeRect(62, 40, 68, 28); g.strokeRect(62, 204, 68, 28);
  g.fillStyle = '#3987e5'; for (const [x, y] of [[60, 170], [96, 160], [132, 170], [96, 205]]) { g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#d95926'; for (const [x, y] of [[70, 100], [122, 100], [96, 78]]) { g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#2a2d33'; g.fillRect(70, 0, 52, 34);    // the clip
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

const SCARF = ['#14213d', '#14213d', '#f2f4f7'];

export const CAST: Role[] = [
  {
    key: 'fan', name: 'Fan', mode: 'Watch', anim: { name: 'victory' },
    look: look({ skin: SKIN_TONES[1], hair: HAIR_COLOURS[3], style: 'quiff', build: { arm: 1.03, leg: 1.02, torso: 1.04, head: 1 },
      dress: { bottom: '#34507a', leg: '#34507a', sock: '#34507a', shoe: '#eceae4' } }),     // the home shirt, jeans
    props: [
      // the scarf: wound round the neck just over the collar, resting on the shoulders (below it the torso's top hides
      // it), its two ends laid down the chest
      { at: 'neck', geo: () => new THREE.TorusGeometry(0.072, 0.032, 10, 28).rotateX(Math.PI / 2).scale(1, 1.3, 1), color: '#14213d', off: [0, 0.02, 0.004] },
      { drape: [[0.95, 0.05], [0.8, 0.058], [0.6, 0.064], [0.4, 0.068]], width: 0.085, thick: 0.018, color: '#ffffff', map: () => stripes(SCARF, 9) },
      { drape: [[0.95, -0.046], [0.8, -0.042], [0.6, -0.036], [0.52, -0.034]], width: 0.085, thick: 0.018, color: '#ffffff', map: () => stripes(SCARF, 7) },
    ],
  },
  {
    key: 'pundit', name: 'Pundit', mode: 'Explain', anim: { name: 'arm-gesture' },
    look: look({ skin: SKIN_TONES[4], hair: HAIR_COLOURS[0], style: 'crop', boot: '#121316',
      dress: { top: '#1d2740', arm: '#1d2740', bottom: '#1a2030', leg: '#1a2030', sock: '#1a2030', shoe: '#121316', neck: '#ece8df' } }),   // a navy suit over a cream roll-neck
    props: [
      // a hand microphone, across the fist towards the thumb, its grille out past the thumb
      { at: 'rHand', geo: () => new THREE.CylinderGeometry(0.022, 0.016, 0.2, 16).rotateZ(-Math.PI / 2).translate(0.04, 0, 0), color: '#17181b' },
      { at: 'rHand', geo: () => new THREE.SphereGeometry(0.04, 18, 14).translate(0.16, 0, 0), color: '#6f7782' },
    ],
  },
  {
    key: 'coach', name: 'Coach', mode: 'Tactics', anim: { name: 'happy-idle' },
    look: look({ skin: SKIN_TONES[0], hair: '#8a8580', style: 'buzz', build: { arm: 1.04, leg: 1.02, torso: 1.07, head: 1.01 },
      dress: { top: '#33435a', arm: '#33435a', bottom: '#1d2229', leg: '#1d2229', sock: '#1d2229', shoe: '#eeeeea' } }),   // a slate touchline jacket
    props: [
      // a cap: the crown 1.6 cm over the cropped hair (looks.ts buzz: 0.108 by 0.119 by 0.119 m, 1.8 cm up), clear of
      // the hair's outline as well (up to 11 mm out, Styles.tsx OUTLINE_MAX); the peak out front from its rim, tipped down
      { at: 'head', geo: () => new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.124, 0.135, 0.135), color: '#eef0f2', off: [0, 0.018, -0.008] },
      { at: 'head', geo: () => new THREE.CylinderGeometry(0.07, 0.07, 0.012, 24), color: '#eef0f2', off: [0, 0.022, 0.15], rot: [0.12, 0, 0] },
      // the clipboard in the left hand
      { at: 'lHand', geo: () => new THREE.BoxGeometry(0.2, 0.27, 0.012).translate(0, 0.09, 0.02), color: '#ffffff', map: board },
    ],
  },
  {
    key: 'gamer', name: 'Gamer', mode: 'What-if', anim: { name: 'happy-idle', hold: true },
    look: look({ skin: SKIN_TONES[2], hair: HAIR_COLOURS[0], style: 'curly', build: { arm: 0.95, leg: 0.97, torso: 0.98, head: 1.02 },
      dress: { top: '#7e4ddb', arm: '#7e4ddb', bottom: '#25272e', leg: '#25272e', sock: '#25272e', shoe: '#f1f1ef' } }),   // a hoodie, joggers
    props: [
      // headphones over the curls: the band lying on the curls (looks.ts afro: 0.135 by 0.125 m, 5 cm up, 3 cm back) and
      // reaching down to the cups, a cup on each ear with a lime ring
      { at: 'head', geo: () => new THREE.TorusGeometry(1, 0.08, 8, 36, Math.PI + 0.7).rotateZ(-0.35).scale(0.142, 0.128, 0.142), color: '#eceef2', off: [0, 0.05, -0.03] },
      { at: 'head', geo: () => new THREE.CylinderGeometry(0.055, 0.055, 0.045, 24).rotateZ(Math.PI / 2), color: '#eceef2', off: [0.135, -0.005, 0] },
      { at: 'head', geo: () => new THREE.CylinderGeometry(0.055, 0.055, 0.045, 24).rotateZ(Math.PI / 2), color: '#eceef2', off: [-0.135, -0.005, 0] },
      { at: 'head', geo: () => new THREE.TorusGeometry(0.036, 0.008, 6, 20).rotateY(Math.PI / 2), color: '#b6f23a', off: [0.157, -0.005, 0] },
      { at: 'head', geo: () => new THREE.TorusGeometry(0.036, 0.008, 6, 20).rotateY(Math.PI / 2), color: '#b6f23a', off: [-0.157, -0.005, 0] },
      // a game controller between the hands
      { at: 'hands', geo: () => new THREE.BoxGeometry(0.18, 0.05, 0.1), color: '#eceef2' },
    ],
  },
  {
    // a woman (Yi, 2026-10-26): 1.70 m, narrower shoulders and waist, wider hips, a bust; dark hair in a ponytail
    key: 'guide', name: 'Guide', mode: 'Tour', anim: { name: 'waving-2', pingpong: true, size: { k: 0.945, inward: 0.018 } },
    look: look({ skin: SKIN_TONES[5], hair: HAIR_COLOURS[1], style: 'ponytail', build: { arm: 0.84, leg: 0.9, torso: 0.9, head: 0.97 },
      shape: { hip: 1.12, waist: 0.86, shoulder: 0.9, bust: 0.2 },
      dress: { top: '#17a398', arm: '#17a398', bottom: '#22303a', leg: '#22303a', sock: '#22303a', shoe: '#f1f1ef' } }),   // a teal jacket
    props: [
      // a lanyard: two straps from the collar down to a card, hanging from the chest
      { drape: [[0.98, 0.062], [0.86, 0.045], [0.72, 0.024], [0.6, 0.012]], width: 0.014, thick: 0.005, color: '#f2f4f7' },
      { drape: [[0.98, -0.062], [0.86, -0.045], [0.72, -0.024], [0.6, -0.012]], width: 0.014, thick: 0.005, color: '#f2f4f7' },
      { drape: [[0.6, 0], [0.43, 0]], width: 0.075, thick: 0.006, color: '#f2f4f7' },
    ],
  },
];
