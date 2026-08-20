/**
 * The plane the echo images and the wedge the viewer draws are both derived
 * from one probe pose. These tests pin that derivation, because a disagreement
 * between the two is exactly the failure `contracts/echo-renderer.md` forbids.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ProbePose, Sweep } from '../../src/schema/packV0.ts';
import { echoOrientation } from '../../src/viewer/orbit.ts';
import {
  cross,
  dot,
  frameAt,
  imagingFrame,
  length,
  poseAt,
  rotateAbout,
  samplePoint,
  scanlineDirection,
  withApexFlip,
  type Vec3,
} from '../../src/echo/probeFrame.ts';

function probe(overrides: Partial<ProbePose> = {}): ProbePose {
  return {
    origin: [0, 0, 100],
    beam_axis: [0, 0, -1],
    lateral_axis: [1, 0, 0],
    fan: { angle_deg: 90, depth_cm: 12, focus_cm: 5 },
    display: { vertex: 'down', flip_lr: false, marker_side: 'right' },
    ...overrides,
  } as ProbePose;
}

describe('imagingFrame', () => {
  it('builds an orthonormal frame from the pose', () => {
    const frame = imagingFrame(probe());
    expect(length(frame.beam)).toBeCloseTo(1, 12);
    expect(length(frame.lateral)).toBeCloseTo(1, 12);
    expect(length(frame.normal)).toBeCloseTo(1, 12);
    expect(dot(frame.beam, frame.lateral)).toBeCloseTo(0, 12);
    expect(dot(frame.beam, frame.normal)).toBeCloseTo(0, 12);
    expect(dot(frame.lateral, frame.normal)).toBeCloseTo(0, 12);
  });

  it('re-orthogonalises a lateral axis that is only within schema tolerance', () => {
    // The schema admits a 1e-3 deviation. A frame built from it unrepaired
    // would give a fan that is not quite planar.
    const skewed = imagingFrame(probe({ lateral_axis: [1, 0, 9e-4] as unknown as Vec3 }));
    expect(dot(skewed.beam, skewed.lateral)).toBeCloseTo(0, 12);
  });

  it('converts fan geometry from centimetres to model millimetres once', () => {
    const frame = imagingFrame(probe());
    expect(frame.depthMm).toBe(120);
    expect(frame.focusMm).toBe(50);
    expect(frame.halfAngleRad).toBeCloseTo(Math.PI / 4, 12);
  });

  it('places the fan edges at plus and minus the half angle', () => {
    const frame = imagingFrame(probe());
    const centre = scanlineDirection(frame, 0);
    const edge = scanlineDirection(frame, 1);
    expect(centre).toEqual(frame.beam);
    expect(Math.acos(dot(centre, edge))).toBeCloseTo(frame.halfAngleRad, 12);
  });

  it('samples along the scanline at the requested depth', () => {
    const frame = imagingFrame(probe());
    const point = samplePoint(frame, 0, 40);
    expect(point[2]).toBeCloseTo(60, 12);
    expect(length([point[0], point[1], point[2] - 100])).toBeCloseTo(40, 12);
  });
});

describe('rotateAbout', () => {
  it('preserves length and returns to identity over a full turn', () => {
    const axis: Vec3 = [0, 1, 0];
    const turned = rotateAbout([1, 0, 0], axis, Math.PI * 2);
    expect(turned[0]).toBeCloseTo(1, 12);
    expect(length(turned)).toBeCloseTo(1, 12);
  });

  it('rotates a quarter turn in the right-handed sense', () => {
    const turned = rotateAbout([1, 0, 0], [0, 0, 1], Math.PI / 2);
    expect(turned[0]).toBeCloseTo(0, 12);
    expect(turned[1]).toBeCloseTo(1, 12);
  });
});

describe('poseAt', () => {
  const tilt: Sweep = {
    mode: 'tilt',
    axis: { direction: [1, 0, 0] },
    range: { unit: 'deg', from: -30, to: 30 },
    interpolation: 'slerp',
    structures_in_order: [],
  } as Sweep;

  it('returns the endpoints of the range at t = 0 and t = 1', () => {
    const start = poseAt(probe(), tilt, 0);
    const end = poseAt(probe(), tilt, 1);
    const angle = Math.acos(dot(start.beam_axis as Vec3, end.beam_axis as Vec3));
    expect((angle * 180) / Math.PI).toBeCloseTo(60, 6);
  });

  it('leaves the pose orthonormal at every scrub position', () => {
    for (const t of [0, 0.17, 0.5, 0.83, 1]) {
      const frame = frameAt(probe(), tilt, t);
      expect(length(frame.beam)).toBeCloseTo(1, 12);
      expect(dot(frame.beam, frame.lateral)).toBeCloseTo(0, 12);
    }
  });

  it('clamps scrub positions outside [0, 1] rather than extrapolating the sweep', () => {
    // A scrubber that overshoots must not drive the probe past its saved range.
    expect(poseAt(probe(), tilt, -5).beam_axis).toEqual(poseAt(probe(), tilt, 0).beam_axis);
    expect(poseAt(probe(), tilt, 9).beam_axis).toEqual(poseAt(probe(), tilt, 1).beam_axis);
  });

  it('rotates about the probe origin when the sweep names no axis origin', () => {
    expect(poseAt(probe(), tilt, 1).origin).toEqual(probe().origin);
  });

  it('rotates the origin about a named axis origin', () => {
    const swept = poseAt(
      probe(),
      { ...tilt, axis: { direction: [0, 1, 0], origin: [0, 0, 0] } } as Sweep,
      1,
    );
    expect(length(swept.origin as Vec3)).toBeCloseTo(100, 9);
    expect(swept.origin).not.toEqual(probe().origin);
  });

  it('translates the origin without turning the beam', () => {
    const slide: Sweep = {
      mode: 'translate',
      axis: { direction: [1, 0, 0] },
      range: { unit: 'mm', from: 0, to: 20 },
      interpolation: 'lerp',
      structures_in_order: [],
    } as Sweep;
    const swept = poseAt(probe(), slide, 1);
    expect(swept.origin).toEqual([20, 0, 100]);
    expect(swept.beam_axis).toEqual(probe().beam_axis);
  });

  it('treats slerp and lerp identically for a single-axis sweep', () => {
    // Documented in poseAt: for a fixed axis these are the same function, so the
    // schema flag currently selects nothing. Pinned so that stops being true
    // loudly rather than quietly.
    const asSlerp = poseAt(probe(), { ...tilt, interpolation: 'slerp' } as Sweep, 0.37);
    const asLerp = poseAt(probe(), { ...tilt, interpolation: 'lerp' } as Sweep, 0.37);
    expect(asSlerp).toEqual(asLerp);
  });

  it('keeps the derived plane normal consistent through a sweep', () => {
    // The wedge and the echo both read this normal. If it flipped mid-sweep the
    // image would mirror without the wedge doing so.
    const first = frameAt(probe(), tilt, 0);
    for (const t of [0.25, 0.5, 0.75, 1]) {
      const later = frameAt(probe(), tilt, t);
      expect(dot(first.normal, later.normal)).toBeGreaterThan(0);
      expect(length(cross(first.normal, later.normal))).toBeLessThan(1);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* UI-6: the apex toggle layers on the authored value, and replaces nothing    */
/* -------------------------------------------------------------------------- */

describe('the apex flip', () => {
  const authored = (vertex: 'up' | 'down') => imagingFrame({
    origin: [0, -80, 0],
    beam_axis: [0, 1, 0],
    lateral_axis: [1, 0, 0],
    fan: { angle_deg: 80, depth_cm: 14, focus_cm: 8 },
    display: { vertex, flip_lr: false, marker_side: 'right' },
    indicator_clock: '3:00',
  } as never);

  it('leaves the pack alone when it is off', () => {
    for (const vertex of ['up', 'down'] as const) {
      expect(withApexFlip(authored(vertex), false).vertex).toBe(vertex);
    }
  });

  it('inverts the authored value rather than setting one', () => {
    expect(withApexFlip(authored('down'), true).vertex).toBe('up');
    expect(withApexFlip(authored('up'), true).vertex).toBe('down');
  });

  /*
   * The pack's value is the DEFAULT and stays it — the paediatric vertex-down
   * convention and the PLAX apex-left exception are content, not preference
   * (`contracts/view-rail-sweep-scrubber.md` rule 6). Flipping twice is the
   * authored value back, exactly, which is what makes this a layer.
   */
  it('is its own inverse', () => {
    for (const vertex of ['up', 'down'] as const) {
      const twice = withApexFlip(withApexFlip(authored(vertex), true), true);
      expect(twice.vertex).toBe(vertex);
    }
  });

  it('changes nothing else about the frame', () => {
    const before = authored('down');
    const after = withApexFlip(before, true);
    expect(after.beam).toEqual(before.beam);
    expect(after.lateral).toEqual(before.lateral);
    expect(after.normal).toEqual(before.normal);
    expect(after.origin).toEqual(before.origin);
    expect(after.flipLr).toBe(before.flipLr);
    expect(after.markerSide).toBe(before.markerSide);
    expect(after.depthMm).toBe(before.depthMm);
  });

  /*
   * And it reaches the camera through exactly one door: "Match echo", whose job
   * is to make the two panels agree. Orienting to the authored frame while the
   * panel showed the flipped one would be the one control for agreement
   * producing disagreement.
   */
  it('turns the match-echo camera over, and nothing else does', () => {
    const frame = authored('down');
    const matched = echoOrientation(withApexFlip(frame, true));
    const unmatched = echoOrientation(frame);
    const upOf = (q: typeof matched) => new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    expect(upOf(matched).dot(upOf(unmatched))).toBeLessThan(-0.99);
  });
});
