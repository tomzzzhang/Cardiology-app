# Proposed delta 5 — `normal-vhl-heart0102` orientation block

**Last Updated:** 2026-08-22 14:32 EDT
**Status:** PROPOSED, NOT APPLIED. Nothing in `public/packs/` has been edited.
**Applies to:** `public/packs/normal-vhl-heart0102/pack.json`
**Companion:** `sources.proposed.md` holds deltas 1-4. This is the fifth, owed since
2026-08-21 00:30 ET.

---

## What the pack declares

```json
"orientation": { "up": "+y", "anterior": "+z", "patient_left": "+x", "handedness": "right" }
```

with `provenance.modified.note` carrying `ORIENTATION UNVERIFIED. This source carries no
chamber labels, so anterior and patient-left cannot be derived from the geometry.`

## What was measured

The premise of the note is now false. The source carries no chamber *labels*, but it
carries chamber *geometry*, and one observer naming five of them supplies the missing bit.
27 seeds placed in `vhl_label_tool_3d`, one chamber named per seed, give a cardiac basis
with no reference to any declared axis:

| axis | construction | vector in source coordinates |
|---|---|---|
| patient-left | LV centroid − RV centroid | `[ 0.7921, −0.4884, −0.3662]` |
| base | ventricular midpoint → atrial midpoint, orthogonalised | `[ 0.5140, 0.2099, 0.8317]` |
| anterior | `left × base`, forced | `[−0.3294, −0.8470, 0.4173]` |

Right-handed, `det = 1.000000`, orthonormal to 1.1e-16.

**The declared axes, expressed in that measured frame** — this is the finding, and it is
worse than a small misalignment:

| declared | meaning claimed | actually points (left, base, anterior) | reading |
|---|---|---|---|
| `+x` | patient-left | `[+0.792, +0.514, −0.329]` | patient-left, tilted **37.6 deg** toward the base |
| `+y` | up | `[−0.488, +0.210, −0.847]` | **mostly posterior**; only 0.21 of it is basal, **77.9 deg** off |
| `+z` | anterior | `[−0.366, +0.832, +0.417]` | **mostly basal**, **65.3 deg** off |

The declared "up" is nearly perpendicular to the true base-apex axis. The whole declared
basis is a single rotation of **77.9 degrees** away from the measured one
(`rotation_euler_xyz_deg` source → cardiac `[−63.77, 19.23, 32.98]`, quaternion xyzw
`[−0.539641, −0.011836, 0.322234, 0.777697]`). No reflection: every candidate pose here is
a proper rotation, so this is a statement about the declared metadata, not about the
specimen.

## Why this carries to the pack rather than stopping at the STL

Source STL and shipped glTF bounding boxes agree to 0.1 mm in the same axis order, so
`ingest.py` applied no rotation to this source. The frame measured on the STL is the frame
of the shipped asset.

## Corroboration, from relations that are not inputs to the construction

- Raw left-right and base axes come out **89.4 deg** apart before orthogonalisation. Nothing
  forces that; the two are built from different centroid pairs.
- LA sits **42.3 mm** posterior to RA.
- The aorta sits **48.2 mm** basal to the ventricular midpoint.
- One check fails: **RA right of LA by −11.4 mm.** The interatrial septum is oblique and the
  atria genuinely overlap on this axis; `vhl_seed_partition.derive_frame` documents it as
  weak and uninformative at this magnitude. Recorded, not hidden.

## Proposed replacement

```json
"orientation": {
  "up": "+y",
  "anterior": "+z",
  "patient_left": "+x",
  "handedness": "right",
  "declared_axes_are_wrong": true,
  "measured_cardiac_frame": {
    "basis": "cardiac, not patient. Rows map source coordinates onto (patient-left, base, anterior).",
    "patient_left": [0.7920507442286407, -0.48842602466877577, -0.36619071123270275],
    "base": [0.5139748304843037, 0.20990598219700565, 0.8317267293207197],
    "anterior": [-0.32937135910016146, -0.8469825836840842, 0.4172948726504385],
    "declared_disagreement_deg": { "patient_left": 37.6, "base": 77.9, "anterior": 65.3 },
    "raw_axis_angle_deg": 89.36,
    "method": "pipeline/vhl_seed_partition.py derive_frame, from 27 observer-placed chamber seeds",
    "evidence": "output/vhl-partition/seed-partition.json",
    "checks": {
      "LA posterior to RA": { "pass": true, "margin_mm": 42.3 },
      "RA right of LA": { "pass": false, "margin_mm": -11.4 },
      "aorta basal to ventricles": { "pass": true, "margin_mm": 48.2 }
    },
    "provenance": "hand-seeded by one observer, one round, not replicated"
  }
}
```

and in `provenance.modified.note`, replace

> ORIENTATION UNVERIFIED. This source carries no chamber labels, so anterior and
> patient-left cannot be derived from the geometry. The declared convention is the glTF
> default (+y up) with the remaining axes unconfirmed, and must be set at vetting before
> any clinical use.

with

> ORIENTATION MEASURED AND DECLARED AXES WRONG (2026-08-21). The declared convention is the
> glTF default (+y up) and it does not describe this geometry: measured against a cardiac
> frame derived from 27 observer-placed chamber seeds, +x is 37.6 deg, +y is 77.9 deg and
> +z is 65.3 deg from the axis each claims. Declared "up" points mostly posterior. The
> measured frame is CARDIAC, not the patient's: a heart-only mesh carries no spine,
> diaphragm or chest wall, so patient superior-inferior is not recoverable and is not
> claimed. The frame is hand-seeded by one observer in a single unreplicated round and the
> left-right assignment rests on that observer naming which lobe is the left ventricle; it
> is evidence for vetting, not a vetted result. Renders in this pack are still UNVERIFIED
> and this pack is still NOT PUBLISHED.

## What this does and does not do to the 2026-08-19 rejection

Nothing. The rejection stands on three legs — CC BY-NC 4.0 licence, no per-chamber
structures, unverified orientation. This measures the third rather than clearing it: it
replaces "unknown" with "known and wrong", which is a smaller repair but still a repair
nobody has vetted. The licence leg is untouched and the per-chamber leg is unresolved.
**Do not apply this delta as a step toward reversing the rejection.**

## Caveats a vetter must weigh

1. One observer, one round, no second opinion. Nothing here is replicated.
2. The left-right assignment is exactly as good as the observer's naming of the LV. Four
   automatic routes failed to recover that bit (NOTES.md §5b), which is why it was
   hand-placed — but it means the frame inherits a human judgement, not a measurement.
3. The frame is cardiac. `up` in the pack schema is a patient axis. Applying this delta
   means either re-defining the field or accepting a cardiac vector in a patient-axis slot;
   `normal-rodero` already faced this and documents the cardiac basis in the note. Follow
   that precedent rather than inventing a second convention.
4. `RA right of LA` fails by 11.4 mm. Small and documented as weak, but it is the only
   independent left-right check available and it does not pass.
