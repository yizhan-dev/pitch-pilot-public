import { describe, expect, it } from 'vitest';
import { fmtClock, scoreAt } from '../src/hud/match';
import { syntheticClip, syntheticClipRow, syntheticEvent, syntheticIndex } from './synthetic';

describe('fmtClock', () => {
  it.each([
    [-1, '0:00'],
    [0, '0:00'],
    [9.99, '0:09'],
    [59.99, '0:59'],
    [60, '1:00'],
    [952.9, '15:52'],
    [2700, '45:00'],
    [5400, '90:00'],
    [6001, '100:01'],
  ])('formats %s seconds as %s', (seconds, expected) => {
    expect(fmtClock(seconds)).toBe(expected);
  });
});

describe('scoreAt', () => {
  it('starts at 0-0 with no goals or index', () => {
    expect(scoreAt(syntheticClip(), null, 100)).toEqual([0, 0]);
  });

  it('counts a synced goal at its exact match clock', () => {
    const pkg = syntheticClip({ events: [syntheticEvent({ type: 'Goal', clock: 105 })] });
    expect(scoreAt(pkg, null, 104.99)).toEqual([0, 0]);
    expect(scoreAt(pkg, null, 105)).toEqual([1, 0]);
  });

  it('maps both sides correctly when the clip attackers are away', () => {
    const pkg = syntheticClip();
    pkg.meta.attacking = 'away';
    pkg.events = [
      syntheticEvent({ type: 'Goal', clock: 101, shooting: true }),
      syntheticEvent({ type: 'Goal', clock: 102, shooting: false }),
    ];
    expect(scoreAt(pkg, null, 101)).toEqual([0, 1]);
    expect(scoreAt(pkg, null, 102)).toEqual([1, 1]);
  });

  it('combines earlier index goals with local events without double-counting the current clip', () => {
    const pkg = syntheticClip({ events: [syntheticEvent({ type: 'Goal', clock: 105 })] });
    const index = syntheticIndex([
      syntheticClipRow({ id: 'previous-home', clock: 50 }),
      syntheticClipRow({ id: 'previous-away', clock: 80, team: 'away' }),
      syntheticClipRow({ id: pkg.meta.id, clock: 104 }),
      syntheticClipRow({ id: 'future-home', clock: 150 }),
      syntheticClipRow({ id: 'miss', clock: 70, goal: false }),
    ]);
    expect(scoreAt(pkg, index, 104)).toEqual([1, 1]);
    expect(scoreAt(pkg, index, 105)).toEqual([2, 1]);
    expect(scoreAt(pkg, index, 150)).toEqual([3, 1]);
  });

  it('counts each local goal and ignores shots that were saved or missed', () => {
    const pkg = syntheticClip({ events: [
      syntheticEvent({ type: 'Goal', clock: 101 }),
      syntheticEvent({ type: 'SavedShot', clock: 102 }),
      syntheticEvent({ type: 'MissedShots', clock: 103 }),
      syntheticEvent({ type: 'Goal', clock: 104, shooting: false }),
    ] });
    expect(scoreAt(pkg, null, 104)).toEqual([1, 1]);
  });
});
