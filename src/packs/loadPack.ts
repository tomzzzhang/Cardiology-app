/**
 * pack-loader — fetch, schema-validate, parse. See `contracts/pack-loader.md`.
 *
 * The loader is the only place a pack crosses from untyped JSON into the typed
 * model. Nothing downstream re-validates, and nothing downstream may accept an
 * unvalidated pack.
 */
import { SCHEMA_VERSION, type Pack } from '../schema/packV0.ts';
import { isPublishedPack, unpublishedReason } from './published.ts';
import { loadBodyContext, type BodyContextResult } from './loadBodyContext.ts';
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
  /**
   * The body registration bound to this pack, if any.
   *
   * Loaded HERE rather than inside the viewer because the viewer's scene effect
   * builds the scene in body space, and a transform that arrived after the
   * scene did would mean either rebuilding it — a five-megabyte glTF reload —
   * or drawing one frame in the wrong space. It is part of what "the pack is
   * loaded" means.
   *
   * `state: 'none'` and `state: 'problem'` both leave the heart in model space.
   * Only `'problem'` is worth telling the learner about.
   */
  bodyContext: BodyContextResult;
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

  // Read as TEXT so the exact bytes can be digested: the body-context binding
  // pins `pack.json` by hash, and re-serialising the parsed object would digest
  // a different byte sequence than the one on disk.
  let text: string;
  try {
    text = await response.text();
  } catch (cause) {
    throw new PackLoadError(url, `pack could not be read: ${(cause as Error).message}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
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
    throw new PackLoadError(url, `pack failed schema v${SCHEMA_VERSION} validation:`, result.issues);
  }

  return {
    pack: result.pack,
    baseUrl: new URL('.', new URL(url, globalThis.location?.href ?? 'http://localhost/')).toString(),
    bodyContext: await loadBodyContext(result.pack, await sha256Hex(text), init),
  };
}

/**
 * Lowercase hex SHA-256 of a string, or `null` where the platform has no
 * WebCrypto.
 *
 * Null rather than a throw: the digest tightens the body-context binding from
 * "same pack id and version" to "same bytes", and that is a strengthening. A
 * runtime without `crypto.subtle` — an insecure origin, or a bare test harness
 * — should fall back to the version check rather than lose the registration
 * entirely.
 */
async function sha256Hex(text: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/**
 * Load a pack by id, refusing unpublished packs in a production build.
 *
 * This is a SECOND line, not the mechanism: unpublished packs are removed from
 * `dist/` at build time (`vite.config.ts`), so on the deployed site the files
 * are not there to fetch. The guard exists so that a deep link to a rejected
 * pack fails with an explanation of *why* it is not published, rather than a
 * bare 404 that looks like a broken deployment.
 *
 * In development every pack in the repository stays loadable. The rejected wave
 * 1a candidates are evidence, and the comparison that produced the substrate
 * verdict has to remain reproducible.
 */
export async function loadPackById(packId: string, init?: RequestInit): Promise<LoadedPack> {
  if (import.meta.env.PROD && !isPublishedPack(packId)) {
    const rejection = unpublishedReason(packId);
    throw new PackLoadError(
      packUrl(packId),
      rejection
        ? `pack "${packId}" is not published. ${rejection.licence}`
        : `pack "${packId}" is not part of the published build`,
    );
  }
  return loadPack(packUrl(packId), init);
}
