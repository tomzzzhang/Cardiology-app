# Content packs

**Last Updated:** 2026-08-22 07:13 EDT

One directory per pack: `public/packs/<id>/pack.json`, with assets alongside under `assets/`.
Asset paths inside `pack.json` are pack-relative; the loader rejects absolute URLs and `..`.

`public/packs/` is public Git distribution, not a private staging area. New or regenerated
third-party derivatives belong here only after an explicit source-policy decision confirms that
redistribution and modification rights cover the files. Unresolved work goes to the gitignored
`build/packs/` workspace. The Pages allowlist is a separate, later decision.

Packs are validated against **content-pack schema v0.1 (PROVISIONAL)** — `src/schema/packV0.ts`.
Code against it and change it only deliberately, with tests and documentation in the same commit.

A pack is one of two kinds, and the distinction decides which modes it can even offer:

- **echo-capable** — it has a labelled `echo_volume` and at least one view, so Echo mode works;
- **EXPLORE-ONLY** — geometry with no labelled volume and correspondingly no views. Echo mode is
  refused for it, visibly and with the reason on screen.

## The packs

| Pack | Kind | What it is | Licence | Licence state | On Pages? |
| --- | --- | --- | --- | --- | --- |
| `stub/` | echo | Synthetic engine fixture. Two nested boxes. **Not anatomy, not clinical content.** | CC0-1.0 | confirmed | yes, but never offered in the picker |
| `normal-rodero/` | echo | Normal heart, Rodero/CEMRG average four-chamber. Volumetric myocardium, 24 structures. **v0.1.3, six Draft views** (B1, B4, C1, C2, F1 + a non-clinical ingest reference pose); apertures on the reference chest wall except F1. Carries a `body-context/v0` registration. | CC BY 4.0 | confirmed | **yes — the selected substrate** |
| `normal-alberta-neonatal/` | echo | Normal neonatal heart, 3D Heart Project. Blood pool plus a separate myocardium. | CC BY 4.0 (contested) | unconfirmed | **no** |
| `normal-vhl-heart0102/` | echo | Normal paediatric heart (14 y), Visible Heart Labs. Single undivided tissue body. Retained as rejection evidence and hidden from the normal picker. | CC BY-NC 4.0 | non_commercial | **no** |
| `normal-vhl-heart0102-chambers/` | echo | Chamber-labelled derivative of Heart0102. Six lumen and six per-chamber myocardium structures; measured cardiac frame. The active VHL development-picker option; not suitable for teaching wall thickness. | CC BY-NC 4.0 | non_commercial | **no — public Git only; Pages-blocked** |
| `motion-biv-cinemri/` | explore | **Moving.** Ten biventricular cine-MRI segmentations, end-diastole to end-systole. Unlabelled. | CC BY 4.0 | confirmed | **no** |
| `anatomy-bodyparts3d-heart/` | explore | 86 separately modelled parts: valve leaflets and cusps, papillary muscles, chamber walls and cavities, coronaries. | CC BY 4.0 | confirmed | **no** |
| `normal-kit-four-chamber/` | explore | Four chamber cavities, epicardium, great-vessel trunks and a pericardial shell. Six of seven watertight. | CC BY-NC 4.0 | non_commercial | **no — never** |
| `motion-straus-us-patient01/` | explore | **Moving, with vertex correspondence.** 30 frames of a synthetic biventricular myocardium over one whole cycle. | none stated | unconfirmed | **no** |
| `tof-cobivecox-chd0017001/` | explore | **Congenital.** Repaired Tetralogy of Fallot: LV and RV endocardium, epicardium, four valve annuli. | CC BY 4.0 | confirmed | **no** |

**Current development picker:** BodyParts3D is the only Explore-only model offered. The owner
withdrew `motion-biv-cinemri`, `motion-straus-us-patient01`, `normal-kit-four-chamber`, and
`tof-cobivecox-chd0017001` on 2026-08-20 because their present geometry is not educationally useful.
On 2026-08-22 the chamber-labelled Heart0102 derivative replaced the rejected undivided Heart0102
as the visible VHL choice. All withdrawn directories, validation, provenance, and explicit
development `?pack=` routes remain intact as research evidence; these are reversible catalogue
decisions, not asset deletion.

**The engine fixture is published and is not advertised.** The visual suite runs against the
production artefact and needs one pack whose contents this repository fixes, so `stub` stays in
`dist/` and stays reachable by `?pack=stub`. It is marked `fixture` in the catalogue and the picker
filters it out of the deployed site: publishing a test artefact and offering it to a learner beside
a real heart are different things. In development it appears, marked **engine fixture**.

A consequence: with the fixture hidden, exactly **one** real pack ships, so the deployed site renders
no picker at all — a control offering a single choice cannot do anything. It returns the moment a
second pack is published.

## Licence state, and what it decides

Schema v0.1 requires every pack to record how well its grant is actually *known*, separately from
what the grant says: `confirmed` (read at the rights holder's own page and quoted in the pack),
`non_commercial` (confirmed, and NC, so it can never ship), `unconfirmed` (no authoritative
statement found), `permission_pending` (an enquiry has gone out and no answer has come back).

**Only `confirmed` may reach Pages**, and that is a validator rule rather than a habit —
`npm run check:provenance` fails a published pack whose state is anything else, and
`tests/unit/publishedPacks.test.ts` applies the same rule under `npm run test`. A confirmed licence
is necessary and not sufficient: `motion-biv-cinemri` is confirmed CC BY 4.0 and still does not
ship, because nothing new ships in this build.

The repository also contains two **frozen legacy public-Git exceptions**:
`motion-straus-us-patient01` and `normal-alberta-neonatal`. Their rights are unresolved, their exact
existing asset trees are fingerprinted by `npm run check:provenance`, and they remain off Pages.
This records an existing exposure; it does not authorise changing those assets or adding another
unresolved pack. Disposition is an owner decision recorded in the planning folder as Q29.

## The substrate verdict (2026-08-19)

**`normal-rodero` is the substrate.** It is the only candidate with native volumetric myocardium:
tissue is stored as tagged tetrahedra, so extracting a tag group's boundary yields its endocardial
*and* epicardial surface and wall thickness exists by construction. It is also the only one whose
orientation is **measured** rather than assumed — superior from the ventricular to the aortic-wall
centroid, patient-left from the right- to the left-atrial centroid — because it is the only source
with chamber labels.

The other two are **rejected candidates, retained as evidence.** They lost the wave 1a comparison
and they are licence-blocked; both facts are recorded, because they fail differently. A substrate
verdict can be revisited by re-reading the geometry. A licence block cannot be resolved by anything
in this repository.

| Rejected | Substrate verdict | Licence position |
| --- | --- | --- |
| `normal-alberta-neonatal` | Blood pool and myocardium **interpenetrate** rather than nesting — not a cast-and-shell pair, so wall thickness cannot be derived by pairing them. Extents differ sharply (84.5 mm vs 43.5 mm superior), only ~⅓ of the blood-pool surface lies inside the myocardium, and pairwise distance spreads 0.05–33.9 mm. | **Blocked pending written confirmation.** 3dheartproject.com states a site-wide CC BY-NC grant; the per-model Sketchfab grant and the bundled licence file both read CC BY 4.0. Unreconciled. |
| `normal-vhl-heart0102` | A **single undivided label** — one material, no per-chamber structures, so nothing can be shown or hidden per chamber and a sweep has no ordered structure list. Interior endocardial surfaces are present, but 1,026 connected components (trabecular islands and segmentation debris) render as voids through the tissue. | **CC BY-NC 4.0.** A non-commercial pack binds the whole application to the NC red lines; not accepted for the published build. |

**Both rejected packs render in UNVERIFIED orientations.** Neither source carries chamber labels, so
superior and patient-left cannot be derived from the geometry. Each declares the glTF default and
says so in its own provenance. Verifying them is deliberately not done — they are not shipping.

Each rejected pack also carries its verdict inside its own `provenance.modified.note`, so the
reasoning survives being read by someone holding only the pack.

## The shelf: models brought in to be looked at

Separate from the wave 1a comparison, and judged differently. A shelf model does not have to be
labelled, segmented or pretty; it earns its place by looking good in the viewer, and that judgement
is made by *looking*, with the verdict written into `docs/observations.md`. None of them ships. Four
are now retained as hidden research packs rather than normal picker choices; BodyParts3D remains on
the active shelf.

| Pack | Why it is here | What is wrong with it |
| --- | --- | --- |
| `motion-biv-cinemri/` | It **moves** — ten whole-mesh frames on a normalised phase axis, the first moving geometry in the repository. | No vertex correspondence between frames (2268 vertices in the first, 1712 in the last), so no deformation field is derivable. Half a cycle only, so playback bounces rather than loops. No labels, so no echo. Undocumented supplementary data of unverified quality. |
| `normal-kit-four-chamber/` | The **cleanest geometry** on the shelf: six of seven surfaces watertight, one component each, zero boundary edges, so the cutter's caps actually close. | The pericardium is an opaque 183 mm bag around everything, so the default view is a grey egg and nothing inside is visible without a per-structure hide control that does not exist yet — marking the cavities as blood pool did not help here, because the pericardium blocks them. Cavities only, no wall thickness. No valve surfaces. Non-commercial, so it can never ship. |
| `motion-straus-us-patient01/` | The **only source with vertex correspondence** — 30 frames identical in vertex count and ordering, so a deformation field could be derived from it. Loops rather than bounces, and every frame is watertight. | Synthetic: a simulation's mesh, not a measured heart. NO LICENCE STATEMENT EXISTS at the source, so nothing derived from it may be published until a depositor says otherwise. One undivided myocardium, no labels. 10.9 MB, the largest pack here. |
| `tof-cobivecox-chd0017001/` | The **only congenital anatomy** in the repository, with four named valve annuli a view could be built on. | The annuli are rings, not valves — no leaflets, nothing opens. The repair is not described anywhere in the deposit. One patient of ten. Biventricular only: no atria, no great vessels. |
| `anatomy-bodyparts3d-heart/` | It carries **separate valve leaflets and cusps**, which no other available model does, plus papillary muscles and chamber cavities as distinct meshes. All 86 parts are watertight and single-component, so the cutter caps them properly, and the four cavity casts render as translucent lumen. | The atrioventricular "leaflets" are wall-sized regions, not thin leaflets; the semilunar cusps are genuine but coarse. One adult cadaver, fixed post-mortem, so nothing here opens or closes. Licence reading contradicted by older mirrors. |

## What reaches the deployed site

`src/packs/published.ts` is the single allowlist. It is read by the build filter in
`vite.config.ts`, by the loader's guard, and by `npm run check:published-packs`.

Removal is enforced at **build time** — unpublished packs are absent from `dist/`, not merely hidden
— so no deep link or guessed URL can reach them. They stay loadable under `npm run dev` so the
substrate comparison remains reproducible. `npm run check:published-packs` asserts the outcome after
a build, because a filter that silently stops working would mean a licence breach on a public URL.

All anatomical packs are **`draft` — none has been read by a clinician** — and each ships one ingest
reference view, a mechanically derived pose explicitly flagged as not a clinical view.

The stub pack exists so the loader, the schema, and CI have something to run against before any real
model exists. Its geometry and both of its "views" are synthetic and explicitly labelled as such; its
assets are generated by `scripts/make-stub-assets.mjs` and CI checks that regenerating them produces
no diff. Wave 0 downloads no medical models and invents no clinical content.

Its label volume covers the same `[-1, 1]³` model bounds as the meshes, but the label extents are
deliberately not identical to the mesh extents: the core label matches its mesh, while the shell
label stops short of the shell mesh so the fixture keeps a rim of background voxels. Without any
background the validator's reserved-background rule would go unexercised.

## Adding or regenerating a pack

1. Run the pipeline into `build/packs/<id>/` while source rights are unresolved. Move or regenerate
   into `public/packs/<id>/` only when the source registry explicitly records that the known grant
   permits public derived files. Do not hand-copy a research download into Git.
2. Add `public/packs/<id>/pack.json` plus its derived assets only after that decision.
3. `npm run validate:packs` — schema, cross-references, and asset *semantics*: referenced files
   exist, every `mesh_node` resolves to a named node inside the glTF, the glTF's own external
   resources are embedded or present on disk, and a `raw-u8` volume matches its declared resolution
   and declares every voxel value it contains. **Voxel value `0` is reserved for background** and
   must not appear in `echo_volume.labels`; every other value present must be declared, and every
   declared label must actually appear. Binary containers (`.glb`, KTX2) are reported as skipped
   rather than silently passed — inspecting them is a tracked technical-slice gap.
4. `npm run check:provenance` — licence, attribution, public-Git policy, and legacy-exception
   integrity, per anatomy **and** per view.

`npm run check:content` runs both. Selective content CI runs when pack/schema/pipeline material
changes, and the Pages release runs them again before deployment.

## Provenance is not optional

Every pack carries a full provenance block per anatomy and per view: creator, source, source URL,
licence, licence URL, modified flag + note, derivation chain, and vetting state. The credits screen
renders it (`contracts/provenance-ui.md`), and the build fails without it.

Vetter **names are consent-gated** — `vetters[i].name` is omitted until explicit naming consent is
recorded, and the UI falls back to the role label (`fellow`, `attending`). Do not add a
collaborator's personal name, institution or program affiliation, or availability to a pack. That is
distinct from the `provenance` block's third-party attribution, which names a model's source creator
and institution because the licence requires it.
