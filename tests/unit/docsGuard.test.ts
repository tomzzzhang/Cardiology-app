/**
 * The `docs/` guard, exercised against real git history.
 *
 * `docs/` is read-only for workers, with exactly one sanctioned sync route for
 * the planning session. Both halves of that route matter, so both are tested:
 * a `docs/sync-*` branch name states the intent, and the docs-only check is
 * what actually stops a code change riding along under that intent.
 *
 * Each case builds a throwaway repository rather than mocking git, because the
 * guard's behaviour depends on real diff and log semantics.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const guard = join(repoRoot, 'scripts', 'check-docs-guard.sh');

let work: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: work, encoding: 'utf8' }).trim();
}

function write(relativePath: string, contents: string): void {
  const full = join(work, relativePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

function commit(message: string): string {
  git('add', '-A');
  git('-c', 'user.name=test', '-c', 'user.email=test@invalid', 'commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
}

/** Run the guard; return its exit code and combined output. */
function runGuard(baseSha: string, headRef: string): { code: number; output: string } {
  try {
    const output = execFileSync('bash', [guard], {
      cwd: work,
      encoding: 'utf8',
      env: { ...process.env, BASE_SHA: baseSha, HEAD_REF: headRef },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'docs-guard-test-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: work });
  write('README.md', 'root\n');
  commit('root');
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('initial sync — docs/ does not exist on the base', () => {
  it('allows additions', () => {
    const base = git('rev-parse', 'HEAD');
    write('docs/build_plan.md', 'v1.2\n');
    commit('sync docs');

    const result = runGuard(base, 'feat/00-wave0');
    expect(result.code).toBe(0);
    expect(result.output).toMatch(/initial sync, additions only/);
  });

  it('rejects a later commit editing what the same pull request just added', () => {
    const base = git('rev-parse', 'HEAD');
    write('docs/build_plan.md', 'v1.2\n');
    commit('sync docs');
    write('docs/build_plan.md', 'v1.2 tampered\n');
    commit('quietly edit the synced copy');

    const result = runGuard(base, 'feat/00-wave0');
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/modifies or deletes docs\/ content it also introduces/);
  });

  it('rejects a deletion of what it just added', () => {
    const base = git('rev-parse', 'HEAD');
    write('docs/build_plan.md', 'v1.2\n');
    write('docs/mvp_scope.md', 'locked\n');
    commit('sync docs');
    rmSync(join(work, 'docs', 'mvp_scope.md'));
    commit('drop one');

    expect(runGuard(base, 'feat/00-wave0').code).toBe(1);
  });
});

describe('after docs/ exists on the base', () => {
  let base: string;

  beforeEach(() => {
    write('docs/build_plan.md', 'v1.2\n');
    commit('sync docs');
    base = git('rev-parse', 'HEAD');
    git('checkout', '-q', '-b', 'work');
  });

  it('passes a pull request that leaves docs/ alone', () => {
    write('src/app.ts', 'export const a = 1;\n');
    commit('feature');

    const result = runGuard(base, 'feat/01a-model-pipeline');
    expect(result.code).toBe(0);
    expect(result.output).toMatch(/docs\/ unchanged/);
  });

  it('rejects a worker editing docs/', () => {
    write('docs/build_plan.md', 'v1.3 by a worker\n');
    commit('edit the spec');

    const result = runGuard(base, 'feat/01a-model-pipeline');
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/workers never edit them/);
    expect(result.output).toMatch(/docs\/sync-\*/);
  });

  it('rejects a worker adding a new file under docs/', () => {
    write('docs/sneaky.md', 'new\n');
    commit('add a doc');

    expect(runGuard(base, 'feat/01a-model-pipeline').code).toBe(1);
  });

  it('allows a docs-only sync on a docs/sync-* branch', () => {
    write('docs/build_plan.md', 'v1.3 from the planning session\n');
    commit('sync schema v1 revision');

    const result = runGuard(base, 'docs/sync-schema-v1');
    expect(result.code).toBe(0);
    expect(result.output).toMatch(/Sanctioned planning-session docs sync/);
  });

  it('rejects a docs/sync-* branch that also changes code', () => {
    write('docs/build_plan.md', 'v1.3\n');
    write('src/app.ts', 'export const smuggled = true;\n');
    commit('sync docs and sneak in a change');

    const result = runGuard(base, 'docs/sync-schema-v1');
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/may change nothing outside docs\//);
    expect(result.output).toMatch(/src\/app\.ts/);
  });

  it('rejects a docs edit on a branch that merely looks like the sync route', () => {
    write('docs/build_plan.md', 'v1.3\n');
    commit('edit');

    // `docs-sync/...` and `feat/docs/sync-...` are not the sanctioned prefix.
    expect(runGuard(base, 'docs-sync/schema-v1').code).toBe(1);
    expect(runGuard(base, 'feat/docs/sync-schema-v1').code).toBe(1);
  });
});

describe('input handling', () => {
  it('fails loudly when the required environment is missing', () => {
    const result = (() => {
      try {
        execFileSync('bash', [guard], {
          cwd: work,
          encoding: 'utf8',
          env: { ...process.env, BASE_SHA: '', HEAD_REF: '' },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { code: 0, output: '' };
      } catch (error) {
        const failure = error as { status?: number; stderr?: string };
        return { code: failure.status ?? 1, output: failure.stderr ?? '' };
      }
    })();

    expect(result.code).not.toBe(0);
    expect(result.output).toMatch(/BASE_SHA is required/);
  });
});
