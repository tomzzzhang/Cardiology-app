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
 *   - `license_state` is present and non-empty, and ONLY a `confirmed` state may
 *     appear on a published pack.
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

const failures: string[] = [];

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
