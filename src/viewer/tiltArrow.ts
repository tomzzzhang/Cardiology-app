/**
 * The probe's own scrub affordance: a double-headed arrow hugging the probe,
 * traced along the path the probe actually takes through its sweep.
 *
 * **It is an input, not an owner.** Dragging it calls the same scrub path the
 * slider calls, so the wedge, the highlight and the echo image still advance
 * from one clock. It writes `t` and nothing else: there is no code path from
 * here to `views[].probe`, and the pose that results is
 * `frameAt(probe, sweep, t)` by construction, because `t` is the only thing
 * that changed. `contracts/view-rail-sweep-scrubber.md` rule 3 — learner mode
 * cannot reposition a vetted wedge — is preserved by that, not weakened: the
 * arrow reaches exactly the poses the slider already reaches and no others.
 *
 * The path is SAMPLED FROM THE SWEEP rather than drawn as a decorative arc.
 * That matters: a tilt sweep produces a curve and a translate sweep produces a
 * straight line, and a curved arrow drawn over a translation would be claiming
 * a motion the pack does not describe. The arrow is whatever shape the sweep
 * is. Where the task called for "a curved arrow", the curve is the common case
 * and the straight one is the honest exception — logged in
 * `docs/observations.md`.
 *
 * It is a WINDOW on the track, not the whole of it, so the arrow rides the
 * probe: it slides and tilts with the transducer as the sweep scrubs instead of
 * hanging in space over the whole trajectory. Every point of it is still a real
 * pose from `poseAt`, so the shape is the local shape of the actual track.
 *
 * It PERSISTS rather than being revealed on approach. The cut handles are
 * revealed because there are four of them sitting on a plane the learner may
 * not be thinking about; the probe has one control and it is the main thing the
 * learner is here to move, so hiding it until approached costs more than it
 * saves. Proximity still brightens it.
 *
 * `t` is hard-clamped to [0, 1]. At either end the head for that direction dims
 * and the drag stops: no wrap, no rubber band. A view with no sweep gets no
 * arrow at all, because there is nothing for it to scrub.
 */
import * as THREE from 'three';
import { poseAt } from '../echo/probeFrame.ts';
import type { ProbePose, Sweep } from '../schema/packV0.ts';
import type { Vec3 } from '../schema/primitives.ts';

/** Samples along the path. Enough that a wide tilt does not read as facets. */
const SAMPLES = 24;

/**
 * Half-width of the drawn window, in `t`.
 *
 * The arrow shows where the probe can go NEXT, not everywhere it can ever go —
 * that is what makes it ride the transducer. Wide enough to be a comfortable
 * drag target and to read as an arc rather than a dash; narrow enough that it
 * visibly slides along the track as the sweep scrubs.
 */
const WINDOW_T = 0.22;

/**
 * How far behind the transducer face the arrow is drawn, in pack units (mm).
 *
 * Straight back along the beam, well clear of the 26 mm body, so the arrow sits
 * below the probe rather than beside it — and it RIDES the probe: every point
 * is that offset applied to the pose at its own `t`, so the arc sweeps with the
 * transducer instead of sitting behind a fixed spot in space.
 *
 * The distance is also what gives the arrow length. A `tilt` sweep turns the
 * pose about an axis through `probe.origin`, so a path drawn AT the origin
 * collapses to a point and the arc's radius is exactly this offset's component
 * perpendicular to the tilt axis. Further back is a longer, easier arrow; the
 * limit is the panel edge, which is why the camera framing takes the probe's
 * whole travel into account rather than only the model's bounds.
 */
const CLEARANCE_MM = 34;

const ARROW_COLOUR = 0xffc857;
const HEAD_COLOUR = 0xffe6a8;
/** How visible the arrow is when the pointer is nowhere near it. */
const RESTING_OPACITY = 0.5;
/** How far the head at an exhausted end is dimmed. Dim, not hidden: the arrow
 * stays double-headed so its axis of motion is still readable at an endpoint. */
const EXHAUSTED_OPACITY = 0.18;

/**
 * The world-space path the probe body traces as `t` runs 0 to 1.
 *
 * Every point is `poseAt(probe, sweep, t)` — the same function the wedge and
 * the echo derive their pose from — so the drawn path cannot disagree with
 * where the probe will actually be.
 */
export function sweepPath(
  probe: ProbePose, sweep: Sweep | undefined, samples = SAMPLES,
  from = 0, to = 1,
): Vec3[] {
  const points: Vec3[] = [];
  // A view with no sweep has one pose, so it has one point and no arrow. The
  // single point is still worth returning: the camera framing uses this path to
  // decide what it has to fit, and a probe with no sweep is still a probe.
  const stops = sweep === undefined ? 0 : samples;
  for (let i = 0; i <= stops; i += 1) {
    const at = stops === 0 ? from : from + ((to - from) * i) / stops;
    const pose = sweep === undefined ? probe : poseAt(probe, sweep, at);
    const origin = pose.origin as Vec3;
    const beam = pose.beam_axis as Vec3;
    const beamScale = Math.hypot(beam[0], beam[1], beam[2]) || 1;
    points.push([
      origin[0] - (beam[0] / beamScale) * CLEARANCE_MM,
      origin[1] - (beam[1] / beamScale) * CLEARANCE_MM,
      origin[2] - (beam[2] / beamScale) * CLEARANCE_MM,
    ]);
  }
  return points;
}

/**
 * The stretch of the track the arrow draws at scrub position `t`.
 *
 * Clamped to [0, 1] rather than extended past the ends: every point the arrow
 * draws is a pose the sweep actually reaches, so the arrow can never depict a
 * probe position that is off the saved track. The window therefore SHORTENS at
 * the ends, which is a second way of saying the same thing the dimmed head says.
 */
export function sweepWindow(t: number): { from: number; to: number } {
  const clamped = clampT(t);
  return {
    from: Math.max(0, clamped - WINDOW_T),
    to: Math.min(1, clamped + WINDOW_T),
  };
}

/**
 * `t` into [0, 1], treating a non-number as the start of the sweep.
 *
 * `Math.max(0, NaN)` is `NaN`, so the obvious clamp passes a NaN straight
 * through — and a NaN `t` reaches `poseAt`, which produces a pose of NaNs and a
 * probe that silently disappears rather than an error anyone can act on.
 */
function clampT(t: number): number {
  return Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
}

/** A point on a screen-projected path, plus the distance to it. */
export interface PathHit {
  /** Distance from the query point to the polyline, in CSS pixels. */
  distancePx: number;
  /** Unit screen direction of increasing `t` at the closest point. */
  tangent: { x: number; y: number };
}

/**
 * Closest approach of a screen-space point to a projected path.
 *
 * Segment-wise rather than vertex-wise: at 48 samples the vertices of a wide
 * sweep are tens of pixels apart, so a vertex test would report the pointer as
 * far from a line it is sitting exactly on.
 */
export function nearestOnPath(
  path: readonly { x: number; y: number }[], x: number, y: number,
): PathHit | null {
  if (path.length < 2) return null;
  let best = Infinity;
  let tangent = { x: 1, y: 0 };
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i];
    const b = path[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq < 1e-9) continue;
    const u = Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / lengthSq));
    const distance = Math.hypot(a.x + dx * u - x, a.y + dy * u - y);
    if (distance < best) {
      best = distance;
      const length = Math.sqrt(lengthSq);
      tangent = { x: dx / length, y: dy / length };
    }
  }
  return Number.isFinite(best) ? { distancePx: best, tangent } : null;
}

/** Total on-screen length of a projected path, in CSS pixels. */
export function pathScreenLength(path: readonly { x: number; y: number }[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    total += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
  }
  return total;
}

/**
 * `t` after a drag along the arrow, hard-clamped to [0, 1].
 *
 * The gesture freezes `t` and the screen tangent at pointerdown and applies the
 * drag's TOTAL offset — the same rule the cut handles follow, for the same
 * reason: the result must not depend on the pointer's sampling rate, and
 * dragging back must return.
 *
 * `tPerPixel` is the LOCAL rate of the track — the drawn window's extent in `t`
 * divided by its length on screen — so the probe moves at the rate the arrow
 * under the hand depicts. Taking it from the drawn window rather than from the
 * whole sweep is what keeps the gain honest when the window is clipped short at
 * an end: a shorter arrow covers proportionally less `t`, so the feel does not
 * change as the probe approaches a stop.
 */
export function scrubbedT(
  startT: number,
  tangent: { x: number; y: number },
  totalDx: number,
  totalDy: number,
  tPerPixel: number,
): number {
  if (!Number.isFinite(tPerPixel) || tPerPixel <= 0) return clampT(startT);
  const along = totalDx * tangent.x + totalDy * tangent.y;
  return clampT(startT + along * tPerPixel);
}

/** The arrow as one scene object. */
export class TiltArrow {
  readonly object = new THREE.Group();
  /** The drawn window's world-space path, in `t` order. */
  path: THREE.Vector3[] = [];
  /** How much of the sweep the drawn window currently covers. */
  windowExtent = WINDOW_T * 2;

  private readonly probe: ProbePose;
  private readonly sweep: Sweep;
  private readonly line: THREE.Line;
  private readonly heads: [THREE.Mesh, THREE.Mesh];
  private reveal = 0;
  private headScale = 1;

  constructor(probe: ProbePose, sweep: Sweep) {
    this.probe = probe;
    this.sweep = sweep;
    this.rebuild(0.5);

    this.line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(this.path),
      // Depth test off, like the cut gizmo: an instrument the model must not
      // swallow. The probe body sits between the camera and half of this path
      // at most camera angles.
      new THREE.LineBasicMaterial({
        color: ARROW_COLOUR, transparent: true, opacity: 0, depthTest: false,
      }),
    );

    // Slender: the arrow is a hint about a motion, not a piece of hardware, and
    // it sits next to a probe indicator it must not compete with. A 1:4 cone
    // reads as an arrowhead where a squat one reads as a marker.
    const head = () => new THREE.Mesh(
      new THREE.ConeGeometry(1, 4, 10),
      new THREE.MeshBasicMaterial({
        color: HEAD_COLOUR, transparent: true, opacity: 0, depthTest: false,
      }),
    );
    this.heads = [head(), head()];
    this.object.add(this.line, ...this.heads);
    this.object.renderOrder = 1000;
    this.placeHeads();
  }

  /** Resample the drawn window for scrub position `t`. */
  private rebuild(t: number): void {
    const window = sweepWindow(t);
    this.windowExtent = window.to - window.from;
    this.path = sweepPath(this.probe, this.sweep, SAMPLES, window.from, window.to)
      .map((point) => new THREE.Vector3(...point));
  }

  /**
   * Cone size follows the hit target, at a fraction of it.
   *
   * A fraction rather than the whole radius: the grab target has to be a
   * thumb's width, and an arrowhead drawn a thumb's width across would be the
   * loudest thing in the panel. The head marks where to aim; the tolerance
   * around it is generous and invisible, which is the right way round.
   */
  setScreenScale(unitsPerPixel: number, hitRadiusPx: number): void {
    this.headScale = Math.max(unitsPerPixel * hitRadiusPx * 0.18, 1e-4);
    this.placeHeads();
  }

  private placeHeads(): void {
    if (this.path.length < 2) return;
    const ends: [THREE.Vector3, THREE.Vector3][] = [
      [this.path[0], this.path[1]],
      [this.path[this.path.length - 1], this.path[this.path.length - 2]],
    ];
    ends.forEach(([tip, inward], index) => {
      const head = this.heads[index];
      head.position.copy(tip);
      head.scale.setScalar(this.headScale);
      // The cone's axis is +Y; point it outward, away from the path.
      const outward = tip.clone().sub(inward).normalize();
      head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), outward);
    });
  }

  /**
   * Place the arrow for scrub position `t`, and dim the head for a direction
   * the sweep cannot go.
   *
   * `reveal` BRIGHTENS rather than reveals: the arrow persists at a resting
   * opacity whatever the pointer is doing, because the probe has one control
   * and it is the main thing the learner is here to move. `t` at 0 means the
   * `t`-decreasing head is exhausted, and vice versa; the drag clamps at the
   * same bounds, so the dimmed head and the dead direction are the same fact
   * stated twice.
   */
  setReveal(reveal: number, t: number): void {
    this.reveal = reveal;
    this.rebuild(t);
    this.line.geometry.dispose();
    this.line.geometry = new THREE.BufferGeometry().setFromPoints(this.path);
    this.placeHeads();

    const strength = RESTING_OPACITY + (1 - RESTING_OPACITY) * Math.min(1, Math.max(0, reveal));
    this.object.visible = true;
    (this.line.material as THREE.LineBasicMaterial).opacity = strength;
    const atStart = t <= 1e-4;
    const atEnd = t >= 1 - 1e-4;
    (this.heads[0].material as THREE.MeshBasicMaterial).opacity =
      strength * (atStart ? EXHAUSTED_OPACITY : 1);
    (this.heads[1].material as THREE.MeshBasicMaterial).opacity =
      strength * (atEnd ? EXHAUSTED_OPACITY : 1);
  }

  /** Re-place the arrow at a new `t`, keeping whatever brightness it has. */
  refresh(t: number): void {
    this.setReveal(this.reveal, t);
  }

  dispose(): void {
    for (const object of [this.line, ...this.heads]) {
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
  }
}
