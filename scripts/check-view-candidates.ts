#!/usr/bin/env node
/**
 * Offline content check for immutable view-candidate evidence.
 *
 * The checker discovers candidate-set JSON documents only. Assessment
 * sidecars have a separate schema and deliberately cannot affect whether a
 * coordinate artifact matches the current pack bytes.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { repoRoot, relativeToRepo } from './lib/discoverPacks.ts';
import {
  ViewCandidateRegistry,
  formatViewCandidateIssues,
  validateViewCandidateEvidence,
  verifyViewCandidateAppendOnlyHistory,
} from './lib/viewCandidateEvidence.ts';

const evidenceRoot = join(repoRoot, 'evidence', 'view-candidates');
const registryPath = join(evidenceRoot, 'registry.json');

function discoverCandidateSets(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current).sort()) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) {
        visit(path);
      } else if (/^candidate-set-[a-z0-9._-]+\.json$/.test(basename(path))) {
        found.push(path);
      }
    }
  };
  visit(dir);
  return found;
}

const failures: string[] = [];
const candidateSets = discoverCandidateSets(evidenceRoot);
const candidateSetLabels = new Set(candidateSets.map(relativeToRepo));
const registeredByPath = new Map<string, ViewCandidateRegistry['candidate_sets'][number]>();

if (candidateSets.length === 0) {
  failures.push('no candidate-set JSON found under evidence/view-candidates/');
}

if (!existsSync(registryPath)) {
  failures.push('evidence/view-candidates/registry.json: immutable-set registry is missing');
} else {
  try {
    const rawRegistry = JSON.parse(readFileSync(registryPath, 'utf8')) as unknown;
    const parsedRegistry = ViewCandidateRegistry.safeParse(rawRegistry);
    if (!parsedRegistry.success) {
      const issues = parsedRegistry.error.issues
        .map((issue) => `  ${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('\n');
      failures.push(`evidence/view-candidates/registry.json:\n${issues}`);
    } else {
      for (const entry of parsedRegistry.data.candidate_sets) {
        registeredByPath.set(entry.path, entry);
        if (!candidateSetLabels.has(entry.path)) {
          failures.push(`evidence/view-candidates/registry.json: registered set is missing: ${entry.path}`);
        }
      }
      const historyIssues = verifyViewCandidateAppendOnlyHistory(repoRoot, parsedRegistry.data);
      if (historyIssues.length > 0) {
        failures.push(
          `evidence/view-candidates/registry.json:\n${formatViewCandidateIssues(historyIssues)}`,
        );
      }
    }
  } catch (error) {
    failures.push(
      `evidence/view-candidates/registry.json: not valid JSON: ${(error as Error).message}`,
    );
  }
}

for (const path of candidateSets) {
  const label = relativeToRepo(path);
  const failureCountBefore = failures.length;
  const registered = registeredByPath.get(label);
  if (registered === undefined) {
    failures.push(`${label}: candidate set is not pinned in evidence/view-candidates/registry.json`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    failures.push(`${label}: not valid JSON: ${(error as Error).message}`);
    continue;
  }

  const result = validateViewCandidateEvidence(raw, {
    repoRoot,
    evidencePath: path,
    registryEntry: registered,
  });
  if (!result.ok) {
    failures.push(`${label}:\n${formatViewCandidateIssues(result.issues)}`);
    continue;
  }
  if (failures.length === failureCountBefore) {
    console.log(
      `ok  ${label}  (${result.evidence.candidate_set_id}, `
        + `${result.evidence.candidates.length} proposed, `
        + `${result.evidence.deferred.length} deferred, `
        + `${result.evidence.unsupported.length} unsupported)`,
    );
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} view-candidate evidence failure(s):\n`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`\n${candidateSets.length} view-candidate set(s) passed schema and byte-binding checks.`);
