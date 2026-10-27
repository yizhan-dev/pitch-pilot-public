export interface Frame { att: [number, number][]; def: [number, number][]; ball: [number, number, number] | null; }
export interface Option {
  kind: 'pass' | 'carry' | 'hold' | 'shot';
  teammate?: number; target: [number, number]; control?: number;
  success: number; value_if_success: number; loss_value: number; ev: number; choice_p: number;
}
export interface Vision { yaw: number; view_half_deg: number; peripheral_half_deg: number; outside_view_att: number[]; outside_view_def: number[]; }
export interface MomentPkg {
  meta: { id: string; half: number; minute: number; decision_frame: number; fps: number; attacking: string; real_outcome: string; note: string; goal?: { t: number; x: number } };
  /** the ball at 25 Hz, when exported (goals); null where untracked */
  ball25?: { fps: number; xyz: ([number, number, number] | null)[] };
  /** the goalkeepers' indices (attackers first), when exported */
  keepers?: number[];
  frames: Frame[];
  timeline: { f: number; v: number | null; lost?: boolean }[];
  decision: {
    carrier: number; possession_value: number; options: Option[]; best: number; chosen: number;
    pitch_control: { w: number; h: number; att: number[] }; vision: Vision | null;
  };
}
export interface IndexRow { id: string; file: string; minute: number; t: number; attacking: string; outcome: string; chosen_ev: number; best_ev: number; best_kind: string; gap: number; }
