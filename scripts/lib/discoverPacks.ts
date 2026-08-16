import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every shipped pack lives under `public/packs/<id>/pack.json`. */
export const packsRoot = join(repoRoot, 'public', 'packs');

export interface DiscoveredPack {
  id: string;
  dir: string;
  jsonPath: string;
  /** `null` when the pack could not be read; `problem` then says why. */
  raw: unknown;
  /** A readable reason this pack could not be loaded, or `null`. */
  problem: string | null;
}

/**
 * Collect every pack directory, including broken ones.
 *
 * A missing or malformed `pack.json` is reported as a `problem` on the entry
 * rather than thrown, so the caller prints one clean failure line per pack
 * instead of aborting the whole run with a stack trace on the first bad pack.
 */
export function discoverPacks(): DiscoveredPack[] {
  if (!existsSync(packsRoot)) return [];

  return readdirSync(packsRoot)
    .filter((entry) => statSync(join(packsRoot, entry)).isDirectory())
    .sort()
    .map((id) => {
      const dir = join(packsRoot, id);
      const jsonPath = join(dir, 'pack.json');

      if (!existsSync(jsonPath)) {
        return { id, dir, jsonPath, raw: null, problem: 'pack directory has no pack.json' };
      }
      try {
        return {
          id,
          dir,
          jsonPath,
          raw: JSON.parse(readFileSync(jsonPath, 'utf8')) as unknown,
          problem: null,
        };
      } catch (cause) {
        return {
          id,
          dir,
          jsonPath,
          raw: null,
          problem: `pack.json is not valid JSON: ${(cause as Error).message}`,
        };
      }
    });
}

export function relativeToRepo(absolutePath: string): string {
  return absolutePath.startsWith(repoRoot)
    ? absolutePath.slice(repoRoot.length + 1)
    : absolutePath;
}
