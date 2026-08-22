import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readExport, type SlotExport } from '../../src/authoring/exportFile.ts';
import { ViewCandidateEvidence } from '../../scripts/lib/viewCandidateEvidence.ts';
import { buildViewCandidateReviewSession } from '../../scripts/lib/viewCandidateReviewSession.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const evidence = ViewCandidateEvidence.parse(JSON.parse(readFileSync(join(
  repoRoot,
  'evidence/view-candidates/normal-rodero/pack-0.1.1/candidate-set-001.json',
), 'utf8')) as unknown);
const evidenceV2Path = join(
  repoRoot,
  'evidence/view-candidates/normal-rodero/pack-0.1.1/candidate-set-002.json',
);
const evidenceV2 = ViewCandidateEvidence.parse(
  JSON.parse(readFileSync(evidenceV2Path, 'utf8')) as unknown,
);
const sessionPath = join(
  repoRoot,
  'evidence/view-candidates/normal-rodero/pack-0.1.1/'
    + 'review-session-001.authoring-slots-v1.json',
);
const sessionV2Path = join(
  repoRoot,
  'evidence/view-candidates/normal-rodero/pack-0.1.1/'
    + 'review-session-002.authoring-slots-v1.json',
);
const cliPath = join(repoRoot, 'scripts', 'build-view-candidate-review-session.ts');
const tsxPath = join(repoRoot, 'node_modules', '.bin', 'tsx');
const evidencePath = join(
  repoRoot,
  'evidence/view-candidates/normal-rodero/pack-0.1.1/candidate-set-001.json',
);
const generatedAt = '2026-08-21T00:47:49.000Z';

describe('view-candidate review session', () => {
  it('reproduces the checked carrier and round-trips through authoring import', () => {
    const checked = JSON.parse(readFileSync(sessionPath, 'utf8')) as SlotExport;
    expect(buildViewCandidateReviewSession(evidence, checked.exported_at)).toEqual(checked);

    const imported = readExport(JSON.stringify(checked), 'normal-rodero', '0.1.1');
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    expect(imported.slots).toHaveLength(9);
    expect(imported.slots.map((slot) => slot.slotId)).toEqual([
      'view-b4-apical-three-chamber',
      'view-f1-right-parasternal-bicaval',
      'custom-1',
      'custom-2',
      'custom-3',
      'custom-4',
      'custom-5',
      'custom-6',
      'custom-7',
    ]);
    expect(imported.slots.some((slot) => slot.slotId === 'view-b2-apical-five-chamber')).toBe(false);
    expect(imported.slots.some((slot) => [
      'view-b1-apical-four-chamber',
      'view-c1-parasternal-long-axis',
      'view-c2-parasternal-short-axis',
    ].includes(slot.slotId))).toBe(false);

    const singles = evidence.candidates.filter((candidate) => candidate.kind === 'single');
    expect(imported.slots.slice(0, 2).map((slot) => slot.pose)).toEqual(
      singles.map((candidate) => candidate.coordinates.probe),
    );
    const series = evidence.candidates.find((candidate) => candidate.kind === 'series');
    expect(series?.selected_variant_id).toBeNull();
    expect(imported.slots.slice(2).map((slot) => slot.pose)).toEqual(
      series?.variants.map((variant) => variant.coordinates.probe),
    );
  });

  it('reproduces the current 12-slot set-002 carrier without selecting B2', () => {
    const checked = JSON.parse(readFileSync(sessionV2Path, 'utf8')) as SlotExport;
    expect(buildViewCandidateReviewSession(evidenceV2, checked.exported_at)).toEqual(checked);

    const imported = readExport(JSON.stringify(checked), 'normal-rodero', '0.1.1');
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    expect(imported.slots).toHaveLength(12);
    expect(imported.slots.some((slot) => slot.slotId === 'view-b2-apical-five-chamber')).toBe(false);
    const singles = evidenceV2.candidates.filter((candidate) => candidate.kind === 'single');
    expect(imported.slots.slice(0, 5).map((slot) => slot.pose)).toEqual(
      singles.map((candidate) => candidate.coordinates.probe),
    );
    const b1Replacement = singles.find(
      (candidate) => candidate.intended_view_id === 'b1-apical-four-chamber',
    );
    expect(b1Replacement?.replaces_source_view_id).toBe('b1-apical-four-chamber');
    expect(imported.slots[0]).toMatchObject({
      slotId: 'view-b1-apical-four-chamber',
      kind: 'canon',
      pose: b1Replacement?.coordinates.probe,
    });
    for (const [index, viewId] of [
      'c1-parasternal-long-axis',
      'c2-parasternal-short-axis',
    ].entries()) {
      const replacement = singles.find((candidate) => candidate.intended_view_id === viewId);
      expect(replacement?.replaces_source_view_id).toBe(viewId);
      expect(imported.slots[index + 1]).toMatchObject({
        slotId: `view-${viewId}`,
        kind: 'canon',
        pose: replacement?.coordinates.probe,
      });
    }
    const series = evidenceV2.candidates.find((candidate) => candidate.kind === 'series');
    expect(series?.selected_variant_id).toBeNull();
    expect(imported.slots.slice(5).map((slot) => slot.pose)).toEqual(
      series?.variants.map((variant) => variant.coordinates.probe),
    );
    expect(imported.slots.every((slot) => slot.label.includes('candidate-002'))).toBe(true);

    for (const candidate of evidenceV2.candidates) {
      const checkSets = candidate.kind === 'single'
        ? [candidate.checks]
        : candidate.variants.map((variant) => variant.checks);
      for (const checks of checkSets) {
        const proxy = checks.find(
          (entry) => entry.check_id.endsWith('.aperture-gap-proxy'),
        );
        expect(proxy?.measurement.provisional_adult_aperture_gap_mm).toBe(30);
        expect(proxy?.measurement.minimum_source_forward_projection_mm)
          .toBeGreaterThanOrEqual(30);
      }
    }
  });

  it('keeps preview, verification, path containment, and safe replacement fail-closed', () => {
    const checkedBytes = readFileSync(sessionPath, 'utf8');
    const baseArgs = [cliPath, evidencePath, sessionPath, generatedAt];

    const preview = spawnSync(tsxPath, baseArgs, { cwd: repoRoot, encoding: 'utf8' });
    expect(preview.status, preview.stderr).toBe(0);
    expect(preview.stdout).toBe(checkedBytes);
    expect(preview.stderr).toContain('preview only');
    expect(readFileSync(sessionPath, 'utf8')).toBe(checkedBytes);

    const check = spawnSync(tsxPath, [...baseArgs, '--check'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toContain('9 Draft test views');

    const ambiguous = spawnSync(tsxPath, [...baseArgs, '--write', '--check'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(ambiguous.status).not.toBe(0);
    expect(ambiguous.stderr).toContain('choose either --write or --check');

    const overwrite = spawnSync(tsxPath, [...baseArgs, '--write'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(overwrite.status, overwrite.stderr).toBe(0);
    expect(overwrite.stdout).toContain('wrote');
    expect(readFileSync(sessionPath, 'utf8')).toBe(checkedBytes);
    expect(existsSync(`${sessionPath}.tmp`)).toBe(false);

    const outside = spawnSync(tsxPath, [
      cliPath,
      evidencePath,
      join(repoRoot, '..', 'outside-review-session.json'),
      generatedAt,
      '--write',
    ], { cwd: repoRoot, encoding: 'utf8' });
    expect(outside.status).not.toBe(0);
    expect(outside.stderr).toContain('must stay inside the repository');

    const inputCollision = spawnSync(tsxPath, [
      cliPath,
      evidencePath,
      evidencePath,
      generatedAt,
      '--write',
    ], { cwd: repoRoot, encoding: 'utf8' });
    expect(inputCollision.status).not.toBe(0);
    expect(inputCollision.stderr).toContain('cannot overwrite its candidate set');

    const misleadingName = spawnSync(tsxPath, [
      cliPath,
      evidencePath,
      join(dirname(sessionPath), 'candidate-set-copy.json'),
      generatedAt,
      '--write',
    ], { cwd: repoRoot, encoding: 'utf8' });
    expect(misleadingName.status).not.toBe(0);
    expect(misleadingName.stderr).toContain(
      'must be named review-session-NNN.authoring-slots-v1.json',
    );

    const v2Check = spawnSync(tsxPath, [
      cliPath,
      evidenceV2Path,
      sessionV2Path,
      '2026-08-21T01:42:00.000Z',
      '--check',
    ], { cwd: repoRoot, encoding: 'utf8' });
    expect(v2Check.status, v2Check.stderr).toBe(0);
    expect(v2Check.stdout).toContain('12 Draft test views');
  });
});
