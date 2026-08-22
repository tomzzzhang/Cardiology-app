#!/usr/bin/env node
/** Build one explicit authoring-slots/v1 visual-review carrier. */
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { repoRoot } from './lib/discoverPacks.ts';
import {
  ViewCandidateRegistry,
  formatViewCandidateIssues,
  validateViewCandidateEvidence,
} from './lib/viewCandidateEvidence.ts';
import { buildViewCandidateReviewSession } from './lib/viewCandidateReviewSession.ts';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const write = args.includes('--write');
const check = args.includes('--check');
if (write && check) fail('choose either --write or --check, not both');
const positional = args.filter((arg) => arg !== '--write' && arg !== '--check');
if (positional.length !== 3) {
  fail(
    'usage: tsx scripts/build-view-candidate-review-session.ts '
    + '<candidate-set.json> <review-session.json> <canonical-ISO-instant> [--write|--check]',
  );
}

const [evidenceArg, outputArg, generatedAt] = positional as [string, string, string];
const evidencePath = resolve(repoRoot, evidenceArg);
const outputPath = resolve(repoRoot, outputArg);
const evidenceRelative = relative(repoRoot, evidencePath);
const outputRelative = relative(repoRoot, outputPath);
if (isAbsolute(evidenceRelative) || isAbsolute(outputRelative)
  || evidenceRelative === '..' || evidenceRelative.startsWith(`..${sep}`)
  || outputRelative === '..' || outputRelative.startsWith(`..${sep}`)) {
  fail('input and output must stay inside the repository');
}
if (dirname(outputPath) !== dirname(evidencePath)) {
  fail('the review-session carrier must stay beside its candidate set');
}
if (outputPath === evidencePath) {
  fail('the review-session carrier cannot overwrite its candidate set');
}
if (!/^review-session-\d{3}\.authoring-slots-v1\.json$/.test(basename(outputPath))) {
  fail('the output must be named review-session-NNN.authoring-slots-v1.json');
}
const evidenceLabel = evidenceRelative.split(sep).join('/');
const outputLabel = outputRelative.split(sep).join('/');

const registry = ViewCandidateRegistry.parse(JSON.parse(readFileSync(
  resolve(repoRoot, 'evidence/view-candidates/registry.json'),
  'utf8',
)) as unknown);
const registryEntry = registry.candidate_sets.find((entry) => entry.path === evidenceLabel);
if (registryEntry === undefined) fail(`${evidenceLabel} is not in the candidate-set registry`);

const raw = JSON.parse(readFileSync(evidencePath, 'utf8')) as unknown;
const validated = validateViewCandidateEvidence(raw, {
  repoRoot,
  evidencePath,
  registryEntry,
});
if (!validated.ok) fail(formatViewCandidateIssues(validated.issues));

const session = buildViewCandidateReviewSession(validated.evidence, generatedAt);
const serialized = `${JSON.stringify(session, null, 2)}\n`;
if (check) {
  if (!existsSync(outputPath)) fail(`${outputLabel} does not exist`);
  if (readFileSync(outputPath, 'utf8') !== serialized) {
    fail(`${outputLabel} does not match the current registered candidate set`);
  }
  console.log(`ok  ${outputLabel} (${session.slots.length} Draft test views)`);
  process.exit(0);
}
if (!write) {
  process.stdout.write(serialized);
  console.error(`preview only; add --write to create or --check to verify ${outputLabel}`);
  process.exit(0);
}

const temporaryPath = `${outputPath}.tmp`;
if (existsSync(temporaryPath)) fail(`${outputLabel}.tmp already exists`);
try {
  writeFileSync(temporaryPath, serialized, { encoding: 'utf8', flag: 'wx' });
  renameSync(temporaryPath, outputPath);
} catch (error) {
  if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  throw error;
}
console.log(`wrote ${outputLabel} (${session.slots.length} Draft test views)`);
