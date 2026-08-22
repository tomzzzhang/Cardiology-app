/**
 * A transducer stands ON the patient, and the measurement that decides it.
 *
 * `scripts/check-probe-on-skin.ts` gates the poses a pack carries and the
 * authoring viewer badges the pose on screen. Both answer the same question
 * about the same surface with the same tolerance, and both now do it through
 * `src/viewer/skinContact.ts`. What is pinned here is the property that made
 * the module worth extracting rather than duplicating: point-to-TRIANGLE and
 * point-to-nearest-VERTEX are different numbers on a decimated surface, and the
 * gate's whole argument rests on using the first one.
 *
 * The distances asserted below are the arithmetic of the fixtures, not readings
 * off a shipped asset. The two real measurements — F1 at `normal-rodero` v0.1.4
 * and the chamber pack's ingest reference pose — live in `docs/observations.md`
 * entry 71 and are re-derivable by running the gate.
 */
import { describe, expect, it } from 'vitest';
import {
  SKIN_CONTACT_TOLERANCE_MM,
  distanceToSurfaceMm,
  pointTriangleSquared,
  type Point3,
} from '../../src/viewer/skinContact.ts';

/**
 * One large triangle in the z = 0 plane, with vertices far apart.
 *
 * A stand-in for a decimated skin patch: 100 mm on a side, which is the same
 * order as the shipped chest's spacing once it has been reduced to its triangle
 * budget. A point over the middle of it is close to the SURFACE and a long way
 * from every VERTEX, which is the case a vertex test gets wrong.
 */
const A: Point3 = [0, 0, 0];
const B: Point3 = [100, 0, 0];
const C: Point3 = [0, 100, 0];

function nearestVertexMm(p: Point3, vertices: readonly Point3[]): number {
  return Math.min(...vertices.map((v) => Math.hypot(p[0] - v[0], p[1] - v[1], p[2] - v[2])));
}

describe('skin contact — point to triangle', () => {
  it('measures the perpendicular when the foot of it is inside the triangle', () => {
    const p: Point3 = [20, 20, 3];
    expect(Math.sqrt(pointTriangleSquared(p, A, B, C))).toBeCloseTo(3, 10);
  });

  it('is zero for a point lying on the face', () => {
    expect(Math.sqrt(pointTriangleSquared([10, 10, 0], A, B, C))).toBeCloseTo(0, 10);
  });

  it('falls back to the nearest edge when the perpendicular lands outside', () => {
    // Beyond the hypotenuse: closest point is on the BC edge, at (50, 50, 0).
    const p: Point3 = [60, 60, 0];
    expect(Math.sqrt(pointTriangleSquared(p, A, B, C))).toBeCloseTo(Math.hypot(10, 10), 10);
  });

  it('falls back to a vertex when the point is past a corner', () => {
    const p: Point3 = [-4, -3, 0];
    expect(Math.sqrt(pointTriangleSquared(p, A, B, C))).toBeCloseTo(5, 10);
  });

  it('does not depend on the order the vertices are given in', () => {
    const p: Point3 = [12, 31, 7];
    const reference = pointTriangleSquared(p, A, B, C);
    for (const [a, b, c] of [[B, C, A], [C, A, B], [A, C, B], [B, A, C], [C, B, A]] as const) {
      expect(pointTriangleSquared(p, a, b, c)).toBeCloseTo(reference, 10);
    }
  });

  /*
   * THE REASON THE MODULE EXISTS.
   *
   * This is the shape of the real finding — the parasternal short axis measures
   * 8.15 mm to the nearest skin vertex and 0.07 mm to the skin — reproduced at
   * fixture scale: a probe 3 mm off a coarse surface reads as more than 25 mm
   * off it if the test asks about vertices. A vertex-based gate would reject a
   * pose that is in contact.
   */
  it('disagrees with a nearest-vertex test on a coarse surface, in the direction that matters', () => {
    const p: Point3 = [25, 25, 3];
    const surface = Math.sqrt(pointTriangleSquared(p, A, B, C));
    const vertex = nearestVertexMm(p, [A, B, C]);

    expect(surface).toBeCloseTo(3, 10);
    expect(vertex).toBeGreaterThan(25);
    expect(surface).toBeLessThanOrEqual(SKIN_CONTACT_TOLERANCE_MM);
    expect(vertex).toBeGreaterThan(SKIN_CONTACT_TOLERANCE_MM);
  });
});

describe('skin contact — point to an indexed surface', () => {
  /** Two triangles forming the unit-ish quad [0,100]^2 at z = 0. */
  const positions = Float32Array.from([
    0, 0, 0,
    100, 0, 0,
    0, 100, 0,
    100, 100, 0,
  ]);
  const indices = Uint32Array.from([0, 1, 2, 1, 3, 2]);

  it('returns the distance to the nearest triangle, not the first one', () => {
    // Over the far triangle, which is second in the index buffer.
    expect(distanceToSurfaceMm([90, 90, 4], positions, indices)).toBeCloseTo(4, 6);
  });

  it('is zero on the shared edge', () => {
    expect(distanceToSurfaceMm([50, 50, 0], positions, indices)).toBeCloseTo(0, 6);
  });

  it('measures signlessly — inside and outside are the same distance', () => {
    const above = distanceToSurfaceMm([30, 30, 9], positions, indices);
    const below = distanceToSurfaceMm([30, 30, -9], positions, indices);
    expect(above).toBeCloseTo(9, 6);
    expect(below).toBeCloseTo(above, 10);
  });

  it('reads a probe nine centimetres clear of the surface as off it', () => {
    // The shape of the chamber pack's ingest reference pose: 92.31 mm off skin.
    const distance = distanceToSurfaceMm([50, 50, 92.31], positions, indices);
    expect(distance).toBeCloseTo(92.31, 6);
    expect(distance).toBeGreaterThan(SKIN_CONTACT_TOLERANCE_MM);
  });
});

describe('the contact tolerance', () => {
  /*
   * Pinned, because it is a physical claim rather than a knob: five
   * millimetres is what the fourteen poses actually placed against this body
   * need — thirteen under 0.1 mm and the widest at 3.16 mm — and widening it
   * would start accepting poses that are not in contact. Changing it is a
   * decision about the evidence, which is why it has to fail a test first.
   */
  it('is 5 mm, and it is the one both the gate and the viewer use', () => {
    expect(SKIN_CONTACT_TOLERANCE_MM).toBe(5);
  });

  it('accepts the widest pose actually placed on this body and rejects a gap', () => {
    expect(3.16).toBeLessThanOrEqual(SKIN_CONTACT_TOLERANCE_MM);
    expect(66.05).toBeGreaterThan(SKIN_CONTACT_TOLERANCE_MM);
  });
});
