/**
 * Fail-closed validation for generated Rodero view-coordinate evidence.
 *
 * A candidate set is deliberately not a content pack. This module validates
 * its closed evidence envelope, reuses the pack's coordinate schemas, and
 * binds the document to the exact pack and model bytes currently in the
 * checkout. It never writes either the evidence document or a pack.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, posix, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { VIEW_CANON } from '../../src/authoring/viewCanon.ts';
import {
  ProbePose,
  SCHEMA_VERSION,
  Sweep,
  type Pack,
} from '../../src/schema/packV0.ts';
import {
  AssetPath,
  HttpUrl,
  ORTHOGONAL_TOLERANCE,
  Slug,
  UnitVec3,
  dot3,
} from '../../src/schema/primitives.ts';
import { toIssues, validatePack } from '../../src/schema/validate.ts';

export const VIEW_CANDIDATE_SCHEMA = 'view-candidates/v1' as const;
const INTEGRITY_SCOPE = 'canonical-json-with-integrity.canonical_payload_sha256-null' as const;

export const VIEW_CANDIDATE_DERIVATION_FILES = Object.freeze([
  '.gitattributes',
  'pipeline/view_candidates.py',
  'pipeline/views.py',
  'pipeline/anatomy.py',
  'pipeline/meshlib.py',
  'pipeline/sources.py',
  'shared/imaging-constants.json',
  'environment.yml',
] as const);

const GLOBAL_CHECK_IDS = Object.freeze([
  'binding.source-pack',
  'binding.rodero-source',
  'binding.pack-assets',
  'binding.derivation-files',
  'binding.cardiac-frame',
  'policy.draft-only',
  'policy.no-pack-promotion',
] as const);
const CANON_VIEW_IDS = new Set(VIEW_CANON.map((entry) => entry.viewId));

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'expected a lowercase SHA-256 digest');
const Md5 = z.string().regex(/^[0-9a-f]{32}$/, 'expected a lowercase MD5 digest');
const GitRevision = z.string().regex(/^[0-9a-f]{40}$/, 'expected a full lowercase Git revision');
const EvidenceId = z
  .string()
  .regex(
    /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
    'expected a stable lowercase id using letters, digits, dot, dash, or underscore separators',
  );
const NonEmptyString = z.string().min(1);

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.array(JsonValueSchema),
  z.record(z.string(), JsonValueSchema),
]));

const Measurement = z.record(z.string(), JsonValueSchema);

const MachineCheck = z.strictObject({
  check_id: EvidenceId,
  passed: z.literal(true),
  requirement: NonEmptyString,
  measurement: Measurement,
});

const MachineChecks = z.array(MachineCheck).min(1).superRefine((checks, ctx) => {
  const seen = new Set<string>();
  checks.forEach((check, index) => {
    if (seen.has(check.check_id)) {
      ctx.addIssue({
        code: 'custom',
        path: [index, 'check_id'],
        message: `duplicate check_id "${check.check_id}" in one check scope`,
      });
    }
    seen.add(check.check_id);
  });
});

function requireCheckIds(
  checks: readonly z.infer<typeof MachineCheck>[],
  required: readonly string[],
  ctx: z.RefinementCtx,
  path: PropertyKey[],
): void {
  const present = new Set(checks.map((check) => check.check_id));
  for (const checkId of required) {
    if (!present.has(checkId)) {
      ctx.addIssue({
        code: 'custom',
        path,
        message: `missing required machine check "${checkId}"`,
      });
    }
  }
}

function coordinateCheckIds(prefix: string, hasSweep: boolean): string[] {
  return [
    `${prefix}.pose-math`,
    `${prefix}.aperture`,
    `${prefix}.depth`,
    ...(hasSweep ? [`${prefix}.sweep-math`] : []),
    `${prefix}.landmarks-contained`,
  ];
}

const Coordinates = z.strictObject({
  probe: ProbePose,
  sweep: Sweep.optional(),
});

const Derivation = z.strictObject({
  method: NonEmptyString,
  inputs: z.array(NonEmptyString).min(1),
  description: NonEmptyString,
});

const ExistingView = z.strictObject({
  kind: z.literal('existing'),
  candidate_id: EvidenceId,
  intended_view_id: Slug,
  source_view_id: Slug,
  candidate_status: z.literal('draft'),
  coordinates: Coordinates,
  checks: MachineChecks,
});

const SingleCandidate = z.strictObject({
  kind: z.literal('single'),
  candidate_id: EvidenceId,
  intended_view_id: Slug,
  candidate_status: z.literal('draft'),
  derivation: Derivation,
  coordinates: Coordinates,
  checks: MachineChecks,
  limitations: z.array(NonEmptyString),
});

const SeriesVariant = z.strictObject({
  variant_id: EvidenceId,
  source_parameter: z.strictObject({
    name: NonEmptyString,
    value: z.number().finite(),
    derived_value: z.strictObject({
      unit: NonEmptyString,
      value: z.number().finite(),
    }),
  }),
  coordinates: Coordinates,
  checks: MachineChecks,
});

const SeriesCandidate = z
  .strictObject({
    kind: z.literal('series'),
    candidate_id: EvidenceId,
    intended_view_id: Slug,
    candidate_status: z.literal('draft'),
    selected_variant_id: EvidenceId.nullable(),
    selection_state: z.enum(['no_variant_selected', 'variant_selected']),
    derivation: Derivation,
    variants: z.array(SeriesVariant).min(1),
    checks: MachineChecks,
    limitations: z.array(NonEmptyString),
  })
  .superRefine((series, ctx) => {
    const ids = new Set<string>();
    series.variants.forEach((variant, index) => {
      if (ids.has(variant.variant_id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['variants', index, 'variant_id'],
          message: `duplicate variant_id "${variant.variant_id}"`,
        });
      }
      ids.add(variant.variant_id);
    });

    if (series.selected_variant_id === null) {
      if (series.selection_state !== 'no_variant_selected') {
        ctx.addIssue({
          code: 'custom',
          path: ['selection_state'],
          message: 'a null selected_variant_id requires "no_variant_selected"',
        });
      }
      return;
    }

    if (series.selection_state !== 'variant_selected') {
      ctx.addIssue({
        code: 'custom',
        path: ['selection_state'],
        message: 'a selected variant requires "variant_selected"',
      });
    }
    if (!ids.has(series.selected_variant_id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['selected_variant_id'],
        message: `selected_variant_id "${series.selected_variant_id}" is not in variants`,
      });
    }
  });

const Candidate = z.discriminatedUnion('kind', [SingleCandidate, SeriesCandidate]);

const Deferred = z.strictObject({
  intended_view_id: Slug,
  disposition: z.literal('deferred'),
  reason_code: EvidenceId,
  reason: NonEmptyString,
  requires: z.array(NonEmptyString).min(1),
});

const Unsupported = z.strictObject({
  intended_view_id: Slug,
  disposition: z.literal('unsupported'),
  reason_code: EvidenceId,
  reason: NonEmptyString,
});

const BoundFile = z.strictObject({
  path: AssetPath,
  sha256: Sha256,
});

const RegisteredCandidateSet = z.strictObject({
  candidate_set_id: EvidenceId,
  path: AssetPath,
  file_sha256: Sha256,
  canonical_payload_sha256: Sha256,
});
export type RegisteredCandidateSet = z.infer<typeof RegisteredCandidateSet>;

export const ViewCandidateRegistry = z
  .strictObject({
    registry_schema: z.literal('view-candidate-registry/v1'),
    candidate_sets: z.array(RegisteredCandidateSet).min(1),
  })
  .superRefine((registry, ctx) => {
    const ids = new Set<string>();
    const paths = new Set<string>();
    registry.candidate_sets.forEach((entry, index) => {
      if (ids.has(entry.candidate_set_id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['candidate_sets', index, 'candidate_set_id'],
          message: `duplicate candidate_set_id "${entry.candidate_set_id}"`,
        });
      }
      if (paths.has(entry.path)) {
        ctx.addIssue({
          code: 'custom',
          path: ['candidate_sets', index, 'path'],
          message: `duplicate candidate-set path "${entry.path}"`,
        });
      }
      ids.add(entry.candidate_set_id);
      paths.add(entry.path);
    });
  });
export type ViewCandidateRegistry = z.infer<typeof ViewCandidateRegistry>;

const CoordinateFrame = z
  .strictObject({
    method: NonEmptyString,
    basis_source_to_pack: z.strictObject({
      patient_left: UnitVec3,
      basal: UnitVec3,
      anterior: UnitVec3,
    }),
    checks_passed: z.number().int().positive(),
    checks_total: z.number().int().positive(),
  })
  .superRefine((frame, ctx) => {
    if (frame.checks_passed !== frame.checks_total) {
      ctx.addIssue({
        code: 'custom',
        path: ['checks_passed'],
        message: 'coordinate-frame machine gates must all pass',
      });
    }
    const axes = frame.basis_source_to_pack;
    const pairs = [
      ['patient_left', axes.patient_left, 'basal', axes.basal],
      ['patient_left', axes.patient_left, 'anterior', axes.anterior],
      ['basal', axes.basal, 'anterior', axes.anterior],
    ] as const;
    for (const [leftName, left, rightName, right] of pairs) {
      if (Math.abs(dot3(left, right)) > ORTHOGONAL_TOLERANCE) {
        ctx.addIssue({
          code: 'custom',
          path: ['basis_source_to_pack', rightName],
          message: `${leftName} and ${rightName} must be orthogonal`,
        });
      }
    }
  });

export const ViewCandidateEvidence = z
  .strictObject({
    artifact_schema: z.literal(VIEW_CANDIDATE_SCHEMA),
    candidate_set_id: EvidenceId,
    status: z.literal('draft_evidence_only'),
    integrity: z.strictObject({
      algorithm: z.literal('sha256'),
      scope: z.literal(INTEGRITY_SCOPE),
      canonical_payload_sha256: Sha256,
    }),
    binding: z.strictObject({
      source_pack_id: Slug,
      source_pack_version: NonEmptyString,
      source_pack_schema_version: z.literal(SCHEMA_VERSION),
      source_pack_path: AssetPath,
      source_pack_sha256: Sha256,
      source: z.strictObject({
        path: AssetPath,
        sha256: Sha256,
        size_bytes: z.number().int().positive(),
        archive_md5: Md5,
        source_url: HttpUrl,
      }),
      pack_assets: z.array(BoundFile).min(1),
      derivation_files: z.array(BoundFile).min(1),
      source_pack_revision: GitRevision,
      coordinate_frame: CoordinateFrame,
    }),
    existing_views: z.array(ExistingView),
    candidates: z.array(Candidate),
    deferred: z.array(Deferred),
    unsupported: z.array(Unsupported),
    non_promotion: z.strictObject({
      effect_on_pack_review_status: z.literal('none'),
      may_write_pack: z.literal(false),
      may_promote_pack_review_status: z.literal(false),
      source_pack_review_status: z.literal('draft'),
      candidate_review_status: z.literal('draft'),
      generation_writes_only: AssetPath,
    }),
    checks: MachineChecks,
    limitations: z.array(NonEmptyString).min(1),
  })
  .superRefine((document, ctx) => {
    const candidateIds = new Set<string>();
    const variantIds = new Set<string>();
    const usedViewIds = new Map<string, string>();

    const addCandidateId = (id: string, path: PropertyKey[]) => {
      if (candidateIds.has(id)) {
        ctx.addIssue({ code: 'custom', path, message: `duplicate candidate_id "${id}"` });
      }
      candidateIds.add(id);
    };
    const addViewId = (id: string, category: string, path: PropertyKey[]) => {
      const previous = usedViewIds.get(id);
      if (previous !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path,
          message: `intended_view_id "${id}" also appears in ${previous}`,
        });
      }
      usedViewIds.set(id, category);
    };

    document.existing_views.forEach((view, index) => {
      addCandidateId(view.candidate_id, ['existing_views', index, 'candidate_id']);
      addViewId(view.intended_view_id, 'existing_views', ['existing_views', index, 'intended_view_id']);
      requireCheckIds(
        view.checks,
        coordinateCheckIds(view.candidate_id, view.coordinates.sweep !== undefined),
        ctx,
        ['existing_views', index, 'checks'],
      );
    });
    document.candidates.forEach((candidate, index) => {
      addCandidateId(candidate.candidate_id, ['candidates', index, 'candidate_id']);
      addViewId(candidate.intended_view_id, 'candidates', ['candidates', index, 'intended_view_id']);
      if (candidate.kind === 'single') {
        requireCheckIds(
          candidate.checks,
          coordinateCheckIds(candidate.candidate_id, candidate.coordinates.sweep !== undefined),
          ctx,
          ['candidates', index, 'checks'],
        );
        return;
      }
      requireCheckIds(
        candidate.checks,
        [`${candidate.candidate_id}.variant-grid`, `${candidate.candidate_id}.no-selection`],
        ctx,
        ['candidates', index, 'checks'],
      );
      candidate.variants.forEach((variant, variantIndex) => {
        if (variantIds.has(variant.variant_id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['candidates', index, 'variants', variantIndex, 'variant_id'],
            message: `duplicate variant_id "${variant.variant_id}" across candidate series`,
          });
        }
        variantIds.add(variant.variant_id);
        requireCheckIds(
          variant.checks,
          coordinateCheckIds(variant.variant_id, variant.coordinates.sweep !== undefined),
          ctx,
          ['candidates', index, 'variants', variantIndex, 'checks'],
        );
      });
    });
    document.deferred.forEach((entry, index) => {
      addViewId(entry.intended_view_id, 'deferred', ['deferred', index, 'intended_view_id']);
    });
    document.unsupported.forEach((entry, index) => {
      addViewId(entry.intended_view_id, 'unsupported', ['unsupported', index, 'intended_view_id']);
    });

    const assetPaths = new Set<string>();
    document.binding.pack_assets.forEach((asset, index) => {
      if (assetPaths.has(asset.path)) {
        ctx.addIssue({
          code: 'custom',
          path: ['binding', 'pack_assets', index, 'path'],
          message: `duplicate pack asset path "${asset.path}"`,
        });
      }
      assetPaths.add(asset.path);
    });

    const derivationPaths = new Set<string>();
    document.binding.derivation_files.forEach((file, index) => {
      if (derivationPaths.has(file.path)) {
        ctx.addIssue({
          code: 'custom',
          path: ['binding', 'derivation_files', index, 'path'],
          message: `duplicate derivation file path "${file.path}"`,
        });
      }
      derivationPaths.add(file.path);
    });

    requireCheckIds(document.checks, GLOBAL_CHECK_IDS, ctx, ['checks']);

    for (const canonId of CANON_VIEW_IDS) {
      if (!usedViewIds.has(canonId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['existing_views'],
          message: `canon view "${canonId}" is not accounted for`,
        });
      }
    }
    for (const [viewId, category] of usedViewIds) {
      if (!CANON_VIEW_IDS.has(viewId)) {
        ctx.addIssue({
          code: 'custom',
          path: [category],
          message: `non-canon intended_view_id "${viewId}" is not allowed`,
        });
      }
    }

    for (const candidateId of candidateIds) {
      if (variantIds.has(candidateId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['candidates'],
          message: `id "${candidateId}" is used as both a candidate_id and variant_id`,
        });
      }
    }
  });

export type ViewCandidateEvidence = z.infer<typeof ViewCandidateEvidence>;

export interface ViewCandidateIssue {
  path: string;
  message: string;
}

export type ViewCandidateValidation =
  | { ok: true; evidence: ViewCandidateEvidence; issues: [] }
  | { ok: false; evidence: null; issues: ViewCandidateIssue[] };

export interface ViewCandidateValidationOptions {
  repoRoot: string;
  evidencePath?: string;
  /** Independent accepted-digest lock supplied by the repository registry. */
  registryEntry?: RegisteredCandidateSet;
  /** Tests with a synthetic non-Git repo may disable only the historical Git-object check. */
  verifyGitBinding?: boolean;
}

/** Keys that would turn evidence into pack content or imply review promotion. */
export const FORBIDDEN_EVIDENCE_KEYS = new Set([
  'views',
  'meta',
  'provenance',
  'vetted',
  'vetters',
  'last_reviewed',
  'review_status',
  'review_state',
  'pack_review_status',
  'review_promotion',
]);

function pathLabel(path: PropertyKey[]): string {
  return path.length === 0 ? '<root>' : path.map(String).join('.');
}

function forbiddenKeyIssues(value: unknown): ViewCandidateIssue[] {
  const issues: ViewCandidateIssue[] = [];
  const visit = (node: unknown, path: PropertyKey[]) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, [...path, index]));
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      if (FORBIDDEN_EVIDENCE_KEYS.has(key)) {
        issues.push({
          path: pathLabel([...path, key]),
          message: `forbidden pack/review-promotion key "${key}" in coordinate evidence`,
        });
      }
      visit(child, [...path, key]);
    }
  };
  visit(value, []);
  return issues;
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Canonical payload bytes defined by `integrity.scope`. */
export function canonicalEvidencePayload(value: ViewCandidateEvidence): string {
  const payload = structuredClone(value) as unknown as {
    integrity: { canonical_payload_sha256: string | null };
  };
  payload.integrity.canonical_payload_sha256 = null;
  return canonicalize(payload);
}

export function candidatePayloadSha256(value: ViewCandidateEvidence): string {
  return createHash('sha256').update(canonicalEvidencePayload(value), 'utf8').digest('hex');
}

function safeRepoPath(repoRoot: string, relativePath: string): string | null {
  const absolute = resolve(repoRoot, ...relativePath.split('/'));
  const root = resolve(repoRoot);
  return absolute === root || absolute.startsWith(`${root}${sep}`) ? absolute : null;
}

function gitBlob(repoRoot: string, revision: string, path: string): Buffer | null {
  try {
    return execFileSync('git', ['show', `${revision}:${path}`], {
      cwd: repoRoot,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }
}

/**
 * Enforce immutable history for accepted sets while allowing new registry
 * entries. HEAD catches local pre-commit edits; every commit that changed the
 * registry keeps the first accepted bytes authoritative even if a failed
 * direct-push commit is followed by an unchanged commit.
 */
export function verifyViewCandidateAppendOnlyHistory(
  repoRoot: string,
  currentRegistry: ViewCandidateRegistry,
  revisions?: readonly string[],
): ViewCandidateIssue[] {
  const issues: ViewCandidateIssue[] = [];
  const currentByPath = new Map(
    currentRegistry.candidate_sets.map((entry) => [entry.path, entry]),
  );
  const registryRelativePath = 'evidence/view-candidates/registry.json';
  let revisionsToCheck = revisions;
  if (revisionsToCheck === undefined) {
    let registryHistory: string[] = [];
    try {
      const history = execFileSync(
        'git',
        ['log', '--format=%H', '--', registryRelativePath],
        { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      registryHistory = history.split(/\r?\n/).filter(Boolean);
    } catch {
      // The source-revision binding reports a missing or unusable Git checkout.
    }
    revisionsToCheck = [...new Set(['HEAD', ...registryHistory])];
  }

  for (const revision of revisionsToCheck) {
    const registryBytes = gitBlob(repoRoot, revision, registryRelativePath);
    if (registryBytes === null) continue;

    let historicalRaw: unknown;
    try {
      historicalRaw = JSON.parse(registryBytes.toString('utf8')) as unknown;
    } catch (error) {
      issues.push({
        path: registryRelativePath,
        message: `${revision} registry is not JSON: ${(error as Error).message}`,
      });
      continue;
    }
    const historical = ViewCandidateRegistry.safeParse(historicalRaw);
    if (!historical.success) {
      issues.push({
        path: registryRelativePath,
        message: `${revision} registry does not satisfy view-candidate-registry/v1`,
      });
      continue;
    }

    for (const historicalEntry of historical.data.candidate_sets) {
      const currentEntry = currentByPath.get(historicalEntry.path);
      if (currentEntry === undefined) {
        issues.push({
          path: historicalEntry.path,
          message: `immutable candidate set registered in ${revision} was removed`,
        });
        continue;
      }
      if (!jsonEqual(currentEntry, historicalEntry)) {
        issues.push({
          path: historicalEntry.path,
          message: `immutable registry entry differs from ${revision}`,
        });
      }

      const historicalCandidate = gitBlob(repoRoot, revision, historicalEntry.path);
      if (historicalCandidate === null) {
        issues.push({
          path: historicalEntry.path,
          message: `${revision} registry points to a missing candidate blob`,
        });
        continue;
      }
      const currentPath = safeRepoPath(repoRoot, historicalEntry.path);
      if (currentPath === null || !existsSync(currentPath)) {
        issues.push({
          path: historicalEntry.path,
          message: `immutable candidate file from ${revision} is missing`,
        });
        continue;
      }
      if (!historicalCandidate.equals(readFileSync(currentPath))) {
        issues.push({
          path: historicalEntry.path,
          message: `immutable candidate bytes differ from ${revision}`,
        });
      }
    }
  }

  return issues;
}

function repoRelative(repoRoot: string, absolutePath: string): string {
  return relative(repoRoot, absolutePath).split(sep).join('/');
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return canonicalize(a) === canonicalize(b);
}

/** Every geometry/echo asset bound by the pack, including glTF dependencies. */
function expectedPackAssets(repoRoot: string, packDir: string, pack: Pack): string[] {
  const expected = new Set<string>();
  const addGltf = (packRelativeGltf: string) => {
    const gltfPath = resolve(packDir, ...packRelativeGltf.split('/'));
    expected.add(repoRelative(repoRoot, gltfPath));
    if (extname(gltfPath).toLowerCase() !== '.gltf' || !existsSync(gltfPath)) return;

    let document: unknown;
    try {
      document = JSON.parse(readFileSync(gltfPath, 'utf8')) as unknown;
    } catch {
      return;
    }
    if (document === null || typeof document !== 'object' || Array.isArray(document)) return;
    const record = document as {
      buffers?: { uri?: unknown }[];
      images?: { uri?: unknown }[];
    };
    const resources = [...(record.buffers ?? []), ...(record.images ?? [])];
    for (const resource of resources) {
      if (typeof resource?.uri !== 'string' || resource.uri.startsWith('data:')) continue;
      const relativeResource = posix.normalize(
        posix.join(posix.dirname(packRelativeGltf), resource.uri),
      );
      if (!AssetPath.safeParse(relativeResource).success) continue;
      const absolute = resolve(packDir, ...relativeResource.split('/'));
      if (absolute.startsWith(`${resolve(packDir)}${sep}`)) {
        expected.add(repoRelative(repoRoot, absolute));
      }
    }
  };

  addGltf(pack.meshes.gltf);
  for (const frame of pack.meshes.keyframes?.frames ?? []) addGltf(frame.gltf);
  if (pack.echo_volume !== undefined) {
    expected.add(repoRelative(repoRoot, resolve(packDir, ...pack.echo_volume.asset.split('/'))));
  }
  return [...expected].sort();
}

function verifyBinding(
  evidence: ViewCandidateEvidence,
  options: ViewCandidateValidationOptions,
): ViewCandidateIssue[] {
  const issues: ViewCandidateIssue[] = [];
  const fail = (path: string, message: string) => issues.push({ path, message });
  const binding = evidence.binding;
  const expectedPackPath = `public/packs/${binding.source_pack_id}/pack.json`;
  if (binding.source_pack_path !== expectedPackPath) {
    fail(
      'binding.source_pack_path',
      `expected exact source pack path "${expectedPackPath}"`,
    );
    return issues;
  }

  const packPath = safeRepoPath(options.repoRoot, binding.source_pack_path);
  if (packPath === null || !existsSync(packPath)) {
    fail('binding.source_pack_path', `bound pack does not exist at "${binding.source_pack_path}"`);
    return issues;
  }

  const actualPackSha = sha256File(packPath);
  if (actualPackSha !== binding.source_pack_sha256) {
    fail(
      'binding.source_pack_sha256',
      `digest mismatch: evidence ${binding.source_pack_sha256}, checkout ${actualPackSha}`,
    );
  }

  if (options.verifyGitBinding !== false) {
    let revisionAvailable = true;
    try {
      execFileSync(
        'git',
        ['merge-base', '--is-ancestor', binding.source_pack_revision, 'HEAD'],
        { cwd: options.repoRoot, stdio: 'ignore' },
      );
    } catch {
      revisionAvailable = false;
      fail(
        'binding.source_pack_revision',
        `revision ${binding.source_pack_revision} is not an ancestor available in this checkout`,
      );
    }

    if (revisionAvailable) {
      try {
        const revisionBytes = execFileSync(
          'git',
          ['show', `${binding.source_pack_revision}:${binding.source_pack_path}`],
          {
            cwd: options.repoRoot,
            maxBuffer: 64 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        const revisionSha = sha256Bytes(revisionBytes);
        if (revisionSha !== binding.source_pack_sha256) {
          fail(
            'binding.source_pack_revision',
            `pack bytes at revision ${binding.source_pack_revision} hash to ${revisionSha}, not ${binding.source_pack_sha256}`,
          );
        }
      } catch (error) {
        fail(
          'binding.source_pack_revision',
          `cannot read the bound pack from revision ${binding.source_pack_revision}: ${(error as Error).message}`,
        );
      }
    }
  }

  let rawPack: unknown;
  try {
    rawPack = JSON.parse(readFileSync(packPath, 'utf8')) as unknown;
  } catch (error) {
    fail('binding.source_pack_path', `bound pack is not JSON: ${(error as Error).message}`);
    return issues;
  }
  const parsedPack = validatePack(rawPack);
  if (!parsedPack.ok) {
    fail('binding.source_pack_path', 'bound pack does not validate against the current pack schema');
    return issues;
  }
  const pack = parsedPack.pack;
  if (pack.meta.id !== binding.source_pack_id) {
    fail('binding.source_pack_id', `evidence says "${binding.source_pack_id}", pack says "${pack.meta.id}"`);
  }
  if (pack.meta.pack_version !== binding.source_pack_version) {
    fail(
      'binding.source_pack_version',
      `evidence says "${binding.source_pack_version}", pack says "${pack.meta.pack_version}"`,
    );
  }
  if (pack.meta.schema_version !== binding.source_pack_schema_version) {
    fail(
      'binding.source_pack_schema_version',
      `evidence says "${binding.source_pack_schema_version}", pack says "${pack.meta.schema_version}"`,
    );
  }

  const packFrame = pack.meshes.anatomical_frame;
  if (packFrame === undefined) {
    fail('binding.coordinate_frame', 'bound pack has no anatomical_frame to support coordinates');
  } else {
    const expectedFrame = {
      method: packFrame.method,
      basis_source_to_pack: packFrame.basis_source_to_pack,
      checks_passed: packFrame.checks_passed,
      checks_total: packFrame.checks_total,
    };
    if (!jsonEqual(binding.coordinate_frame, expectedFrame)) {
      fail(
        'binding.coordinate_frame',
        'does not exactly equal the bound pack anatomical-frame evidence',
      );
    }
  }

  const declaredAssets = [...binding.pack_assets].sort((a, b) => a.path.localeCompare(b.path));
  const expectedAssets = expectedPackAssets(options.repoRoot, dirname(packPath), pack);
  const declaredPaths = declaredAssets.map((asset) => asset.path);
  if (!jsonEqual(declaredPaths, expectedAssets)) {
    fail(
      'binding.pack_assets',
      `must list exactly the current pack asset closure; expected ${JSON.stringify(expectedAssets)}`,
    );
  }
  for (const [index, asset] of binding.pack_assets.entries()) {
    const assetPath = safeRepoPath(options.repoRoot, asset.path);
    if (assetPath === null || !existsSync(assetPath)) {
      fail(`binding.pack_assets.${index}.path`, `pack asset does not exist at "${asset.path}"`);
      continue;
    }
    const actual = sha256File(assetPath);
    if (actual !== asset.sha256) {
      fail(
        `binding.pack_assets.${index}.sha256`,
        `digest mismatch for "${asset.path}": evidence ${asset.sha256}, checkout ${actual}`,
      );
    }
  }

  const declaredDerivationFiles = [...binding.derivation_files]
    .sort((a, b) => a.path.localeCompare(b.path));
  const expectedDerivationPaths = [...VIEW_CANDIDATE_DERIVATION_FILES].sort();
  const declaredDerivationPaths = declaredDerivationFiles.map((file) => file.path);
  if (!jsonEqual(declaredDerivationPaths, expectedDerivationPaths)) {
    fail(
      'binding.derivation_files',
      `must list exactly the coordinate-derivation closure; expected ${JSON.stringify(expectedDerivationPaths)}`,
    );
  }
  for (const [index, file] of binding.derivation_files.entries()) {
    const filePath = safeRepoPath(options.repoRoot, file.path);
    if (filePath === null || !existsSync(filePath)) {
      fail(`binding.derivation_files.${index}.path`, `derivation file does not exist at "${file.path}"`);
      continue;
    }
    const actual = sha256File(filePath);
    if (actual !== file.sha256) {
      fail(
        `binding.derivation_files.${index}.sha256`,
        `digest mismatch for "${file.path}": evidence ${file.sha256}, checkout ${actual}`,
      );
    }
  }

  const packReview = pack.provenance.vetted;
  if (
    packReview.status !== 'draft'
    || packReview.vetters.length !== 0
    || packReview.last_reviewed !== null
  ) {
    fail(
      'non_promotion.source_pack_review_status',
      'bound pack must remain Draft with no vetters or review timestamp',
    );
  }
  pack.views.forEach((view, index) => {
    const review = view.provenance.vetted;
    if (review.status !== 'draft' || review.vetters.length !== 0 || review.last_reviewed !== null) {
      fail(
        `binding.source_pack_path.views.${index}.provenance.vetted`,
        `bound source view "${view.view_id}" must remain Draft with no vetters or review timestamp`,
      );
    }
  });

  const packViews = new Map(pack.views.map((view) => [view.view_id, view]));
  const evidencedSourceViewIds = new Set(
    evidence.existing_views.map((entry) => entry.source_view_id),
  );
  for (const view of pack.views) {
    if (CANON_VIEW_IDS.has(view.view_id) && !evidencedSourceViewIds.has(view.view_id)) {
      fail(
        'existing_views',
        `canon view "${view.view_id}" already exists in the pack and cannot be reclassified`,
      );
    }
  }
  evidence.existing_views.forEach((entry, index) => {
    const view = packViews.get(entry.source_view_id);
    if (view === undefined) {
      fail(
        `existing_views.${index}.source_view_id`,
        `source view "${entry.source_view_id}" is absent from the bound pack`,
      );
      return;
    }
    if (entry.intended_view_id !== entry.source_view_id) {
      fail(
        `existing_views.${index}.intended_view_id`,
        'an existing entry must preserve the source view id',
      );
    }
    if (!jsonEqual(entry.coordinates.probe, view.probe)) {
      fail(`existing_views.${index}.coordinates.probe`, 'does not equal the bound pack pose');
    }
    if (!jsonEqual(entry.coordinates.sweep, view.sweep)) {
      fail(`existing_views.${index}.coordinates.sweep`, 'does not equal the bound pack sweep');
    }
  });

  const existingIds = new Set(pack.views.map((view) => view.view_id));
  evidence.candidates.forEach((candidate, index) => {
    if (existingIds.has(candidate.intended_view_id)) {
      fail(
        `candidates.${index}.intended_view_id`,
        `candidate "${candidate.intended_view_id}" already exists in the bound pack`,
      );
    }
  });

  if (options.evidencePath !== undefined) {
    const actualRelative = repoRelative(options.repoRoot, resolve(options.evidencePath));
    const expectedDir = `evidence/view-candidates/${binding.source_pack_id}/pack-${binding.source_pack_version}`;
    if (posix.dirname(actualRelative) !== expectedDir) {
      fail(
        '<file>',
        `candidate set must live directly under "${expectedDir}"; found "${actualRelative}"`,
      );
    }
    const expectedSetId = `${binding.source_pack_id}-pack-${binding.source_pack_version}-${basename(actualRelative, '.json')}`;
    if (evidence.candidate_set_id !== expectedSetId) {
      fail(
        'candidate_set_id',
        `must equal the pack/path-derived id "${expectedSetId}"`,
      );
    }
    if (evidence.non_promotion.generation_writes_only !== actualRelative) {
      fail(
        'non_promotion.generation_writes_only',
        `must equal this artifact path "${actualRelative}"`,
      );
    }
  }

  return issues;
}

/** Validate shape, non-promotion boundary, self-integrity, and live pack binding. */
export function validateViewCandidateEvidence(
  value: unknown,
  options: ViewCandidateValidationOptions,
): ViewCandidateValidation {
  const forbidden = forbiddenKeyIssues(value);
  const parsed = ViewCandidateEvidence.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      evidence: null,
      issues: [...forbidden, ...toIssues(parsed.error)],
    };
  }

  const issues = [...forbidden];
  const expectedDigest = candidatePayloadSha256(parsed.data);
  if (parsed.data.integrity.canonical_payload_sha256 !== expectedDigest) {
    issues.push({
      path: 'integrity.canonical_payload_sha256',
      message: `digest mismatch: evidence ${parsed.data.integrity.canonical_payload_sha256}, recomputed ${expectedDigest}`,
    });
  }
  if (options.registryEntry !== undefined) {
    const registered = options.registryEntry;
    if (registered.candidate_set_id !== parsed.data.candidate_set_id) {
      issues.push({
        path: 'candidate_set_id',
        message: `does not match immutable registry id "${registered.candidate_set_id}"`,
      });
    }
    if (registered.canonical_payload_sha256 !== parsed.data.integrity.canonical_payload_sha256) {
      issues.push({
        path: 'integrity.canonical_payload_sha256',
        message: 'does not match the independently pinned immutable registry digest',
      });
    }
    if (options.evidencePath === undefined) {
      issues.push({
        path: '<file>',
        message: 'an immutable registry entry requires evidencePath for exact file-byte checking',
      });
    } else if (registered.file_sha256 !== sha256File(options.evidencePath)) {
      issues.push({
        path: '<file>',
        message: 'exact file-byte digest does not match the independently pinned immutable registry',
      });
    }
  }
  issues.push(...verifyBinding(parsed.data, options));
  if (issues.length > 0) return { ok: false, evidence: null, issues };
  return { ok: true, evidence: parsed.data, issues: [] };
}

export function formatViewCandidateIssues(issues: ViewCandidateIssue[]): string {
  return issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n');
}
