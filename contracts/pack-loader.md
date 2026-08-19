# Contract: pack-loader

**Owns:** `src/schema/**`, `src/packs/**`, `scripts/validate-packs.ts`, `scripts/check-provenance.ts`
**Status:** implemented in wave 0; extended to **v0.1** (2026-08-19) so the pack system can carry
unlabelled and moving geometry. Revisited once more at the v1 revision after the wave 1 slice.
**Spec:** `docs/build_plan.md` v1.2 — "Architecture: engine + content packs" (1), "Content pack schema — v0 PROVISIONAL".

## Responsibility

Fetch, schema-validate, and parse content packs; expose a typed pack model. It is the **only** place
an untyped pack becomes a typed one. Nothing downstream re-validates, and nothing downstream may
accept an unvalidated pack.

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
