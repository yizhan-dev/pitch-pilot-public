import { describe, expect, it } from 'vitest';
import { control, influence, type XY } from '../src/hud/fb';

describe('influence', () => {
  it('peaks at the stationary player and falls with distance', () => {
    expect(influence([0, 0], [0, 0], [0, 0], [0, 0])).toBe(1);
    expect(influence([0, 0], [0, 0], [0, 0], [2, 0])).toBeCloseTo(Math.exp(-0.5));
    expect(influence([0, 0], [0, 0], [0, 0], [4, 0])).toBeLessThan(
      influence([0, 0], [0, 0], [0, 0], [2, 0]),
    );
  });

  it('is radially symmetric for a stationary player', () => {
    const player: XY = [7, -3];
    const ball: XY = [12, 9];
    expect(influence(player, [0, 0], ball, [10, -3])).toBeCloseTo(
      influence(player, [0, 0], ball, [7, 0]),
    );
  });

  it('shifts its peak half a second along velocity', () => {
    expect(influence([2, 3], [6, 0], [2, 3], [5, 3])).toBe(1);
    expect(influence([2, 3], [6, 0], [2, 3], [2, 3])).toBeLessThan(1);
  });

  it('stretches along the direction of motion', () => {
    const along = influence([0, 0], [6, 0], [0, 0], [5, 0]);
    const across = influence([0, 0], [6, 0], [0, 0], [3, 2]);
    expect(along).toBeGreaterThan(across);
  });

  it('widens farther from the ball, with a finite cap', () => {
    const near = influence([0, 0], [0, 0], [0, 0], [4, 0]);
    const far = influence([0, 0], [0, 0], [100, 0], [4, 0]);
    expect(far).toBeGreaterThan(near);
    expect(far).toBe(influence([0, 0], [0, 0], [200, 0], [4, 0]));
  });

  it('is invariant to translating the whole scene', () => {
    expect(influence([1, 2], [3, -2], [8, -5], [3, 1])).toBeCloseTo(
      influence([11, 22], [3, -2], [18, 15], [13, 21]),
    );
  });

  it.each([0, 13, 30, 100])('stays finite and bounded at speed %s m/s', (speed) => {
    const result = influence([0, 0], [speed, 0], [4, 0], [1, 2]);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});

describe('control', () => {
  const cells: XY[] = [[-10, 0], [0, 0], [10, 0]];

  it('has no preferred side when both teams are absent', () => {
    expect(Array.from(control([], [], [], [], [0, 0], cells))).toEqual([0.5, 0.5, 0.5]);
  });

  it('gives equal teams equal shares at every cell', () => {
    const positions: XY[] = [[-5, 2], [4, -3]];
    const velocities: XY[] = [[1, 0], [-1, 2]];
    expect(Array.from(control(positions, velocities, positions, velocities, [1, 1], cells)))
      .toEqual([0.5, 0.5, 0.5]);
  });

  it('favors the nearby team and complements when the sides swap', () => {
    const home: XY[] = [[-10, 0]];
    const away: XY[] = [[10, 0]];
    const stationary: XY[] = [[0, 0]];
    const homeControl = control(home, stationary, away, stationary, [0, 0], cells);
    const awayControl = control(away, stationary, home, stationary, [0, 0], cells);
    expect(homeControl[0]).toBeGreaterThan(0.5);
    expect(homeControl[2]).toBeLessThan(0.5);
    cells.forEach((_, index) => {
      expect(homeControl[index] + awayControl[index]).toBeCloseTo(1, 6);
    });
  });

  it('returns a Float32Array with one result per cell, including an empty grid', () => {
    expect(control([], [], [], [], [0, 0], cells)).toBeInstanceOf(Float32Array);
    expect(control([], [], [], [], [0, 0], [])).toHaveLength(0);
  });
});
