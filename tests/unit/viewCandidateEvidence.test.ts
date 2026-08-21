/**
 * Candidate coordinates are evidence, not pack content. These tests exercise
 * the boundary that prevents a plausible-looking JSON document from escaping
 * its exact source revision or carrying review promotion.
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { VIEW_CANON } from '../../src/authoring/viewCanon.ts';
import { validatePack } from '../../src/schema/validate.ts';
import {
  ViewCandidateEvidence,
  ViewCandidateRegistry,
  VIEW_CANDIDATE_DERIVATION_FILES,
  candidatePayloadSha256,
  sha256File,
  validateViewCandidateEvidence,
  verifyViewCandidateAppendOnlyHistory,
} from '../../scripts/lib/viewCandidateEvidence.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const packRelativePath = 'public/packs/normal-rodero/pack.json';
const packPath = join(repoRoot, ...packRelativePath.split('/'));
const modelGltfRelativePath = 'public/packs/normal-rodero/assets/model.gltf';
const modelBinRelativePath = 'public/packs/normal-rodero/assets/model.bin';
const echoVolumeRelativePath = 'public/packs/normal-rodero/assets/echo-volume.raw';
const checkedEvidencePath = join(
  repoRoot,
  'evidence',
  'view-candidates',
  'normal-rodero',
  'pack-0.1.1',
  'candidate-set-001.json',
);
const registryPath = join(repoRoot, 'evidence', 'view-candidates', 'registry.json');
const sourcePackRevision = '770d5d2aa65f27d510c4ab59e94f91209c539cbb';
const registry = ViewCandidateRegistry.parse(
  JSON.parse(readFileSync(registryPath, 'utf8')) as unknown,
);
const checkedRegistryEntry = registry.candidate_sets.find(
  (entry) => entry.path.endsWith('/candidate-set-001.json'),
) ?? (() => { throw new Error('the candidate registry must pin candidate-set-001.json'); })();

const parsedPack = validatePack(JSON.parse(readFileSync(packPath, 'utf8')) as unknown);
if (!parsedPack.ok) throw new Error('the checked-in Rodero pack must validate for this test');
const sourcePack = parsedPack.pack;
const sourceFrame = sourcePack.meshes.anatomical_frame
  ?? (() => { throw new Error('the checked-in Rodero pack must contain an anatomical frame'); })();
const b1 = sourcePack.views.find((view) => view.view_id === 'b1-apical-four-chamber')
  ?? (() => { throw new Error('the checked-in Rodero pack must contain B1'); })();
const existingCanonViews = [
  'b1-apical-four-chamber',
  'c1-parasternal-long-axis',
  'c2-parasternal-short-axis',
].map((viewId) => sourcePack.views.find((view) => view.view_id === viewId)
  ?? (() => { throw new Error(`the checked-in Rodero pack must contain ${viewId}`); })());

const check = (checkId: string) => ({
  check_id: checkId,
  passed: true,
  requirement: 'test machine invariant',
  measurement: { value: 0, tolerance: 0.001 },
});

const coordinateChecks = (prefix: string, hasSweep = false) => [
  check(`${prefix}.pose-math`),
  check(`${prefix}.aperture`),
  check(`${prefix}.depth`),
  ...(hasSweep ? [check(`${prefix}.sweep-math`)] : []),
  check(`${prefix}.landmarks-contained`),
];

const globalChecks = () => [
  check('binding.source-pack'),
  check('binding.rodero-source'),
  check('binding.pack-assets'),
  check('binding.derivation-files'),
  check('binding.cardiac-frame'),
  check('policy.draft-only'),
  check('policy.no-pack-promotion'),
];

function unsignedEvidence(): any {
  const raw: any = {
    artifact_schema: 'view-candidates/v1',
    candidate_set_id: 'normal-rodero-pack-0.1.1-candidate-set-001',
    status: 'draft_evidence_only',
    integrity: {
      algorithm: 'sha256',
      scope: 'canonical-json-with-integrity.canonical_payload_sha256-null',
      canonical_payload_sha256: '0'.repeat(64),
    },
    binding: {
      source_pack_id: sourcePack.meta.id,
      source_pack_version: sourcePack.meta.pack_version,
      source_pack_schema_version: sourcePack.meta.schema_version,
      source_pack_path: packRelativePath,
      source_pack_sha256: sha256File(packPath),
      source: {
        path: 'pipeline/.cache/rodero/average.vtk',
        sha256: '1'.repeat(64),
        size_bytes: 187320446,
        archive_md5: '992f31e20c1aa73c10c5d9a6b6ac903a',
        source_url: 'https://zenodo.org/records/4593738',
      },
      pack_assets: [
        {
          path: modelGltfRelativePath,
          sha256: sha256File(join(repoRoot, ...modelGltfRelativePath.split('/'))),
        },
        {
          path: modelBinRelativePath,
          sha256: sha256File(join(repoRoot, ...modelBinRelativePath.split('/'))),
        },
        {
          path: echoVolumeRelativePath,
          sha256: sha256File(join(repoRoot, ...echoVolumeRelativePath.split('/'))),
        },
      ],
      derivation_files: VIEW_CANDIDATE_DERIVATION_FILES.map((path) => ({
        path,
        sha256: sha256File(join(repoRoot, ...path.split('/'))),
      })),
      source_pack_revision: sourcePackRevision,
      coordinate_frame: {
        method: sourceFrame.method,
        basis_source_to_pack: structuredClone(sourceFrame.basis_source_to_pack),
        checks_passed: sourceFrame.checks_passed,
        checks_total: sourceFrame.checks_total,
      },
    },
    existing_views: existingCanonViews.map((view) => {
      const candidateId = `existing-${view.view_id}`;
      return {
        kind: 'existing',
        candidate_id: candidateId,
        intended_view_id: view.view_id,
        source_view_id: view.view_id,
        candidate_status: 'draft',
        coordinates: {
          probe: structuredClone(view.probe),
          sweep: structuredClone(view.sweep),
        },
        checks: coordinateChecks(candidateId, true),
      };
    }),
    candidates: [
      {
        kind: 'single',
        candidate_id: 'b4-apical-three-chamber-candidate-001',
        intended_view_id: 'b4-apical-three-chamber',
        candidate_status: 'draft',
        derivation: {
          method: 'test-single',
          inputs: ['b1-apical-four-chamber'],
          description: 'Test-only coordinate proposal.',
        },
        coordinates: { probe: structuredClone(b1.probe) },
        checks: coordinateChecks('b4-apical-three-chamber-candidate-001'),
        limitations: ['Test-only coordinate proposal.'],
      },
      {
        kind: 'series',
        candidate_id: 'b2-apical-sweep-series-001',
        intended_view_id: 'b2-apical-five-chamber',
        candidate_status: 'draft',
        selected_variant_id: null,
        selection_state: 'no_variant_selected',
        derivation: {
          method: 'test-b1-anterior-angulation',
          inputs: ['b1-apical-four-chamber'],
          description: 'No variant is selected without human review.',
        },
        variants: [
          {
            variant_id: 'b2-t-0.550',
            source_parameter: {
              name: 'b1_sweep_normalized_t',
              value: 0.55,
              derived_value: { unit: 'deg', value: 4 },
            },
            coordinates: { probe: structuredClone(b1.probe) },
            checks: coordinateChecks('b2-t-0.550'),
          },
        ],
        checks: [
          check('b2-apical-sweep-series-001.variant-grid'),
          check('b2-apical-sweep-series-001.no-selection'),
        ],
        limitations: ['The machine checks do not choose a clinically meaningful variant.'],
      },
    ],
    deferred: [
      {
        intended_view_id: 'a1-subcostal-coronal-situs',
        disposition: 'deferred',
        reason_code: 'missing-body-reference',
        reason: 'The heart-only model does not establish this external window.',
        requires: ['body or acquisition reference'],
      },
    ],
    unsupported: [
      {
        intended_view_id: 'e1-suprasternal-long-axis',
        disposition: 'unsupported',
        reason_code: 'missing-arch-geometry',
        reason: 'The model does not carry the required anatomy.',
      },
    ],
    non_promotion: {
      effect_on_pack_review_status: 'none',
      may_write_pack: false,
      may_promote_pack_review_status: false,
      source_pack_review_status: 'draft',
      candidate_review_status: 'draft',
      generation_writes_only:
        'evidence/view-candidates/normal-rodero/pack-0.1.1/candidate-set-001.json',
    },
    checks: globalChecks(),
    limitations: ['Machine geometry evidence is not clinical review.'],
  };

  const covered = new Set<string>([
    ...raw.existing_views.map((entry: any) => entry.intended_view_id),
    ...raw.candidates.map((entry: any) => entry.intended_view_id),
    ...raw.deferred.map((entry: any) => entry.intended_view_id),
    ...raw.unsupported.map((entry: any) => entry.intended_view_id),
  ]);
  for (const canon of VIEW_CANON) {
    if (covered.has(canon.viewId)) continue;
    raw.deferred.push({
      intended_view_id: canon.viewId,
      disposition: 'deferred',
      reason_code: 'test-not-generated',
      reason: 'This canon slot is deliberately ungenerated in the synthetic fixture.',
      requires: ['a scoped derivation and review decision'],
    });
  }
  return raw;
}

function signEvidence(raw: any): any {
  const shaped = ViewCandidateEvidence.parse(raw);
  raw.integrity.canonical_payload_sha256 = candidatePayloadSha256(shaped);
  return raw;
}

function evidence(): any {
  return signEvidence(unsignedEvidence());
}

function messages(result: ReturnType<typeof validateViewCandidateEvidence>): string {
  return result.ok ? '' : result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
}

let workDir: string | null = null;

afterEach(() => {
  if (workDir !== null) rmSync(workDir, { recursive: true, force: true });
  workDir = null;
});

describe('view-candidates/v1 closed evidence envelope', () => {
  it('validates the checked-in Rodero candidate set against the current pack bytes', () => {
    const raw = JSON.parse(readFileSync(checkedEvidencePath, 'utf8')) as unknown;
    const result = validateViewCandidateEvidence(raw, {
      repoRoot,
      evidencePath: checkedEvidencePath,
      registryEntry: checkedRegistryEntry,
    });
    expect(result.ok, messages(result)).toBe(true);
    if (!result.ok) return;
    const covered = [
      ...result.evidence.existing_views.map((entry) => entry.intended_view_id),
      ...result.evidence.candidates.map((entry) => entry.intended_view_id),
      ...result.evidence.deferred.map((entry) => entry.intended_view_id),
      ...result.evidence.unsupported.map((entry) => entry.intended_view_id),
    ].sort();
    expect(covered).toEqual(VIEW_CANON.map((entry) => entry.viewId).sort());
  });

  it('accepts a B2 variant series with no selected variant and coordinate-free deferrals', () => {
    const result = validateViewCandidateEvidence(evidence(), { repoRoot });
    expect(result.ok, messages(result)).toBe(true);
    if (!result.ok) return;
    const b2 = result.evidence.candidates.find((candidate) => candidate.kind === 'series');
    expect(b2?.selected_variant_id).toBeNull();
    expect(result.evidence.deferred[0]).not.toHaveProperty('coordinates');
  });

  it('uses the pack ProbePose and Sweep schemas for every coordinate object', () => {
    const badProbe = evidence();
    badProbe.candidates[0].coordinates.probe.beam_axis = [2, 0, 0];
    expect(messages(validateViewCandidateEvidence(badProbe, { repoRoot })))
      .toMatch(/beam_axis.*unit length/);

    const badSweep = evidence();
    badSweep.candidates[0].coordinates.sweep = {
      mode: 'translate',
      axis: { direction: [1, 0, 0] },
      range: { unit: 'deg', from: 0, to: 5 },
      interpolation: 'lerp',
      structures_in_order: [],
    };
    expect(messages(validateViewCandidateEvidence(badSweep, { repoRoot })))
      .toMatch(/mode "translate" requires range unit "mm"/);
  });

  it('allows null selection but refuses an inconsistent or missing series selection', () => {
    const inconsistent = evidence();
    inconsistent.candidates[1].selection_state = 'variant_selected';
    expect(messages(validateViewCandidateEvidence(inconsistent, { repoRoot })))
      .toMatch(/null selected_variant_id requires "no_variant_selected"/);

    const dangling = evidence();
    dangling.candidates[1].selected_variant_id = 'not-a-variant';
    dangling.candidates[1].selection_state = 'variant_selected';
    expect(messages(validateViewCandidateEvidence(dangling, { repoRoot })))
      .toMatch(/is not in variants/);
  });

  it('refuses duplicate ids and any machine gate that did not pass', () => {
    const duplicate = evidence();
    duplicate.candidates[1].candidate_id = duplicate.candidates[0].candidate_id;
    expect(messages(validateViewCandidateEvidence(duplicate, { repoRoot })))
      .toMatch(/duplicate candidate_id/);

    const failedGate = evidence();
    failedGate.candidates[0].checks[0].passed = false;
    expect(messages(validateViewCandidateEvidence(failedGate, { repoRoot })))
      .toMatch(/passed.*Invalid input/);

    const missingGate = evidence();
    missingGate.candidates[0].checks = missingGate.candidates[0].checks.slice(0, 1);
    expect(messages(validateViewCandidateEvidence(missingGate, { repoRoot })))
      .toMatch(/missing required machine check/);

    const crossNamespace = evidence();
    crossNamespace.candidates[1].variants[0].variant_id = crossNamespace.candidates[0].candidate_id;
    expect(messages(validateViewCandidateEvidence(crossNamespace, { repoRoot })))
      .toMatch(/used as both a candidate_id and variant_id/);
  });

  it('refuses coordinates on deferred entries and pack/review-promotion keys anywhere', () => {
    const deferredCoordinates = evidence();
    deferredCoordinates.deferred[0].coordinates = {
      probe: structuredClone(b1.probe),
    };
    expect(messages(validateViewCandidateEvidence(deferredCoordinates, { repoRoot })))
      .toMatch(/deferred\.0.*Unrecognized key/);

    for (const forbidden of ['views', 'provenance', 'vetted', 'review_status']) {
      const promoted = evidence();
      promoted.candidates[0].checks[0].measurement[forbidden] = {};
      const report = messages(validateViewCandidateEvidence(promoted, { repoRoot }));
      expect(report).toContain(`forbidden pack/review-promotion key "${forbidden}"`);
    }
  });

  it('requires the exact pack identity, version, schema, and byte digests', () => {
    const wrongId = evidence();
    wrongId.binding.source_pack_id = 'not-rodero';
    expect(messages(validateViewCandidateEvidence(wrongId, { repoRoot })))
      .toMatch(/expected exact source pack path/);

    const wrongVersion = evidence();
    wrongVersion.binding.source_pack_version = '0.1.0';
    expect(messages(validateViewCandidateEvidence(wrongVersion, { repoRoot })))
      .toMatch(/evidence says "0\.1\.0", pack says "0\.1\.1"/);

    const wrongRevision = evidence();
    wrongRevision.binding.source_pack_revision = 'f'.repeat(40);
    signEvidence(wrongRevision);
    expect(messages(validateViewCandidateEvidence(wrongRevision, { repoRoot })))
      .toMatch(/source_pack_revision.*not an ancestor available/);

    const wrongSchema = evidence();
    wrongSchema.binding.source_pack_schema_version = '1.0';
    expect(messages(validateViewCandidateEvidence(wrongSchema, { repoRoot })))
      .toMatch(/source_pack_schema_version.*Invalid input/);

    const wrongPackDigest = evidence();
    wrongPackDigest.binding.source_pack_sha256 = 'f'.repeat(64);
    expect(messages(validateViewCandidateEvidence(wrongPackDigest, { repoRoot })))
      .toMatch(/source_pack_sha256.*digest mismatch/);

    const wrongAssetDigest = evidence();
    wrongAssetDigest.binding.pack_assets[0].sha256 = 'f'.repeat(64);
    expect(messages(validateViewCandidateEvidence(wrongAssetDigest, { repoRoot })))
      .toMatch(/pack_assets\.0\.sha256.*digest mismatch/);

    const wrongDerivationDigest = evidence();
    wrongDerivationDigest.binding.derivation_files[0].sha256 = 'f'.repeat(64);
    expect(messages(validateViewCandidateEvidence(wrongDerivationDigest, { repoRoot })))
      .toMatch(/derivation_files\.0\.sha256.*digest mismatch/);

    const wrongFrame = evidence();
    wrongFrame.binding.coordinate_frame.basis_source_to_pack.patient_left =
      wrongFrame.binding.coordinate_frame.basis_source_to_pack.patient_left
        .map((component: number) => -component);
    expect(messages(validateViewCandidateEvidence(wrongFrame, { repoRoot })))
      .toMatch(/binding\.coordinate_frame.*does not exactly equal/);
  });

  it('does not allow an existing canon pack view to be reclassified as deferred', () => {
    const reclassified = evidence();
    reclassified.existing_views = reclassified.existing_views
      .filter((view: any) => view.intended_view_id !== b1.view_id);
    reclassified.deferred.push({
      intended_view_id: b1.view_id,
      disposition: 'deferred',
      reason_code: 'test-reclassification',
      reason: 'A present pack view must not be hidden by a disposition change.',
      requires: ['nothing'],
    });
    signEvidence(reclassified);
    expect(messages(validateViewCandidateEvidence(reclassified, { repoRoot })))
      .toMatch(/already exists in the pack and cannot be reclassified/);
  });

  it('re-hashes the current pack assets and derivation files instead of trusting recorded digests', () => {
    workDir = mkdtempSync(join(tmpdir(), 'view-candidate-evidence-'));
    const packDir = join(workDir, 'public', 'packs', 'normal-rodero');
    const assetDir = join(packDir, 'assets');
    mkdirSync(assetDir, { recursive: true });
    copyFileSync(packPath, join(packDir, 'pack.json'));
    copyFileSync(join(repoRoot, ...modelGltfRelativePath.split('/')), join(assetDir, 'model.gltf'));
    copyFileSync(join(repoRoot, ...modelBinRelativePath.split('/')), join(assetDir, 'model.bin'));
    copyFileSync(
      join(repoRoot, ...echoVolumeRelativePath.split('/')),
      join(assetDir, 'echo-volume.raw'),
    );
    for (const path of VIEW_CANDIDATE_DERIVATION_FILES) {
      const destination = join(workDir, ...path.split('/'));
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(repoRoot, ...path.split('/')), destination);
    }

    const raw = evidence();
    expect(validateViewCandidateEvidence(raw, {
      repoRoot: workDir,
      verifyGitBinding: false,
    }).ok).toBe(true);

    writeFileSync(join(assetDir, 'model.bin'), Buffer.from('changed model bytes'));
    const changed = validateViewCandidateEvidence(raw, {
      repoRoot: workDir,
      verifyGitBinding: false,
    });
    expect(changed.ok).toBe(false);
    expect(messages(changed)).toMatch(/digest mismatch.*model\.bin/);
  });

  it('verifies the canonical payload digest rather than accepting a syntactic hash', () => {
    const changed = evidence();
    changed.limitations.push('Changed after the digest was calculated.');
    expect(messages(validateViewCandidateEvidence(changed, { repoRoot })))
      .toMatch(/canonical_payload_sha256.*digest mismatch/);
  });

  it('refuses edited coordinates even when their self-digest is recomputed', () => {
    const tampered = JSON.parse(readFileSync(checkedEvidencePath, 'utf8')) as any;
    tampered.candidates[0].coordinates.probe.origin = [100_000, 100_000, 100_000];
    signEvidence(tampered);
    const result = validateViewCandidateEvidence(tampered, {
      repoRoot,
      evidencePath: checkedEvidencePath,
      registryEntry: checkedRegistryEntry,
    });
    expect(messages(result)).toMatch(/independently pinned immutable registry digest/);
  });

  it('refuses committed candidate edits even after an unchanged follow-up commit', () => {
    workDir = mkdtempSync(join(tmpdir(), 'view-candidate-history-'));
    const candidateRelativePath =
      'evidence/view-candidates/example/pack-0.1.0/candidate-set-001.json';
    const candidatePath = join(workDir, ...candidateRelativePath.split('/'));
    const historyRegistryPath = join(workDir, 'evidence', 'view-candidates', 'registry.json');
    mkdirSync(dirname(candidatePath), { recursive: true });

    const historicalRegistry = {
      registry_schema: 'view-candidate-registry/v1',
      candidate_sets: [{
        candidate_set_id: 'example-pack-0.1.0-candidate-set-001',
        path: candidateRelativePath,
        file_sha256: 'a'.repeat(64),
        canonical_payload_sha256: 'b'.repeat(64),
      }],
    };
    writeFileSync(candidatePath, '{"coordinates":"original"}\n');
    writeFileSync(historyRegistryPath, `${JSON.stringify(historicalRegistry, null, 2)}\n`);
    const git = (args: string[]) => execFileSync('git', args, {
      cwd: workDir!,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    git(['init']);
    git(['config', 'user.email', 'candidate-test@example.invalid']);
    git(['config', 'user.name', 'Candidate Test']);
    git(['config', 'commit.gpgsign', 'false']);
    git(['add', '.']);
    git(['commit', '-m', 'pin candidate']);

    const editedRegistry = structuredClone(historicalRegistry);
    editedRegistry.candidate_sets[0].file_sha256 = 'c'.repeat(64);
    writeFileSync(candidatePath, '{"coordinates":"edited"}\n');
    writeFileSync(historyRegistryPath, `${JSON.stringify(editedRegistry, null, 2)}\n`);
    git(['add', '.']);
    git(['commit', '-m', 'tamper candidate']);
    writeFileSync(join(workDir, 'unrelated.txt'), 'unchanged follow-up\n');
    git(['add', 'unrelated.txt']);
    git(['commit', '-m', 'unrelated follow-up']);

    const issues = verifyViewCandidateAppendOnlyHistory(
      workDir,
      ViewCandidateRegistry.parse(editedRegistry),
    );
    expect(issues.map((issue) => issue.message).join('\n')).toMatch(
      /immutable registry entry differs.*immutable candidate bytes differ/s,
    );
  });
});
