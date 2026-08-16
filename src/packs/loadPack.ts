/**
 * pack-loader — fetch, schema-validate, parse. See `contracts/pack-loader.md`.
 *
 * The loader is the only place a pack crosses from untyped JSON into the typed
 * model. Nothing downstream re-validates, and nothing downstream may accept an
 * unvalidated pack.
 */
import { SCHEMA_VERSION, type Pack } from '../schema/packV0.ts';
import { formatIssues, readSchemaVersion, validatePack, type PackIssue } from '../schema/validate.ts';

export class PackLoadError extends Error {
  readonly url: string;
  readonly issues: PackIssue[];

  constructor(url: string, message: string, issues: PackIssue[] = []) {
    super(issues.length > 0 ? `${message}\n${formatIssues(issues)}` : message);
    this.name = 'PackLoadError';
    this.url = url;
    this.issues = issues;
  }
}

/** A validated pack plus the base URL its relative assets resolve against. */
export interface LoadedPack {
  pack: Pack;
  /** Directory URL of `pack.json`, with a trailing slash. */
  baseUrl: string;
}

/** Resolve a pack-relative `AssetPath` against the pack directory. */
export function resolveAsset(loaded: LoadedPack, assetPath: string): string {
  return new URL(assetPath, loaded.baseUrl).toString();
}

/**
 * Resolve a pack id to its `pack.json` URL under the deployed base path.
 * Uses `import.meta.env.BASE_URL` so the same code works at `/` locally and at
 * `/<repository-name>/` on GitHub Pages.
 */
export function packUrl(packId: string): string {
  return `${import.meta.env.BASE_URL}packs/${packId}/pack.json`;
}

export async function loadPack(url: string, init?: RequestInit): Promise<LoadedPack> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    throw new PackLoadError(url, `pack fetch failed: ${(cause as Error).message}`);
  }

  if (!response.ok) {
    throw new PackLoadError(url, `pack fetch failed: HTTP ${response.status} ${response.statusText}`);
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (cause) {
    throw new PackLoadError(url, `pack is not valid JSON: ${(cause as Error).message}`);
  }

  const declared = readSchemaVersion(raw);
  if (declared !== null && declared !== SCHEMA_VERSION) {
    throw new PackLoadError(
      url,
      `pack declares schema_version "${declared}"; this engine implements v${SCHEMA_VERSION}`,
    );
  }

  const result = validatePack(raw);
  if (!result.ok) {
    throw new PackLoadError(url, 'pack failed schema v0 validation:', result.issues);
  }

  return {
    pack: result.pack,
    baseUrl: new URL('.', new URL(url, globalThis.location?.href ?? 'http://localhost/')).toString(),
  };
}

export async function loadPackById(packId: string, init?: RequestInit): Promise<LoadedPack> {
  return loadPack(packUrl(packId), init);
}
