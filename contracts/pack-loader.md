# Contract: pack-loader

**Owns:** `src/schema/**`, `src/packs/**`, `scripts/validate-packs.ts`, `scripts/check-provenance.ts`
**Status:** implemented in wave 0; extended to **v0.1** (2026-08-19) so the pack system can carry
unlabelled and moving geometry. Revisited once more at the v1 revision after the wave 1 slice.
**Spec:** `docs/build_plan.md` v1.2 — "Architecture: engine + content packs" (1), "Content pack schema — v0 PROVISIONAL".

## Responsibility

Fetch, schema-validate, and parse content packs; expose a typed pack model. It is the **only** place
an untyped pack becomes a typed one. Nothing downstream re-validates, and nothing downstream may
accept an unvalidated pack.

## `body-context/v0` — a separate document, bound to a pack by hash

*(Added 2026-08-21.)* `src/schema/bodyContextV0.ts` and `src/packs/loadBodyContext.ts` carry the
patient/body frame — `+X` patient-left, `+Y` posterior, `+Z` superior — and a rigid, unit-scale
`model_to_body` registration. It is **not** a pack field, and the direction of the binding is the
point: a registration is a fact about pairing one pack revision with one reference body, with its
own residuals and its own third-party licence. `meshes.orientation` and `meshes.anatomical_frame`
stay what they are — the pack's own cardinal declaration and its CARDIAC basis — and are not
overwritten to carry a body frame they were never derived for.

The descriptor names its pack, its pack version, and that pack's exact `pack.json` SHA-256, and all
three are checked at load. Model-space coordinates do not survive a re-ingest, so a stale
registration is refused rather than applied approximately. `rigidProblem` refuses a scale, a shear
or a reflection by name; a reflection is refused because a mirrored heart fits the same landmarks
and is a different organ.

Loading is fail-soft in one direction only: no context, or a context that fails any check, leaves
the heart in its own model space and everything working. A context that failed validation is never
partially applied.

## Interface

```ts
loadPack(url: string, init?: RequestInit): Promise<LoadedPack>
loadPackById(packId: string, init?: RequestInit): Promise<LoadedPack>
resolveAsset(loaded: LoadedPack, assetPath: string): string
packUrl(packId: string): string

interface LoadedPack { pack: Pack; baseUrl: string }
class PackLoadError extends Error { url: string; issues: PackIssue[] }

validatePack(value: unknown): PackValidation   // never throws
readSchemaVersion(value: unknown): string | null

isExploreOnly(pack: Pack): boolean            // meshes, no echo, no views
hasKeyframes(pack: Pack): boolean             // motion the cine control can play
mayBePublished(state: LicenseState): boolean  // only "confirmed"
```

Packs live at `public/packs/<id>/pack.json`. Asset paths inside a pack are pack-relative; the loader
rejects absolute URLs and `..` traversal, and `resolveAsset` is the only supported way to turn one
into a URL. Deployed base paths differ (`/` locally, `/<repository-name>/` on Pages), so URLs are
built through `import.meta.env.BASE_URL` — never hardcoded.

## What v0.1 added

Three additions, all provisional, all made because the alternative was excluding real material from
the repository rather than because the schema was ready to settle.

**`echo_volume` is optional, and its absence defines EXPLORE-ONLY.** A pack with meshes and no
labelled volume is a valid pack. `isExploreOnly(pack)` is the predicate, and the schema forces the
two possible statements of the same fact to agree: a pack with no `echo_volume` must carry **no**
views, and a pack with an `echo_volume` must carry **at least one**. A view is a pose to image from,
so a view with nothing to image is a pack describing an echo it cannot produce.

**`provenance.license_state` is required.** It records how well the grant named in `license` is
actually known — `confirmed`, `non_commercial`, `unconfirmed`, `permission_pending`. It is required
on the pack's provenance and on every view's, and the two must agree, because the publication rule
reads the pack-level one. See the rules below.

**`meshes.keyframes` carries motion.** Frames are whole meshes, not deformation fields, and
`vertex_correspondence` records per pack whether a deformation field could ever be derived. The
first frame must be `meshes.gltf`, so a consumer that knows nothing about motion still renders a
real frame of the same heart. Playing keyframes is Explore's cine control; the echo renderer does
not read this block, and wiring motion into the echo is a separate task with a performance design in
front of it (`src/echo/shaders/scanPass.ts`).

## What v0.1 added later, on 2026-08-19, and why

Three more fields, each because a defect the owner found by looking had no field to be caught in.

**`Structure.blood_pool_decision` — blood pool is DECIDED, never defaulted.** `blood_pool` has
existed since v0, and `pipeline/geometry.py` wrote `false` for every structure it emitted, so no
geometry-only pack had ever set it and BodyParts3D's four solid chamber casts rendered as tissue
(`docs/observations.md` entries 31 and 32). A boolean cannot be told apart from a default. The
decision block records the **basis** — `label_match`, `label_no_match`, `source_tag`, `authored` —
and the evidence, the flag has to agree with the basis, and a structure that carries no decision is
refused. Groups carry none, having no surface.

**`Structure.topology` — watertightness is DECLARED, never discovered by a learner.** The measured
topology of the surface **as shipped**: after welding, after decimation, of the mesh actually in the
glTF. A surface that is not watertight, manifold and single-component must carry
`declared_reason`, and one that is clean must NOT — a declaration that outlives its defect is how
the next real one gets waved through. It is required on every structure of a pack with no
`echo_volume`, because geometry is the only thing such a pack has to say. CobivecoX is the honest
exception: truncated ventricles and annuli that really are rings, all eight declared.

**`Structure.mesh_node` is nullable — a GROUP.** A structure with no mesh is a name in the pack's own
hierarchy over its children: "left coronary artery" above its ten branches. It exists because a
source's hierarchy is a hierarchy of CONCEPTS whose meshes are the leaves — nothing in BodyParts3D
is the artery itself. A group must have children, and carries no colour, cap, topology or blood-pool
state. **Grouping comes from the pack and never from the engine**: a taxonomy hardcoded in viewer
code is one draft of anatomy frozen into the build, the same reason `docs/view_canon.md`'s families
are not enumerated there. A pack that declares no hierarchy renders as a flat list, which is every
pack here but two.

## Rules

1. **Schema v0.1 is PROVISIONAL.** Code against it. Do not freeze,
   simplify, or extend it. Exactly one controlled revision (v1) is expected after the wave 1
   technical slice review.
2. **`meta.schema_version` is exact-match.** A pack declaring anything but `"0.1"` is refused with a
   version message, not a shape error.
3. **Validation is total.** Unknown keys are rejected (`strictObject`), unit vectors must be unit,
   `beam_axis ⟂ lateral_axis`, and every cross-reference resolves — structure parents (acyclic),
   echo labels, view structure lists, show/hide presets, sweep structure order.
4. **The loader never repairs a pack.** No normalizing a non-unit vector, no defaulting a missing
   required field, no dropping an unknown key. A bad pack fails loudly at the boundary.
5. **The free cutter is not view data.** `interaction.free_cut` is a viewer default and the only
   place a free-cut plane appears in a pack. There is no code path from `views[]` to a free cutter
   and none may be added.
6. **Defaults are resolved by the consumer, not baked in.** Absent `interaction.pivot` means "use the
   model-bounds centroid"; absent `interaction.camera` means "use `meshes.canonical_pose`"; absent
   `interaction.free_cut` means "start with the free cutter disabled". The loader reports absence; it
   does not invent values.
7. **An EXPLORE-ONLY pack cannot enter Echo mode, and the refusal is visible.** The shell disables the
   Echo control and states the reason next to it; `?mode=echo` on such a pack lands in Explore rather
   than on a half-built screen. `describePack` throws if the echo renderer is handed one anyway,
   because reaching it is a shell bug and a blank canvas would read as a broken renderer.
8. **Only a `confirmed` licence may be published.** `mayBePublished(state)` is the single definition;
   `scripts/check-provenance.ts` applies it against `PUBLISHED_PACK_IDS` and fails the build, and
   `tests/unit/publishedPacks.test.ts` applies it again over the real packs under `npm run test`. The
   rule includes `non_commercial`, which is a confirmed licence that forbids the use. This is a
   validator rule rather than a convention precisely because the allowlist is edited by hand.
9. **A pack's licence state is one answer, not one per view.** Every view's `license_state` must equal
   the pack's, or the publication rule would be evaluated against a field that disagrees with the one
   being enforced.

## Definition of done (already met for wave 0)

- Schema v0.1 expressed in code, validated at load time in the browser and by CI.
- Stub pack under `public/packs/stub/` loads and validates.
- `npm run validate:packs` and `npm run check:provenance` fail the build on a bad or under-attributed
  pack.
