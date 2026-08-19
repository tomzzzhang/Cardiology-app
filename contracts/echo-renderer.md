# Contract: echo-renderer

**Owns:** `src/echo/**`
**Status:** implemented. Scan, separable PSF and display passes run over the labelled volume with
per-view tuning; every frame is labelled simulated. Outstanding: motion, secondary rays, and
`echo_tuning` authored per view rather than defaulted.
**Spec:** `docs/build_plan.md` v1.2 — "Simulated echo work item (echo-shader spec)".

## Responsibility

Render the simulated echo image for the **selected vetted view or sweep position**, from the labelled
`echo_volume` and the view's probe pose. Nothing else drives it.

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
  Rendering an arbitrary plane under a vetted view's name is the one thing forbidden — it is the
  failure the pack's refusal to author A3 and A4 exists to avoid.
- The scatterer field is **not shipped**: generate it at runtime from `scatterer_seed`,
  deterministically. Baking a scatterer channel stays a fallback if runtime generation is too costly
  on phones — that call belongs to the slice review, and no baked-channel field exists in schema v0.

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

## Bar

Per-view **"learnable-from"** verdict from the clinical vetter — not indistinguishability. Stage 0
(inside the technical slice) is fixture slice → grey-level LUT + speckle + fan + TGC. If it reads as
echo, the path is confirmed; if it reads as CT, speckle/PSF comes first.

## Upgrade path (must not require rearchitecture)

Keyframed motion as deformation-warped scatterers; secondary rays only if vetting flags missing
artifacts; WebGPU compute if budgets bottleneck; diffusion offline for reference stills only.

Implementation references, in order: Gao 2009 (COLE); Bürger 2013 (scatterer params, artifacts);
Amadou 2024 (labelled-volume cardiac blueprint); ImFusion patent US10565900B2 (hybrid architecture);
SlicerIGT/PLUS (mesh→scanline pattern); MUST/Field II for offline tuning only.
