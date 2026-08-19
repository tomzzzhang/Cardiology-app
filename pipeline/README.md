# Model ingest pipeline

**Updated:** 2026-08-19 02:05 EDT

Turns a raw anatomical source into a content pack: a decimated glTF plus a labelled
echo volume conforming to schema v0, with complete provenance.

One pipeline, run over every candidate substrate, so the slice review compares
candidates on the same ruler instead of committing blind.

```bash
conda env create -f ../environment.yml     # once
npm run ingest -- --source rodero          # one source
npm run ingest -- --source all             # all three
npm run ingest -- --budget-table           # volume size against resolution
```

## Files

| File | What it does |
| --- | --- |
| `sources.py` | The source registry: acquisition, licence, citation, publish policy. |
| `fetch.py` | Checksum-verified download into the gitignored `.cache/`. |
| `meshlib.py` | Readers (VTK tets, glTF, binary STL) and the glTF writer. |
| `anatomy.py` | Valve identification by face adjacency, and the cardiac frame derived from it. |
| `substrate.py` | The substrate probe: geometry type, wall thickness, interior surfaces. |
| `ingest.py` | The pipeline, and its CLI. |

## Steps

`acquire -> pose-normalise -> split/label -> decimate -> glTF -> voxelise -> pack.json`

The pipeline is source-shaped in exactly two places, both unavoidable and both explicit:

- **Structure splitting.** A tetrahedral mesh with per-element tags splits by tag. A glTF
  splits by the creator's named groups. A single STL does not split at all — and the
  pipeline says so rather than inventing a division. Connected-component splitting is
  deliberately *not* applied: the components of a segmented STL are trabecular islands,
  not chambers, and naming them would manufacture anatomy the source does not contain.
- **Voxelisation.** A volumetric source is sampled from its elements via barycentric
  containment, which is exact. A surface-only source is filled by ray parity along
  scanlines, which is exact for a watertight surface — and where a scanline returns an odd
  hit count the surface is locally open there, so those lines are skipped and *counted*.
  A leaky source shows up as a number rather than as silently missing tissue.

Everything after that is shared.

## What gets named, and on what evidence

Six Rodero tags are named because the source documents them. The four valve planes are named
because `anatomy.py` **derives** which is which: a valve plane borders exactly two of those six
tags, and the pair identifies it (LV+LA mitral, RV+RA tricuspid, LV+aorta aortic, RV+PA
pulmonary). Adjacency, not position — position is what the frame is being derived to interpret,
so reading identity off it would be circular. Disagreement with the published mapping **raises**.

The remaining fourteen tags each border exactly one chamber, so adjacency cannot separate a right
upper pulmonary vein from a left lower one. They keep generic labels until a clinician names them.

## No Blender

`docs/build_plan.md` describes this as a "Blender + Python" pipeline. It is Python only.
Every step needed — tag splitting, boundary extraction, quadric decimation, voxelisation,
glTF export — is a direct computation on arrays, so the whole ingest runs headless from the
command line and is reproducible without a GUI tool in the loop. Blender becomes necessary
only when geometry has to be *authored* rather than derived: sculpted valve leaflets, and
the ASD module. Neither is in this slice.

## `.gltf`, not `.glb`

`scripts/lib/packAssets.ts` inspects JSON glTF and reports binary containers as *skipped*.
Shipping `.glb` would quietly retire the `mesh_node` validation that `npm run validate:packs`
performs. Staying with JSON plus an external `.bin` keeps that gate real, and costs nothing
the deployed pack notices.

## What does not ship

`sources.py` carries a `publishable` flag. A source whose licence is unresolved is still
built and measured — the slice review needs the numbers — but it is written to `build/packs/`,
which is gitignored, instead of `public/packs/`. Two of the three candidates are currently in
that state; see the pack table in `public/packs/README.md`.

## Credentials

The Sketchfab download API needs a personal token, read from `SKETCHFAB_API_TOKEN`. It is a
credential: never written to the cache, never logged, never committed.

```bash
export SKETCHFAB_API_TOKEN=...   # https://sketchfab.com/settings/password
```

## Vetting status

Nothing this pipeline emits has been read by a clinician. Every pack it writes is
`vetted.status: "draft"` with an empty vetters list, without exception, and its single view
is an ingest reference pose that is named and flagged as not being a clinical view. Vetted
probe poses are wave 1d's job, with a clinical vetter.
