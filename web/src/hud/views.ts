import { VIEWS, OFF_BOARD_VIEWS, type ViewMode } from '../game/settings';
import { tr } from '../i18n';

// How the views are listed in the HUD (Yi, 2026-10-22): four groups, cameras, players, officials and the stadium from
// outside (外景, its own group, Yi 2026-10-23; last, so the keys still run 1-9, 0 down the menu), in the order, labels
// and keys of VIEWS in src/game/settings.ts (aligned by the 3D side the same day); only the groups and the one-line hints
// live here. Each hint fits the narrow menu's foot on one line, about ten characters (Yi, 2026-10-22).

export type ViewGroup = '镜头' | '裁判' | '球员' | '外景';
export interface ViewUI { key: ViewMode; label: string; hotkey: string; group: ViewGroup; hint: string; needsPlayer: boolean; needsOfficials: boolean; hidden: boolean }

const LOCAL: Record<ViewMode, { group: ViewGroup; hint: string }> = {
  broadcast: { group: '镜头', hint: tr('主看台机位，跟着球走', 'Follows the ball') },
  tactical: { group: '镜头', hint: tr('正上方俯视全场', 'Straight down') },
  free: { group: '镜头', hint: tr('拖动旋转，滚轮远近', 'Drag to orbit') },
  first: { group: '球员', hint: tr('选中球员的眼睛', 'Through his eyes') },
  third: { group: '球员', hint: tr('跟在选中球员身后', 'Behind the player') },
  referee: { group: '裁判', hint: tr('主裁判的眼睛', "The referee's eyes") },
  ar1: { group: '裁判', hint: tr('边裁的眼睛，看越位', 'Along the line') },
  ar2: { group: '裁判', hint: tr('边裁的眼睛，看越位', 'Along the line') },
  aerialNear: { group: '外景', hint: tr('低空绕体育场飞', 'Low orbit') },
  aerialFar: { group: '外景', hint: tr('高空看体育场全貌', 'High orbit') },
  aerialIn: { group: '外景', hint: 'The whole pitch' },
};

export const VIEW_UI: ViewUI[] = VIEWS.map((v) => ({
  key: v.key, label: v.label, hotkey: v.hotkey, ...LOCAL[v.key], needsPlayer: !!v.needsPlayer, needsOfficials: LOCAL[v.key].group === '裁判', hidden: !!v.hidden,
}));
export const VIEW_GROUPS: ViewGroup[] = ['镜头', '球员', '裁判', '外景'];
/** the groups' names as shown (the keys above stay as they are) */
export const VIEW_GROUP_LABEL: Record<ViewGroup, string> = { 镜头: tr('镜头', 'Cameras'), 球员: tr('球员', 'Players'), 裁判: tr('裁判', 'Officials'), 外景: tr('外景', 'Stadium') };
export const viewUI = (k: ViewMode) => VIEW_UI.find((v) => v.key === k)!;

/** why a view cannot be picked right now, or null */
export function viewBlocked(v: ViewUI, selected: number | null, hasOfficials: boolean, board = false): string | null {
  if (board && OFF_BOARD_VIEWS.includes(v.key)) return 'Not on the analysis board';   // Yi, 2026-10-25 (settings.ts)
  if (v.needsPlayer && selected === null) return tr('先点一名球员', 'Pick a player first');
  if (v.needsOfficials && !hasOfficials) return tr('这个片段没有裁判数据', 'No officials here');
  return null;
}
