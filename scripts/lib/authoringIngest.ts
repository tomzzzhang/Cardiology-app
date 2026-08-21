/**
 * Fail-closed bridge from a browser authoring export to one existing pack view.
 *
 * This module is deliberately pure: it accepts parsed JSON values and returns
 * a fully validated candidate pack. File IO and the explicit `--write` gate
 * live in `scripts/ingest-authoring-export.ts`.
 */
import { z } from 'zod';
import { EXPORT_SCHEMA_VERSION } from '../../src/authoring/exportFile.ts';
import {
  ProbePose as ProbePoseSchema,
  SCHEMA_VERSION,
  type Pack,
  type ProbePose,
  type Sweep,
} from '../../src/schema/packV0.ts';
import { UnitVec3, type Vec3 } from '../../src/schema/primitives.ts';
import { formatIssues, validatePack } from '../../src/schema/validate.ts';

const IsoInstant = z.string().datetime({ offset: true });

const ExportedSlot = z.strictObject({
  slot_id: z.string().min(1),
  kind: z.enum(['canon', 'extra', 'custom', 'orphan']),
  label: z.string().min(1),
  saved_at: IsoInstant,
  probe: ProbePoseSchema,
});

/**
 * LEGACY. Parsed so that an export written before 2026-08-21 still validates as
 * a v1 envelope, and for no other reason.
 *
 * Current authoring does not emit this block: the apical four-chamber no longer
 * defines the model's axes, and the patient/body frame comes from a
 * `body-context/v0` descriptor instead. The value was never applied to
 * `meshes.anatomical_frame` — that block is pack content with its own
 * derivation and provenance — and it is not applied to anything now. It is
 * accepted, reported as ignored, and dropped.
 *
 * Kept parseable rather than rejected because refusing it would strand the
 * poses in old files, and those poses are ordinary model-space coordinates that
 * are still perfectly good. The claim about axes travelling beside them is what
 * is discarded.
 */
const ExportedCardiacFrame = z.strictObject({
  derived_from_slot: z.string().min(1),
  method: z.string().min(1),
  patient_left: UnitVec3,
  basal: UnitVec3,
  anterior: UnitVec3,
  flipped_for_display: z.boolean(),
});

export const AuthoringSlotsExport = z
  .strictObject({
    schema_version: z.literal(EXPORT_SCHEMA_VERSION),
    pack_id: z.string().min(1),
    pack_version: z.string().min(1),
    pack_schema_version: z.literal(SCHEMA_VERSION),
    exported_at: IsoInstant,
    slots: z.array(ExportedSlot),
    /** Legacy and inert. Accepted so old files parse; never applied. */
    cardiac_frame: ExportedCardiacFrame.optional(),
  })
  .superRefine((document, ctx) => {
    const seen = new Set<string>();
    document.slots.forEach((slot, index) => {
      if (seen.has(slot.slot_id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['slots', index, 'slot_id'],
          message: `duplicate slot_id "${slot.slot_id}"`,
        });
      }
      seen.add(slot.slot_id);
    });
  });

export type AuthoringSlotsExport = z.infer<typeof AuthoringSlotsExport>;

export interface AuthoringIngestInput {
  pack: unknown;
  authoringExport: unknown;
  slotId: string;
  viewId: string;
  nextPackVersion: string;
}

export interface AuthoringIngestSummary {
  packId: string;
  sourcePackVersion: string;
  fromPackVersion: string;
  toPackVersion: string;
  packSchemaVersion: string;
  exportSchemaVersion: string;
  slotId: string;
  slotLabel: string;
  viewId: string;
  savedAt: string;
  exportedAt: string;
  reviewStatus: 'draft';
  probeBefore: ProbePose;
  probeAfter: ProbePose;
  sweepAxisBefore: Sweep['axis'] | null;
  sweepAxisAfter: Sweep['axis'] | null;
  sweepAxisTransported: boolean;
  structuresCleared: number;
  cardiacFrameIgnored: boolean;
  placementLandmarkBefore: string;
  placementLandmarkAfter: string;
}

export interface AuthoringIngestResult {
  candidate: Pack;
  summary: AuthoringIngestSummary;
}

function refuse(message: string): never {
  throw new Error(`authoring export ingest refused: ${message}`);
}

function parseExport(value: unknown): AuthoringSlotsExport {
  const parsed = AuthoringSlotsExport.safeParse(value);
  if (parsed.success) return parsed.data;
  const first = parsed.error.issues[0];
  const path = first.path.length === 0 ? '<root>' : first.path.join('.');
  return refuse(`invalid ${EXPORT_SCHEMA_VERSION} document at ${path}: ${first.message}`);
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(vector: Vec3, amount: number): Vec3 {
  return [vector[0] * amount, vector[1] * amount, vector[2] * amount];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length === 0) return refuse('a probe frame contains a zero-length axis');
  return scale(vector, 1 / length);
}

interface RigidFrame {
  origin: Vec3;
  beam: Vec3;
  lateral: Vec3;
  normal: Vec3;
}

/** Match the renderer's Gram-Schmidt convention before deriving a rotation. */
function rigidFrame(probe: ProbePose): RigidFrame {
  const beam = normalize(probe.beam_axis);
  const lateralRaw = probe.lateral_axis;
  const lateral = normalize(subtract(lateralRaw, scale(beam, dot(lateralRaw, beam))));
  return {
    origin: probe.origin,
    beam,
    lateral,
    normal: normalize(cross(beam, lateral)),
  };
}

/** Rotate a model-space vector by the unique rotation carrying old probe axes to new ones. */
function rotateBetweenFrames(vector: Vec3, from: RigidFrame, to: RigidFrame): Vec3 {
  return add(
    add(scale(to.beam, dot(vector, from.beam)), scale(to.lateral, dot(vector, from.lateral))),
    scale(to.normal, dot(vector, from.normal)),
  );
}

/** Carry a model-space point through the same rigid motion as the probe. */
function transportPoint(point: Vec3, from: RigidFrame, to: RigidFrame): Vec3 {
  return add(to.origin, rotateBetweenFrames(subtract(point, from.origin), from, to));
}

/**
 * Preserve a sweep relative to its probe when the probe pose is replaced.
 *
 * Direction is a vector, explicit origin is a point. An omitted origin stays
 * omitted: schema v0 defines that as "through the probe origin", and the new
 * implicit point is exactly where the rigid transform sends the old one.
 * `structures_in_order` is measurement derived from the old placement, so it
 * is invalidated rather than carried into a different sector.
 */
export function transportSweep(
  sweep: Sweep,
  oldProbe: ProbePose,
  newProbe: ProbePose,
): Sweep {
  const from = rigidFrame(oldProbe);
  const to = rigidFrame(newProbe);
  return {
    ...structuredClone(sweep),
    axis: {
      direction: rotateBetweenFrames(sweep.axis.direction, from, to),
      ...(sweep.axis.origin === undefined
        ? {}
        : { origin: transportPoint(sweep.axis.origin, from, to) }),
    },
    structures_in_order: [],
  };
}

/** Build and fully schema-validate the candidate pack. Performs no file IO. */
export function prepareAuthoringIngest(input: AuthoringIngestInput): AuthoringIngestResult {
  const sourcePack = validatePack(input.pack);
  if (!sourcePack.ok) {
    return refuse(`target pack is invalid before ingest:\n${formatIssues(sourcePack.issues)}`);
  }
  const pack = sourcePack.pack;
  const document = parseExport(input.authoringExport);

  if (document.pack_id !== pack.meta.id) {
    refuse(
      `export pack_id "${document.pack_id}" does not equal target pack "${pack.meta.id}"`,
    );
  }
  if (document.pack_schema_version !== pack.meta.schema_version) {
    refuse(
      `export pack_schema_version "${document.pack_schema_version}" does not equal target `
      + `schema "${pack.meta.schema_version}"`,
    );
  }
  if (document.pack_version !== pack.meta.pack_version) {
    refuse(
      `export pack_version "${document.pack_version}" does not equal target pack version `
      + `"${pack.meta.pack_version}"; model-space authoring data cannot cross pack revisions`,
    );
  }
  if (input.nextPackVersion.trim().length === 0) {
    refuse('the next pack version must be supplied explicitly');
  }
  if (input.nextPackVersion !== input.nextPackVersion.trim()) {
    refuse('the next pack version must not contain leading or trailing whitespace');
  }
  if (input.nextPackVersion === pack.meta.pack_version) {
    refuse(
      `next pack version "${input.nextPackVersion}" equals the current version; `
      + 'ingest requires an explicit version change',
    );
  }

  const selectedSlots = document.slots.filter((slot) => slot.slot_id === input.slotId);
  if (selectedSlots.length !== 1) {
    refuse(
      `selected slot "${input.slotId}" occurs ${selectedSlots.length} times; expected exactly one`,
    );
  }
  const selectedViews = pack.views
    .map((view, index) => ({ view, index }))
    .filter(({ view }) => view.view_id === input.viewId);
  if (selectedViews.length !== 1) {
    refuse(
      `selected view "${input.viewId}" occurs ${selectedViews.length} times in the target pack; `
      + 'expected exactly one existing view',
    );
  }

  const slot = selectedSlots[0];
  const { view: oldView, index: viewIndex } = selectedViews[0];
  const expectedSlotId = `view-${oldView.view_id}`;
  if (slot.slot_id !== expectedSlotId || (slot.kind !== 'canon' && slot.kind !== 'extra')) {
    refuse(
      `selected slot "${slot.slot_id}" (${slot.kind}) is not the standard slot for view `
      + `"${oldView.view_id}"; expected "${expectedSlotId}" with kind canon or extra. `
      + 'Arbitrary slot-to-view remapping is not supported.',
    );
  }
  if (oldView.provenance.vetted.status !== 'draft') {
    refuse(
      `selected view "${input.viewId}" is ${oldView.provenance.vetted.status}; `
      + 'an authoring ingest may replace only a draft pose',
    );
  }
  if (
    oldView.provenance.vetted.vetters.length !== 0
    || oldView.provenance.vetted.last_reviewed !== null
  ) {
    refuse(
      `selected view "${input.viewId}" is draft but has recorded review history; `
      + 'clearing or carrying review state requires an explicit clinical-review decision',
    );
  }

  const candidate = structuredClone(pack);
  const updatedView = candidate.views[viewIndex];
  const structuresCleared = oldView.sweep?.structures_in_order.length ?? 0;
  const sweepAxisTransported = oldView.sweep !== undefined;
  const placementLandmark =
    `Authoring placement imported from ${EXPORT_SCHEMA_VERSION} slot "${slot.slot_id}" `
    + `("${slot.label}"); prior placement landmark invalidated pending content review`;

  updatedView.probe = structuredClone(slot.probe);
  updatedView.placement_landmark = placementLandmark;
  if (oldView.sweep !== undefined) {
    updatedView.sweep = transportSweep(oldView.sweep, oldView.probe, slot.probe);
  }

  const provenanceNote = [
    `Current probe pose came from ${EXPORT_SCHEMA_VERSION} slot "${slot.slot_id}" `
      + `(source pack ${document.pack_version}; saved ${slot.saved_at}; `
      + `exported ${document.exported_at}) through `
      + 'scripts/ingest-authoring-export.ts.',
    'Status remains Draft; ingestion did not promote review state.',
    ...(sweepAxisTransported
      ? [
          'The existing sweep axis was rigidly transported from the previous probe frame to '
            + 'the new probe frame; structures_in_order was cleared pending remeasurement.',
        ]
      : ['This view has no sweep; no sweep metadata was created.']),
    ...(document.cardiac_frame === undefined
      ? []
      : ['The export carried a legacy cardiac_frame block. It was discarded: an imaging view '
        + 'does not define the patient frame, and nothing in this ingest reads it.']),
  ].join(' ');
  updatedView.provenance.modified = {
    flag: true,
    note: provenanceNote,
  };
  updatedView.provenance.derivation_chain = [
    ...oldView.provenance.derivation_chain,
    `scripts/ingest-authoring-export.ts (${EXPORT_SCHEMA_VERSION} slot ${slot.slot_id}, `
      + `source pack ${document.pack_version}, exported ${document.exported_at})`,
  ];

  candidate.meta.pack_version = input.nextPackVersion;

  // The write-side receives only this parsed result. No candidate can reach it
  // without satisfying every schema and cross-field invariant in `Pack`.
  const checked = validatePack(candidate);
  if (!checked.ok) {
    return refuse(`candidate pack is invalid; nothing may be written:\n${formatIssues(checked.issues)}`);
  }

  return {
    candidate: checked.pack,
    summary: {
      packId: pack.meta.id,
      sourcePackVersion: document.pack_version,
      fromPackVersion: pack.meta.pack_version,
      toPackVersion: input.nextPackVersion,
      packSchemaVersion: pack.meta.schema_version,
      exportSchemaVersion: document.schema_version,
      slotId: slot.slot_id,
      slotLabel: slot.label,
      viewId: oldView.view_id,
      savedAt: slot.saved_at,
      exportedAt: document.exported_at,
      reviewStatus: oldView.provenance.vetted.status,
      probeBefore: structuredClone(oldView.probe),
      probeAfter: structuredClone(slot.probe),
      sweepAxisBefore: oldView.sweep === undefined ? null : structuredClone(oldView.sweep.axis),
      sweepAxisAfter: updatedView.sweep === undefined
        ? null
        : structuredClone(updatedView.sweep.axis),
      sweepAxisTransported,
      structuresCleared,
      cardiacFrameIgnored: document.cardiac_frame !== undefined,
      placementLandmarkBefore: oldView.placement_landmark,
      placementLandmarkAfter: updatedView.placement_landmark,
    },
  };
}
