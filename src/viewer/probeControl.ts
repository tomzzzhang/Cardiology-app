/**
 * The probe's travel: where it goes over a sweep, and how far one press moves it.
 *
 * Two small things that both answer "what does this sweep do", kept together
 * because they are the same fact read two ways — one for the camera, one for
 * the buttons.
 *
 * There is no drag affordance here and there was one until this revision: a
 * curved arrow under the probe that scrubbed the sweep. It is gone. Positioning
 * a transducer is not a drag: the probe turns about three of its own axes, a
 * drag has two degrees of freedom and no way to say which axis it meant, and
 * the one motion a drag CAN express unambiguously — scrubbing along a
 * one-dimensional track — is better served by a button that steps a known
 * amount than by a gesture whose gain depends on where the camera happens to
 * be. The probe control pad replaced it.
 */
import { poseAt } from '../echo/probeFrame.ts';
import type { ProbePose, Sweep } from '../schema/packV0.ts';
import type { Vec3 } from '../schema/primitives.ts';

/** Samples along the travel path. Enough that a wide tilt is not a chord. */
const SAMPLES = 24;

/**
 * How far behind the transducer face the travel envelope reaches, in mm.
 *
 * The probe body is 33 mm long, so this clears it with margin. It exists so the
 * camera frames the whole instrument rather than the aperture point: a probe
 * sits outside the model by construction, and framing on the model alone leaves
 * the transducer clipped at the panel edge.
 */
const ENVELOPE_MM = 46;

/**
 * The world-space path the back of the probe traces as `t` runs 0 to 1.
 *
 * Every point is `poseAt(probe, sweep, t)` — the same function the wedge and the
 * echo derive their pose from — so what the camera is asked to fit cannot
 * disagree with where the probe will actually be. A view with no sweep has one
 * pose and therefore one point, which is still worth returning: a probe that
 * does not move is still a probe the camera has to fit.
 */
export function probeTravelPath(
  probe: ProbePose, sweep: Sweep | undefined, samples = SAMPLES,
): Vec3[] {
  const points: Vec3[] = [];
  const stops = sweep === undefined ? 0 : samples;
  for (let i = 0; i <= stops; i += 1) {
    const pose = sweep === undefined ? probe : poseAt(probe, sweep, i / stops);
    const origin = pose.origin as Vec3;
    const beam = pose.beam_axis as Vec3;
    const scale = Math.hypot(beam[0], beam[1], beam[2]) || 1;
    points.push([
      origin[0] - (beam[0] / scale) * ENVELOPE_MM,
      origin[1] - (beam[1] / scale) * ENVELOPE_MM,
      origin[2] - (beam[2] / scale) * ENVELOPE_MM,
    ]);
  }
  return points;
}

/**
 * Where a view sits on its own sweep: the middle.
 *
 * A sweep runs from one extreme to the other THROUGH the view — the apical
 * four-chamber's tilt goes posterior to anterior with the four-chamber itself
 * in between, and the parasternal short axis runs base to apex through the
 * level the view is named for. So `t = 0.5` is the reference position and the
 * ends are the extremes, which is why the app opens there rather than at zero.
 *
 * It was a bare `0.5` in `App.tsx` and a second bare `0` in the pad's centre
 * button, which is how a "home" control ends up going somewhere that is not
 * home. One constant, named for what it means.
 */
export const SWEEP_HOME_T = 0.5;

/**
 * How far from home still counts as being at home.
 *
 * The scrub is a float driven by a slider and by button steps, so it lands on
 * the reference exactly by one route and approaches it by the other. A home
 * button still enabled a millionth away would be a control that cannot do
 * anything, which is what the pad's dead centre cell was.
 */
export const SWEEP_HOME_EPSILON = 1e-6;

/** Whether the scrub is at the view's reference position. */
export function atSweepHome(t: number): boolean {
  return Math.abs(t - SWEEP_HOME_T) <= SWEEP_HOME_EPSILON;
}

/**
 * One press of a sweep step, in the sweep's own units.
 *
 * Two degrees, or two millimetres — the same number as `NUDGE_DEG`, so a press
 * moves the probe by the same visible amount whether it is stepping along a
 * saved track or turning freely. That the units differ between sweep modes and
 * the number does not is deliberate: a millimetre and a degree are comparable
 * amounts of motion at this scale, and a learner pressing a button is asking
 * for "a bit more", not for a unit.
 */
export const SWEEP_STEP = 2;

/**
 * How much `t` one press is worth, for a given sweep.
 *
 * Derived from the sweep's own range rather than fixed, so the step feels the
 * same on a 40-degree tilt and an 80-millimetre translation instead of crossing
 * one in two presses and the other in forty. A degenerate range — a sweep whose
 * ends coincide — yields no step rather than an infinity.
 */
export function sweepStepT(sweep: Sweep | undefined): number {
  if (!sweep) return 0;
  const span = Math.abs(sweep.range.to - sweep.range.from);
  if (!Number.isFinite(span) || span < 1e-9) return 0;
  return Math.min(1, SWEEP_STEP / span);
}

/**
 * `t` after one press, hard-clamped to [0, 1].
 *
 * **This is the gate.** The locked probe is pinned to its view: every reachable
 * pose is `frameAt(probe, sweep, t)` for `t` in [0, 1], and that is what lets
 * the echo panel put a view's name on an image. A press writes `t` and nothing
 * else, so the pose it produces is on the saved track by construction — and the
 * clamp is what keeps it there at the ends, where `poseAt` would otherwise pin
 * the probe silently while the slider showed something else.
 */
export function steppedT(current: number, direction: -1 | 1, sweep: Sweep | undefined): number {
  const step = sweepStepT(sweep);
  const base = Number.isFinite(current) ? current : 0;
  return Math.min(1, Math.max(0, base + direction * step));
}
