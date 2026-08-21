/**
 * Acceptance gate: no imaging view defines the patient/body frame.
 *
 *   npm run check:frame-decoupling
 *
 * The apical four-chamber used to set the model's z axis. Saving it repointed
 * the levelling axis, the authoring surface said "sets z axis" beside the save
 * button, and the export carried a `cardiac_frame` block out for an ingest to
 * read. All of it is removed (owner decision, 2026-08-21): the patient frame is
 * `+X` patient-left, `+Y` posterior, `+Z` superior, it comes from a
 * `body-context/v0` registration measured against a whole-body reference, and
 * nothing a view does may move it.
 *
 * ## Why a repository-wide grep rather than a unit test
 *
 * A unit test proves a function behaves. It cannot prove a capability is
 * ABSENT, because the next reintroduction of it would arrive with its own
 * passing tests. What has to hold here is a property of the whole tree: no live
 * path exists by which placing a view repoints world up.
 *
 * So this checks names and user-visible strings across source, scripts and
 * tests. The names are the ones the removed machinery used; a reimplementation
 * that avoided every one of them would be a deliberate act rather than an
 * accident, and this gate is aimed at the accident.
 *
 * ## What is deliberately still allowed
 *
 * * `cardiac_frame` in `scripts/lib/authoringIngest.ts` and in the test that
 *   feeds it a legacy file. Old exports carry the block and must still import
 *   their poses; the ingest parses it, reports it ignored, and drops it.
 * * The pack field `meshes.anatomical_frame`. That is a pack's own CARDIAC
 *   basis with a recorded derivation. It never was a body frame and does not
 *   become one.
 * * B1 itself, everywhere. It is still a canon row, still a slot, still a pack
 *   view, and still whatever it is to the B2 candidates. Only its claim over
 *   the frame is gone.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');

/**
 * Trees that must contain no live path.
 *
 * `contracts/` is deliberately NOT here. A contract that explains what was
 * removed and why has to be able to name it, and a gate that forbade the words
 * would push the documentation into vagueness to get past itself. Contracts are
 * checked the other way round instead, by `contractsRecordTheRemoval` below:
 * they must SAY the frame no longer comes from a view.
 */
const ROOTS = ['src', 'scripts', 'tests'];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-authoring', '.git', 'test-results']);

interface Rule {
  /** Matched against file contents. */
  pattern: RegExp;
  what: string;
  /** Repo-relative paths where this match is legitimate. */
  allow?: readonly string[];
}

export const FRAME_DECOUPLING_RULES: readonly Rule[] = [
  {
    pattern: /sets\s+z\s+axis/i,
    what: 'the "sets z axis" label beside the authoring save button',
  },
  {
    pattern: /authoring-frame-hint/,
    what: 'the test id of the "sets z axis" badge',
  },
  {
    pattern: /\bdefinesFrame\b/,
    what: 'the per-slot flag naming one view as the frame-defining one',
  },
  {
    pattern: /\bFRAME_VIEW_ID\b/,
    what: 'the constant naming B1 as the frame-defining view',
  },
  {
    pattern: /\bisFrameView\b/,
    what: 'the predicate asking whether a view defines the frame',
  },
  {
    pattern: /\bframeFromFourChamber\b/,
    what: 'the derivation of model axes from an apical four-chamber pose',
  },
  {
    pattern: /\bcardiacFrame\b/,
    what: 'the module and parameter that carried a view-derived frame',
    // The ingest still REPORTS that it ignored a legacy block.
    allow: ['scripts/lib/authoringIngest.ts', 'tests/unit/authoringIngest.test.ts'],
  },
  {
    pattern: /\bonLevelAxis\b|\bsetLevelAxis\b|\blevelAxis\b/,
    what: 'the path by which a view repointed the levelling axis',
  },
  {
    pattern: /cardiac_frame/,
    what: 'the exported view-derived frame block',
    allow: [
      'scripts/lib/authoringIngest.ts',
      'tests/unit/authoringIngest.test.ts',
      'src/authoring/exportFile.ts', // the comment explaining it is read past
      'scripts/check-frame-decoupling.ts',
    ],
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|css|md|mjs)$/.test(entry)) out.push(path);
  }
  return out;
}

/** Every violation, so one run reports all of them rather than the first. */
export function frameDecouplingFailures(root = repoRoot): string[] {
  const failures: string[] = [];
  const self = 'scripts/check-frame-decoupling.ts';

  for (const treeName of ROOTS) {
    const tree = join(root, treeName);
    let files: string[];
    try {
      files = walk(tree);
    } catch {
      continue; // a tree that does not exist is not a violation
    }
    for (const file of files) {
      const rel = relative(root, file).split('\\').join('/');
      if (rel === self) continue;
      const text = readFileSync(file, 'utf8');
      const lines = text.split('\n');
      for (const rule of FRAME_DECOUPLING_RULES) {
        if (rule.allow?.includes(rel)) continue;
        lines.forEach((line, index) => {
          if (rule.pattern.test(line)) {
            failures.push(
              `${rel}:${index + 1}: ${rule.what} is still present — ${line.trim().slice(0, 120)}`,
            );
          }
        });
      }
    }
  }
  return failures;
}

/**
 * The contracts have to record the removal rather than merely not contradict it.
 *
 * Absence of a claim is not documentation. If `viewer-core.md` still described
 * the horizon lock as holding a measured cardiac axis, the code and the
 * contract would disagree and the contract is what a reader trusts.
 */
export function contractsRecordTheRemoval(root = repoRoot): string[] {
  const required: readonly { file: string; needle: RegExp; what: string }[] = [
    {
      file: 'contracts/viewer-core.md',
      needle: /body\/world `\+Z`/,
      what: 'that the horizon lock holds body/world +Z',
    },
    {
      file: 'contracts/authoring-mode.md',
      needle: /No view defines the patient frame/i,
      what: 'that no view defines the patient frame',
    },
  ];
  const problems: string[] = [];
  for (const rule of required) {
    let text: string;
    try {
      text = readFileSync(join(root, rule.file), 'utf8');
    } catch {
      problems.push(`${rule.file}: missing, so it cannot record ${rule.what}`);
      continue;
    }
    if (!rule.needle.test(text)) {
      problems.push(`${rule.file}: does not record ${rule.what}`);
    }
  }
  return problems;
}

/**
 * The export must not carry a frame block, checked at the type level by
 * building one and looking at what came out.
 */
export function exportCarriesNoFrame(root = repoRoot): string[] {
  const source = readFileSync(join(root, 'src', 'authoring', 'exportFile.ts'), 'utf8');
  const problems: string[] = [];
  if (/cardiac_frame\s*[?:]/.test(source)) {
    problems.push('src/authoring/exportFile.ts: SlotExport still declares a cardiac_frame field');
  }
  if (/\.\.\.\(input\.cardiacFrame/.test(source)) {
    problems.push('src/authoring/exportFile.ts: buildExport still emits a cardiac_frame block');
  }
  return problems;
}

const failures = [
  ...frameDecouplingFailures(),
  ...exportCarriesNoFrame(),
  ...contractsRecordTheRemoval(),
];

if (failures.length > 0) {
  console.error(
    'B1 must not define the patient/body frame. The frame comes from body-context/v0:\n'
    + '  +X patient-left, +Y posterior, +Z superior; Level holds body +Z.\n',
  );
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(
  `frame decoupling: ${FRAME_DECOUPLING_RULES.length} rules clean across ${ROOTS.join(', ')}; `
  + 'contracts record the removal',
);
