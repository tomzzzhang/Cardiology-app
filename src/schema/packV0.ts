/**
 * Content pack schema — v0 PROVISIONAL.
 *
 * Transcribed from `docs/build_plan.md` (v1.2) "Content pack schema — v0
 * PROVISIONAL", with the per-view field list from `docs/view_canon.md`
 * "Per-view schema (feeds pack schema)".
 *
 * STABILITY: v0 is provisional. Do not freeze, simplify, or extend it casually.
 * A v1 revision is expected once the technical slice supplies evidence; make
 * that change deliberately, updating tests and documentation in the same commit.
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
export const SCHEMA_VERSION = '0' as const;

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

export const Structure = z.strictObject({
  id: Slug,
  /** Name of the sub-mesh node inside the referenced glTF. */
  mesh_node: z.string().min(1),
  display_label: z.string().min(1),
  /** Structure hierarchy; `null` marks a root. Validated for existence and cycles. */
  parent: Slug.nullable(),
  /** Drives blood-pool colouring in viewer-core. */
  blood_pool: z.boolean(),
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
       * Pediatric convention: subcostal and apical families render vertex-DOWN.
       * User-toggleable at runtime; this is the authored default.
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
  echo_volume: EchoVolume,
  views: z.array(PackView).min(1),
  display_flags: DisplayFlags,
  /**
   * The schema tolerates a future volumetric-data reference (CT/CMR-derived
   * segmentations). Shape is intentionally unconstrained in v0 — v1 defines it.
   */
  volumetric_data: z.unknown().optional(),
});

/** Cross-field integrity: every id referenced anywhere must resolve. */
export const Pack = PackShape.superRefine((pack, ctx) => {
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
    if (meshNodes.has(structure.mesh_node)) {
      ctx.addIssue({
        code: 'custom',
        path: ['meshes', 'structures', index, 'mesh_node'],
        message: `duplicate glTF node reference "${structure.mesh_node}"`,
      });
    }
    meshNodes.add(structure.mesh_node);
  });

  const labelIds = new Set<number>();
  pack.echo_volume.labels.forEach((label, index) => {
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
