import { z } from 'zod';
import { Pack } from './packV0.ts';

export interface PackIssue {
  /** Dotted JSON path, e.g. `views.0.probe.beam_axis`. */
  path: string;
  message: string;
}

export type PackValidation =
  | { ok: true; pack: Pack; issues: [] }
  | { ok: false; pack: null; issues: PackIssue[] };

function formatPath(path: PropertyKey[]): string {
  return path.length === 0 ? '<root>' : path.map(String).join('.');
}

export function toIssues(error: z.ZodError): PackIssue[] {
  return error.issues.map((issue) => ({
    path: formatPath(issue.path as PropertyKey[]),
    message: issue.message,
  }));
}

/**
 * Validate an unknown value against content-pack schema v0.
 *
 * Never throws: callers decide how a bad pack surfaces. The loader turns this
 * into a `PackLoadError`; the CI validator prints and exits non-zero.
 */
export function validatePack(value: unknown): PackValidation {
  const result = Pack.safeParse(value);
  if (result.success) {
    return { ok: true, pack: result.data, issues: [] };
  }
  return { ok: false, pack: null, issues: toIssues(result.error) };
}

/**
 * Cheap pre-check so a v1 pack fed to a v0 engine fails with a version message
 * instead of a wall of shape errors.
 */
export function readSchemaVersion(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const meta = (value as { meta?: unknown }).meta;
  if (typeof meta !== 'object' || meta === null) return null;
  const version = (meta as { schema_version?: unknown }).schema_version;
  if (typeof version === 'string') return version;
  // A pack that writes `0` or `1` unquoted still declared a version. Report it
  // so the caller refuses with a version message rather than a shape-error wall.
  if (typeof version === 'number' && Number.isFinite(version)) return String(version);
  return null;
}

export function formatIssues(issues: PackIssue[]): string {
  return issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n');
}
