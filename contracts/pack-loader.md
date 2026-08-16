# Contract: pack-loader

**Owns:** `src/schema/**`, `src/packs/**`, `scripts/validate-packs.ts`, `scripts/check-provenance.ts`
**Status:** implemented in wave 0. Revisited once, at the schema v1 revision after the wave 1 slice.
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
```

Packs live at `public/packs/<id>/pack.json`. Asset paths inside a pack are pack-relative; the loader
rejects absolute URLs and `..` traversal, and `resolveAsset` is the only supported way to turn one
into a URL. Deployed base paths differ (`/` locally, `/<repository-name>/` on Pages), so URLs are
built through `import.meta.env.BASE_URL` — never hardcoded.

## Rules

1. **Schema v0 is PROVISIONAL and owned by the planning session.** Code against it. Do not freeze,
   simplify, or extend it. Exactly one controlled revision (v1) is expected after the wave 1
   technical slice review.
2. **`meta.schema_version` is exact-match.** A pack declaring anything but `"0"` is refused with a
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

## Definition of done (already met for wave 0)

- Schema v0 expressed in code, validated at load time in the browser and by CI.
- Stub pack under `public/packs/stub/` loads and validates.
- `npm run validate:packs` and `npm run check:provenance` fail the build on a bad or under-attributed
  pack.
