import type { ClipEvent, ClipIndex, ClipPkg, ClipRow } from '../src/hud/match';

/** Small invented fixtures: no match packages or files are loaded by the tests. */
export function syntheticEvent(overrides: Partial<ClipEvent> = {}): ClipEvent {
  return {
    t: 1,
    clock: 101,
    type: 'Pass',
    outcome: 'Successful',
    shooting: true,
    player: 0,
    receiver: 1,
    tags: [],
    ...overrides,
  };
}

export function syntheticClip(overrides: Partial<ClipPkg> = {}): ClipPkg {
  return {
    meta: {
      id: 'synthetic-clip',
      half: 1,
      minute: 1,
      decision_frame: 0,
      fps: 1,
      attacking: 'home',
      real_outcome: '',
      note: 'Invented unit-test fixture',
    },
    frames: Array.from({ length: 13 }, (_, frame) => ({
      att: [[-20, 0], [20 + frame, 4], [8, -5]],
      def: [[35, 10]],
      ball: [frame * 2, 0, 0],
    })),
    timeline: [],
    decision: {
      carrier: 0,
      possession_value: 0,
      options: [],
      best: 0,
      chosen: 0,
      pitch_control: { w: 0, h: 0, att: [] },
      vision: null,
    },
    clock0: 100,
    events: [],
    ...overrides,
  };
}

export function syntheticClipRow(overrides: Partial<ClipRow> = {}): ClipRow {
  return {
    id: 'other-synthetic-clip',
    kind: 'shot',
    moment: 'synthetic-only',
    title: 'Invented goal',
    half: 1,
    clock: 80,
    team: 'home',
    duration: 12,
    xg: [],
    goal: true,
    lines: null,
    last: null,
    xpass: null,
    shot_after: false,
    ...overrides,
  };
}

export function syntheticIndex(clips: ClipRow[] = []): ClipIndex {
  return { match: 'synthetic', home: 'Home', away: 'Away', note: 'Synthetic only', clips };
}
