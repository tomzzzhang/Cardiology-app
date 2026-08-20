/**
 * The model's axes from one apical four-chamber pose.
 *
 * The owner's proposition, checked: the beam is the long axis with the sign the
 * atria are on, the fan plane carries left-right, and the plane normal carries
 * anterior-posterior. It holds, and the thing worth pinning is the handedness —
 * a left-handed basis mirrors the anatomy and every view built on it puts
 * right-sided structures on the left while looking entirely plausible. The
 * schema refuses that in `anatomical_frame`; this must never hand it one.
 */
import { describe, expect, it } from 'vitest';
import { frameDisagreementDeg, frameFromFourChamber } from '../../src/authoring/cardiacFrame.ts';
import { imagingFrame } from '../../src/echo/probeFrame.ts';
import { ORTHOGONAL_TOLERANCE, UNIT_TOLERANCE, type Vec3 } from '../../src/schema/primitives.ts';
import type { ProbePose } from '../../src/schema/packV0.ts';

/**
 * An apical four-chamber on a heart whose apex is at -y and base at +y.
 *
 * The transducer sits below the apex looking up, so the beam is +y — "up is the
 * atrium direction" — and the fan plane is the y-x plane.
 */
function fourChamber(over: Partial<ProbePose> = {}): ProbePose {
  return {
    origin: [0, -140, 0],
    beam_axis: [0, 1, 0],
    lateral_axis: [1, 0, 0],
    fan: { angle_deg: 80, depth_cm: 21, focus_cm: 10 },
    display: { vertex: 'down', flip_lr: false, marker_side: 'right' },
    ...over,
  } as ProbePose;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

describe('the three axes are what the pose says they are', () => {
  it('z is the beam: the long axis, pointing at the atria', () => {
    const { basis } = frameFromFourChamber(fourChamber());
    expect(basis.basal[0]).toBeCloseTo(0, 12);
    expect(basis.basal[1]).toBeCloseTo(1, 12);
    expect(basis.basal[2]).toBeCloseTo(0, 12);
  });

  it('x is in the fan plane, and y is perpendicular to it', () => {
    const pose = fourChamber();
    const frame = imagingFrame(pose);
    const { basis } = frameFromFourChamber(pose);

    // x lies in the plane the beam and lateral span.
    expect(Math.abs(dot(basis.patient_left, frame.normal))).toBeLessThan(1e-12);
    // y is along the plane's normal, up to sign.
    expect(Math.abs(dot(basis.anterior, frame.normal))).toBeCloseTo(1, 12);
  });

  it('is orthonormal far tighter than the schema requires of a basis', () => {
    const { basis } = frameFromFourChamber(fourChamber({
      beam_axis: [0.37, 0.81, -0.45].map((v) => v / Math.hypot(0.37, 0.81, 0.45)) as Vec3,
      lateral_axis: [0.9, -0.41, 0.14] as Vec3,
    }));

    for (const axis of [basis.patient_left, basis.basal, basis.anterior]) {
      expect(Math.abs(norm(axis) - 1)).toBeLessThan(1e-14);
      expect(Math.abs(norm(axis) - 1)).toBeLessThan(UNIT_TOLERANCE);
    }
    for (const [a, b] of [
      [basis.patient_left, basis.basal],
      [basis.basal, basis.anterior],
      [basis.anterior, basis.patient_left],
    ] as [Vec3, Vec3][]) {
      expect(Math.abs(dot(a, b))).toBeLessThan(1e-14);
      expect(Math.abs(dot(a, b))).toBeLessThan(ORTHOGONAL_TOLERANCE);
    }
  });
});

describe('handedness, which is the one that silently mirrors anatomy', () => {
  /*
   * `anterior` is CONSTRUCTED as `patient_left x basal` rather than measured
   * independently, which makes the schema's own right-handedness refinement a
   * tautology instead of a trap. Asserted over a spread of poses, including the
   * flipped one, because "it cannot happen" is exactly the claim worth testing.
   */
  it.each([
    ['square on', fourChamber()],
    ['flipped for display', fourChamber({ display: { vertex: 'down', flip_lr: true, marker_side: 'left' } })],
    ['oblique', fourChamber({
      beam_axis: [0.37, 0.81, -0.45].map((v) => v / Math.hypot(0.37, 0.81, 0.45)) as Vec3,
      lateral_axis: [0.9, -0.41, 0.14] as Vec3,
    })],
    ['rolled 180 degrees', fourChamber({ lateral_axis: [-1, 0, 0] })],
  ])('%s: patient_left x basal points along anterior', (_label, pose) => {
    const derived = frameFromFourChamber(pose);
    expect(derived.handedness).toBeGreaterThan(0.999);
  });

  it('rolling the probe 180 degrees exchanges left and right, and says nothing else changed', () => {
    const straight = frameFromFourChamber(fourChamber()).basis;
    const rolled = frameFromFourChamber(fourChamber({ lateral_axis: [-1, 0, 0] })).basis;

    // Same long axis — the plane is the same plane.
    expect(dot(straight.basal, rolled.basal)).toBeCloseTo(1, 12);
    // Opposite left, and therefore opposite anterior. Geometry cannot tell
    // which of the two the author meant; the anatomy on screen can.
    expect(dot(straight.patient_left, rolled.patient_left)).toBeCloseTo(-1, 12);
    expect(dot(straight.anterior, rolled.anterior)).toBeCloseTo(-1, 12);
  });

  it('reports when the in-plane sign came from the pose’s display convention', () => {
    expect(frameFromFourChamber(fourChamber()).flippedForDisplay).toBe(false);
    expect(frameFromFourChamber(fourChamber({
      display: { vertex: 'down', flip_lr: true, marker_side: 'left' },
    })).flippedForDisplay).toBe(true);
  });
});

describe('how far the pose is from what the pack declares', () => {
  /*
   * Every pack on the shelf declares `up=+y, anterior=+z, patient_left=+x`, and
   * only `normal-rodero` carries an `anatomical_frame` behind it. On the other
   * eight that triple is the ingest's default: not measured, just written into
   * the field a measurement would go in. This is the number that says how much
   * the guess was off by.
   */
  const declared = {
    patient_left: [1, 0, 0] as Vec3,
    basal: [0, 1, 0] as Vec3,
    anterior: [0, 0, 1] as Vec3,
  };

  it('is zero when the pose agrees with the declaration', () => {
    const { basis } = frameFromFourChamber(fourChamber());
    const off = frameDisagreementDeg(basis, declared);
    expect(off.basal).toBeCloseTo(0, 9);
    expect(off.patient_left).toBeCloseTo(0, 9);
    expect(off.anterior).toBeCloseTo(0, 9);
  });

  it('measures the angle when it does not', () => {
    // A heart lying 30 degrees off the declared long axis.
    const radians = (30 * Math.PI) / 180;
    const { basis } = frameFromFourChamber(fourChamber({
      beam_axis: [0, Math.cos(radians), Math.sin(radians)] as Vec3,
      lateral_axis: [1, 0, 0] as Vec3,
    }));
    const off = frameDisagreementDeg(basis, declared);
    expect(off.basal).toBeCloseTo(30, 6);
    expect(off.patient_left).toBeCloseTo(0, 6);
    expect(off.anterior).toBeCloseTo(30, 6);
  });
});
