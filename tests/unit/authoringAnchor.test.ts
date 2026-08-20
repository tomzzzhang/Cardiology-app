/**
 * The anchored pose: an ordinary `ProbePose`, and nothing can tell otherwise.
 *
 * Two claims are worth more than the rest here. The first is that the pose
 * validates against the schema's own probe refinements — unit axes, orthogonal
 * to 1e-3 — with room to spare rather than by a whisker. The second is that
 * `imagingFrame` accepts it UNCHANGED: the orthogonalisation went through
 * `probeFrame.ts` on the way out, so running it again is a no-op, which is what
 * makes the wedge and the echo derive from this pose exactly as they do from a
 * vetted one.
 */
import { describe, expect, it } from 'vitest';
import { anchoredPose, defaultTemplate, type ViewAnchor } from '../../src/authoring/anchor.ts';
import { derivedStandoffMm } from '../../src/authoring/standoff.ts';
import { imagingFrame } from '../../src/echo/probeFrame.ts';
import { ProbePose } from '../../src/schema/packV0.ts';
import { ORTHOGONAL_TOLERANCE, UNIT_TOLERANCE, type Vec3 } from '../../src/schema/primitives.ts';

const TEMPLATE = {
  fan: { angle_deg: 80, depth_cm: 30, focus_cm: 12 },
  display: { vertex: 'down', flip_lr: false, marker_side: 'right' },
} as const;

/** A camera looking down -z at a model at the origin, with a tidy right vector. */
function straightOn(radius = 100): ViewAnchor {
  return { forward: [0, 0, -1], right: [1, 0, 0], centre: [0, 0, 0], radius };
}

/** A camera at a deliberately awkward angle, with a right vector that is not unit. */
function oblique(): ViewAnchor {
  return {
    forward: [0.37, -0.81, 0.45],
    right: [0.9, 0.41, -0.001],
    centre: [-5, 1.3, 8.5],
    radius: 106.3,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function norm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

describe('the pose is one the schema and the renderer both accept', () => {
  it.each([['straight on', straightOn()], ['oblique', oblique()]] as const)(
    '%s: validates against ProbePose',
    (_label, anchor) => {
      const { pose } = anchoredPose(anchor, TEMPLATE);
      expect(ProbePose.safeParse(pose).success).toBe(true);
    },
  );

  it.each([['straight on', straightOn()], ['oblique', oblique()]] as const)(
    '%s: the axes are unit and orthogonal far tighter than the schema asks',
    (_label, anchor) => {
      const { pose } = anchoredPose(anchor, TEMPLATE);
      const beam = pose.beam_axis as Vec3;
      const lateral = pose.lateral_axis as Vec3;

      // The schema tolerates 1e-3 on both. These are at machine precision, so
      // the pose is not merely admissible — it is exact to the bit the renderer
      // would have produced anyway.
      expect(Math.abs(norm(beam) - 1)).toBeLessThan(1e-15);
      expect(Math.abs(norm(lateral) - 1)).toBeLessThan(1e-15);
      expect(Math.abs(dot(beam, lateral))).toBeLessThan(1e-15);

      expect(Math.abs(norm(beam) - 1)).toBeLessThan(UNIT_TOLERANCE);
      expect(Math.abs(dot(beam, lateral))).toBeLessThan(ORTHOGONAL_TOLERANCE);
    },
  );

  it('imagingFrame accepts it unchanged: the orthogonalisation already went through it', () => {
    const { pose } = anchoredPose(oblique(), TEMPLATE);
    const frame = imagingFrame(pose);
    for (let axis = 0; axis < 3; axis += 1) {
      expect(frame.beam[axis]).toBeCloseTo((pose.beam_axis as Vec3)[axis], 15);
      expect(frame.lateral[axis]).toBeCloseTo((pose.lateral_axis as Vec3)[axis], 15);
    }
  });

  it('a right vector nearly parallel to the beam still yields an orthonormal frame', () => {
    // Not a case a camera produces — a camera's right is orthogonal to its
    // forward by construction — but the guarantee should not depend on that.
    const anchor: ViewAnchor = {
      forward: [0, 0, -1], right: [1e-6, 0, -1], centre: [0, 0, 0], radius: 50,
    };
    const { pose } = anchoredPose(anchor, TEMPLATE);
    expect(ProbePose.safeParse(pose).success).toBe(true);
    expect(Math.abs(dot(pose.beam_axis as Vec3, pose.lateral_axis as Vec3))).toBeLessThan(1e-12);
  });

  it('refuses a degenerate view axis rather than emitting a pose with a NaN in it', () => {
    const anchor: ViewAnchor = {
      forward: [0, 0, 0], right: [1, 0, 0], centre: [0, 0, 0], radius: 50,
    };
    expect(() => anchoredPose(anchor, TEMPLATE)).toThrow(/degenerate/);
  });
});

describe('where the probe lands', () => {
  it('sits on the camera axis, at the derived standoff, aimed at the model', () => {
    const anchor = straightOn(100);
    const { pose, report } = anchoredPose(anchor, TEMPLATE);
    const expected = derivedStandoffMm(100, TEMPLATE.fan.angle_deg);

    expect(report.standoffMm).toBeCloseTo(expected, 12);
    // Camera looks down -z, so the probe is on the +z side of the model.
    expect(pose.origin[0]).toBeCloseTo(0, 12);
    expect(pose.origin[1]).toBeCloseTo(0, 12);
    expect(pose.origin[2]).toBeCloseTo(expected, 12);
    expect(pose.beam_axis).toEqual([0, 0, -1]);
  });

  it('the beam through the origin passes exactly through the bounding sphere centre', () => {
    const anchor = oblique();
    const { pose, report } = anchoredPose(anchor, TEMPLATE);
    const toCentre: Vec3 = [
      anchor.centre[0] - pose.origin[0],
      anchor.centre[1] - pose.origin[1],
      anchor.centre[2] - pose.origin[2],
    ];
    expect(norm(toCentre)).toBeCloseTo(report.standoffMm, 9);
    // Parallel to the beam, not merely near it: the cross product vanishes.
    const beam = pose.beam_axis as Vec3;
    const unitToCentre: Vec3 = [
      toCentre[0] / norm(toCentre), toCentre[1] / norm(toCentre), toCentre[2] / norm(toCentre),
    ];
    expect(dot(beam, unitToCentre)).toBeCloseTo(1, 12);
  });

  it('changes placement only: the fan and display come from the template untouched', () => {
    const { pose } = anchoredPose(oblique(), TEMPLATE);
    expect(pose.fan).toEqual(TEMPLATE.fan);
    expect(pose.display).toEqual(TEMPLATE.display);
  });

  it('honours a pack standoff override, and reports that it did', () => {
    const { pose, report } = anchoredPose(straightOn(100), TEMPLATE, 140);
    expect(report.standoffMm).toBe(140);
    expect(report.overrideMm).toBe(140);
    expect(report.derivedMm).toBeCloseTo(derivedStandoffMm(100, TEMPLATE.fan.angle_deg), 12);
    expect(pose.origin[2]).toBeCloseTo(140, 12);
  });

  it('ignores a nonsensical override rather than placing the probe inside the heart', () => {
    for (const bad of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { report } = anchoredPose(straightOn(100), TEMPLATE, bad);
      expect(report.overrideMm).toBeNull();
      expect(report.standoffMm).toBeCloseTo(report.derivedMm, 12);
    }
  });
});

describe('what the report says, and what it refuses to do about it', () => {
  it('reports containment when the authored fan reaches', () => {
    const { report } = anchoredPose(straightOn(100), TEMPLATE);
    expect(report.requiredDepthCm).toBeCloseTo((report.standoffMm + 100) / 10, 12);
    expect(report.depthShortCm).toBeNull();
    expect(report.contains).toBe(true);
  });

  it('reports the shortfall, and does NOT move the probe closer to hide it', () => {
    const shallow = { ...TEMPLATE, fan: { ...TEMPLATE.fan, depth_cm: 16.79 } };
    const { pose, report } = anchoredPose(straightOn(106.3), shallow);

    expect(report.depthShortCm).not.toBeNull();
    expect(report.contains).toBe(false);
    // The standoff is the derived one regardless. A clamp here would be the
    // engine deciding a content question quietly.
    expect(report.standoffMm).toBeCloseTo(derivedStandoffMm(106.3, 80), 12);
    expect(pose.fan.depth_cm).toBe(16.79);
  });
});

describe('the default template, for a pack with no authored view at all', () => {
  it('produces a pose the schema accepts, and a fan that reaches', () => {
    for (const radius of [1.7, 59.5, 106.3, 140.6]) {
      const template = defaultTemplate(radius);
      const { pose, report } = anchoredPose(straightOn(radius), template);
      expect(ProbePose.safeParse(pose).success).toBe(true);
      expect(report.contains).toBe(true);
      expect(report.depthShortCm).toBeNull();
      expect(pose.fan.focus_cm).toBeLessThanOrEqual(pose.fan.depth_cm);
    }
  });
});
