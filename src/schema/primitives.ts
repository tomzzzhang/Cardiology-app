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

/**
 * `YYYY-MM-DD`. Dates are authored, not generated, so the calendar day is enough.
 *
 * The shape check alone would admit `2026-13-45`, so the day is also required to
 * survive a round trip through the calendar — a provenance date that does not
 * exist is a data error, not a formatting one.
 */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO calendar date, YYYY-MM-DD')
  .refine(
    (value) => {
      const [year, month, day] = value.split('-').map(Number);
      const parsed = new Date(Date.UTC(year, month - 1, day));
      return (
        parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() === month - 1 &&
        parsed.getUTCDate() === day
      );
    },
    { message: 'expected a real calendar date' },
  );

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

/**
 * Reasons a candidate asset path is not pack-relative, or `null` if it is.
 *
 * Exported so the adversarial tests can assert on the specific reason rather
 * than merely that something was refused.
 *
 * Assets resolve through the WHATWG URL parser (`resolveAsset`), which treats
 * backslashes as separators and decodes percent-encoding — so a literal `..`
 * check alone does not deliver the invariant this schema and
 * `contracts/pack-loader.md` both state. Every form that the parser could turn
 * into a separator or a dot segment is refused here, and the check runs on the
 * percent-decoded string so an encoded traversal cannot slip past.
 */
export function assetPathProblem(value: string): string | null {
  if (value.length === 0) return 'asset path must not be empty';
  if (value.includes('\\')) {
    return 'asset paths must use "/" separators; "\\" is a separator to the URL parser';
  }
  if (value.includes('?') || value.includes('#')) {
    return 'asset paths must not carry a query or fragment';
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return 'asset path is not valid percent-encoding';
  }
  if (decoded.includes('\\')) {
    return 'asset paths must not encode "\\" separators';
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded)) {
    return 'asset paths must not carry a scheme or drive prefix';
  }
  if (decoded.startsWith('/')) {
    return 'asset paths are resolved relative to the pack directory';
  }

  const segments = decoded.split('/');
  if (segments.some((segment) => segment.length === 0)) {
    return 'asset paths must not contain empty segments';
  }
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return 'asset paths must not traverse outside the pack directory';
  }
  return null;
}

/** Pack-relative asset path. Absolute URLs, schemes, and any traversal form are rejected. */
export const AssetPath = z.string().superRefine((value, ctx) => {
  const problem = assetPathProblem(value);
  if (problem !== null) {
    ctx.addIssue({ code: 'custom', message: problem });
  }
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
