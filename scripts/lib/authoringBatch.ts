/**
 * Apply several authoring poses to one pack in ONE revision, and create the
 * views that do not exist yet.
 *
 * ## Why a batch is the right shape, not a convenience
 *
 * `prepareAuthoringIngest` moves one pose into one existing view and bumps the
 * pack version. That is exactly right for one correction. It is the wrong shape
 * for a correction SET: five poses authored against pack 0.1.1, applied one at
 * a time, produce five revisions, and revisions two through five are applying
 * 0.1.1 coordinates to a pack that no longer says 0.1.1 — which the single-view
 * guard correctly refuses.
 *
 * The invariant that guard protects is "these model-space coordinates belong to
 * this mesh". A batch does not weaken it: the mesh is untouched throughout, and
 * every pose in the set was authored against the same one. So the batch pins
 * `exportBaseVersion` to the revision the export names and lets one revision
 * carry the whole set.
 *
 * ## How it reuses the guarded path rather than reimplementing it
 *
 * Replacements are chained through `prepareAuthoringIngest` itself, each step
 * feeding its validated candidate into the next. Every refusal that function
 * makes — draft-only, no review history, standard slot only, schema validation
 * of the whole candidate — therefore still applies to every pose, and none of
 * it is duplicated here where it could drift.
 *
 * The intermediate steps carry throwaway version strings, and the final version
 * is stamped once at the end. Those intermediates never reach pack content: the
 * provenance note and the derivation chain both record the EXPORT's version,
 * which is the fact that matters, not the target's.
 *
 * ## Creating a view is a different act, and is labelled as one
 *
 * Replacing a pose corrects something the pack already claimed. Creating a view
 * makes a claim the pack was not making, so it is separated, it takes its
 * clinical identity (family, name, indicator clock, aliases) from
 * `docs/view_canon.md` rather than from anything this code invents, and it
 * lands as `draft` with an empty review history and a provenance note that says
 * where every part of it came from.
 *
 * No sweep is created. A sweep is a claim about how the plane moves through the
 * anatomy, and nothing in an `authoring-slots/v1` carrier measures one.
 */
import { validatePack, formatIssues } from '../../src/schema/validate.ts';
import type { Pack, PackView } from '../../src/schema/packV0.ts';
import { EXPORT_SCHEMA_VERSION } from '../../src/authoring/exportFile.ts';
import { AuthoringSlotsExport, prepareAuthoringIngest } from './authoringIngest.ts';

/** Replace the pose of a view the pack already has. */
export interface ReplaceOperation {
  mode: 'replace';
  slotId: string;
  viewId: string;
}

/**
 * The clinical identity of a view being created.
 *
 * Every field here is CONTENT, taken from the draft canon. None of it is
 * derived from geometry, and none of it is invented by this module — an
 * indicator clock in particular is a statement about how a transducer is held
 * against a patient, which no mesh can tell you.
 */
export interface ViewCanonIdentity {
  family: string;
  viewId: string;
  name: string;
  aliases: string[];
  indicatorClock: string;
  /** Where the identity above was read from, recorded in provenance. */
  canonSource: string;
}

/** Create a view the pack does not have, from a carrier pose. */
export interface CreateOperation {
  mode: 'create';
  slotId: string;
  canon: ViewCanonIdentity;
}

export type AuthoringOperation = ReplaceOperation | CreateOperation;

export interface AuthoringBatchInput {
  pack: unknown;
  authoringExport: unknown;
  operations: readonly AuthoringOperation[];
  nextPackVersion: string;
}

export interface AuthoringBatchStep {
  mode: 'replace' | 'create';
  slotId: string;
  slotLabel: string;
  viewId: string;
  probeBefore: unknown;
  probeAfter: unknown;
}

export type AuthoringBatchResult =
  | { ok: true; candidate: Pack; steps: AuthoringBatchStep[]; fromPackVersion: string;
      toPackVersion: string; exportBaseVersion: string }
  | { ok: false; problem: string };

export function prepareAuthoringBatch(input: AuthoringBatchInput): AuthoringBatchResult {
  const parsedPack = validatePack(input.pack);
  if (!parsedPack.ok) {
    return { ok: false, problem: `target pack is invalid:\n${formatIssues(parsedPack.issues)}` };
  }
  const parsedExport = AuthoringSlotsExport.safeParse(input.authoringExport);
  if (!parsedExport.success) {
    const first = parsedExport.error.issues[0];
    return {
      ok: false,
      problem: `authoring export is invalid: ${first.path.join('.') || '<root>'} — ${first.message}`,
    };
  }
  const document = parsedExport.data;

  const fromPackVersion = parsedPack.pack.meta.pack_version;
  const exportBaseVersion = document.pack_version;
  if (input.operations.length === 0) {
    return { ok: false, problem: 'a batch must carry at least one operation' };
  }
  if (input.nextPackVersion === fromPackVersion) {
    return {
      ok: false,
      problem: `next pack version "${input.nextPackVersion}" equals the current version; `
        + 'ingest requires an explicit version change',
    };
  }

  const steps: AuthoringBatchStep[] = [];
  let current: Pack = parsedPack.pack;
  let step = 0;

  /* --- replacements, through the single-view guarded path ----------------- */
  for (const operation of input.operations) {
    if (operation.mode !== 'replace') continue;
    step += 1;
    // `prepareAuthoringIngest` REFUSES by throwing. Caught rather than allowed
    // to escape so that a batch reports which operation was refused and why,
    // and so that a refusal anywhere writes nothing anywhere.
    let result;
    try {
      result = prepareAuthoringIngest({
        pack: current,
        authoringExport: document,
        slotId: operation.slotId,
        viewId: operation.viewId,
        // Throwaway. Overwritten once at the end; never reaches pack content.
        nextPackVersion: `${input.nextPackVersion}+step${step}`,
        exportBaseVersion,
      });
    } catch (error) {
      return {
        ok: false,
        problem: `replacing "${operation.viewId}": ${(error as Error).message}`,
      };
    }
    current = result.candidate;
    steps.push({
      mode: 'replace',
      slotId: result.summary.slotId,
      slotLabel: result.summary.slotLabel,
      viewId: result.summary.viewId,
      probeBefore: result.summary.probeBefore,
      probeAfter: result.summary.probeAfter,
    });
  }

  /* --- creations ---------------------------------------------------------- */
  for (const operation of input.operations) {
    if (operation.mode !== 'create') continue;
    const slots = document.slots.filter((slot) => slot.slot_id === operation.slotId);
    if (slots.length !== 1) {
      return {
        ok: false,
        problem: `creating "${operation.canon.viewId}": slot "${operation.slotId}" occurs `
          + `${slots.length} times; expected exactly one`,
      };
    }
    if (current.views.some((view) => view.view_id === operation.canon.viewId)) {
      return {
        ok: false,
        problem: `creating "${operation.canon.viewId}": the pack already has that view. `
          + 'Use a replace operation, which preserves its provenance and review state.',
      };
    }
    const slot = slots[0];

    /*
     * Presentation is copied from the pack's own structures rather than
     * authored: which structures exist is a fact about the mesh, and showing
     * all of them is the same neutral default every other view here carries.
     * What is NOT copied is any teaching content — measurements, lesion
     * attachments and emphasis stay empty, because those are claims.
     */
    const structures = current.meshes.structures.map((structure) => structure.id);
    const created: PackView = {
      family: operation.canon.family,
      view_id: operation.canon.viewId,
      name: operation.canon.name,
      aliases: [...operation.canon.aliases],
      placement_landmark:
        `Authoring placement imported from ${EXPORT_SCHEMA_VERSION} slot "${slot.slot_id}" `
        + `("${slot.label}"). This view is NEW: the pack did not previously claim it, and no `
        + 'prior placement landmark existed to invalidate.',
      indicator_clock: operation.canon.indicatorClock,
      probe: structuredClone(slot.probe),
      structures,
      measurements: [],
      lesion_attachments: [],
      show_hide_preset: { visible: structures, hidden: [] },
      echo_tuning: {},
      real_clip_slot: null,
      emphasis: null,
      provenance: {
        ...structuredClone(current.provenance),
        modified: {
          flag: true,
          note: [
            `View CREATED by scripts/ingest-authoring-batch.ts from ${EXPORT_SCHEMA_VERSION} `
              + `slot "${slot.slot_id}" (source pack ${document.pack_version}; saved `
              + `${slot.saved_at}; exported ${document.exported_at}).`,
            `Clinical identity — family, name, aliases and indicator clock — is content taken `
              + `from ${operation.canon.canonSource}, not derived from this mesh.`,
            'No sweep was created: a sweep states how the plane moves through the anatomy and '
              + 'nothing in the carrier measures one.',
            'Status is Draft with no review history. Creating a view does not review it, and '
              + 'the pose has not been clinically validated.',
          ].join(' '),
        },
        derivation_chain: [
          ...structuredClone(current.provenance).derivation_chain,
          `scripts/ingest-authoring-batch.ts (created ${operation.canon.viewId} from `
            + `${EXPORT_SCHEMA_VERSION} slot ${slot.slot_id}, source pack `
            + `${document.pack_version}, exported ${document.exported_at})`,
        ],
        vetted: {
          status: 'draft',
          vetters: [],
          last_reviewed: null,
        },
      },
    };

    const candidate = structuredClone(current) as Pack;
    candidate.views = [...candidate.views, created];
    const checked = validatePack(candidate);
    if (!checked.ok) {
      return {
        ok: false,
        problem: `creating "${operation.canon.viewId}" produced an invalid pack; nothing may be `
          + `written:\n${formatIssues(checked.issues)}`,
      };
    }
    current = checked.pack;
    steps.push({
      mode: 'create',
      slotId: slot.slot_id,
      slotLabel: slot.label,
      viewId: operation.canon.viewId,
      probeBefore: null,
      probeAfter: structuredClone(slot.probe),
    });
  }

  /* --- one version, stamped once ------------------------------------------ */
  const finished = structuredClone(current) as Pack;
  finished.meta.pack_version = input.nextPackVersion;
  const validated = validatePack(finished);
  if (!validated.ok) {
    return {
      ok: false,
      problem: `the batch produced an invalid pack; nothing may be written:\n`
        + formatIssues(validated.issues),
    };
  }

  return {
    ok: true,
    candidate: validated.pack,
    steps,
    fromPackVersion,
    toPackVersion: input.nextPackVersion,
    exportBaseVersion,
  };
}
