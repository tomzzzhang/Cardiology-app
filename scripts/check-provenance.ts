/**
 * CI gate: license and attribution completeness.
 *
 *   npm run check:provenance
 *
 * `docs/build_plan.md` (Licensing plan): "CI enforces attribution completeness;
 * build fails on missing provenance/license fields." The schema already makes
 * the provenance block structurally required — this check adds the rules that
 * are policy rather than shape:
 *
 *   - provenance exists per anatomy AND per view;
 *   - no placeholder text stands in for a real attribution;
 *   - a `vetted` item names its vetters and a review date;
 *   - a draft item is visibly draft-flagged rather than silently unvetted;
 *   - vetter NAMES are consent-gated, so an unnamed vetter is fine but a named
 *     one must still carry a role label for the provenance strip;
 *   - `modified.flag` implies a non-empty modified note (the CC "reasonable
 *     manner" requirement) and a non-empty derivation chain;
 *   - `license_state` is present and non-empty;
 *   - a pack in public Git must match an explicit source/grant approval;
 *   - unresolved-rights packs cannot be added, apart from two pre-existing
 *     exceptions recorded below;
 *   - ONLY a `confirmed` state may appear on the Pages allowlist.
 *
 * That last rule is the reason this check exists at all rather than being left
 * to the schema. The schema can require a state to be declared; it cannot see
 * the published allowlist, so it cannot tell whether declaring `unconfirmed`
 * contradicts shipping the pack. Enforcing it here makes "an unconfirmed
 * licence does not ship" a rule the build applies rather than a habit somebody
 * has to remember at the moment they edit the allowlist.
 */
import { validatePack } from '../src/schema/validate.ts';
import { mayBePublished, type Provenance } from '../src/schema/packV0.ts';
import { isPublishedPack } from '../src/packs/published.ts';
import { discoverPacks, relativeToRepo } from './lib/discoverPacks.ts';
import { isPlaceholder } from './lib/placeholders.ts';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const failures: string[] = [];

type PublicGitRightsApproval = {
  sourceUrl: string;
  license: string;
  licenseUrl: string;
  licenseState: Provenance['license_state'];
  assetFingerprint: string;
};

/**
 * Explicit public-repository distribution decisions for the current packs.
 *
 * `license_state` records how well a named grant is known; it does not itself
 * prove that the grant permits redistribution and modification. A new pack or
 * a changed source/grant therefore fails until this reviewable policy record is
 * updated deliberately. The two unresolved historical cases remain separate,
 * frozen exceptions below.
 */
const PUBLIC_GIT_RIGHTS_APPROVALS = new Map<string, PublicGitRightsApproval>([
  ['anatomy-bodyparts3d-heart', {
    sourceUrl: 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html',
    license: 'CC-BY-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    licenseState: 'confirmed',
    assetFingerprint: '93905b267e711d3c3c55001ab1688e9c879b2a3c6d7a9f0ccf709db2d6b4f6b0',
  }],
  ['motion-biv-cinemri', {
    sourceUrl: 'https://zenodo.org/records/10548682',
    license: 'CC-BY-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    licenseState: 'confirmed',
    assetFingerprint: 'c35f96bc201395e41594bf2394bd7da8760dff6635ff375971dd34fa80c5a137',
  }],
  ['normal-kit-four-chamber', {
    sourceUrl: 'https://zenodo.org/records/10526554',
    license: 'CC-BY-NC-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
    licenseState: 'non_commercial',
    assetFingerprint: '664771db71f830459af02393fc5f930d162eef8f225a8878b66e5189df193119',
  }],
  ['normal-rodero', {
    sourceUrl: 'https://zenodo.org/records/4593738',
    license: 'CC-BY-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    licenseState: 'confirmed',
    assetFingerprint: 'c1dbf23c239e8e2d383d39af0a2afed4618e8112530ea42607c57f20f593aba8',
  }],
  ['normal-vhl-heart0102', {
    sourceUrl: 'https://sketchfab.com/3d-models/healthy-pediatric-heart-model-heart0102-b7cb05c398894395a329cfff4c1caf0e',
    license: 'CC-BY-NC-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
    licenseState: 'non_commercial',
    assetFingerprint: 'f7adb6bb62a9262ec7310b4c17673f172179a77dd4076e03be44fe43094a0160',
  }],
  ['normal-vhl-heart0102-chambers', {
    sourceUrl: 'https://sketchfab.com/3d-models/healthy-pediatric-heart-model-heart0102-b7cb05c398894395a329cfff4c1caf0e',
    license: 'CC-BY-NC-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
    licenseState: 'non_commercial',
    assetFingerprint: '4e3a013804f5d91978a9692c75db0151db9771005feba2e5dd1ba14085b27649',
  }],
  ['stub', {
    sourceUrl: 'https://github.com/tomzzzhang/Cardiology-app',
    license: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    licenseState: 'confirmed',
    assetFingerprint: '3ba69c54db86c8c92309b7cf10b8b718d3634e4f914a51917829b172be1ebd95',
  }],
  ['tof-cobivecox-chd0017001', {
    sourceUrl: 'https://zenodo.org/records/10577973',
    license: 'CC-BY-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    licenseState: 'confirmed',
    assetFingerprint: '3227e09dd81a6ab20b1aed7be6b81d6162f9a12d6ea9c94719040031e813cc8b',
  }],
]);

/**
 * These packs pre-date the public-Git rule and are already present in shared
 * history. Keeping the exception explicit lets ordinary content checks pass
 * while preventing another unresolved-rights pack from silently joining them.
 * Removing files from the current branch or rewriting history is a separate
 * owner decision; exclusion from Pages does not undo the existing distribution.
 */
const KNOWN_PUBLIC_GIT_RIGHTS_EXCEPTIONS = new Map([
  [
    'motion-straus-us-patient01',
    '8b57a415a96180cad31b211e08d953beaa3ef38314950f4f80507e4f2b73140b',
  ],
  [
    'normal-alberta-neonatal',
    'e8e12e992872d005c835d3ddb2ad2f36066e2529b863fea69ae402f4a7c5b0f5',
  ],
]);

function assetFingerprint(packDir: string): string | null {
  if (!existsSync(packDir)) return null;

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (relative(packDir, path) !== 'pack.json') files.push(path);
    }
  };
  walk(packDir);

  const hash = createHash('sha256');
  for (const path of files) {
    // Pack-relative references may legally live outside assets/. Fingerprint
    // every non-metadata file so alternate paths cannot bypass approval.
    hash.update(relative(packDir, path));
    hash.update('\0');
    hash.update(readFileSync(path));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function checkProvenance(where: string, provenance: Provenance): void {
  const fail = (message: string) => failures.push(`${where}: ${message}`);

  const required: [string, string][] = [
    ['creator', provenance.creator],
    ['source', provenance.source],
    ['source_url', provenance.source_url],
    ['license', provenance.license],
    ['license_url', provenance.license_url],
  ];

  for (const [field, value] of required) {
    if (value.trim().length === 0) {
      fail(`${field} is empty`);
      continue;
    }
    if (isPlaceholder(value)) {
      fail(`${field} is a placeholder ("${value}")`);
    }
  }

  if (provenance.modified.flag) {
    if (provenance.modified.note.trim().length === 0) {
      fail('modified.flag is set but modified.note is empty — CC attribution requires the note');
    }
    if (provenance.derivation_chain.length === 0) {
      fail('modified.flag is set but derivation_chain is empty');
    }
  }

  // The schema types this as an enum, so a bad value cannot reach here — but a
  // pack that never went through the schema (a hand-edit under review) can, and
  // an empty state must fail as loudly as a missing one.
  if (String(provenance.license_state ?? '').trim().length === 0) {
    fail('license_state is missing or empty');
  }

  const { vetted } = provenance;
  if (vetted.status === 'vetted') {
    if (vetted.vetters.length === 0) fail('status is "vetted" but no vetters are recorded');
    if (vetted.last_reviewed === null) fail('status is "vetted" but last_reviewed is null');
  }

  vetted.vetters.forEach((vetter, index) => {
    if (vetter.name !== undefined && vetter.name.trim().length === 0) {
      fail(`vetters.${index}.name is present but empty — omit it instead`);
    }
  });
}

const packs = discoverPacks();
if (packs.length === 0) {
  console.error('No packs found under public/packs/.');
  process.exit(1);
}

for (const found of packs) {
  const label = relativeToRepo(found.jsonPath);
  if (found.problem !== null) {
    failures.push(`${label}: ${found.problem}`);
    continue;
  }

  const result = validatePack(found.raw);
  if (!result.ok) {
    failures.push(`${label}: does not validate against schema v0.1; run "npm run validate:packs"`);
    continue;
  }

  const { pack } = result;
  checkProvenance(`${label} [anatomy]`, pack.provenance);
  pack.views.forEach((view, index) => {
    checkProvenance(`${label} [views.${index} "${view.view_id}"]`, view.provenance);
  });

  /*
   * The licence gate. `mayBePublished` is the one definition of the rule; this
   * is the one place it meets the allowlist.
   */
  const state = pack.provenance.license_state;
  const approval = PUBLIC_GIT_RIGHTS_APPROVALS.get(pack.meta.id);
  const actualFingerprint = assetFingerprint(found.dir);
  const matchesApproval = approval !== undefined
    && pack.meta.id === found.id
    && pack.provenance.source_url === approval.sourceUrl
    && pack.provenance.license === approval.license
    && pack.provenance.license_url === approval.licenseUrl
    && state === approval.licenseState
    && actualFingerprint === approval.assetFingerprint;

  if (!matchesApproval) {
    const expectedFingerprint = KNOWN_PUBLIC_GIT_RIGHTS_EXCEPTIONS.get(found.id);
    if (
      pack.meta.id === found.id &&
      expectedFingerprint !== undefined &&
      actualFingerprint === expectedFingerprint
    ) {
      console.warn(
        `frozen public-Git rights exception: ${pack.meta.id} (${state}); ` +
          'its existing asset tree is unchanged',
      );
    } else {
      failures.push(
        `${label}: pack directory/source/grant does not match an explicit public-Git rights ` +
          `approval or an exact frozen legacy exception (directory "${found.id}", ` +
          `meta.id "${pack.meta.id}"). New or unresolved derivatives belong in the ` +
          'gitignored build/packs workspace.',
      );
    }
  }

  if (isPublishedPack(pack.meta.id) && !mayBePublished(state)) {
    failures.push(
      `${label}: pack "${pack.meta.id}" is on the published list but its license_state is ` +
        `"${state}". Only "confirmed" may be published — either confirm the licence at the ` +
        'rights holder, or remove the pack from PUBLISHED_PACK_IDS.',
    );
  }

  const draftViews = pack.views.filter((view) => view.provenance.vetted.status === 'draft');
  console.log(
    `ok  ${label}  (anatomy: ${pack.provenance.license}, ${state}; ` +
      `${draftViews.length}/${pack.views.length} views draft-flagged; ` +
      `${pack.echo_volume === undefined ? 'EXPLORE-ONLY' : 'echo-capable'})`,
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length} provenance/attribution failure(s):\n`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`\nProvenance and attribution complete for ${packs.length} pack(s).`);
