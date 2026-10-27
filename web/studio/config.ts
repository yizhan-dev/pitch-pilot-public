// Studio constants, kept out of the component modules so Vite can hot-refresh them in place.
import { DEFAULT_FACADE, type FacadeParams } from '../src/three/stadium/Facade';
import { STADIUM_CURRENT, type CrystalParams } from '../src/three/stadium/crystalParams';
import type { ShellForm } from '../src/three/stadium/Shell';
import presetData from './presets.json';
import crystalPresetData from './crystalPresets.json';

export type TimeOfDay = 'night' | 'dusk' | 'day';
export const TIMES: Record<TimeOfDay, {
  label: string; top: string; haze: string; ground: string;
  hemi: [string, string, number]; sun: { pos: [number, number, number]; color: string; intensity: number };
  glow: number; led: number; env: number; pitch: number;
}> = {
  night: { label: '夜晚', top: '#020306', haze: '#141c2c', ground: '#0c0f15', hemi: ['#c9d6ff', '#0b0d12', 0.5], sun: { pos: [-120, 160, 90], color: '#9fb4ff', intensity: 0.55 }, glow: 1, led: 1, env: 0.06, pitch: 0.42 },
  dusk: { label: '黄昏', top: '#16264a', haze: '#e0956a', ground: '#3a3436', hemi: ['#ffcfa8', '#2a2630', 1.0], sun: { pos: [-300, 95, 160], color: '#ffad6a', intensity: 2.8 }, glow: 0.65, led: 0.75, env: 0.3, pitch: 0.18 },
  day: { label: '白天', top: '#3a78cf', haze: '#cfe0ef', ground: '#6c7075', hemi: ['#dbe8ff', '#4b4a45', 1.1], sun: { pos: [-170, 260, 120], color: '#fff3df', intensity: 3.0 }, glow: 0.12, led: 0, env: 0.55, pitch: 0 },   // LEDs are off by day
};

export const CAMS: Record<string, { label: string; pos: [number, number, number]; target: [number, number, number]; fov: number }> = {
  plaza: { label: '广场', pos: [-150, 22, 185], target: [0, 16, 0], fov: 40 },
  street: { label: '鳍片下', pos: [-38, 1.7, 112], target: [-10, 17, 70], fov: 60 },
  aerial: { label: '航拍', pos: [-190, 150, 230], target: [0, 4, 0], fov: 30 },
  side: { label: '立面', pos: [0, 16, 330], target: [0, 16, 0], fov: 22 },
  sideS: { label: '立面·南', pos: [0, 16, -330], target: [0, 16, 0], fov: 22 },        // the far side, square-on: the mirror of 立面
  back: { label: '背面', pos: [160, 26, -175], target: [0, 16, 0], fov: 40 },
  corner: { label: '东北角', pos: [185, 24, 165], target: [0, 16, 0], fov: 40 },          // the rounded north-east corner
  arcade: { label: '柱廊近景', pos: [-78, 3.2, 132], target: [-18, 9, 86], fov: 52 },          // standing on the plaza, looking along the supports
  section: { label: '剖切', pos: [260, 22, 0.01], target: [0, 22, 0], fov: 30 },          // with the building cut at x = 0: the walls' section lines
  shoulder: { label: '圆肩近景', pos: [-20, 44, 112], target: [-10, 33, 60], fov: 40 },     // close on the eave shoulder
  rimClose: { label: '下沿特写', pos: [-44, 15, 140], target: [-32, 14, 70], fov: 12 },
  lowerEdge: { label: '下沿近景', pos: [-75, 5, 125], target: [-30, 14, 64], fov: 32 },      // close on the line between the fins and the glazed base
  roofJoin: { label: '屋面连接', pos: [-30, 52, 118], target: [-14, 36, 52], fov: 34 },      // the fins running over the shoulder onto the roof
  sign: { label: '标识', pos: [0, 20, 150], target: [0, 24, 50], fov: 42 },               // square-on to the main face's signature
  signFar: { label: '对面标识', pos: [0, 20, -150], target: [0, 24, -50], fov: 42 },       // the far side's signature
  west: { label: '西端', pos: [-230, 18, -20], target: [0, 20, 0], fov: 34 },              // the west goal end and its symbol
  eastNear: { label: '东端斜看', pos: [150, 30, 70], target: [96, 24, 0], fov: 38 },          // the east symbol from the side
  east: { label: '东端', pos: [230, 18, 20], target: [0, 20, 0], fov: 34 },               // the east goal end and its symbol
  eastAxis: { label: '东端正视', pos: [260, 20, 0], target: [0, 20, 0], fov: 30 },          // exactly on the long axis: north and south should mirror
  goalClose: { label: '球门特写', pos: [47.5, 1.5, 3.5], target: [53.5, 1.3, -0.5], fov: 50 },      // 5 m from the goal mouth
  goal: { label: '球门近景', pos: [38, 1.6, 9], target: [52.5, 1.2, 0], fov: 50 },              // from the penalty area towards the east goal
  goalProfile: { label: '球门侧视', pos: [53.6, 1.25, 12], target: [53.6, 1.25, 0], fov: 22 },     // square-on to the goal's side: its profile
  goalSide: { label: '球门侧面', pos: [50, 1.4, 12], target: [54, 1.1, 0], fov: 45 },            // the goal from the side: net depth and stanchions
  cornerStand: { label: '角落看台', pos: [30, 9, 12], target: [52, 9, 34], fov: 55 },          // the corner of the bowl, square on
  cornerKick: { label: '角球区', pos: [38, 7, 20], target: [55, 0.5, 36], fov: 50 },        // from the pitch towards a corner flag
  cornerFlag: { label: '角旗特写', pos: [50.6, 1.45, 32.4], target: [52.55, 1.3, 34], fov: 40 },        // the corner flag at 2.5 m
  cornerTop: { label: '角球区俯视', pos: [50, 28, 31], target: [54, 0, 35.5], fov: 50 },      // straight down on a corner
  innerWall: { label: '内墙特写', pos: [-10, 30, -10], target: [-58, 36, -62], fov: 20 },        // the dark inner wall above the upper tier at a corner
  bench: { label: '教练席', pos: [22, 4.5, 22], target: [3, 1.5, 40], fov: 50 },              // from the pitch towards the benches and the tunnel
  stand: { label: '看台近景', pos: [-20, 6, -10], target: [-35, 8, -48], fov: 55 },          // the far stand: vomitories, box band, seats
  boards: { label: '场边广告牌', pos: [30, 2.2, 22], target: [62, 1, 34], fov: 55 },          // from the pitch towards a corner: side, chamfer and end boards
  gantry: { label: '转播位', pos: [0, 29, 58], target: [0, 0, 2], fov: 44 },               // the main camera gantry under the roof
  pov: { label: '球员视角', pos: [-18, 1.72, 4], target: [30, 1.4, -3], fov: 70 },         // a player's eyes on the pitch
  plan: { label: '顶视', pos: [0, 430, 0.01], target: [0, 0, 0], fov: 30 },
};

export interface StudioState { time: TimeOfDay; cam: string; spin: boolean; interior: boolean; form: ShellForm; facade: FacadeParams; crystal: CrystalParams; }
export const DEFAULT_STATE: StudioState = { time: 'night', cam: 'plaza', spin: false, interior: true, form: 'crystal', facade: DEFAULT_FACADE, crystal: STADIUM_CURRENT };

/** starting points; every slider stays live afterwards */
export const PRESETS = presetData as { key: string; label: string; note: string; facade: Partial<FacadeParams> }[];
export const CRYSTAL_PRESETS = crystalPresetData as { key: string; label: string; note: string; crystal: Partial<CrystalParams> }[];
