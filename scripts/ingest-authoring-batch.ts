#!/usr/bin/env node
/**
 * Apply the Rodero corrected pose set to the pack, in one revision.
 *
 * Preview is the default; `--write` is required to replace the pack, exactly as
 * the single-view tool works.
 *
 *   npm run ingest:authoring:batch -- --write
 *
 * ## What this replaces, and what it creates
 *
 * The corrected poses were generated as review evidence and mounted through a
 * browser-local `authoring-slots/v1` carrier. That made them a disposable review
 * session: a fresh browser profile has never imported them, so the app fell back
 * to the pack's own, too-close poses. This makes the corrections the pack's.
 *
 * B1, C1 and C2 exist in the pack and are REPLACED, keeping their identity,
 * their aliases and their review state. B4 and F1 do not exist in the pack and
 * are CREATED (owner decision, 2026-08-21), which is a different act: the pack
 * begins claiming two views it was not claiming before. Their clinical identity
 * is quoted from `docs/view_canon.md` rather than derived, and they land Draft
 * with no review history.
 *
 * The seven B2 variants in the carrier are deliberately NOT ingested. They are
 * unselected alternatives; choosing among them is a clinical decision that has
 * not been made, and ingesting all seven would have the pack claim seven
 * versions of one view.
 */
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  prepareAuthoringBatch,
  type AuthoringOperation,
} from './lib/authoringBatch.ts';

const repoRoot = join(import.meta.dirname, '..');

const EXPORT_PATH = join(
  repoRoot,
  'evidence/view-candidates/normal-rodero/pack-0.1.1/review-session-002.authoring-slots-v1.json',
);
const PACK_PATH = join(repoRoot, 'public/packs/normal-rodero/pack.json');
const NEXT_PACK_VERSION = '0.1.2';

/**
 * Clinical identity for the two created views, quoted from the draft canon.
 *
 * `docs/view_canon.md` is the source for family, name and indicator clock. An
 * indicator clock says how the transducer is held against a patient; no mesh
 * can produce one, so it is content and it is cited.
 */
const CANON_SOURCE = 'docs/view_canon.md (DRAFT canon, lines 53 and 73)';

const OPERATIONS: readonly AuthoringOperation[] = [
  { mode: 'replace', slotId: 'view-b1-apical-four-chamber', viewId: 'b1-apical-four-chamber' },
  { mode: 'replace', slotId: 'view-c1-parasternal-long-axis', viewId: 'c1-parasternal-long-axis' },
  { mode: 'replace', slotId: 'view-c2-parasternal-short-axis', viewId: 'c2-parasternal-short-axis' },
  {
    mode: 'create',
    slotId: 'view-b4-apical-three-chamber',
    canon: {
      family: 'B',
      viewId: 'b4-apical-three-chamber',
      name: 'Apical three-chamber (draft)',
      aliases: ['A3C', 'apical long axis'],
      // "B4. Three-chamber (apical long-axis) — indicator 11:00."
      indicatorClock: '11:00',
      canonSource: CANON_SOURCE,
    },
  },
  {
    mode: 'create',
    slotId: 'view-f1-right-parasternal-bicaval',
    canon: {
      family: 'F',
      viewId: 'f1-right-parasternal-bicaval',
      name: 'Right parasternal bicaval (draft)',
      aliases: ['bicaval', 'right sternal border sagittal'],
      // "F1. Sagittal (bicaval) — right sternal border; indicator 12:00."
      indicatorClock: '12:00',
      canonSource: CANON_SOURCE,
    },
  },
];

const write = process.argv.includes('--write');

const result = prepareAuthoringBatch({
  pack: JSON.parse(readFileSync(PACK_PATH, 'utf8')) as unknown,
  authoringExport: JSON.parse(readFileSync(EXPORT_PATH, 'utf8')) as unknown,
  operations: OPERATIONS,
  nextPackVersion: NEXT_PACK_VERSION,
});

if (!result.ok) {
  console.error(`batch ingest refused: ${result.problem}`);
  process.exit(1);
}

const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

console.log(
  `normal-rodero ${result.fromPackVersion} -> ${result.toPackVersion} `
  + `(export authored against ${result.exportBaseVersion})`,
);
for (const step of result.steps) {
  const after = (step.probeAfter as { origin: number[] }).origin;
  if (step.mode === 'replace') {
    const before = (step.probeBefore as { origin: number[] }).origin;
    console.log(
      `  replace ${step.viewId.padEnd(30)} aperture moved `
      + `${distance(before, after).toFixed(2)} mm`,
    );
  } else {
    console.log(`  create  ${step.viewId.padEnd(30)} new view, Draft, no review history`);
  }
}

if (!write) {
  console.log('\nPreview only. Re-run with --write to replace the pack.');
  process.exit(0);
}

// Atomic replace, same as the single-view tool: a half-written pack.json is a
// broken app, and this file is the one every other check binds to.
const temporary = join(dirname(PACK_PATH), `.pack.json.${process.pid}.tmp`);
try {
  writeFileSync(temporary, `${JSON.stringify(result.candidate, null, 2)}\n`);
  renameSync(temporary, PACK_PATH);
} catch (error) {
  try {
    unlinkSync(temporary);
  } catch {
    // The temporary file may not exist; the original error is what matters.
  }
  throw error;
}
console.log(`\nwrote ${resolve(PACK_PATH)}`);
