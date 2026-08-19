/**
 * The cine axis. Small surface, and one rule on it that is not cosmetic:
 * half a cycle must not be played on a loop.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CINE_FPS, cineIntervalMs, nextCineState, type CineState } from '../../src/viewer/cine.ts';

/** Play `steps` ticks from rest and return the frames visited, in order. */
function play(count: number, loop: boolean, steps: number): number[] {
  let state: CineState = { frame: 0, direction: 1 };
  const visited: number[] = [state.frame];
  for (let step = 0; step < steps; step += 1) {
    state = nextCineState(state, count, loop);
    visited.push(state.frame);
  }
  return visited;
}

describe('a whole cycle wraps', () => {
  it('runs forward and returns to the first frame', () => {
    expect(play(4, true, 5)).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it('never reverses, so the second half is not played backwards', () => {
    let state: CineState = { frame: 0, direction: 1 };
    for (let step = 0; step < 20; step += 1) {
      state = nextCineState(state, 4, true);
      expect(state.direction).toBe(1);
    }
  });
});

describe('half a cycle bounces', () => {
  /*
   * This is the whole reason `loop` is a pack field rather than an assumption.
   * The one 4D source available covers end-diastole to end-systole; wrapping it
   * would show the heart snapping from fully contracted back to fully relaxed
   * in one frame — a motion no heart makes, presented as though it were
   * recorded.
   */
  it('turns round at the end instead of wrapping', () => {
    expect(play(4, false, 6)).toEqual([0, 1, 2, 3, 2, 1, 0]);
  });

  it('turns round at the start as well', () => {
    expect(play(3, false, 6)).toEqual([0, 1, 2, 1, 0, 1, 2]);
  });

  it('does not hold an end frame for two ticks', () => {
    const visited = play(5, false, 12);
    for (let index = 1; index < visited.length; index += 1) {
      expect(visited[index], `repeat at ${index}`).not.toBe(visited[index - 1]);
    }
  });

  it('never leaves the frame range', () => {
    let state: CineState = { frame: 0, direction: 1 };
    for (let step = 0; step < 50; step += 1) {
      state = nextCineState(state, 7, false);
      expect(state.frame).toBeGreaterThanOrEqual(0);
      expect(state.frame).toBeLessThan(7);
    }
  });
});

describe('degenerate cases', () => {
  it('cannot move with fewer than two frames', () => {
    expect(nextCineState({ frame: 0, direction: 1 }, 1, false)).toEqual({ frame: 0, direction: 1 });
    expect(nextCineState({ frame: 0, direction: 1 }, 0, true)).toEqual({ frame: 0, direction: 1 });
  });

  it('alternates between exactly two frames', () => {
    expect(play(2, false, 4)).toEqual([0, 1, 0, 1, 0]);
  });
});

describe('playback rate', () => {
  it("uses the pack's own rate where it states one", () => {
    expect(cineIntervalMs(25)).toBe(40);
  });

  it('falls back to a display default where the source states none', () => {
    // Not a physiological claim: a source that records no frame rate has not
    // said what heart rate it was captured at.
    expect(cineIntervalMs(undefined)).toBe(1000 / DEFAULT_CINE_FPS);
  });
});
