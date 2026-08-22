/**
 * How far a probe origin is from the skin, and how far it is allowed to be.
 *
 * ## Why this is one module and not two copies
 *
 * `scripts/check-probe-on-skin.ts` gates canon-family poses at build time and
 * the authoring viewer has to say the same thing about the pose on screen. Both
 * need the same tolerance and the same measure, and a physical constant written
 * down twice is a physical constant that drifts — the argument
 * `shared/imaging-constants.json` makes for the elevation slab, made again here.
 * The difference is that both consumers are TypeScript, so this is a module
 * rather than a JSON file the two languages parse.
 *
 * The gate is unchanged by the extraction: it imports the tolerance and the
 * distance it already used, and its scope, its canon-family filter and its
 * exclusion of the `INGEST` family stay exactly where they were.
 *
 * ## Point-to-TRIANGLE, not point-to-nearest-vertex
 *
 * The shipped skin is decimated to a triangle budget, so its vertices are
 * millimetres apart. A probe genuinely resting on the surface can be several
 * millimetres from the nearest vertex — `normal-rodero`'s parasternal short
 * axis is 8.15 mm from one and 0.07 mm from the surface — so a vertex test
 * fails correct poses and buys nothing.
 */

/** A point or a position, in whatever space the caller is working in. */
export type Point3 = readonly [number, number, number];

/**
 * How far a probe origin may sit from the skin surface, in millimetres.
 *
 * Not zero, and the reason is measurement rather than generosity: the shipped
 * skin is a decimated surface and a real transducer couples through gel. But it
 * is tight, because the measurement below is point-to-SURFACE: of the fourteen
 * poses actually placed against this body, thirteen sit under 0.1 mm from it and
 * the widest — an aperture `pipeline/migrate_apertures.py` slid onto the wall
 * along its own beam — sits at 3.16 mm. Five millimetres accepts all of them
 * with room to spare and rejects anything that is not in contact.
 */
export const SKIN_CONTACT_TOLERANCE_MM = 5;

/**
 * Squared distance from a point to one triangle.
 *
 * Squared, and returned squared: the caller compares thousands of these and
 * takes one square root at the end.
 */
export function pointTriangleSquared(p: Point3, a: Point3, b: Point3, c: Point3): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];

  const d1 = ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2];
  const d2 = ac[0] * ap[0] + ac[1] * ap[1] + ac[2] * ap[2];
  let u = 0;
  let v = 0;
  if (!(d1 <= 0 && d2 <= 0)) {
    const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
    const d3 = ab[0] * bp[0] + ab[1] * bp[1] + ab[2] * bp[2];
    const d4 = ac[0] * bp[0] + ac[1] * bp[1] + ac[2] * bp[2];
    const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    const d5 = ab[0] * cp[0] + ab[1] * cp[1] + ab[2] * cp[2];
    const d6 = ac[0] * cp[0] + ac[1] * cp[1] + ac[2] * cp[2];
    const vc = d1 * d4 - d3 * d2;
    const vb = d5 * d2 - d1 * d6;
    const va = d3 * d6 - d5 * d4;

    if (d3 >= 0 && d4 <= d3) { u = 1; v = 0; }
    else if (d6 >= 0 && d5 <= d6) { u = 0; v = 1; }
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) { u = d1 / (d1 - d3); v = 0; }
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) { u = 0; v = d2 / (d2 - d6); }
    else if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
      const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      u = 1 - w; v = w;
    } else {
      const denom = 1 / (va + vb + vc);
      u = vb * denom; v = vc * denom;
    }
  }

  const q = [a[0] + ab[0] * u + ac[0] * v, a[1] + ab[1] * u + ac[1] * v,
    a[2] + ab[2] * u + ac[2] * v];
  const dx = p[0] - q[0]; const dy = p[1] - q[1]; const dz = p[2] - q[2];
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Distance from a point to the nearest triangle of an indexed surface.
 *
 * `positions` and `indices` must be in the SAME space as `point`; nothing here
 * transforms anything, because the two callers hold different transforms and
 * silently applying one of them would be wrong for the other.
 *
 * Brute force over every triangle. The shipped skin is 30,000 of them, which is
 * about a millisecond, and both callers measure once per pose rather than once
 * per frame. An acceleration structure would be a second thing that can be
 * wrong about geometry the gate has to be exactly right about.
 */
export function distanceToSurfaceMm(
  point: Point3, positions: Float32Array, indices: Uint32Array,
): number {
  let best = Infinity;
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3; const ib = indices[i + 1] * 3; const ic = indices[i + 2] * 3;
    const squared = pointTriangleSquared(
      point,
      [positions[ia], positions[ia + 1], positions[ia + 2]],
      [positions[ib], positions[ib + 1], positions[ib + 2]],
      [positions[ic], positions[ic + 1], positions[ic + 2]],
    );
    if (squared < best) best = squared;
  }
  return Math.sqrt(best);
}
