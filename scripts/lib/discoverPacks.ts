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
  raw: unknown;
}

export function discoverPacks(): DiscoveredPack[] {
  if (!existsSync(packsRoot)) return [];

  return readdirSync(packsRoot)
    .filter((entry) => statSync(join(packsRoot, entry)).isDirectory())
    .sort()
    .map((id) => {
      const dir = join(packsRoot, id);
      const jsonPath = join(dir, 'pack.json');
      if (!existsSync(jsonPath)) {
        throw new Error(`pack directory "${id}" has no pack.json`);
      }
      return { id, dir, jsonPath, raw: JSON.parse(readFileSync(jsonPath, 'utf8')) as unknown };
    });
}

export function relativeToRepo(absolutePath: string): string {
  return absolutePath.startsWith(repoRoot)
    ? absolutePath.slice(repoRoot.length + 1)
    : absolutePath;
}
