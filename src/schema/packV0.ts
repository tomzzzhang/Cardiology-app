/**
 * Content pack schema — v0.1 PROVISIONAL.
 *
 * Transcribed from `docs/build_plan.md` (v1.2) "Content pack schema — v0
 * PROVISIONAL", with the per-view field list from `docs/view_canon.md`
 * "Per-view schema (feeds pack schema)".
 *
 * STABILITY: still provisional. Do not freeze, simplify, or extend it casually.
 * A v1 revision is expected once the technical slice supplies evidence; make
 * that change deliberately, updating tests and documentation in the same commit.
 *
 * WHAT v0.1 ADDED, and why each was cheap enough to do before the clinical
 * review rather than after it:
 *
 * * **`echo_volume` is OPTIONAL.** A pack without one is EXPLORE-ONLY: meshes
 *   and no echo. Requiring it meant that nothing unlabelled could validate,
 *   which excluded every geometry-only source — and a model does not have to be
 *   labelled or segmented to be worth looking at.
 * * **`provenance.license_state` is REQUIRED.** Licence questions on the new
 *   sources are deferred, not ignored: each pack records how well its grant is
 *   actually known, so the deferral is reversible and auditable. Anything other
 *   than `confirmed` cannot be published, and that is a validator rule rather
 *   than a habit.
 * * **`meshes.keyframes` carries MOTION.** Frames are whole meshes, not
 *   deformation fields. That is deliberate: the one 4D asset in hand has no
 *   vertex correspondence between frames, so it could not use a deformation
 *   field even if one existed here.
 *
 * BOUNDARY (build_plan v1.2, "Viewer interaction contract"): the free
 * anatomical cutter and the vetted echo wedge are different objects on
 * different data paths. The free cutter appears in this file exactly once, as
 * the optional `interaction.free_cut` viewer default. It must never appear in
 * `views[]`.
 */
import { z } from 'zod';
import {
  AssetPath,
  HttpUrl,
  IndicatorClock,
  IsoDate,
  ORTHOGONAL_TOLERANCE,
  Slug,
  UNIT_TOLERANCE,
  UnitVec3,
  Vec3,
  dot3,
  length3,
} from './primitives.ts';

/** Packs declaring any other value are rejected outright rather than coerced. */
export const SCHEMA_VERSION = '0.1' as const;

/* -------------------------------------------------------------------------- */
/* meta                                                                       */
/* -------------------------------------------------------------------------- */

export const PackMeta = z.strictObject({
  id: Slug,
  display_name: z.string().min(1),
  anatomy: z.string().min(1),
  /** One canonical variant per lesion, named and disclosed in-app (mvp_scope, locked decision 5). */
  canonical_variant: z.string().min(1),
  pack_version: z.string().min(1),
  schema_version: z.literal(SCHEMA_VERSION),
});
export type PackMeta = z.infer<typeof PackMeta>;

/* -------------------------------------------------------------------------- */
/* provenance — carried per anatomy AND per view                              */
/* -------------------------------------------------------------------------- */

/**
 * Vetter identity. `name` is consent-gated: it is omitted until explicit naming
 * consent is recorded, and the provenance UI falls back to the role label.
 * `docs/` and this repository carry role labels only.
 */
export const Vetter = z.strictObject({
  name: z.string().min(1).optional(),
  role: z.enum(['fellow', 'attending']),
  date: IsoDate,
});
export type Vetter = z.infer<typeof Vetter>;

export const VettingState = z
  .strictObject({
    status: z.enum(['draft', 'vetted']),
    vetters: z.array(Vetter),
    last_reviewed: IsoDate.nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.status !== 'vetted') return;
    if (value.vetters.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['vetters'],
        message: 'a vetted item must record at least one vetter',
      });
    }
    if (value.last_reviewed === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['last_reviewed'],
        message: 'a vetted item must record last_reviewed',
      });
    }
  });
export type VettingState = z.infer<typeof VettingState>;

/**
 * How well the licence on this material is actually KNOWN.
 *
 * `license` names a grant. It says nothing about where that name came from, and
 * the difference is the whole risk: a licence copied off a mirror, or inferred
 * from a sibling deposit, reads identically to one quoted from the rights
 * holder's own page. Recording the difference is what makes deferring the
 * licence questions reversible rather than merely postponed.
 *
 * * `confirmed` — read from the rights holder's own page, and quoted in the
 *   pack's `modified.note` so the reading is preserved rather than trusted.
 * * `non_commercial` — confirmed, and NC. It can never ship: an NC pack binds
 *   the whole application to the NC red lines (`contracts/provenance-ui.md`).
 * * `unconfirmed` — no licence statement was found at the source at all, or the
 *   statements found contradict each other and none is authoritative.
 * * `permission_pending` — an enquiry has gone to the rights holder and no
 *   answer has come back.
 *
 * Only `confirmed` may be published, and that is enforced — see
 * `mayBePublished` and `scripts/check-provenance.ts`.
 */
export const LICENSE_STATES = [
  'confirmed',
  'non_commercial',
  'unconfirmed',
  'permission_pending',
] as const;

export const LicenseState = z.enum(LICENSE_STATES);
export type LicenseState = z.infer<typeof LicenseState>;

/**
 * The publication rule, in one place.
 *
 * A licence that is merely probable is not a licence. Everything but
 * `confirmed` — including `non_commercial`, which IS confirmed but forbids the
 * use — stays off the deployed site.
 */
export function mayBePublished(state: LicenseState): boolean {
  return state === 'confirmed';
}

/**
 * Attribution surface. CI fails the build on any missing provenance or license
 * field (build_plan, "Licensing plan"); the credits screen renders creator,
 * source URL, license + URL, and the modified note per model.
 */
export const Provenance = z.strictObject({
  creator: z.string().min(1),
  source: z.string().min(1),
  source_url: HttpUrl,
  license: z.string().min(1),
  license_url: HttpUrl,
  /** How the grant named in `license` is known. Required since schema v0.1. */
  license_state: LicenseState,
  modified: z.strictObject({
    flag: z.boolean(),
    note: z.string(),
  }),
  derivation_chain: z.array(z.string().min(1)),
  vetted: VettingState,
});
export type Provenance = z.infer<typeof Provenance>;

/* -------------------------------------------------------------------------- */
/* meshes                                                                     */
/* -------------------------------------------------------------------------- */

export const Axis = z.enum(['+x', '-x', '+y', '-y', '+z', '-z']);
export type Axis = z.infer<typeof Axis>;

/** The unit vector one of the six signed axis names denotes, in MODEL space. */
export function axisVector(axis: Axis): Vec3 {
  return AXIS_VECTORS[axis];
}

const AXIS_VECTORS: Record<Axis, Vec3> = {
  '+x': [1, 0, 0],
  '-x': [-1, 0, 0],
  '+y': [0, 1, 0],
  '-y': [0, -1, 0],
  '+z': [0, 0, 1],
  '-z': [0, 0, -1],
};

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export interface OrientationConvention {
  up: Axis;
  anterior: Axis;
  patient_left: Axis;
  handedness: 'right' | 'left';
}

/**
 * Reasons an orientation block is not a coherent frame, or `null` if it is.
 *
 * `docs/build_plan.md` requires meshes to declare an "orientation convention".
 * Naming the same axis for two anatomical directions, or declaring a handedness
 * the axes contradict, is not a convention — it is data that cannot be acted on,
 * and the viewer would silently build a degenerate basis from it.
 *
 * Handedness is evaluated in the ordering `(patient_left, up, anterior)` mapped
 * to `(x, y, z)`. That ordering is not chosen here: it is the one under which
 * the shipped pack's declared `handedness` is true, and it matches the
 * right-handed Y-up convention of glTF and three.js. If a different ordering is
 * intended, this is a one-line change.
 */
export function orientationProblem(orientation: OrientationConvention): string | null {
  const letters = [orientation.patient_left, orientation.up, orientation.anterior].map(
    (axis) => axis[1],
  );
  if (new Set(letters).size !== 3) {
    return 'up, anterior, and patient_left must map to three distinct axes';
  }

  const determinant = dot3(
    AXIS_VECTORS[orientation.patient_left],
    cross3(AXIS_VECTORS[orientation.up], AXIS_VECTORS[orientation.anterior]),
  );
  const expected = orientation.handedness === 'right' ? 1 : -1;
  if (determinant !== expected) {
    return `declared handedness "${orientation.handedness}" contradicts the axis mapping`;
  }
  return null;
}

/**
 * HOW a structure's `blood_pool` flag was decided — never how it defaulted.
 *
 * `blood_pool` has existed since schema v0 and `pipeline/geometry.py` hardcoded
 * it to `false` for every structure it emitted, so no geometry-only pack ever
 * set it and BodyParts3D's four solid chamber casts rendered as tissue
 * (`docs/observations.md` entries 31 and 32). A boolean cannot tell a decision
 * apart from a default. This block can: every structure records the basis on
 * which the pipeline determined it, and a pack that cannot say is rejected.
 */
export const BloodPoolDecision = z.strictObject({
  /**
   * `label_match` — the source's own label matched a lumen-cast pattern the
   * source registry declares, so the structure IS a cast.
   * `label_no_match` — the source declares its lumen-cast patterns and this
   * label matched none of them, so the structure is tissue.
   * `source_tag` — decided from the source's own per-element tags or groups
   * rather than from a label string.
   * `authored` — set by hand in the source registry, because the source names
   * its casts in a way no rule can read.
   */
  basis: z.enum(['label_match', 'label_no_match', 'source_tag', 'authored']),
  /** What was actually matched, tagged or read. Never empty. */
  evidence: z.string().min(1),
});
export type BloodPoolDecision = z.infer<typeof BloodPoolDecision>;

/**
 * The measured topology of one surface AS SHIPPED — after welding, after
 * decimation, of the mesh actually in the glTF.
 *
 * A surface that is watertight, manifold and one connected component caps
 * correctly at the free cutter and reads as one object. Anything else is a
 * limitation of the source, and this pack format's rule is that a limitation is
 * DECLARED rather than discovered by a learner: `declared_reason` is required
 * exactly when the surface is not clean, and forbidden when it is, so a stale
 * declaration cannot outlive the defect it excused.
 */
export const SurfaceTopology = z.strictObject({
  watertight: z.boolean(),
  components: z.number().int().positive(),
  boundary_edges: z.number().int().nonnegative(),
  nonmanifold_edges: z.number().int().nonnegative(),
  /** Why this surface is not clean. Required iff it is not. */
  declared_reason: z.string().min(1).optional(),
});
export type SurfaceTopology = z.infer<typeof SurfaceTopology>;

/** Whether a measured surface is manifold, closed and in one piece. */
export function topologyIsClean(topology: SurfaceTopology): boolean {
  return (
    topology.watertight &&
    topology.components === 1 &&
    topology.boundary_edges === 0 &&
    topology.nonmanifold_edges === 0
  );
}

export const Structure = z.strictObject({
  id: Slug,
  /**
   * Name of the sub-mesh node inside the referenced glTF, or `null` for a GROUP.
   *
   * A group is a name in the pack's own hierarchy with no geometry of its own —
   * "left coronary artery" over its branches. It exists because a source's
   * hierarchy is a hierarchy of CONCEPTS and the meshes are its leaves: in
   * BodyParts3D every branch of the coronary tree is a separate element and
   * nothing in the data is the artery itself. A group carries no colour, no
   * cap, no topology and no blood-pool state; hiding it hides its children.
   */
  mesh_node: z.string().min(1).nullable(),
  display_label: z.string().min(1),
  /**
   * Structure hierarchy; `null` marks a root. Validated for existence and cycles.
   *
   * It comes from the PACK and never from the engine. Grouping 86 structures is
   * a taxonomy, and a taxonomy hardcoded in viewer code is a draft frozen into
   * the build — the same reason `docs/view_canon.md`'s view families are not
   * enumerated there. A pack that declares no hierarchy renders as a flat list.
   */
  parent: Slug.nullable(),
  /**
   * Whether this structure carries an anatomical IDENTIFICATION.
   *
   * Not the same question as whether it has a `display_label` — everything has
   * one — and not the same as whether the palette knows its slug. Rodero's
   * tags 11 to 24 are real tissue nobody has read yet and say "Tagged region
   * 18"; BodyParts3D's 86 parts are all identified, from the source's own
   * concept map, and simply do not share slugs with the palette. Those are
   * different states and the viewer draws them differently
   * (`docs/observations.md` entry 24): grey is reserved for the first, and
   * saying "we declined to identify this" is the only thing it means.
   */
  identified: z.boolean(),
  /** Drives blood-pool colouring in viewer-core. */
  blood_pool: z.boolean(),
  /** How `blood_pool` was decided. Absent on a group, which has no geometry. */
  blood_pool_decision: BloodPoolDecision.optional(),
  /** Measured topology of the shipped surface. Absent on a group. */
  topology: SurfaceTopology.optional(),
  /**
   * Honest labelling for substrate completion (build_plan, "Anatomical
   * substrate risk"): shelled myocardium, sculpted leaflets, and interface-only
   * pericardium are stylized geometry and say so in provenance.
   */
  stylized: z.boolean(),
});
export type Structure = z.infer<typeof Structure>;

/* -------------------------------------------------------------------------- */
/* the derived anatomical frame                                               */
/* -------------------------------------------------------------------------- */

/**
 * How a pack's frame was DERIVED, recorded so it can be checked.
 *
 * A pack has always had to declare `meshes.orientation`. Declaring it is cheap
 * and says nothing about whether the declaration is true: the first version of
 * this pipeline measured "superior" from the ventricular centroid to the
 * aortic-wall centroid, which produces a frame in which the inferior vena cava
 * is superior to the valve plane. The declaration looked identical.
 *
 * This block is the evidence behind the declaration — which tags were used,
 * what was measured, and which independent anatomical checks the result passed.
 * It is optional because not every source can support it: a fused surface with
 * no chamber labels genuinely cannot derive a frame, and must say so by
 * omitting this rather than by inventing one.
 *
 * The axes recorded here are CARDIAC. A heart-only mesh carries no spine,
 * diaphragm or chest wall, so the patient's axes are not recoverable from it —
 * see `pipeline/anatomy.py`, which measures three defensible proxies for body
 * superior-inferior and finds them up to 46 degrees apart.
 *
 * The shapes of `inputs`, `landmarks_source_mm` and `measurements` are
 * deliberately open. They are a record for a human reader and a future
 * re-derivation, and pinning their keys here would mean a schema change every
 * time the pipeline measures one more thing about a new substrate.
 */
/**
 * Which structure carries which valve plane, and the adjacency that says so.
 *
 * A frame built on valve rings is only as good as the identification of those
 * rings, and identifying them by where they sit is circular — position is what
 * the frame is being derived to interpret. Identifying them by what they
 * SEPARATE is not: a valve plane borders exactly two labelled chambers, and the
 * pair names it uniquely.
 *
 * So this block records, per valve, the shared-face count against every chamber
 * the plane borders. `borders` having exactly two entries is enforced here
 * rather than trusted: a third entry means the tag is not a valve plane, and a
 * pack asserting a valve identity it cannot support is exactly the failure the
 * whole `anatomical_frame` block exists to prevent.
 *
 * Optional, like the frame itself — a substrate whose groups do not share faces
 * (a set of separate surfaces rather than one tagged volume) cannot produce it.
 */
export const ValveIdentification = z.strictObject({
  method: z.string().min(1),
  description: z.string().min(1),
  /** Which source tag is which chamber, so `borders` can be read. */
  chamber_tags: z.record(z.string(), z.number().int()),
  valves: z
    .record(
      z.string(),
      z.strictObject({
        tag: z.number().int(),
        /** Chamber tag -> shared triangles. Exactly two, by definition. */
        borders: z.record(z.string(), z.number().int().positive()),
      }),
    )
    .refine(
      (valves) => Object.values(valves).every((v) => Object.keys(v.borders).length === 2),
      { message: 'a valve plane borders exactly two chambers' },
    )
    .refine(
      (valves) => new Set(Object.values(valves).map((v) => v.tag)).size
        === Object.keys(valves).length,
      { message: 'two valves cannot share one tag' },
    ),
  /** The mapping this derivation was checked against. */
  published_tags: z.record(z.string(), z.number().int()),
  agrees_with_published: z.boolean(),
});
export type ValveIdentification = z.infer<typeof ValveIdentification>;

export const AnatomicalFrame = z
  .strictObject({
    /** Versioned name of the derivation, so a pack states which one produced it. */
    method: z.string().min(1),
    description: z.string().min(1),
    inputs: z.record(z.string(), z.unknown()),
    /** Absent where the substrate cannot support an adjacency derivation. */
    valve_identification: ValveIdentification.optional(),
    landmarks_source_mm: z.record(z.string(), z.unknown()),
    /** Rows of the rotation carrying source coordinates into pack coordinates. */
    basis_source_to_pack: z.strictObject({
      patient_left: UnitVec3,
      basal: UnitVec3,
      anterior: UnitVec3,
    }),
    measurements: z.record(z.string(), z.unknown()),
    /** Named anatomical checks and their outcomes. A failing check is allowed
     *  to be RECORDED — hiding it would defeat the point — but never hidden. */
    checks: z.record(z.string(), z.boolean()),
    checks_passed: z.number().int().nonnegative(),
    checks_total: z.number().int().nonnegative(),
  })
  .superRefine((frame, ctx) => {
    const { patient_left: left, basal, anterior } = frame.basis_source_to_pack;
    const pairs: [string, string, number][] = [
      ['patient_left', 'basal', dot3(left, basal)],
      ['basal', 'anterior', dot3(basal, anterior)],
      ['anterior', 'patient_left', dot3(anterior, left)],
    ];
    for (const [a, b, product] of pairs) {
      if (Math.abs(product) > ORTHOGONAL_TOLERANCE) {
        ctx.addIssue({
          code: 'custom',
          path: ['basis_source_to_pack'],
          message: `${a} and ${b} must be orthogonal (tolerance ${ORTHOGONAL_TOLERANCE})`,
        });
      }
    }

    /*
     * A left-handed basis would silently mirror the anatomy — every view built
     * on it would place right-sided structures on the left and look entirely
     * plausible doing it. Checked by triple product rather than trusted.
     */
    const cross: [number, number, number] = [
      left[1] * basal[2] - left[2] * basal[1],
      left[2] * basal[0] - left[0] * basal[2],
      left[0] * basal[1] - left[1] * basal[0],
    ];
    if (dot3(cross, anterior) <= 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['basis_source_to_pack'],
        message: 'basis must be right-handed: patient_left x basal must point along anterior',
      });
    }

    /*
     * `agrees_with_published` is a summary of two objects that are both present,
     * so it is checked rather than believed. A pack that claims agreement while
     * recording a different mapping would send a reader to the wrong reference
     * and defeat the point of carrying both.
     */
    const valves = frame.valve_identification;
    if (valves) {
      const measured = Object.entries(valves.valves)
        .map(([name, { tag }]) => `${name}=${tag}`)
        .sort()
        .join(',');
      const published = Object.entries(valves.published_tags)
        .map(([name, tag]) => `${name}=${tag}`)
        .sort()
        .join(',');
      if (valves.agrees_with_published !== (measured === published)) {
        ctx.addIssue({
          code: 'custom',
          path: ['valve_identification', 'agrees_with_published'],
          message: `agrees_with_published is ${valves.agrees_with_published} but measured `
            + `(${measured}) and published (${published}) mappings say otherwise`,
        });
      }
    }

    // The counts are a summary of `checks`, so they cannot be free to disagree
    // with it — a pack claiming 9 of 9 while recording a failure is worse than
    // one that records nothing.
    const total = Object.keys(frame.checks).length;
    const passed = Object.values(frame.checks).filter(Boolean).length;
    if (frame.checks_total !== total || frame.checks_passed !== passed) {
      ctx.addIssue({
        code: 'custom',
        path: ['checks_passed'],
        message: `checks_passed/checks_total (${frame.checks_passed}/${frame.checks_total}) `
          + `disagree with checks (${passed}/${total})`,
      });
    }
  });
export type AnatomicalFrame = z.infer<typeof AnatomicalFrame>;

/* -------------------------------------------------------------------------- */
/* keyframed geometry — motion, deliberately minimal                          */
/* -------------------------------------------------------------------------- */

/**
 * One geometry frame: a WHOLE mesh, not a displacement of another one.
 *
 * That is the deliberate limit of this block. A deformation field is the right
 * representation for motion and is a fraction of the size — and it requires
 * vertex correspondence between frames, which the one 4D asset actually in hand
 * does not have (its frames differ in vertex COUNT, 2268 against 1712). A
 * schema field nothing can populate is worse than an absent one, so the
 * representation follows the data rather than the ambition. See
 * `keyframes.vertex_correspondence`, which records per pack whether a future
 * deformation-field representation could even be derived.
 */
export const GeometryFrame = z.strictObject({
  gltf: AssetPath,
  /**
   * Position on the cardiac cycle, normalised to [0, 1].
   *
   * Optional only because a source may instead state a real frame rate. One of
   * the two must be present — see the refinement on `GeometryKeyframes` — or
   * the frames are an ordered list with no time axis at all, which cannot be
   * played back honestly.
   */
  phase: z.number().min(0).max(1).optional(),
  /** Source frame name, so a frame traces back to the file it came from. */
  label: z.string().min(1),
});
export type GeometryFrame = z.infer<typeof GeometryFrame>;

export const GeometryKeyframes = z
  .strictObject({
    /** Ordered frames. Two is the minimum that can be called motion. */
    frames: z.array(GeometryFrame).min(2),
    /** Playback rate, where the source states one. */
    fps: z.number().positive().optional(),
    /**
     * Whether the frames span one whole cycle and the ends meet.
     *
     * False means playback must bounce rather than wrap: half a cycle played on
     * a loop would show the heart snapping from end-systole back to
     * end-diastole, which is not a motion any heart makes.
     */
    loop: z.boolean(),
    /**
     * Whether vertex count AND ordering are constant across frames.
     *
     * Recorded rather than assumed. It is the single fact that decides whether
     * this pack could ever carry a deformation field, and it is invisible from
     * anything else in the pack.
     */
    vertex_correspondence: z.boolean(),
    /** What part of the cycle these frames actually cover, in words. */
    coverage: z.string().min(1),
  })
  .superRefine((value, ctx) => {
    const phased = value.frames.filter((frame) => frame.phase !== undefined);
    if (value.fps === undefined && phased.length !== value.frames.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['fps'],
        message:
          'keyframes need a time axis: declare fps, or give every frame a phase',
      });
    }

    // A phase axis that is not monotonic is not an axis. Checked rather than
    // sorted at load, because reordering authored frames would silently change
    // which mesh is end-systole.
    for (let index = 1; index < phased.length; index += 1) {
      if (phased[index].phase! <= phased[index - 1].phase!) {
        ctx.addIssue({
          code: 'custom',
          path: ['frames', index, 'phase'],
          message: 'frame phases must strictly increase',
        });
        break;
      }
    }

    const labels = new Set<string>();
    value.frames.forEach((frame, index) => {
      if (labels.has(frame.label)) {
        ctx.addIssue({
          code: 'custom',
          path: ['frames', index, 'label'],
          message: `duplicate frame label "${frame.label}"`,
        });
      }
      labels.add(frame.label);
    });
  });
export type GeometryKeyframes = z.infer<typeof GeometryKeyframes>;

export const Meshes = z.strictObject({
  gltf: AssetPath,
  structures: z.array(Structure).min(1),
  /** Canonical pose applied on load; `reset` returns the camera to this orientation. */
  canonical_pose: z.strictObject({
    position: Vec3,
    rotation_euler_xyz_deg: Vec3,
    scale: z.number().positive(),
  }),
  units: z.enum(['mm', 'cm', 'm']),
  orientation: z
    .strictObject({
      up: Axis,
      anterior: Axis,
      patient_left: Axis,
      handedness: z.enum(['right', 'left']),
    })
    .superRefine((orientation, ctx) => {
      const problem = orientationProblem(orientation);
      if (problem !== null) {
        ctx.addIssue({ code: 'custom', message: problem });
      }
    }),
  /** Evidence for `orientation`. Absent where the source cannot support one. */
  anatomical_frame: AnatomicalFrame.optional(),
  /**
   * Motion, where the source has any. Absent means a single static geometry.
   *
   * `gltf` above stays the pack's one static mesh and must be the FIRST frame,
   * so a consumer that knows nothing about motion still renders a real frame of
   * this heart rather than a mesh nothing else references.
   */
  keyframes: GeometryKeyframes.optional(),
})
  .superRefine((meshes, ctx) => {
    if (meshes.keyframes && meshes.keyframes.frames[0].gltf !== meshes.gltf) {
      ctx.addIssue({
        code: 'custom',
        path: ['keyframes', 'frames', 0, 'gltf'],
        message:
          `the first keyframe must be meshes.gltf ("${meshes.gltf}"), so the static `
          + 'mesh and frame 0 cannot drift apart',
      });
    }
  });
export type Meshes = z.infer<typeof Meshes>;

/* -------------------------------------------------------------------------- */
/* interaction — viewer defaults only, NOT medical view metadata              */
/* -------------------------------------------------------------------------- */

/**
 * The free anatomical cutter as stored in a pack: the initial value of the
 * oriented radial plane `{N, s}` relative to the interaction pivot `C`.
 *
 *   dot(N, X - C) = s          closest point Q = C + sN
 *
 * The plane is mathematically infinite. Any rendered rectangle is a helper
 * sized from model bounds and never limits clipping. Reversing the oriented
 * plane changes which side remains visible.
 *
 * This is runtime inspection state seeded from the pack — it is NOT a clinical
 * view, and there is deliberately no path from here into `views[]`.
 */
export const FreeCutState = z.strictObject({
  /** `N` — plane normal in model space. */
  normal: UnitVec3,
  /** `s` — signed distance from the interaction pivot `C`, in pack `units`. */
  offset: z.number(),
});
export type FreeCutState = z.infer<typeof FreeCutState>;

/**
 * A camera whose position equals its target has no view direction, and an `up`
 * parallel to that direction yields no basis — `lookAt` produces NaNs from
 * either. Both are refused so a pack cannot seed the viewer with a camera that
 * cannot be built.
 */
export const CameraState = z
  .strictObject({
    position: Vec3,
    target: Vec3,
    up: UnitVec3,
    fov_deg: z.number().positive().max(179),
  })
  .superRefine((camera, ctx) => {
    const direction: Vec3 = [
      camera.target[0] - camera.position[0],
      camera.target[1] - camera.position[1],
      camera.target[2] - camera.position[2],
    ];
    const distance = length3(direction);
    if (distance <= UNIT_TOLERANCE) {
      ctx.addIssue({
        code: 'custom',
        path: ['target'],
        message: 'camera target must differ from its position',
      });
      return;
    }

    const normalized: Vec3 = [
      direction[0] / distance,
      direction[1] / distance,
      direction[2] / distance,
    ];
    if (Math.abs(dot3(camera.up, normalized)) >= 1 - ORTHOGONAL_TOLERANCE) {
      ctx.addIssue({
        code: 'custom',
        path: ['up'],
        message: 'camera up must not be parallel to the view direction',
      });
    }
  });
export type CameraState = z.infer<typeof CameraState>;

/**
 * Optional. Governs viewer defaults only; it is not medical view metadata and
 * carries no provenance because nothing here is a clinical claim.
 */
export const InteractionDefaults = z.strictObject({
  /** Interaction pivot `C`. Absent means "use the model-bounds centroid". */
  pivot: Vec3.optional(),
  /** Initial camera/orientation. Absent means "use `meshes.canonical_pose`". */
  camera: CameraState.optional(),
  /** Initial free-cut state. Absent means "start with the free cutter disabled". */
  free_cut: FreeCutState.optional(),
});
export type InteractionDefaults = z.infer<typeof InteractionDefaults>;

/* -------------------------------------------------------------------------- */
/* echo_volume                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Per-label acoustic properties consumed by the echo renderer. Perceptual
 * priority 1 (build_plan, "Simulated echo work item") is correct grey-level
 * ORDERING, so these are relative, unitless authoring values.
 */
export const EchoLabel = z.strictObject({
  /** Voxel value in the labelled volume. */
  id: z.number().int().min(0).max(255),
  /** Structure this label maps to. Validated against `meshes.structures`. */
  structure: Slug,
  echogenicity: z.number().min(0).max(1),
  attenuation: z.number().min(0),
});
export type EchoLabel = z.infer<typeof EchoLabel>;

/**
 * The labelled volume the echo renderer samples.
 *
 * **`raw-u8` is x-fastest**, one byte per voxel:
 *
 *     offset = x + resolution[0] * (y + resolution[1] * z)
 *
 * That is not a free choice. It is the layout `texImage3D` reads, so any other
 * ordering is silently transposed on upload. Stating it here because leaving it
 * unstated already cost one: the Python pipeline wrote its grid x-slowest
 * (numpy's C order over `[ix, iy, iz]`), so the renderer sampled an x/z-swapped
 * heart while the wedge drawn on the model used the untransposed geometry. The
 * two panels disagreed about which slice they were showing, and the echo still
 * looked like a plausible echo of a plausible heart.
 */
export const EchoVolume = z.strictObject({
  asset: AssetPath,
  format: z.enum(['raw-u8', 'ktx2']),
  resolution: z.tuple([
    z.number().int().positive(),
    z.number().int().positive(),
    z.number().int().positive(),
  ]),
  /** Model space -> volume space, 4x4 column-major. */
  mesh_to_volume: z.array(z.number()).length(16),
  labels: z.array(EchoLabel).min(1),
  /**
   * The scatterer field is NOT shipped. It is generated at runtime from this
   * seed, deterministically. Baking a scatterer channel remains a fallback if
   * runtime generation is too costly on phones — that call belongs to the
   * technical slice, so no baked-channel field exists in v0.
   */
  scatterer_seed: z.number().int(),
});
export type EchoVolume = z.infer<typeof EchoVolume>;

/* -------------------------------------------------------------------------- */
/* views[] — vetted clinical content                                          */
/* -------------------------------------------------------------------------- */

/**
 * Full vetted probe pose. This is the ONE source of truth for a clinical view:
 * the cut plane `{anchor, basis_u, basis_v}` is DERIVED from it
 * (anchor = origin, basis = beam/lateral axes), so the wedge drawn on the model
 * and the echo fan cannot disagree.
 *
 * Derivation belongs to viewer-core and echo-renderer (wave 1); the schema only
 * guarantees the pose is well formed.
 */
export const ProbePose = z
  .strictObject({
    /** Probe origin in model space — the fan apex. */
    origin: Vec3,
    beam_axis: UnitVec3,
    lateral_axis: UnitVec3,
    fan: z.strictObject({
      angle_deg: z.number().positive().max(180),
      depth_cm: z.number().positive(),
      focus_cm: z.number().positive(),
    }),
    display: z.strictObject({
      /**
       * Where the sector's VERTEX — the point the transducer occupies — is
       * drawn on the panel. `down` puts it at the bottom with the fan opening
       * upward, which is the pediatric convention for the subcostal and apical
       * families and the opposite of most adult labs. User-toggleable at
       * runtime; this is the authored default.
       */
      vertex: z.enum(['up', 'down']),
      flip_lr: z.boolean(),
      marker_side: z.enum(['left', 'right']),
    }),
  })
  .superRefine((value, ctx) => {
    if (Math.abs(dot3(value.beam_axis, value.lateral_axis)) > ORTHOGONAL_TOLERANCE) {
      ctx.addIssue({
        code: 'custom',
        path: ['lateral_axis'],
        message: `beam_axis and lateral_axis must be orthogonal (tolerance ${ORTHOGONAL_TOLERANCE})`,
      });
    }
    if (value.fan.focus_cm > value.fan.depth_cm) {
      ctx.addIssue({
        code: 'custom',
        path: ['fan', 'focus_cm'],
        message: 'focus_cm must lie within depth_cm',
      });
    }
  });
export type ProbePose = z.infer<typeof ProbePose>;

/** A swept pose: `{mode, axis, range, interpolation, ordered structure list crossed}`. */
export const Sweep = z
  .strictObject({
    mode: z.enum(['tilt', 'rotate', 'translate']),
    axis: z.strictObject({
      direction: UnitVec3,
      /** Absent means "through the probe origin". */
      origin: Vec3.optional(),
    }),
    range: z.strictObject({
      unit: z.enum(['deg', 'mm']),
      from: z.number(),
      to: z.number(),
    }),
    /** Interpolated over `t` in [0, 1] by the sweep scrubber. */
    interpolation: z.enum(['slerp', 'lerp']),
    /** Ordered structures crossed; drives the scrubber's teaching readout. */
    structures_in_order: z.array(Slug),
  })
  .superRefine((value, ctx) => {
    const expected = value.mode === 'translate' ? 'mm' : 'deg';
    if (value.range.unit !== expected) {
      ctx.addIssue({
        code: 'custom',
        path: ['range', 'unit'],
        message: `mode "${value.mode}" requires range unit "${expected}"`,
      });
    }
    if (value.range.from === value.range.to) {
      ctx.addIssue({
        code: 'custom',
        path: ['range'],
        message: 'sweep range must be non-empty',
      });
    }
  });
export type Sweep = z.infer<typeof Sweep>;

export const ShowHidePreset = z.strictObject({
  visible: z.array(Slug),
  hidden: z.array(Slug),
});

/**
 * Per-view echo tuning overrides. Deliberately an open bag of scalars: the
 * renderer's knob names are fixed by the echo slice (wave 1b), and inventing
 * them here would extend the schema beyond v0.
 */
export const EchoTuning = z.record(z.string().min(1), z.union([z.number(), z.boolean(), z.string()]));

export const PackView = z.strictObject({
  /* --- view identity, per view_canon.md ---------------------------------- */
  /**
   * Free-form in v0. `view_canon.md` is a DRAFT pending clinical vetting, so
   * the family/view_id vocabulary is not enumerated here; enumerating it would
   * freeze draft clinical content into the engine.
   */
  family: z.string().min(1),
  view_id: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  placement_landmark: z.string().min(1),
  indicator_clock: IndicatorClock,

  /* --- the vetted pose, and everything derived from it -------------------- */
  probe: ProbePose,
  sweep: Sweep.optional(),

  /* --- teaching content --------------------------------------------------- */
  structures: z.array(Slug),
  measurements: z.array(z.string().min(1)),
  lesion_attachments: z.array(z.string().min(1)),

  /* --- presentation ------------------------------------------------------- */
  show_hide_preset: ShowHidePreset,
  echo_tuning: EchoTuning,

  /**
   * Reserved slot for a real de-identified clip. v0 requires it EMPTY: real
   * clips carry their own licensing/IRB decision, and the slot exists so that
   * adding them later is additive, never a rearchitecture.
   */
  real_clip_slot: z.null(),

  /**
   * Per-lesion view emphasis, assigned in a vetting session. `null` until then;
   * deliberately not an enum, because the vocabulary is content, not engine.
   */
  emphasis: z.string().min(1).nullable(),

  /** Provenance is carried per view as well as per anatomy. */
  provenance: Provenance,
});
export type PackView = z.infer<typeof PackView>;

/* -------------------------------------------------------------------------- */
/* display flags                                                              */
/* -------------------------------------------------------------------------- */

export const DisplayFlags = z.strictObject({
  /** Subcostal and apical families render vertex-down unless overridden. */
  pediatric_vertex_convention: z.boolean(),
  /** PLAX apex always on screen-left — holds in levocardia and dextrocardia. */
  plax_apex_left_exception: z.boolean(),
  /** Stored per pack, default off in the MVP. */
  dextrocardia_indicator_profile: z.strictObject({
    enabled: z.boolean(),
    profile: z.string().min(1).nullable(),
  }),
});
export type DisplayFlags = z.infer<typeof DisplayFlags>;

/* -------------------------------------------------------------------------- */
/* pack root                                                                  */
/* -------------------------------------------------------------------------- */

const PackShape = z.strictObject({
  meta: PackMeta,
  provenance: Provenance,
  meshes: Meshes,
  interaction: InteractionDefaults.optional(),
  /**
   * The labelled volume, where the source can support one.
   *
   * OPTIONAL since v0.1. A pack without it is EXPLORE-ONLY — see
   * `isExploreOnly`. Requiring it meant nothing unlabelled could validate, and
   * an unlabelled mesh is still a heart worth turning over.
   */
  echo_volume: EchoVolume.optional(),
  views: z.array(PackView),
  display_flags: DisplayFlags,
  /**
   * The schema tolerates a future volumetric-data reference (CT/CMR-derived
   * segmentations). Shape is intentionally unconstrained in v0 — v1 defines it.
   */
  volumetric_data: z.unknown().optional(),
});

/** Cross-field integrity: every id referenced anywhere must resolve. */
export const Pack = PackShape.superRefine((pack, ctx) => {
  /*
   * EXPLORE-ONLY is one fact, not two that have to agree.
   *
   * A view exists to be imaged from: it is a probe pose, a fan and an echo
   * tuning. With no volume there is nothing for that pose to image, so a pack
   * carrying views and no `echo_volume` is describing an echo it cannot
   * produce. Refusing the combination outright means `echo_volume === undefined`
   * and `views.length === 0` are the SAME condition, and the app can key the
   * Echo-mode refusal off either without them ever disagreeing.
   */
  if (pack.echo_volume === undefined) {
    if (pack.views.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['views'],
        message:
          'an EXPLORE-ONLY pack (no echo_volume) cannot carry views: a view is a pose to '
          + 'image from, and there is nothing here to image',
      });
    }
  } else if (pack.views.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['views'],
      message: 'a pack with an echo_volume must carry at least one view',
    });
  }

  /*
   * One pack, one licence state. The per-view provenance blocks exist so a view
   * can carry its own vetting and modification note, not so a pack can hold two
   * answers to "may this be published" — and the publication rule reads the
   * pack-level state, so a view disagreeing with it would be a rule silently
   * evaluated against the wrong field.
   */
  pack.views.forEach((view, index) => {
    if (view.provenance.license_state !== pack.provenance.license_state) {
      ctx.addIssue({
        code: 'custom',
        path: ['views', index, 'provenance', 'license_state'],
        message:
          `view license_state "${view.provenance.license_state}" contradicts the pack's `
          + `"${pack.provenance.license_state}"`,
      });
    }
  });

  const structureIds = new Set<string>();
  pack.meshes.structures.forEach((structure, index) => {
    if (structureIds.has(structure.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['meshes', 'structures', index, 'id'],
        message: `duplicate structure id "${structure.id}"`,
      });
    }
    structureIds.add(structure.id);
  });

  const requireStructure = (id: string, path: (string | number)[]) => {
    if (!structureIds.has(id)) {
      ctx.addIssue({
        code: 'custom',
        path,
        message: `unknown structure id "${id}"`,
      });
    }
  };

  // Hierarchy: parents resolve, and no structure is its own ancestor.
  const parentOf = new Map(pack.meshes.structures.map((s) => [s.id, s.parent]));
  pack.meshes.structures.forEach((structure, index) => {
    if (structure.parent === null) return;
    if (!structureIds.has(structure.parent)) {
      requireStructure(structure.parent, ['meshes', 'structures', index, 'parent']);
      return;
    }
    const seen = new Set<string>([structure.id]);
    let cursor = structure.parent;
    for (;;) {
      if (seen.has(cursor)) {
        ctx.addIssue({
          code: 'custom',
          path: ['meshes', 'structures', index, 'parent'],
          message: `structure hierarchy contains a cycle at "${structure.id}"`,
        });
        return;
      }
      seen.add(cursor);
      const next = parentOf.get(cursor);
      if (next === undefined || next === null) return;
      cursor = next;
    }
  });

  const meshNodes = new Set<string>();
  pack.meshes.structures.forEach((structure, index) => {
    if (structure.mesh_node === null) return;
    if (meshNodes.has(structure.mesh_node)) {
      ctx.addIssue({
        code: 'custom',
        path: ['meshes', 'structures', index, 'mesh_node'],
        message: `duplicate glTF node reference "${structure.mesh_node}"`,
      });
    }
    meshNodes.add(structure.mesh_node);
  });

  // A GROUP is a name over its children. One with no children is a dead branch
  // in the list — an entry a learner can expand into nothing.
  const hasChildren = new Set(
    pack.meshes.structures.map((s) => s.parent).filter((id): id is string => id !== null),
  );
  pack.meshes.structures.forEach((structure, index) => {
    const path = ['meshes', 'structures', index] as const;
    if (structure.mesh_node === null) {
      if (!hasChildren.has(structure.id)) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'mesh_node'],
          message:
            `structure "${structure.id}" has no mesh and no children; a group is a name over ` +
            'its children and one with neither is an entry that expands into nothing',
        });
      }
      if (structure.blood_pool || structure.blood_pool_decision || structure.topology) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'mesh_node'],
          message:
            `group "${structure.id}" carries geometry state; a group has no surface, so it ` +
            'has no blood-pool state and no topology to measure',
        });
      }
      return;
    }

    /*
     * BLOOD POOL IS DECIDED, NEVER DEFAULTED.
     *
     * A pack whose structures merely carry `blood_pool: false` cannot be told
     * apart from a pack whose pipeline never looked. That is exactly what
     * shipped, and a chamber cast reading as tissue is what produced
     * observations 31 and 32. So the determination is required, and the flag
     * has to agree with the basis that produced it — a `label_match` that
     * yielded `false` means the two have drifted apart.
     */
    const decision = structure.blood_pool_decision;
    if (!decision) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'blood_pool_decision'],
        message:
          `structure "${structure.id}" does not say how blood_pool was decided; an undecided ` +
          'structure is a cavity cast waiting to render as tissue',
      });
    } else if (decision.basis === 'label_match' && !structure.blood_pool) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'blood_pool'],
        message: `"${structure.id}" matched a lumen-cast pattern but is not marked blood pool`,
      });
    } else if (decision.basis === 'label_no_match' && structure.blood_pool) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'blood_pool'],
        message: `"${structure.id}" matched no lumen-cast pattern but is marked blood pool`,
      });
    }

    /*
     * WATERTIGHTNESS IS DECLARED, NEVER DISCOVERED BY A LEARNER.
     *
     * `declared_reason` is required exactly when the surface is not clean and
     * forbidden when it is, so a declaration cannot outlive the defect it
     * excused. CobivecoX is the honest case: its ventricles really are
     * truncated at the base and its annuli really are rings.
     */
    const topology = structure.topology;
    /*
     * A pack with no echo volume makes no clinical claim at all: the only thing
     * it offers is its geometry, so it has to have measured it. That is what
     * makes this a gate rather than an optional field — omitting the block
     * would otherwise be a free pass out of the rule below.
     */
    if (!topology && pack.echo_volume === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'topology'],
        message:
          `geometry-only pack: "${structure.id}" does not report its measured topology, and ` +
          'geometry is the only thing this pack has to say',
      });
    }
    if (topology) {
      const clean = topologyIsClean(topology);
      if (!clean && topology.declared_reason === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'topology', 'declared_reason'],
          message:
            `"${structure.id}" is not manifold, closed and single-component ` +
            `(watertight ${topology.watertight}, ${topology.components} component(s), ` +
            `${topology.boundary_edges} boundary and ${topology.nonmanifold_edges} ` +
            'non-manifold edge(s)) and the pack does not say why',
        });
      }
      if (clean && topology.declared_reason !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'topology', 'declared_reason'],
          message:
            `"${structure.id}" declares a reason for being unclean and measures clean; the ` +
            'declaration has outlived the defect it excused',
        });
      }
    }
  });

  const labelIds = new Set<number>();
  pack.echo_volume?.labels.forEach((label, index) => {
    if (labelIds.has(label.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['echo_volume', 'labels', index, 'id'],
        message: `duplicate echo label id ${label.id}`,
      });
    }
    labelIds.add(label.id);
    requireStructure(label.structure, ['echo_volume', 'labels', index, 'structure']);
  });

  const viewIds = new Set<string>();
  pack.views.forEach((view, index) => {
    if (viewIds.has(view.view_id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['views', index, 'view_id'],
        message: `duplicate view_id "${view.view_id}"`,
      });
    }
    viewIds.add(view.view_id);

    view.structures.forEach((id, i) =>
      requireStructure(id, ['views', index, 'structures', i]),
    );
    view.show_hide_preset.visible.forEach((id, i) =>
      requireStructure(id, ['views', index, 'show_hide_preset', 'visible', i]),
    );
    view.show_hide_preset.hidden.forEach((id, i) =>
      requireStructure(id, ['views', index, 'show_hide_preset', 'hidden', i]),
    );
    view.sweep?.structures_in_order.forEach((id, i) =>
      requireStructure(id, ['views', index, 'sweep', 'structures_in_order', i]),
    );

    const overlap = view.show_hide_preset.visible.filter((id) =>
      view.show_hide_preset.hidden.includes(id),
    );
    if (overlap.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['views', index, 'show_hide_preset'],
        message: `structures listed as both visible and hidden: ${overlap.join(', ')}`,
      });
    }
  });
});

export type Pack = z.infer<typeof Pack>;

/**
 * A pack with meshes and no echo.
 *
 * The app must REFUSE to enter Echo mode for one of these, and say why rather
 * than doing nothing: a mode control that is present, pressable and inert is a
 * bug report waiting to be filed.
 */
export function isExploreOnly(pack: Pack): boolean {
  return pack.echo_volume === undefined;
}

/** Whether this pack carries motion the Explore cine control can play. */
export function hasKeyframes(pack: Pack): boolean {
  return pack.meshes.keyframes !== undefined;
}
