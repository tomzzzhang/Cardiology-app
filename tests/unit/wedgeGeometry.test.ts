/**
 * The wedge and the echo must be the same fan.
 *
 * `contracts/viewer-core.md` asks for a wedge "driven by the same saved probe
 * pose and fan params as the echo panel (one-to-one match)". These tests assert
 * the geometric consequences of that: the sector is planar, its apex is the
 * probe origin, its half-angle and depth are the pose's, and it moves with a
 * sweep. A wedge that drifted from the echo would still look plausible on
 * screen, so "it renders" is not evidence.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ProbePose, Sweep } from '../../src/schema/packV0.ts';
import { dot, frameAt, imagingFrame, sub, type Vec3 } from '../../src/echo/probeFrame.ts';
import { wedgeGeometry, wedgeOutline } from '../../src/viewer/wedge.ts';

function probe(overrides: Partial<ProbePose> = {}): ProbePose {
  return {
    origin: [10, -5, 60],
    beam_axis: [0, 0, -1],
    lateral_axis: [1, 0, 0],
    fan: { angle_deg: 75, depth_cm: 15, focus_cm: 8 },
    display: { vertex: 'down', flip_lr: false, marker_side: 'right' },
    ...overrides,
  } as ProbePose;
}

function points(geometry: THREE.BufferGeometry): Vec3[] {
  const attribute = geometry.getAttribute('position');
  const out: Vec3[] = [];
  for (let i = 0; i < attribute.count; i += 1) {
    out.push([attribute.getX(i), attribute.getY(i), attribute.getZ(i)]);
  }
  return out;
}

describe('wedgeGeometry', () => {
  it('is planar — every vertex lies in the imaging plane', () => {
    const frame = imagingFrame(probe());
    for (const point of points(wedgeGeometry(frame))) {
      // Distance along the elevation normal from the probe origin must be zero.
      expect(Math.abs(dot(frame.normal, sub(point, frame.origin)))).toBeLessThan(1e-4);
    }
  });

  it('puts its apex at the probe origin', () => {
    const frame = imagingFrame(probe());
    const all = points(wedgeGeometry(frame));
    const atApex = all.filter(
      (point) => Math.hypot(...sub(point, frame.origin)) < 1e-6,
    );
    // One apex vertex per triangle in the fan.
    expect(atApex.length).toBeGreaterThan(8);
  });

  it('reaches exactly the fan depth and no further', () => {
    const frame = imagingFrame(probe());
    const radii = points(wedgeGeometry(frame)).map((p) => Math.hypot(...sub(p, frame.origin)));
    expect(Math.max(...radii)).toBeCloseTo(frame.depthMm, 3);
    expect(frame.depthMm).toBe(150);
  });

  it('spans exactly the fan angle', () => {
    const frame = imagingFrame(probe());
    const rim = points(wedgeGeometry(frame)).filter(
      (p) => Math.hypot(...sub(p, frame.origin)) > frame.depthMm * 0.99,
    );
    const angles = rim.map((p) => {
      const d = sub(p, frame.origin);
      const length = Math.hypot(...d);
      return Math.acos(dot(frame.beam, [d[0] / length, d[1] / length, d[2] / length]));
    });
    expect(Math.max(...angles)).toBeCloseTo(frame.halfAngleRad, 3);
  });

  it('follows a sweep instead of staying put', () => {
    const sweep: Sweep = {
      mode: 'tilt',
      axis: { direction: [1, 0, 0] },
      range: { unit: 'deg', from: -22, to: 22 },
      interpolation: 'slerp',
      structures_in_order: [],
    } as Sweep;

    const start = wedgeGeometry(frameAt(probe(), sweep, 0));
    const end = wedgeGeometry(frameAt(probe(), sweep, 1));
    const a = points(start);
    const b = points(end);

    const moved = a.filter((point, i) => Math.hypot(...sub(point, b[i])) > 1).length;
    // The apex stays put (rotation is about the probe origin); the rim sweeps.
    expect(moved).toBeGreaterThan(a.length * 0.5);
  });

  it('stays planar at every scrub position of a sweep', () => {
    const sweep: Sweep = {
      mode: 'tilt',
      axis: { direction: [1, 0, 0] },
      range: { unit: 'deg', from: -30, to: 30 },
      interpolation: 'slerp',
      structures_in_order: [],
    } as Sweep;

    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const frame = frameAt(probe(), sweep, t);
      for (const point of points(wedgeGeometry(frame))) {
        expect(Math.abs(dot(frame.normal, sub(point, frame.origin)))).toBeLessThan(1e-3);
      }
    }
  });

  it('tracks a fan angle and depth authored per view', () => {
    // Two views may differ in both, so the wedge cannot be one shape moved
    // around — it has to be rebuilt from the frame.
    const narrow = imagingFrame(probe({ fan: { angle_deg: 30, depth_cm: 6, focus_cm: 3 } } as Partial<ProbePose>));
    const radii = points(wedgeGeometry(narrow)).map((p) => Math.hypot(...sub(p, narrow.origin)));
    expect(Math.max(...radii)).toBeCloseTo(60, 3);
  });
});

describe('wedgeOutline', () => {
  /*
   * The outline is a TUBE, not a polyline, because WebGL ignores `linewidth`:
   * a `LineBasicMaterial` is one pixel wide whatever it is asked for, and the
   * imaging plane is the object the whole screen is about. So its vertices are
   * ring cross-sections around the path rather than the path itself, and the
   * assertions below are about the SHAPE the tube encloses.
   */
  const tubeRadius = (frame: ReturnType<typeof imagingFrame>) => frame.depthMm * 0.005;

  it('runs from the apex out to full depth and back', () => {
    const frame = imagingFrame(probe());
    const radii = points(wedgeOutline(frame)).map((p) => Math.hypot(...sub(p, frame.origin)));
    // Its nearest point is the apex, to within the tube's own thickness.
    expect(Math.min(...radii)).toBeLessThan(tubeRadius(frame) * 1.5);
    // Its furthest is the far arc, at the fan's authored depth.
    expect(Math.max(...radii)).toBeCloseTo(frame.depthMm, -1);
  });

  it('stays in the imaging plane, to within its own thickness', () => {
    /*
     * A tube has thickness in every direction including elevation, so this is
     * not the exact-planarity assertion the sector surface gets — but it still
     * catches an outline built in the wrong basis, which would leave the plane
     * by centimetres rather than by a millimetre.
     */
    const frame = imagingFrame(probe());
    for (const point of points(wedgeOutline(frame))) {
      expect(Math.abs(dot(frame.normal, sub(point, frame.origin))))
        .toBeLessThan(tubeRadius(frame) * 1.5);
    }
  });

  it('keeps its weight relative to the fan it outlines', () => {
    // Thickness scales with depth, so a shallow view's outline is not a rope
    // and a deep one's is not a hairline.
    const shallow = imagingFrame(probe({ fan: { angle_deg: 75, depth_cm: 6, focus_cm: 3 } } as Partial<ProbePose>));
    const deep = imagingFrame(probe({ fan: { angle_deg: 75, depth_cm: 18, focus_cm: 9 } } as Partial<ProbePose>));
    const spread = (frame: ReturnType<typeof imagingFrame>) =>
      Math.max(...points(wedgeOutline(frame))
        .map((p) => Math.abs(dot(frame.normal, sub(p, frame.origin)))));
    expect(spread(deep)).toBeGreaterThan(spread(shallow) * 2);
  });
});
