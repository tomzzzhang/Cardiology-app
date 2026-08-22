# Contract: echo-renderer

**Last Updated:** 2026-08-22 07:13 EDT

**Owns:** `src/echo/**`
**Status:** implemented. Scan, separable PSF and display passes run over the labelled volume with
per-view tuning; every frame is labelled simulated. Outstanding: motion, secondary rays, and
`echo_tuning` authored per view rather than defaulted.
**Spec:** `docs/build_plan.md` v1.2 — "Simulated echo work item (echo-shader spec)".

## Responsibility

Render the simulated echo image for the **selected saved view or sweep position**, from the labelled
`echo_volume` and the view's probe pose. Review status does not change the rendering path.
When the authoring presentation has no selected imaging view, this component is not mounted: a
full-heart model-only state must not silently render `views[0]` under a hidden selection.

## Approach (fixed)

Convolutional ray-tracing (COLE/CRT family) — scatterer map plus separable per-scanline PSF
convolution over a ray-cast — in WebGL2, single render pass, static frames in v1. Wave physics is
offline-only. GAN/diffusion is offline-polish-only.

**Offline, per pack (build step):** voxelize the labelled mesh into `echo_volume`; labels carry
echogenicity and attenuation.

**Runtime, per frame, per scanline in polar space:** ray-march from `probe.origin` through the
volume; accumulate Beer-Lambert attenuation (acoustic shadowing, distal dropout); per sample

```
echo = scatterer_amplitude(seeded) × PSF(depth, lateral)
                                   × specular(beam · normal at label boundaries)
     + boundary_reflection
```

The specular term **multiplies**; only `boundary_reflection` is added. This is the form
`docs/build_plan.md` specifies, and it is the binding one — an earlier revision of this contract
transcribed the specular term as an addition, which would have changed the model Wave 1b implements.

**Post:** TGC, log compression + dynamic range, polar→Cartesian scan-conversion LUT, sector mask,
subtle near-field clutter.

**Depth scale:** the panel overlays one pointer-inert dot per centimetre along the screen-right fan
edge. Dot positions are radial from the displayed sector vertex and come from the exact live
`ImagingFrame.depthMm` used to render that frame, so saved sweeps, free-probe depth edits, authoring
transitions, and Flip apex cannot leave the ruler behind. Zero and an exact distal boundary are
omitted. The scale is presentation chrome outside the WebGL raster: it does not change simulated
tissue pixels, follow `flip_lr`, or reuse the probe-notch `marker_side` convention. If a valid wide
sector extends beyond the 4:3 canvas, a dot moves to the inset screen-right crop boundary and its
axial coordinate is solved again on the same radial depth circle; screen clipping must not turn a
physical scale into a decorative vertical or x-clamped row.
An imported pose that would exceed the bounded marker budget draws no ruler and makes no depth-scale
accessibility claim; arbitrary finite schema input must not create an unbounded DOM workload.

## Inputs — and the boundary

```
views[i].probe        origin, beam_axis, lateral_axis, fan{angle_deg, depth_cm, focus_cm}, display
views[i].echo_tuning  per-view overrides (open bag of scalars in v0)
echo_volume           asset, format, resolution, mesh_to_volume, labels[], scatterer_seed
```

- The **fan geometry comes from the same `probe` the wedge uses.** The plane is derived, never stored
  twice, so wedge and echo cannot disagree.
- **The free anatomical cutter is not an input.** Moving it must not synthesize, relabel, or
  re-render an echo image. There is no code path from `{N, s}` into this module. This holds
  unchanged through the cutter's Echo plane mode, which reads the imaging frame and writes the
  cutter — the arrow of causation is probe → cutter.
- **A hand-turned probe renders, and is labelled.** *(Owner decision, 2026-08-19.)* When the learner
  unlocks the probe, this module renders the pose it is given, exactly as it renders any other. What
  changes is what the PANEL claims: the view's name and its draft flag are withdrawn the moment the
  pose has actually left the saved track, and the provenance line says the plane is unvetted.
  Rendering an arbitrary plane under a saved view's name is the one thing forbidden — it is the
  failure the pack's refusal to author A3 and A4 exists to avoid.
- **An authoring view transition renders its live pose, and says what it is.** The camera, 3D wedge,
  echo-synced cutter, and echo frame consume the same eased runtime pose. During that short motion
  the panel withdraws both endpoint names and review flags and says `Transition — not a saved view`
  and `Unvetted intermediate plane — animation between saved views`. These frames are presentation
  only and the authoring store refuses to save them. Categorical display flags are not interpolated;
  the echo fades fully transparent, changes convention while invisible, then fades back in on the
  same clock. At exact landing the panel names the saved local or pack-authored working view rather
  than falsely calling it an arbitrary free probe.
- The scatterer field is **not shipped**: generate it at runtime from `scatterer_seed`,
  deterministically. Baking a scatterer channel stays a fallback if runtime generation is too costly
  on lower-end devices. Phone-specific performance is deferred, and no baked-channel field exists
  in schema v0.

## Perceptual priorities, in order

1. **Correct grey-level ordering with Rayleigh speckle.** Pericardium brightest (interface render if
   no geometry); calcified bright with shadowing; leaflets bright but view-dependent (specular);
   myocardium mid-grey textured; blood near-black. Speckle comes from PSF-convolved scatterers,
   **never additive Gaussian noise**.
2. **Attenuation artifacts** — shadowing and lateral-wall dropout via the `beam · normal` term.
3. **Sector-fan geometry, TGC, and pediatric display conventions** (per `docs/view_canon.md`).
   Pediatric probe feel: 5–12 MHz, shallow depth, focus ~4–5 cm.

## Honesty requirements

Every simulated frame is labelled **simulated**, with provenance one tap away. Stylized substrate
(shelled myocardium, sculpted leaflets, interface-only pericardium) stays flagged as stylized — the
renderer must not present it as sourced anatomy.

## Platform bar

The renderer accepts a valid saved or working pose, produces deterministic labelled output, keeps
the 3D wedge and echo frame on one geometry path, and exposes tuning without hardcoding a clinical
view. A later integration/release review decides whether a candidate content frame is
"learnable-from"; that verdict is not an acceptance criterion for renderer platform work.

## Upgrade path (must not require rearchitecture)

Keyframed motion as deformation-warped scatterers; secondary rays only if vetting flags missing
artifacts; WebGPU compute if budgets bottleneck; diffusion offline for reference stills only.

Implementation references, in order: Gao 2009 (COLE); Bürger 2013 (scatterer params, artifacts);
Amadou 2024 (labelled-volume cardiac blueprint); ImFusion patent US10565900B2 (hybrid architecture);
SlicerIGT/PLUS (mesh→scanline pattern); MUST/Field II for offline tuning only.
