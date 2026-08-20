# Model ingest pipeline

**Updated:** 2026-08-20 14:40 EDT

Turns a raw anatomical source into a content pack conforming to schema v0.1, with
complete provenance.

**Two paths, one entry point.** A source that carries an anatomical reading —
per-element tags, named glTF groups — goes through `ingest.py` and comes out as a
full pack: decimated glTF, labelled echo volume, derived cardiac frame, clinical
views. A source that is *just geometry* goes through `geometry.py` and comes out
as an EXPLORE-ONLY pack: meshes, no echo, no views, and no frame claimed. Which
path a source needs is a property of the source, so it is asked for the same way.

```bash
conda env create -f ../environment.yml         # once
npm run ingest -- --source rodero              # one labelled substrate
npm run ingest -- --source cardiac-motion      # one geometry-only source
npm run ingest -- --source all                 # everything in both registries
npm run ingest -- --budget-table               # volume size against resolution
```

## Files

| File | What it does |
| --- | --- |
| `sources.py` | Two source registries: `SOURCES` (labelled substrates) and `GEOMETRY_SOURCES`. |
| `fetch.py` | Checksum-verified download into the gitignored `.cache/`, one file or many. |
| `meshlib.py` | Readers (legacy VTK tets/PolyData/unstructured, XML VTU, glTF, STL, OBJ, PLY) and the glTF writer. |
| `geometry.py` | The geometry-only path: plain surfaces in, an Explore-only pack out. |
| `bodyparts3d.py` | Which BodyParts3D files are the heart, and what each one is called. |
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

## The geometry-only path

`geometry.py` exists because most material worth looking at carries no labels, no tags and
no documentation, and schema v0.1 made those packs possible. It reads OBJ, PLY, STL (ASCII and
binary), legacy VTK PolyData and unstructured grids, and XML VTU; normalises units to millimetres by *measuring* the model against the range a whole
heart can plausibly span, and records the reasoning; centres on the model bounds; emits one
unnamed structure where the source has no labels and one per file where it is a directory of
parts; and writes one glTF per frame where the source moves.

It **measures every surface it ships** — after welding, after decimation — and records the
topology per structure. A surface that is not watertight, manifold and single-component must be
DECLARED in `GeometrySource.open_surfaces` with what is actually wrong with it, and the ingest
refuses to write the pack otherwise; a declaration for a surface that measures clean is refused
too, because one that outlives its defect is how the next real one gets waved through. It also
records **how** it decided `blood_pool` for every structure rather than leaving `false` to mean
both "tissue" and "never looked" — see `GeometrySource.blood_pool_basis`.

Where a source carries a hierarchy of its own it is read out and emitted as GROUP structures with no
mesh — `GeometrySource.hierarchy`. BodyParts3D is the one source that has one:
`partof_element_parts.txt` is a concept-to-element table, and `pipeline/bodyparts3d.py` derives the
tree from it by set containment, naming no anatomy of its own. Every other source produces a flat
list, and the viewer renders whatever tree it is given.

It **welds** every surface it reads: unreferenced vertices are dropped and exactly coincident ones
merged. Both are lossless — a vertex no face references renders nothing, and two vertices at the
same float32 coordinates are one point written twice — and skipping it was a real defect. Several
of these formats duplicate a vertex per adjacent face along seams, so unwelded they measure open and
multi-component when they are neither: all 86 BodyParts3D parts read as open with up to 124
connected components, and welded every one of them is watertight. The free cutter's stencil caps
depend on front/back face parity, so an apparently-open surface made the caps paint solid over whole
cavities. See `docs/observations.md` entry 29.

Welding uses **exact** float32 equality with no tolerance: a tolerance is a judgement about how
close is close enough, and a wrong one welds a real gap shut. On a keyframed source the weld is
computed once from frame 0 and applied to every frame, because `np.unique` sorts by coordinate and
the coordinates are exactly what differs between frames — welding frames independently would destroy
the vertex correspondence.

It marks **blood pool** where the source names its casts as such: `GeometrySource.blood_pool_match`
carries case-insensitive substrings matched against the display label, and a declared pattern that
matches nothing is a hard error rather than a silent no-op. A blood-pool structure is a cast of the
lumen rather than tissue and the viewer draws it translucent and cool, which matters most at a CUT —
a solid cavity cast and a solid wall otherwise present the same opaque face. BodyParts3D models its
chambers as filled solids of 52 to 117 mL, so without this the cut read as a filled cavity.

Three things it deliberately does not do.

- **It derives no anatomical frame and claims none.** No labels means no landmarks means no
  measurable superior or patient-left. The pack declares the source's own axis order and says
  in its own provenance that the orientation is unverified.
- **It fills no holes.** `ingest.py` closes what decimation opens, because a tag-group
  boundary is closed by construction and a hole there is damage. A geometry-only surface may
  be genuinely open — a biventricular surface truncated at the valve plane is open on purpose
  — so openness is measured and reported instead of repaired away. Note the distinction from
  welding above: merging duplicate vertices measures what is already there, filling a hole invents
  something. Dropping both together was the mistake `docs/observations.md` entry 29 records.
- **It centres every frame together, never each frame on itself.** Per-frame centring would
  subtract exactly the bulk translation that makes a beating heart beat.

Motion is carried as whole meshes per frame rather than as a deformation field. That follows the
data: the frames of the *first* 4D source differ in vertex **count**, so there is no correspondence
a displacement could be expressed against. Each pack records `vertex_correspondence`, and the ingest
**withdraws** the claim if it ever decimates — quadric simplification is data-dependent, so
decimating frames independently destroys any correspondence they arrived with. For the same reason
the triangle budget applies **per frame** on an animated source rather than being divided across
frames: only one frame is on screen at a time, and dividing would have halved a 15,000-triangle
myocardium for no rendering benefit while silently voiding the property that source exists for.

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

## Public-repository and release boundaries

There are two public surfaces: Git history and the deployed site. Pages filtering protects only
the second one.

Pipeline routing writes a derivative to `public/packs/` only when an explicit source-policy flag
says the known grant permits public derived files **and** its licence state records that grant as
established. Unconfirmed or permission-pending
work goes to `build/packs/`, which is gitignored. Before staging a public output, still confirm that
the recorded grant covers the actual derivative and attribution.

`src/packs/published.ts` decides *what reaches the deployed site*. A pack under `public/packs/`
loads in `npm run dev` and is pruned from `dist/` at build time unless it is on
`PUBLISHED_PACK_IDS`. The selected Normal pack is on that list; research and comparison packs are
not. Any pack whose `license_state` is not `confirmed` is kept off Pages by
`npm run check:provenance` rather than by anyone remembering to.

**Raw sources and uncertain-rights derivatives are never committed.** The repository is public,
so pushing either is distribution even if the deployed site never serves it. Raw files live in the
gitignored `.cache/`; exploratory derivatives live under `build/packs/`. Rights-cleared derived
assets may be committed within the 15 MB per-pack budget that `geometry.py` enforces.

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
