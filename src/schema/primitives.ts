import { z } from 'zod';

/** Tolerance used when asserting that an authored vector is unit-length. */
export const UNIT_TOLERANCE = 1e-3;

/** Tolerance used when asserting that two authored axes are orthogonal. */
export const ORTHOGONAL_TOLERANCE = 1e-3;

/** Model-space vector, ordered `[x, y, z]`. */
export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3>;

export function length3(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Unit vector. Authoring tools normalize before export; the schema refuses
 * un-normalized input rather than silently normalizing, so that a bad export is
 * caught at the pack boundary instead of drifting into viewer maths.
 */
export const UnitVec3 = Vec3.refine((v) => Math.abs(length3(v) - 1) <= UNIT_TOLERANCE, {
  message: `vector must be unit length (tolerance ${UNIT_TOLERANCE})`,
});

/** `YYYY-MM-DD`. Dates are authored, not generated, so the calendar day is enough. */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO calendar date, YYYY-MM-DD');

/**
 * Absolute `http(s)` URL. Validated with the platform URL parser rather than a
 * regex so behaviour is identical in the browser loader and the Node CI checks.
 */
export const HttpUrl = z.string().refine(
  (value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  },
  { message: 'expected an absolute http(s) URL' },
);

/** Pack-relative asset path. Absolute URLs and parent traversal are rejected. */
export const AssetPath = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith('/') && !value.includes('://'), {
    message: 'asset paths are resolved relative to the pack directory',
  })
  .refine((value) => !value.split('/').includes('..'), {
    message: 'asset paths must not traverse outside the pack directory',
  });

/** Stable identifier used for structures, views, and labels. */
export const Slug = z
  .string()
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, 'expected a lowercase slug, e.g. "atrial-septum"');

/**
 * Probe indicator direction as a clock position on the chest
 * (12 = head, 3 = patient left, 6 = feet, 9 = patient right).
 *
 * `view_canon.md`: clock positions are INITIAL poses, not sweep kinematics.
 */
export const IndicatorClock = z
  .string()
  .regex(/^(1[0-2]|[1-9]):[0-5]\d$/, 'expected a clock position, e.g. "3:00" or "10:30"');
