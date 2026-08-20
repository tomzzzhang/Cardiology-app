/**
 * The derived standoff, against synthetic spheres and against every pack.
 *
 * The claim under test is geometric and exact — "the model's bounding sphere is
 * inside the fan at the computed distance" — so it is asserted the way a
 * geometric claim should be: by taking points ON the sphere and checking each
 * one against the sector's own two bounds. An analytic identity that is only
 * ever compared against itself proves nothing about the sector a learner sees.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FAN_ANGLE_DEG, defaultDepthCm, depthShortfallCm, derivedStandoffMm,
  requiredDepthCm, sphereInsideFan, tangentStandoffMm,
} from '../../src/authoring/standoff.ts';
import { boundingSphereFromGltf } from '../../scripts/lib/gltfBounds.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const packsDir = join(repoRoot, 'public', 'packs');

/** Fibonacci sphere: points spread evenly over the surface, no pole clustering. */
function pointsOnSphere(
  centre: readonly [number, number, number], radius: number, count = 512,
): [number, number, number][] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const points: [number, number, number][] = [];
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / (count - 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    points.push([
      centre[0] + radius * Math.cos(theta) * ring,
      centre[1] + radius * y,
      centre[2] + radius * Math.sin(theta) * ring,
    ]);
  }
  return points;
}

/**
 * Every point of the sphere is inside the sector of revolution, measured.
 *
 * The probe sits at the origin looking down +y at a sphere centred `standoff`
 * away; a point is inside when its angle off the beam is within the half-angle
 * AND its range is within the depth. Both, because a sector is bounded two
 * ways.
 */
function everyPointInsideFan(input: {
  standoffMm: number; radiusMm: number; fanAngleDeg: number; depthMm: number;
}): { inside: boolean; worstAngleDeg: number; worstRangeMm: number } {
  const half = (input.fanAngleDeg * Math.PI) / 360;
  let worstAngle = 0;
  let worstRange = 0;
  let inside = true;
  for (const point of pointsOnSphere([0, input.standoffMm, 0], input.radiusMm)) {
    const range = Math.hypot(point[0], point[1], point[2]);
    // Angle off the beam axis, which is +y.
    const angle = Math.atan2(Math.hypot(point[0], point[2]), point[1]);
    worstAngle = Math.max(worstAngle, angle);
    worstRange = Math.max(worstRange, range);
    if (angle > half + 1e-12 || range > input.depthMm + 1e-9) inside = false;
  }
  return { inside, worstAngleDeg: (worstAngle * 180) / Math.PI, worstRangeMm: worstRange };
}

describe('tangency is the exact answer, and the derivation sits outside it', () => {
  it.each([30, 45, 60, 75, 90, 120, 150])('is R / sin(half-angle) at %i degrees', (angle) => {
    const radius = 37;
    const half = (angle * Math.PI) / 360;
    expect(tangentStandoffMm(radius, angle)).toBeCloseTo(radius / Math.sin(half), 12);
  });

  it.each([30, 45, 60, 75, 90, 120, 150])(
    'at tangency the sphere touches the sector edge exactly, at %i degrees',
    (angle) => {
      const radius = 37;
      const standoff = tangentStandoffMm(radius, angle);
      const measured = everyPointInsideFan({
        standoffMm: standoff, radiusMm: radius, fanAngleDeg: angle, depthMm: 1e9,
      });
      /*
       * The worst point sits ON the edge: not outside it, and not measurably
       * inside it either. The tolerance is a SAMPLING tolerance rather than a
       * numerical one — 512 points spread over a sphere do not in general
       * include the exact tangent point, so the measured worst angle
       * undershoots the true one by a fraction of a degree. That is the cost of
       * measuring the sector rather than restating the identity, and it is
       * cheap at this size.
       */
      expect(measured.worstAngleDeg).toBeLessThanOrEqual(angle / 2 + 1e-9);
      expect(measured.worstAngleDeg).toBeGreaterThan(angle / 2 - 0.01);
      expect(measured.inside).toBe(true);
    },
  );

  it('refuses a degenerate radius or angle rather than returning an infinity', () => {
    expect(() => tangentStandoffMm(0, 60)).toThrow(/positive radius/);
    expect(() => tangentStandoffMm(-1, 60)).toThrow(/positive radius/);
    expect(() => tangentStandoffMm(10, 0)).toThrow(/positive fan angle/);
  });
});

describe('the derived standoff contains the bounding sphere, with margin', () => {
  const angles = [30, 45, 60, 75, 90, 120, 150];
  const radii = [1.7, 37, 59.5, 106.3, 140.6, 1000];

  it.each(angles.flatMap((angle) => radii.map((radius) => [angle, radius] as const)))(
    'fan %i degrees, radius %f: every point of the sphere is inside the sector',
    (angle, radius) => {
      const standoff = derivedStandoffMm(radius, angle);
      const depth = defaultDepthCm(standoff, radius) * 10;

      const measured = everyPointInsideFan({
        standoffMm: standoff, radiusMm: radius, fanAngleDeg: angle, depthMm: depth,
      });
      expect(measured.inside).toBe(true);
      // And with room: the widest point of the model is clear of the sector's
      // edge, which is what the margin buys and what makes the pad's first
      // nudge safe.
      expect(measured.worstAngleDeg).toBeLessThan(angle / 2);

      // The analytic predicate agrees with the measurement.
      expect(sphereInsideFan({
        standoffMm: standoff, radiusMm: radius, fanAngleDeg: angle, depthMm: depth,
      })).toBe(true);
    },
  );

  it('a standoff one per cent inside tangency does NOT contain the sphere', () => {
    const radius = 60;
    const angle = 75;
    const tooClose = tangentStandoffMm(radius, angle) * 0.99;
    expect(everyPointInsideFan({
      standoffMm: tooClose, radiusMm: radius, fanAngleDeg: angle, depthMm: 1e9,
    }).inside).toBe(false);
    expect(sphereInsideFan({
      standoffMm: tooClose, radiusMm: radius, fanAngleDeg: angle, depthMm: 1e9,
    })).toBe(false);
  });

  it('a fan wide enough but too shallow is refused, not passed', () => {
    const radius = 60;
    const angle = 75;
    const standoff = derivedStandoffMm(radius, angle);
    expect(sphereInsideFan({
      standoffMm: standoff, radiusMm: radius, fanAngleDeg: angle, depthMm: standoff,
    })).toBe(false);
    expect(everyPointInsideFan({
      standoffMm: standoff, radiusMm: radius, fanAngleDeg: angle, depthMm: standoff,
    }).inside).toBe(false);
  });
});

describe('the depth shortfall measures the monotonic local expansion', () => {
  it('is null when the authored depth reaches past the far side', () => {
    expect(depthShortfallCm({ standoffMm: 200, radiusMm: 100, authoredDepthCm: 31 })).toBeNull();
  });

  it('is the exact shortfall in centimetres when it does not', () => {
    expect(depthShortfallCm({ standoffMm: 200, radiusMm: 100, authoredDepthCm: 20 }))
      .toBeCloseTo(10, 12);
  });

  it('requiredDepthCm is the far side of the sphere, in the fan’s own unit', () => {
    expect(requiredDepthCm(200, 100)).toBeCloseTo(30, 12);
  });
});

/* -------------------------------------------------------------------------- */
/* every pack on the shelf                                                     */
/* -------------------------------------------------------------------------- */

interface Shelf {
  id: string;
  radius: number;
  angleDeg: number;
  authoredDepthCm: number | null;
}

function shelf(): Shelf[] {
  const rows: Shelf[] = [];
  for (const entry of readdirSync(packsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packPath = join(packsDir, entry.name, 'pack.json');
    const pack = JSON.parse(readFileSync(packPath, 'utf8'));
    const sphere = boundingSphereFromGltf(join(packsDir, entry.name, pack.meshes.gltf));
    if (!sphere) continue;
    const view = pack.views[0];
    rows.push({
      id: entry.name,
      radius: sphere.radius,
      angleDeg: view ? view.probe.fan.angle_deg : DEFAULT_FAN_ANGLE_DEG,
      authoredDepthCm: view ? view.probe.fan.depth_cm : null,
    });
  }
  return rows;
}

describe('every pack on the shelf', () => {
  const rows = shelf();

  it('is measurable: nine packs, every one with a readable bounding sphere', () => {
    expect(rows).toHaveLength(9);
    for (const row of rows) expect(row.radius).toBeGreaterThan(0);
  });

  it.each(rows.map((row) => [row.id, row] as const))(
    '%s: the derived standoff puts the whole bounding sphere inside the sector',
    (_id, row) => {
      const standoff = derivedStandoffMm(row.radius, row.angleDeg);
      /*
       * Depth taken from the derivation, not from the pack, ON PURPOSE. This
       * isolates the ANGLE guarantee. Explicit placement now expands a shallow
       * local draft to this measured minimum; the source pack remains unchanged.
       */
      const depth = defaultDepthCm(standoff, row.radius) * 10;
      const measured = everyPointInsideFan({
        standoffMm: standoff, radiusMm: row.radius, fanAngleDeg: row.angleDeg, depthMm: depth,
      });
      expect(measured.inside).toBe(true);
      expect(measured.worstAngleDeg).toBeLessThan(row.angleDeg / 2);
    },
  );

  /*
   * The radius here is the CONSERVATIVE one — the half-diagonal of the box
   * bounding the transformed accessor extents, which is at least the true
   * bounding radius the runtime measures from the vertices themselves. A
   * standoff derived from a radius at least as large as the truth contains the
   * truth, so this direction of error is the safe one, and saying so is
   * cheaper than pretending the two numbers are one measurement.
   */
  it('the three authored depths that do not reach are named', () => {
    const short = rows
      .filter((row) => row.authoredDepthCm !== null)
      .map((row) => {
        const standoff = derivedStandoffMm(row.radius, row.angleDeg);
        return {
          id: row.id,
          shortCm: depthShortfallCm({
            standoffMm: standoff,
            radiusMm: row.radius,
            authoredDepthCm: row.authoredDepthCm as number,
          }),
        };
      })
      .filter((row) => row.shortCm !== null);

    /*
     * `normal-rodero`, `normal-alberta-neonatal` and `normal-vhl-heart0102`
     * carry authored fans whose depth cannot reach the far side of their own
     * model from ANY standoff that satisfies the angle — the two constraints
     * together need `depth >= radius * (1/sin(half) + 1)`, and all three are
     * under it. That is a content finding, reported here and in
     * `docs/observations.md`. Explicit placement reports and applies the
     * shortfall only to its local working pose; it does not bulk-edit these packs.
     */
    expect(short.map((row) => row.id).sort()).toEqual([
      'normal-alberta-neonatal', 'normal-rodero', 'normal-vhl-heart0102',
    ]);
  });
});
