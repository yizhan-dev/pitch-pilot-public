import { describe, expect, it } from 'vitest';
import { moves, xtAt } from '../src/hud/analysis';
import { syntheticClip, syntheticEvent } from './synthetic';

describe('xtAt', () => {
  it('uses the illustrative surface without embedding fitted model values', () => {
    expect(xtAt([-52.5, -34])).toBeCloseTo(0.01);
    expect(xtAt([52.5, 34])).toBeGreaterThan(xtAt([-52.5, -34]));
    expect(xtAt([52, 1])).toBeGreaterThan(xtAt([52.5, 34]));
  });

  it('clamps coordinates beyond the pitch to the nearest edge', () => {
    expect(xtAt([-100, -100])).toBe(xtAt([-52.5, -34]));
    expect(xtAt([100, 100])).toBe(xtAt([52.5, 34]));
  });

  it('rotates both coordinates for the team attacking the opposite goal', () => {
    expect(xtAt([42, 12], false)).toBe(xtAt([-42, -12], true));
    expect(xtAt([-52.5, -34], false)).toBe(xtAt([52.5, 34], true));
  });

  it('changes zones at the cell boundary rather than interpolating values', () => {
    const firstBoundary = -52.5 + 105 / 16;
    expect(xtAt([firstBoundary - 0.001, -33])).toBeCloseTo(0.01);
    expect(xtAt([firstBoundary, -33])).toBeGreaterThan(xtAt([firstBoundary - 0.001, -33]));
  });
});

describe('moves', () => {
  it('returns no moves when the clip has no events', () => {
    expect(moves(syntheticClip())).toEqual([]);
  });

  it('values a completed pass from the passer to its receiver at the next event', () => {
    const pass = syntheticEvent();
    const shot = syntheticEvent({ t: 3, type: 'SavedShot', player: 1, receiver: null });
    const [move] = moves(syntheticClip({ events: [pass, shot] }));
    expect(move.e).toBe(pass);
    expect(move.from).toEqual([-20, 0]);
    expect(move.to).toEqual([23, 4]);
    expect(move.carry).toBe(false);
    expect(move.dxt).toBeCloseTo(xtAt([23, 4]) - xtAt([-20, 0]));
  });

  it('charges an unsuccessful pass the full threat held at its start', () => {
    const [move] = moves(syntheticClip({ events: [syntheticEvent({ outcome: 'Unsuccessful' })] }));
    expect(move.dxt).toBeCloseTo(-xtAt([-20, 0]));
  });

  it('values a defending-side move toward its own attacking goal', () => {
    const pass = syntheticEvent({ player: 3, receiver: 0, shooting: false });
    const [move] = moves(syntheticClip({ events: [pass] }));
    expect(move.to).toEqual([-20, 0]);
    expect(move.dxt).toBeCloseTo(xtAt([-20, 0], false) - xtAt([35, 10], false));
    expect(move.dxt).toBeGreaterThan(0);
  });

  it('uses the ball at the next event for a carry', () => {
    const carry = syntheticEvent({ type: 'Carry', receiver: null });
    const next = syntheticEvent({ t: 4, type: 'SavedShot' });
    const [move] = moves(syntheticClip({ events: [carry, next] }));
    expect(move.to).toEqual([8, 0]);
    expect(move.carry).toBe(true);
  });

  it('uses the ball if the passer or receiver is unknown', () => {
    const pass = syntheticEvent({ player: null, receiver: null });
    const [move] = moves(syntheticClip({ events: [pass] }));
    expect(move.from).toEqual([2, 0]);
    expect(move.to).toEqual([4, 0]);
  });

  it('preserves backward moves as negative threat and ignores non-move events', () => {
    const pass = syntheticEvent({ player: 1, receiver: 0 });
    const shot = syntheticEvent({ t: 2, type: 'Goal' });
    const result = moves(syntheticClip({ events: [pass, shot] }));
    expect(result).toHaveLength(1);
    expect(result[0].dxt).toBeLessThan(0);
  });
});
