/**
 * pack-loader failure paths.
 *
 * `contracts/pack-loader.md` rule 4: a bad pack fails loudly at the boundary and
 * is never repaired. Nothing exercised those paths before, so the behaviour that
 * makes the rule true was unlocked against regression.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PackLoadError, loadPack, loadPackById, resolveAsset } from '../../src/packs/loadPack.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const stubPath = join(repoRoot, 'public', 'packs', 'stub', 'pack.json');
const PACK_URL = 'http://packs.invalid/packs/stub/pack.json';

function stubPack(): Record<string, unknown> {
  return JSON.parse(readFileSync(stubPath, 'utf8')) as Record<string, unknown>;
}

function packOnDisk(packId: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(repoRoot, 'public', 'packs', packId, 'pack.json'), 'utf8'),
  ) as Record<string, unknown>;
}

function respondWith(body: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}) {
  const response = {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: async () => {
      if (typeof body === 'string') throw new SyntaxError('Unexpected token in JSON');
      return body;
    },
  };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadPack happy path', () => {
  it('returns the validated pack and a base URL its assets resolve against', async () => {
    respondWith(stubPack());
    const loaded = await loadPack(PACK_URL);

    expect(loaded.pack.meta.id).toBe('stub');
    expect(loaded.baseUrl).toBe('http://packs.invalid/packs/stub/');
    expect(resolveAsset(loaded, loaded.pack.meshes.gltf)).toBe(
      'http://packs.invalid/packs/stub/assets/stub.gltf',
    );
  });

  it('keeps a picker-hidden research pack loadable by explicit development id', async () => {
    const packId = 'tof-cobivecox-chd0017001';
    respondWith(packOnDisk(packId));

    const loaded = await loadPackById(packId);

    expect(loaded.pack.meta.id).toBe(packId);
    expect(fetch).toHaveBeenCalledWith(`/packs/${packId}/pack.json`, undefined);
  });
});

describe('loadPack failure paths', () => {
  it('reports a network failure without swallowing the cause', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('connection refused')));

    await expect(loadPack(PACK_URL)).rejects.toThrow(PackLoadError);
    await expect(loadPack(PACK_URL)).rejects.toThrow(/connection refused/);
  });

  it('reports an HTTP error with its status', async () => {
    respondWith({}, { ok: false, status: 404, statusText: 'Not Found' });

    await expect(loadPack(PACK_URL)).rejects.toThrow(/HTTP 404 Not Found/);
  });

  it('reports invalid JSON as invalid JSON, not as a schema failure', async () => {
    respondWith('this is not json');

    await expect(loadPack(PACK_URL)).rejects.toThrow(/not valid JSON/);
  });

  it('refuses a future schema version with a version message', async () => {
    const pack = stubPack();
    (pack.meta as Record<string, unknown>).schema_version = '1';
    respondWith(pack);

    const error = await loadPack(PACK_URL).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PackLoadError);
    expect((error as PackLoadError).message).toMatch(/declares schema_version "1"/);
    // The version fast path must fire instead of a wall of shape errors.
    expect((error as PackLoadError).issues).toHaveLength(0);
  });

  it('refuses an unquoted numeric schema version the same way', async () => {
    const pack = stubPack();
    (pack.meta as Record<string, unknown>).schema_version = 1;
    respondWith(pack);

    await expect(loadPack(PACK_URL)).rejects.toThrow(/declares schema_version "1"/);
  });

  it('reports schema violations as issues with paths', async () => {
    const pack = stubPack();
    delete (pack.provenance as Record<string, unknown>).license_url;
    respondWith(pack);

    const error = (await loadPack(PACK_URL).catch((caught: unknown) => caught)) as PackLoadError;
    expect(error).toBeInstanceOf(PackLoadError);
    expect(error.issues.map((issue) => issue.path)).toContain('provenance.license_url');
    expect(error.message).toMatch(/failed schema v0\.1 validation/);
    expect(error.url).toBe(PACK_URL);
  });
});
