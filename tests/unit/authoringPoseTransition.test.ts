/** The review animation moves through valid transient poses and lands exactly. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ProbePose, type ProbePose as ProbePoseValue } from '../../src/schema/packV0.ts';
import { imagingFrame } from '../../src/echo/probeFrame.ts';
import { AUTHORING_GLIDE_MS, authoringGlideEasing } from '../../src/viewer/orbit.ts';
import {
  echoDisplayHandoff,
  viewPoseTransitionStep,
} from '../../src/viewer/poseTransition.ts';

function pose(overrides: Partial<ProbePoseValue> = {}): ProbePoseValue {
  return {
    origin: [0, -80, 10],
    beam_axis: [0, 1, 0],
    lateral_axis: [1, 0, 0],
    fan: { angle_deg: 70, depth_cm: 12, focus_cm: 6 },
    display: { vertex: 'down', flip_lr: false, marker_side: 'right' },
    ...overrides,
  } as ProbePoseValue;
}

const start = pose();
const target = pose({
  origin: [30, -20, 50],
  beam_axis: [0, 0, -1],
  lateral_axis: [0, 1, 0],
  fan: { angle_deg: 90, depth_cm: 20, focus_cm: 8 },
  display: { vertex: 'up', flip_lr: true, marker_side: 'left' },
});

interface ReviewSession {
  slots: { slot_id: string; probe: ProbePoseValue }[];
}

const reviewSession = JSON.parse(readFileSync(new URL(
  '../../evidence/view-candidates/normal-rodero/pack-0.1.1/'
    + 'review-session-002.authoring-slots-v1.json',
  import.meta.url,
), 'utf8')) as ReviewSession;
const reviewPose = (slotId: string) => {
  const found = reviewSession.slots.find((slot) => slot.slot_id === slotId)?.probe;
  if (!found) throw new Error(`review session is missing ${slotId}`);
  return found;
};

const roderoB4 = reviewPose('view-b4-apical-three-chamber');
const roderoF1 = reviewPose('view-f1-right-parasternal-bicaval');
/** Box3 centre measured from the checksum-bound normal-rodero model.gltf. */
const RODERO_CENTRE = [-4.955181121826172, 1.2884674072265625, 8.505151748657227] as const;

describe('authoring pose transition', () => {
  it('starts from a clone and lands on the exact stored target', () => {
    const first = viewPoseTransitionStep(start, target, 0);
    const last = viewPoseTransitionStep(start, target, AUTHORING_GLIDE_MS);

    expect(first.pose).toEqual(start);
    expect(first.pose).not.toBe(start);
    expect(first.done).toBe(false);
    expect(last.pose).toEqual(target);
    expect(last.pose).not.toBe(target);
    expect(last.done).toBe(true);
  });

  it('uses the camera glide easing for radial position and fan dimensions', () => {
    const elapsed = AUTHORING_GLIDE_MS * 0.25;
    const eased = authoringGlideEasing(0.25);
    const step = viewPoseTransitionStep(
      start, target, elapsed, AUTHORING_GLIDE_MS, [0, -50, 10],
    ).pose;

    const centre = [0, -50, 10] as const;
    const startRadius = Math.hypot(...start.origin.map((value, index) => value - centre[index]));
    const targetRadius = Math.hypot(...target.origin.map((value, index) => value - centre[index]));
    const stepRadius = Math.hypot(...step.origin.map((value, index) => value - centre[index]));
    expect(stepRadius).toBeCloseTo(startRadius + (targetRadius - startRadius) * eased, 12);
    expect(step.fan.angle_deg).toBeCloseTo(70 + 20 * eased, 12);
    expect(step.fan.depth_cm).toBeCloseTo(12 + 8 * eased, 12);
    expect(step.fan.focus_cm).toBeCloseTo(6 + 2 * eased, 12);
  });

  it('keeps every sampled basis unit, orthogonal, right-handed, and schema-valid', () => {
    for (
      let elapsed = 0;
      elapsed <= AUTHORING_GLIDE_MS;
      elapsed += AUTHORING_GLIDE_MS / 20
    ) {
      const step = viewPoseTransitionStep(start, target, elapsed).pose;
      const frame = imagingFrame(step);
      const dot = frame.beam[0] * frame.lateral[0]
        + frame.beam[1] * frame.lateral[1]
        + frame.beam[2] * frame.lateral[2];
      const cross = [
        frame.beam[1] * frame.lateral[2] - frame.beam[2] * frame.lateral[1],
        frame.beam[2] * frame.lateral[0] - frame.beam[0] * frame.lateral[2],
        frame.beam[0] * frame.lateral[1] - frame.beam[1] * frame.lateral[0],
      ];

      expect(Math.hypot(...frame.beam)).toBeCloseTo(1, 12);
      expect(Math.hypot(...frame.lateral)).toBeCloseTo(1, 12);
      expect(dot).toBeCloseTo(0, 12);
      expect(cross).toEqual(expect.arrayContaining([
        expect.any(Number), expect.any(Number), expect.any(Number),
      ]));
      expect(cross[0] * frame.normal[0] + cross[1] * frame.normal[1]
        + cross[2] * frame.normal[2]).toBeCloseTo(1, 12);
      expect(ProbePose.safeParse(step).success).toBe(true);
    }
  });

  it('switches categorical display flags only at the fully transparent handoff', () => {
    const before = echoDisplayHandoff(
      start.display, target.display, AUTHORING_GLIDE_MS * 0.49,
    );
    const atSwitch = echoDisplayHandoff(
      start.display, target.display, AUTHORING_GLIDE_MS / 2,
    );
    const after = echoDisplayHandoff(
      start.display, target.display, AUTHORING_GLIDE_MS * 0.51,
    );

    expect(before.phase).toBe('source');
    expect(before.display).toEqual(start.display);
    expect(atSwitch.phase).toBe('target');
    expect(atSwitch.display).toEqual(target.display);
    expect(atSwitch.opacity).toBe(0);
    expect(after.phase).toBe('target');
    expect(after.display).toEqual(target.display);
    expect(before.opacity).toBeCloseTo(after.opacity, 12);
    expect(viewPoseTransitionStep(start, target, AUTHORING_GLIDE_MS / 2).pose.display)
      .toEqual(target.display);
    expect(viewPoseTransitionStep(start, target, AUTHORING_GLIDE_MS).pose.display)
      .toEqual(target.display);
  });

  it('does not fade when the display convention is unchanged', () => {
    for (const elapsed of [0, AUTHORING_GLIDE_MS / 2, AUTHORING_GLIDE_MS]) {
      const handoff = echoDisplayHandoff(
        start.display, structuredClone(start.display), elapsed,
      );
      expect(handoff.changed).toBe(false);
      expect(handoff.opacity).toBe(1);
      expect(handoff.display).toEqual(start.display);
    }
  });

  it('routes the origin around the model centre instead of through it', () => {
    const outsideA = pose({ origin: [-80, 0, 0] });
    const outsideB = pose({ origin: [0, 80, 0] });
    for (
      let elapsed = 0;
      elapsed <= AUTHORING_GLIDE_MS;
      elapsed += AUTHORING_GLIDE_MS / 20
    ) {
      const step = viewPoseTransitionStep(
        outsideA, outsideB, elapsed, AUTHORING_GLIDE_MS, [0, 0, 0],
      ).pose;
      expect(Math.hypot(...step.origin)).toBeCloseTo(80, 9);
    }
  });

  it('keeps the Rodero centre inside the finite fan throughout B4 to F1 and back', () => {
    for (const [from, to] of [[roderoB4, roderoF1], [roderoF1, roderoB4]] as const) {
      let previousLateral: ProbePoseValue['lateral_axis'] | null = null;
      for (let index = 0; index <= 100; index += 1) {
        const step = viewPoseTransitionStep(
          from, to, (AUTHORING_GLIDE_MS * index) / 100, AUTHORING_GLIDE_MS, RODERO_CENTRE,
        ).pose;
        const frame = imagingFrame(step);
        const toCentre = RODERO_CENTRE.map(
          (coordinate, axis) => coordinate - frame.origin[axis],
        ) as [number, number, number];
        const centreRange = Math.hypot(...toCentre);
        const forward = frame.beam[0] * toCentre[0]
          + frame.beam[1] * toCentre[1]
          + frame.beam[2] * toCentre[2];
        const angle = Math.acos(Math.min(1, Math.max(-1, forward / centreRange)));

        expect(forward).toBeGreaterThan(0);
        expect(angle).toBeLessThanOrEqual(frame.halfAngleRad + 1e-10);
        expect(centreRange).toBeLessThanOrEqual(frame.depthMm + 1e-9);
        expect(ProbePose.safeParse(step).success).toBe(true);
        if (previousLateral) {
          const continuity = previousLateral[0] * step.lateral_axis[0]
            + previousLateral[1] * step.lateral_axis[1]
            + previousLateral[2] * step.lateral_axis[2];
          expect(continuity).toBeGreaterThan(0.99);
        }
        previousLateral = step.lateral_axis;
      }
    }
  });

  it('does not mutate either authored endpoint', () => {
    const beforeStart = JSON.stringify(start);
    const beforeTarget = JSON.stringify(target);
    viewPoseTransitionStep(start, target, AUTHORING_GLIDE_MS / 2);
    expect(JSON.stringify(start)).toBe(beforeStart);
    expect(JSON.stringify(target)).toBe(beforeTarget);
  });
});
