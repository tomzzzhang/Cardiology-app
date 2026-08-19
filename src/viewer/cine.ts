/**
 * Playback along the cine axis: which keyframe is on screen, and what comes next.
 *
 * Kept out of the viewer component because the rule it encodes is a claim about
 * the DATA rather than about React. A pack whose frames cover a whole cycle may
 * wrap; a pack whose frames cover half a cycle may not, and playing one on a
 * loop would show the heart snapping from end-systole back to end-diastole —
 * a motion no heart makes, presented as though the source had recorded it.
 *
 * This axis is not the sweep. The sweep moves one probe over one static heart;
 * the cine moves the heart and has no probe in it at all. They share no control
 * and no state, and `contracts/pack-loader.md` says why the two-axis question is
 * still open rather than answered here.
 */

/**
 * Frames per second when the pack states no rate.
 *
 * A source that records no frame rate has not told anyone what heart rate it
 * was captured at, so playing it at a "physiological" speed would be inventing
 * one. This is a legibility choice — slow enough to watch a wall move, fast
 * enough to read as motion — and the pack's own `fps` always wins where it
 * exists.
 */
export const DEFAULT_CINE_FPS = 8;

export interface CineState {
  /** Index into `keyframes.frames`. */
  frame: number;
  /** Which way playback is currently travelling. Only bouncing ever reverses. */
  direction: 1 | -1;
}

/**
 * One step of playback.
 *
 * @param count number of frames; fewer than two cannot move
 * @param loop  whether the frames meet end to end (`keyframes.loop`)
 */
export function nextCineState(state: CineState, count: number, loop: boolean): CineState {
  if (count < 2) return { frame: 0, direction: 1 };

  if (loop) {
    // A whole cycle wraps, and always travels forward: reversing at the seam
    // would play the second half of the cycle backwards.
    return { frame: (state.frame + 1) % count, direction: 1 };
  }

  const forward = state.direction === 1;
  const next = state.frame + state.direction;
  if (next >= 0 && next < count) return { frame: next, direction: state.direction };

  // At an end, turn round. The end frame is not repeated: holding it for two
  // ticks would read as a stutter at both extremes of the motion.
  const direction: 1 | -1 = forward ? -1 : 1;
  return { frame: state.frame + direction, direction };
}

/** Playback interval in milliseconds, from the pack's rate or the default. */
export function cineIntervalMs(fps: number | undefined): number {
  return 1000 / (fps ?? DEFAULT_CINE_FPS);
}
