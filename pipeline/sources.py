"""
Source registry for the model ingest pipeline.

One entry per candidate anatomical substrate. Everything licence-bearing lives
here, so the pack's provenance block is generated from the same declaration that
drives acquisition — a source cannot be ingested without its attribution.

Raw sources are 1-200 MB and are NEVER committed. They are fetched into a
gitignored cache and verified by checksum before use (`fetch.py`). The
repository is PUBLIC, so pushing a raw third-party asset to it would be
distribution even if the deployed site never served it; only derived assets are
committed, and only within the per-pack budget.

Two registries, because two kinds of source need different things said about
them:

* `SOURCES` — substrates that carry an anatomical reading (tagged volumes, named
  glTF groups). `ingest.py` derives a frame, clinical views and a labelled echo
  volume from these.
* `GEOMETRY_SOURCES` — plain surfaces with no labels and often no documentation.
  `geometry.py` turns these into EXPLORE-ONLY packs. None of them is published;
  what each one records instead is exactly how far its licence and its quality
  are actually known.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from bodyparts3d import hierarchy as bodyparts3d_hierarchy, select_heart


@dataclass(frozen=True)
class Source:
    """A candidate substrate: how to get it, and what it obliges us to say."""

    key: str
    pack_id: str
    display_name: str
    anatomy: str
    canonical_variant: str

    # --- acquisition ------------------------------------------------------
    #: Either a direct URL, or a Sketchfab uid fetched through the download API.
    url: str | None
    sketchfab_uid: str | None
    sketchfab_format: str
    #: Archive member the pipeline actually reads, once unpacked.
    member: str
    #: md5 of the downloaded archive. `None` means "record it on first fetch":
    #: Sketchfab re-packs archives, so their bytes are not stable over time and
    #: pinning a checksum would break the fetch rather than protect it.
    md5: str | None
    size_bytes: int | None

    # --- attribution ------------------------------------------------------
    creator: str
    source_text: str
    source_url: str
    license: str
    license_url: str
    #: How well the grant named in `license` is actually KNOWN. One of
    #: "confirmed", "non_commercial", "unconfirmed", "permission_pending" --
    #: `LicenseState` in src/schema/packV0.ts is the definition. A state other
    #: than "confirmed" cannot be published, and CI enforces that rather than
    #: trusting the `publishable` flag below to agree with it.
    license_state: str
    citation: str

    # --- policy -----------------------------------------------------------
    #: False keeps the derived pack out of `public/packs/` entirely. Used where
    #: the licence is unresolved: the pack is still built and measured, but it
    #: cannot ship. See `pipeline/README.md`.
    publishable: bool
    unpublishable_reason: str = ""

    #: Free-text notes surfaced in the substrate report.
    notes: list[str] = field(default_factory=list)

    #: Why this candidate lost the wave 1a substrate comparison, if it did.
    #: Written into the pack's own provenance so the verdict travels with the
    #: evidence rather than living only in a commit message. Empty for the
    #: substrate that was selected.
    rejection: str = ""


RODERO = Source(
    key="rodero",
    pack_id="normal-rodero",
    display_name="Normal heart — Rodero/CEMRG average four-chamber",
    anatomy="Normal heart, four-chamber, adult population average",
    canonical_variant=(
        "Population-average adult four-chamber mesh (mean shape of 19 subjects); "
        "not a single individual and not a paediatric heart"
    ),
    url="https://zenodo.org/api/records/4593739/files/average.tar.gz/content",
    sketchfab_uid=None,
    sketchfab_format="",
    member="average.vtk",
    md5="992f31e20c1aa73c10c5d9a6b6ac903a",
    size_bytes=58167648,
    creator="Rodero, C., Strocchi, M., Marciniak, M., et al. (CEMRG, King's College London)",
    source_text=(
        "Virtual cohort of adult healthy four-chamber heart meshes from CT images, "
        "Zenodo record 4593738, file average.tar.gz"
    ),
    source_url="https://zenodo.org/records/4593738",
    license="CC-BY-4.0",
    license_url="https://creativecommons.org/licenses/by/4.0/",
    # Read from the Zenodo record's own licence field.
    license_state="confirmed",
    citation=(
        "Rodero C, Strocchi M, Marciniak M, Longobardi S, Whitaker J, O'Neill MD, "
        "Gillette K, Augustin C, Plank G, Vigmond EJ, Lamata P, Niederer SA. "
        "Linking statistical shape models and simulated function in the healthy "
        "adult human heart. PLOS Computational Biology 17(4): e1008851 (2021). "
        "doi:10.1371/journal.pcbi.1008851"
    ),
    publishable=True,
    notes=[
        "Volumetric tetrahedral mesh with per-element tissue tags: myocardium is native, not shelled.",
        "Adult and averaged. Paediatric applicability is a clinical-vetting question, not a technical one.",
        "Carries fibre and sheet vectors, and universal ventricular coordinates (RHO/PHI/Z/V).",
    ],
)

ALBERTA = Source(
    key="alberta",
    pack_id="normal-alberta-neonatal",
    display_name="Normal Neonatal Heart — 3D Heart Project",
    anatomy="Normal neonatal heart",
    canonical_variant="Single neonatal specimen, segmented blood pool with a myocardial surface",
    url=None,
    sketchfab_uid="7869b91a0c0744e9a3a2035eb3a72236",
    sketchfab_format="gltf",
    member="scene.gltf",
    md5=None,
    size_bytes=None,
    creator="3D Heart Project (University of Alberta / Stollery Children's Hospital)",
    source_text="Sketchfab model 'Normal Neonatal Heart', uid 7869b91a0c0744e9a3a2035eb3a72236",
    source_url="https://sketchfab.com/3d-models/normal-neonatal-heart-7869b91a0c0744e9a3a2035eb3a72236",
    license="CC-BY-4.0",
    license_url="https://creativecommons.org/licenses/by/4.0/",
    # Two grants from the same rights holder contradict each other and neither
    # is authoritative. That is not a confirmed licence, whichever reading the
    # owner elected for the purposes of keeping the pack.
    license_state="unconfirmed",
    citation=(
        "This work is based on \"Normal Neonatal Heart\" by 3D Heart Project "
        "(https://sketchfab.com/3DHeartProject), licensed under CC-BY-4.0."
    ),
    publishable=True,
    unpublishable_reason="",
    rejection=(
        "REJECTED AS SUBSTRATE (2026-08-19). The blood pool and the myocardium interpenetrate "
        "rather than nesting: they are not a cast-and-shell pair, so wall thickness cannot be "
        "derived by pairing them. Extents differ sharply (84.5 mm against 43.5 mm on the superior "
        "axis, the blood pool running up the great vessels where no myocardium exists), only about "
        "a third of the blood-pool surface lies inside the myocardium, and the pairwise distance "
        "spreads from 0.05 to 33.9 mm. NOT PUBLISHED, and independently licence-blocked: the "
        "site-wide CC BY-NC claim and the per-model CC BY 4.0 grant are unreconciled. Retained in "
        "the repository as evidence. Renders in an UNVERIFIED orientation."
    ),
    notes=[
        "Downloaded bundle's own license.txt asserts CC-BY-4.0, 'Commercial use is allowed'.",
        "LICENCE CONFLICT, resolved by owner decision (2026-08-18): 3dheartproject.com states a "
        "site-wide CC BY-NC grant while the per-model Sketchfab grant AND the license.txt inside "
        "the download both read CC BY 4.0. The owner elected the CC BY 4.0 reading. The conflict "
        "itself is recorded in the pack's provenance rather than hidden, so the decision is "
        "auditable and reversible if written confirmation contradicts it.",
        "Two materials: one opaque, one alphaMode=BLEND — investigated in the substrate report.",
    ],
)

VHL = Source(
    key="vhl",
    pack_id="normal-vhl-heart0102",
    display_name="Healthy Pediatric Heart — Visible Heart Labs Heart0102",
    anatomy="Normal paediatric heart",
    canonical_variant="Single 14-year-old specimen, MR-segmented tissue, no known cardiac history",
    url=None,
    sketchfab_uid="b7cb05c398894395a329cfff4c1caf0e",
    # The creator's own upload, not Sketchfab's re-export: it is the master, and
    # it avoids the 16-bit chunk splitting Sketchfab applies to the glTF.
    sketchfab_format="source",
    member="Heart102_Tissue.stl",
    md5=None,
    size_bytes=None,
    creator="Visible Heart Laboratories (University of Minnesota)",
    source_text="Sketchfab model 'Healthy Pediatric Heart Model- Heart0102', uid b7cb05c398894395a329cfff4c1caf0e",
    source_url="https://sketchfab.com/3d-models/healthy-pediatric-heart-model-heart0102-b7cb05c398894395a329cfff4c1caf0e",
    license="CC-BY-NC-4.0",
    license_url="https://creativecommons.org/licenses/by-nc/4.0/",
    # Read from the Sketchfab model page's own licence field.
    license_state="non_commercial",
    citation=(
        "This work is based on \"Healthy Pediatric Heart Model- Heart0102\" by VisibleHeartLabs "
        "(https://sketchfab.com/VisibleHeartLabs), licensed under CC-BY-NC-4.0."
    ),
    publishable=True,
    unpublishable_reason="",
    rejection=(
        "REJECTED AS SUBSTRATE (2026-08-19). A single undivided tissue body: one material, one "
        "echo label, no per-chamber structures, so nothing can be shown or hidden per chamber and "
        "a sweep has no ordered structure list to read out. Interior endocardial surfaces are "
        "genuinely present, but 1,026 connected components — trabecular islands and segmentation "
        "debris — render as voids through the tissue. NOT PUBLISHED, and independently "
        "licence-constrained as CC BY-NC 4.0. Retained in the repository as evidence. Renders in "
        "an UNVERIFIED orientation."
    ),
    notes=[
        "MR-segmented tissue model of a 14-year-old; described by the source as a tissue (not blood pool) model.",
        "Source upload is a single STL named Heart102_Tissue.stl.",
        "NON-COMMERCIAL. Shipping this pack binds the whole app: build_plan.md's NC red lines are "
        "ads, paid sponsorship tied to content, paid tiers including NC content, and selling "
        "institutional access. A free educational app with zero revenue is squarely permitted. "
        "Kept logically separable so it can be dropped without touching the others.",
    ],
)

SOURCES = {s.key: s for s in (RODERO, ALBERTA, VHL)}


# --------------------------------------------------------------------------- #
# geometry-only sources                                                        #
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class RemoteFile:
    """One file to fetch, and what it should turn out to be."""

    url: str
    #: Filename inside the source's cache directory.
    name: str
    #: Published md5, where the host publishes one. Zenodo does; most do not.
    md5: str | None
    size_bytes: int | None
    #: Extract into the cache directory after download.
    unpack: bool = False


@dataclass(frozen=True)
class GeometrySource:
    """
    A source with geometry and nothing else: no labels, no tags, no frame.

    The fields that carry the most weight here are the ones about UNCERTAINTY.
    A geometry-only source is usually undocumented supplementary data, and the
    pack's whole claim to honesty is that everything not established about it is
    written down rather than smoothed over.
    """

    key: str
    pack_id: str
    display_name: str
    anatomy: str
    canonical_variant: str

    # --- acquisition ------------------------------------------------------
    files: tuple[RemoteFile, ...]
    #: Glob patterns, in registry order, selecting what to read from the cache.
    #: For a moving source this order IS the time axis.
    members: tuple[str, ...]

    # --- what the geometry is ---------------------------------------------
    #: True when the members are FRAMES of one moving mesh rather than parts.
    animated: bool
    #: Frame rate, where the source states one. `None` means the pack carries a
    #: normalised phase axis instead — which is all an unstated rate supports.
    fps: float | None
    #: Whether the frames span a whole cycle and may be looped seamlessly.
    loop: bool
    #: Whether vertex count and ordering hold across frames. Decides whether a
    #: deformation-field representation could ever be derived from this source.
    vertex_correspondence: bool
    #: What part of the cycle the frames cover, in words.
    coverage: str
    #: Display label for the single structure of an unlabelled source.
    structure_label: str
    #: File stem -> display label, where the source names its parts.
    part_labels: dict[str, str]

    # --- attribution ------------------------------------------------------
    creator: str
    source_text: str
    source_url: str
    license: str
    license_url: str
    license_state: str
    citation: str
    #: The licence statement AS READ at the source, quoted into the pack so the
    #: reading is preserved rather than trusted to still be there later.
    license_quote: str

    #: Source-specific selection, where globbing filenames cannot express it.
    #:
    #: Given the unpacked cache directory, returns ordered (path, display label)
    #: pairs. BodyParts3D needs this: which of its 1,258 OBJ files are the heart,
    #: and what each one is called, are both answers derived from a table that
    #: ships with the data, not from the filenames.
    select: Callable[[Path], list[tuple[Path, str]]] | None = None

    #: Case-insensitive substrings marking a structure as BLOOD POOL.
    #:
    #: Matched against the display label. A blood-pool structure is a cast of
    #: the lumen rather than tissue, and the viewer draws it translucent and
    #: cool so a cast cannot be mistaken for a wall — which matters most at a
    #: CUT, where a solid cavity cast and a solid wall otherwise present the
    #: same opaque face. A declared pattern that matches nothing is an error,
    #: not a no-op: it means the source's labels have moved.
    blood_pool_match: tuple[str, ...] = ()

    #: How this source's NON-matching labels were determined to be tissue.
    #:
    #: Required, and required even where `blood_pool_match` is empty, because a
    #: source with no patterns is the case that went wrong: `geometry.py` wrote
    #: `blood_pool: False` for every structure it emitted and no geometry-only
    #: pack had ever set the flag, so BodyParts3D's four solid chamber casts
    #: rendered as tissue. A boolean cannot tell a decision from a default. One
    #: sentence here is what turns "false" into "determined to be tissue, thus".
    blood_pool_basis: str = ""

    #: Structures that are NOT manifold, closed and single-component, and why.
    #:
    #: Keyed by the pack's structure slug. A surface that is not clean caps
    #: wrongly at the free cutter and can read as several objects, so the pack
    #: has to say so — and the ingest FAILS on a surface that is unclean and
    #: undeclared, and equally on a declaration for a surface that measures
    #: clean, because a declaration that outlives its defect is how a real
    #: problem later gets waved through.
    open_surfaces: dict[str, str] = field(default_factory=dict)

    #: Source-specific hierarchy, where the source carries one.
    #:
    #: Given the unpacked cache directory, returns `(groups, of_element)`: the
    #: group names as `(name, parent name)` and the input file stem -> group
    #: name mapping. Grouping comes from the PACK and never from the engine, so
    #: whatever tree a source declares is the tree the viewer renders; a source
    #: with none produces a flat list, which is most of them.
    hierarchy: Callable[[Path], tuple[list[tuple[str, str | None]], dict[str, str]]] | None = None

    #: Why this source is KEPT, where the reason is not visible in the pack.
    #:
    #: Most packs need none: they are here because they are good, or because a
    #: comparison they lost has to stay reproducible. This exists for the case
    #: where every criterion a reader can SEE says delete it and the actual
    #: reason is somewhere else — a licence, a rights holder, a comparison the
    #: pack is not part of. Without the sentence someone deletes it later on
    #: quality grounds and is right to by everything in front of them.
    kept_because: str = ""

    #: Everything known to be wrong with this source, recorded in the pack
    #: rather than worked around. A model that looks bad should say so.
    known_problems: tuple[str, ...] = ()
    notes: list[str] = field(default_factory=list)


ZENODO_FILE = "https://zenodo.org/api/records/{record}/files/{name}/content"

#: The ten biventricular time steps, end-diastole to end-systole. Their md5s are
#: Zenodo's own published checksums, pinned and checked on every fetch.
_CARDIAC_MOTION_FILES = {
    "biV-032.vtk": ("2eb90ff2cef6452e43b072d657b089b0", 129770),
    "biV-062.vtk": ("b0e63e97bb66d7c125513bac5c29afcd", 129285),
    "biV-092.vtk": ("d404149b11cb3ff253b199ec5b026c76", 124623),
    "biV-122.vtk": ("5db250cc069ac9ee527a3674b4736f65", 123931),
    "biV-152.vtk": ("d19d4a5a00fc26c2eae4d1aed6a9532d", 120314),
    "biV-182.vtk": ("9a736d6d0e8d011587d8081cd2cba1ec", 116950),
    "biV-212.vtk": ("938e84062180e992e9303382f32ad18e", 104545),
    "biV-242.vtk": ("6a3979c688b5b9cd6484bd9e2c65a4a6", 104040),
    "biV-272.vtk": ("21001e8b7608e3fb70157057f8721515", 100414),
    "biV-302.vtk": ("71867439495825787afdb59b4193cebc", 98350),
}

CARDIAC_MOTION = GeometrySource(
    key="cardiac-motion",
    pack_id="motion-biv-cinemri",
    display_name="Cardiac Motion — biventricular surfaces from cine-MRI",
    anatomy="Biventricular surface, one adult subject, ten time steps",
    canonical_variant=(
        "Single unnamed subject; ten cine-MRI segmentations from end-diastole to "
        "end-systole, which is HALF a cardiac cycle"
    ),
    files=tuple(
        RemoteFile(
            url=ZENODO_FILE.format(record="10548682", name=name),
            name=name,
            md5=md5,
            size_bytes=size,
        )
        for name, (md5, size) in _CARDIAC_MOTION_FILES.items()
    ),
    members=tuple(_CARDIAC_MOTION_FILES),
    animated=True,
    # The deposit states no frame rate and no timing beyond the file names, so
    # inventing one would be inventing a heart rate. The pack carries a
    # normalised phase axis and the cine control plays it at a rate the LEARNER
    # chooses, which claims nothing the source did not say.
    fps=None,
    loop=False,
    vertex_correspondence=False,
    coverage="end-diastole to end-systole; half a cycle, not a whole one",
    structure_label="Biventricular surface (source carries no labels)",
    part_labels={},
    creator="Zemzemi, Nejib",
    source_text="Zenodo record 10548682, 'Cardiac Motion', ten biV-*.vtk time steps",
    source_url="https://zenodo.org/records/10548682",
    license="CC-BY-4.0",
    license_url="https://creativecommons.org/licenses/by/4.0/",
    license_state="confirmed",
    citation=(
        "Zemzemi, N. (2024). Cardiac Motion [Data set]. Zenodo. "
        "doi:10.5281/zenodo.10548682"
    ),
    license_quote=(
        'the Zenodo record 10548682 declares license id "cc-by-4.0" '
        "(Creative Commons Attribution 4.0 International), read from the deposit's own "
        "record on 2026-08-19"
    ),
    blood_pool_basis=(
        "One undivided epicardial surface per frame, with no labels of any kind. There is no "
        "lumen cast in this source to mark: a surface with no inside modelled cannot be a cast "
        "of one, and the pack's single structure is tissue by construction."
    ),
    kept_because=(
        "WHY THIS PACK IS KEPT, written down because every visible criterion says delete it. "
        "It loses to STRAUS on every technical axis: 10 frames against 30, no vertex "
        "correspondence against full correspondence, half a cycle against a whole one, and 11 "
        "connected components of segmentation debris against a clean surface. Anyone judging the "
        "two on quality would drop this one and be right to. "
        "The reason to keep it is the one thing that is not a quality question: it is CC BY 4.0, "
        "confirmed from the Zenodo record's own licence field, and STRAUS has NO LICENCE "
        "STATEMENT AT ITS SOURCE at all. That makes this the only moving asset in the repository "
        "that could ever ship. A worse model that may be published outranks a better one that may "
        "not, and until someone writes to the STRAUS depositors and gets an answer, deleting this "
        "leaves the project with no motion it is allowed to show."
    ),
    open_surfaces={
        "surface": (
            "Frame 0 is 11 connected components joined across 10 non-manifold edges and is not "
            "closed. This is genuine debris in an undocumented segmentation rather than a "
            "preprocessing artefact: welding changed neither the component count nor the edges. "
            "It is why this pack cuts badly, and it is the price of the only moving asset here "
            "whose licence is confirmed."
        ),
    },
    known_problems=(
        "NO VERTEX CORRESPONDENCE between frames: vertex counts differ (2268 in biV-032, "
        "1712 in biV-302), so frame N+1 is not a displacement of frame N. This is why the "
        "schema carries whole meshes rather than a deformation field, and it means no "
        "per-vertex quantity can be tracked through the motion.",
        "HALF A CYCLE ONLY: end-diastole to end-systole. There is no relaxation, so playback "
        "must bounce rather than loop; a looping playback would show the heart snapping open.",
        "NO LABELS: one undivided surface per frame, so nothing can be shown or hidden per "
        "chamber and there is no echo volume.",
        "UNDOCUMENTED SUPPLEMENTARY DATA of unverified quality. The deposit is a bare "
        "collection of segmentations with a two-sentence description, no subject metadata, "
        "no segmentation protocol and no accuracy statement. Kept because it MOVES.",
    ),
    notes=[
        "Fetched by checksum against Zenodo's published md5s; about 1.15 MB in total.",
    ],
)


BODYPARTS3D_LICENCE_QUOTE = (
    "the rights holder's own licence page, "
    "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html, read on 2026-08-19 and last "
    "updated there 2025/02/27, states: \"The license for this database is specified in the "
    "Creative Commons Attribution 4.0 International\", and grants explicitly that you may "
    "\"freely redistribute part or whole of the data from this database\" and \"freely create "
    "and distribute database and other derivative works based on part or whole of the data\", "
    "with the required attribution \"BodyParts3D, (c) The Database Center for Life Science "
    "licensed under CC Attribution 4.0 International\". "
    "CONTRADICTION, recorded rather than resolved: older mirrors of the same project state "
    "CC BY-SA 2.1 Japan. The reading taken here is the rights holder's CURRENT page, which is "
    "the more authoritative source and the more permissive grant; if that is wrong, this pack "
    "is a share-alike derivative and the licence state must be revisited. It is not published "
    "either way."
)

BODYPARTS3D = GeometrySource(
    key="bodyparts3d",
    pack_id="anatomy-bodyparts3d-heart",
    display_name="BodyParts3D heart — separately modelled valve leaflets and cusps",
    anatomy="Adult heart, 83 separately modelled parts",
    canonical_variant=(
        "Single adult Japanese male cadaver, the BodyParts3D whole-body reference model; "
        "the heart concept FMA7088 and its parts"
    ),
    files=(
        RemoteFile(
            url="https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/"
                "partof_BP3D_4.0_obj_99.zip",
            name="partof_BP3D_4.0_obj_99.zip",
            md5=None,
            size_bytes=64888505,
            unpack=True,
        ),
        RemoteFile(
            url="https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/"
                "partof_element_parts.txt",
            name="partof_element_parts.txt",
            md5=None,
            size_bytes=None,
        ),
    ),
    members=(),
    select=select_heart,
    animated=False,
    fps=None,
    loop=False,
    vertex_correspondence=False,
    coverage="",
    structure_label="",
    part_labels={},
    creator="The Database Center for Life Science (DBCLS), Research Organization of Information and Systems",
    source_text=(
        "BodyParts3D 4.0, partof_BP3D_4.0_obj_99.zip and partof_element_parts.txt, "
        "LSDB Archive"
    ),
    source_url="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html",
    license="CC-BY-4.0",
    license_url="https://creativecommons.org/licenses/by/4.0/",
    license_state="confirmed",
    citation=(
        "BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution "
        "4.0 International. Mitsuhashi N, Fujieda K, Tamura T, Kawamoto S, Takagi T, Okubo K. "
        "BodyParts3D: 3D structure database for anatomical concepts. Nucleic Acids Research "
        "37: D782-D785 (2009)."
    ),
    license_quote=BODYPARTS3D_LICENCE_QUOTE,
    # Every one of these is a closed solid (Euler characteristic 2) filling the
    # vessel or chamber outline: BodyParts3D models lumen as a CAST, not as a
    # tube with a wall. Verified per element — ascending aorta 21.5 mL,
    # pulmonary trunk 19.2 mL, superior vena cava 12.3 mL, the four chambers
    # 51.9 to 117.0 mL. Unmarked they cut as solid grey plugs, which is what
    # they are in the file and is not what a vessel is.
    #
    # The coronary and venous segments are casts too and are deliberately NOT
    # marked: their cut faces are millimetric, and as opaque grey tubes over
    # translucent chambers they are the most legible thing in this pack. That is
    # a judgement about legibility, not about anatomy, and it is recorded here
    # so it can be reversed in one line.
    blood_pool_match=(
        "cavity of", "ascending aorta", "pulmonary trunk", "superior vena cava",
    ),
    blood_pool_basis=(
        "BodyParts3D models lumen as SOLID CASTS and names them so: `cavity of left ventricle` "
        "is 97.9 mL of geometry, the ascending aorta 21.5 mL and the pulmonary trunk 19.2 mL, "
        "all with Euler characteristic 2 — closed solids rather than tubes. Everything else in "
        "the 86 is a wall, a leaflet, a papillary muscle or a coronary branch, and is tissue. "
        "The four patterns above are matched against the source's own labels and each must "
        "match something or the ingest fails."
    ),
    hierarchy=bodyparts3d_hierarchy,
    open_surfaces={
        "anterolateral-head-of-lateral-papillary-muscle-of-left-ventricle-myocardial-zone-12": (
            "Two closed shells rather than one. The source models this element as two "
            "disconnected watertight pieces; welding merges seams and cannot join surfaces "
            "that never touched, and joining them would be inventing a bridge."
        ),
        "right-anterior-cusp-of-pulmonary-valve": (
            "Two closed shells rather than one, in the source. Nothing is broken about either "
            "shell — both are watertight and manifold — but the cusp is not one connected "
            "piece and isolating it shows two."
        ),
        "septal-leaflet-of-tricuspid-valve": (
            "Two closed shells rather than one, in the source. See the note on the pulmonary "
            "cusp: the pieces are individually clean and are not joined."
        ),
    },
    known_problems=(
        "NO ECHO. The parts are separate surfaces with no labelled volume behind them, so this "
        "is an Explore-only pack like every other geometry-only source.",
        "SEMILUNAR CUSPS ARE COARSE. The aortic and pulmonary cusps are a few hundred "
        "triangles each and look faceted at any useful zoom. Not fixed here: smoothing them "
        "would be sculpting anatomy, which is a different task with a different licence "
        "consequence.",
        "NO VENTRICULAR MYOCARDIUM. The source's own concepts resolve `myocardium of left "
        "ventricle` to 12.1 mL over three elements — the anterolateral papillary head and two "
        "wall patches — against a 97.9 mL cavity, and `myocardium of right ventricle` to 7.7 mL "
        "against 117.0 mL. There is no interventricular septum concept at all. The ATRIAL walls "
        "are properly modelled at 40.5 and 27.6 mL. Checked across the whole atlas: every "
        "concept naming ventricular myocardium or wall resolves to elements already in this "
        "pack, so nothing was excluded. This pack cannot show wall thickness, hypertrophy or a "
        "septal defect, because it has no ventricular wall to show them in.",
        "ONE CADAVER, and an adult one. Nothing about this model is paediatric, and the "
        "leaflet geometry is a fixed post-mortem configuration, not a phase of a cardiac "
        "cycle: these leaflets neither open nor close.",
        "NAMES ARE DERIVED, not authored. Each part is named from the SMALLEST concept in "
        "the source's own partof_element_parts.txt that contains it. The eleven valve "
        "leaflets and cusps are additionally pinned by element id, and the ingest fails if "
        "the source stops listing any of them under its expected concept.",
        "THE ATRIOVENTRICULAR LEAFLETS ARE NOT THIN LEAFLETS. The source's concept map is "
        "many-to-many, and element FJ2432 is listed as the posterior mitral leaflet AND as "
        "the inferior wall of the left ventricle, the myocardium of that wall and myocardial "
        "zone 4. It measures 49 x 38 x 32 mm and carries 3,820 triangles, which is a wall "
        "segment rather than a leaflet; the anterior mitral element FJ2420 is 34 x 48 x 31 mm "
        "and likewise. Eight of the 86 parts have a tied smallest concept, and their labels "
        "carry both names rather than the pipeline picking one. The SEMILUNAR cusps are not "
        "ambiguous and are cusp-sized: 15-24 mm across, 316 to 1,370 triangles.",
        "The OBJs duplicate a vertex per adjacent face along their seams. Unwelded they look "
        "open — 1,826 boundary edges and 124 connected components on the right atrial wall — "
        "and they are not: welded, all 86 parts are watertight and manifold, and 83 of the 86 "
        "are a single connected component. The ingest welds exactly coincident vertices, which "
        "moves no surface. This is recorded because a reader measuring the raw OBJs will see "
        "the larger numbers. THREE parts really are two closed shells each and are declared "
        "individually in `open_surfaces`; an earlier reading of this pack said all 86 were "
        "single-component, and the per-structure measurement is what corrected it.",
        "NO GREAT VESSELS BEYOND THREE STUBS. BodyParts3D does not count the aorta or the "
        "pulmonary arteries as part of the heart, and their elements run 96-335 mm down the "
        "body. Only the ascending aorta, the pulmonary trunk and the superior vena cava are "
        "included, so the semilunar cusps have a vessel behind them; there is no arch, no "
        "descending aorta, no inferior vena cava and no pulmonary veins.",
    ),
    notes=[
        "The whole-body archive is about 62 MB and is never committed; only the heart's parts "
        "are derived into the pack.",
        "Fetched from the download page's own links; the direct path 302s.",
    ],
)


ZENODO_KIT = "https://zenodo.org/api/records/10526554/files/{name}/content"

KIT_FOUR_CHAMBER = GeometrySource(
    key="kit-four-chamber",
    pack_id="normal-kit-four-chamber",
    display_name="KIT four-chamber heart — chambers, epicardium and pericardium",
    anatomy="Normal adult heart, four chambers with a pericardial layer",
    canonical_variant=(
        "Single 33-year-old male volunteer; the surface set from the KIT/IBT "
        "four-chamber electromechanics model"
    ),
    files=(
        RemoteFile(
            url=ZENODO_KIT.format(name="Surfaces.zip"),
            name="Surfaces.zip",
            md5="c9fa25053693429ffe9f6d315f300a08",
            size_bytes=1468779,
            unpack=True,
        ),
        RemoteFile(
            url=ZENODO_KIT.format(name="LabelIDs.txt"),
            name="LabelIDs.txt",
            md5="9cf108dcd68fc97e76f51eaf86212a9a",
            size_bytes=1265,
        ),
        # The mechanics mesh. Fetched because it is the tagged volumetric half of
        # this deposit and the only path to a labelled echo volume from this
        # source — but NOT read into this pack: extracting its boundary would
        # produce one undivided envelope duplicating `epicard.stl`, and splitting
        # it by tag is `ingest.py`'s job and needs a derived frame this source
        # has not been given. `EP.vtu` is deliberately NOT fetched: 640 MB of
        # electrophysiology mesh with no use here.
        RemoteFile(
            url=ZENODO_KIT.format(name="M.vtu"),
            name="M.vtu",
            md5="d2c9a077ef355b985d6dcb3740eb493a",
            size_bytes=8722885,
        ),
    ),
    members=(
        "epicard.stl",
        "cavityLV.stl",
        "cavityRV.stl",
        "cavityLA.stl",
        "cavityRA.stl",
        "outerTrunks.stl",
        "outerPeri.stl",
    ),
    animated=False,
    fps=None,
    loop=False,
    vertex_correspondence=False,
    coverage="",
    structure_label="",
    part_labels={
        "epicard": "Epicardium",
        "cavityLV": "Left ventricular cavity",
        "cavityRV": "Right ventricular cavity",
        "cavityLA": "Left atrial cavity",
        "cavityRA": "Right atrial cavity",
        "outerTrunks": "Great-vessel trunks, outer surface",
        "outerPeri": "Pericardium, outer surface",
    },
    creator="Gerach, T., Schuler, S., Wachter, A., Loewe, A. (Institute of Biomedical Engineering, Karlsruhe Institute of Technology)",
    source_text=(
        "Zenodo record 10526554, 'Four-Chamber Human Heart Model for the Simulation of "
        "Cardiac Electrophysiology and Cardiac Mechanics', files Surfaces.zip, LabelIDs.txt "
        "and M.vtu"
    ),
    source_url="https://zenodo.org/records/10526554",
    license="CC-BY-NC-4.0",
    license_url="https://creativecommons.org/licenses/by-nc/4.0/",
    license_state="non_commercial",
    citation=(
        "Gerach T, Schuler S, Wachter A, Loewe A. Four-Chamber Human Heart Model for the "
        "Simulation of Cardiac Electrophysiology and Cardiac Mechanics [Data set]. Zenodo "
        "(2024). doi:10.5281/zenodo.10526554. Gerach T, Loewe A. Differential effects of "
        "mechano-electric feedback mechanisms on whole-heart activation, repolarization, and "
        "tension. The Journal of Physiology (2024). doi:10.1113/JP285022"
    ),
    license_quote=(
        'the Zenodo record 10526554 declares license id "cc-by-nc-4.0" (Creative Commons '
        "Attribution-NonCommercial 4.0 International), read from the deposit's own record on "
        "2026-08-19. NON-COMMERCIAL: this pack can never ship. An NC pack binds the whole "
        "application to the NC red lines, and that constraint is not accepted for the "
        "published build — the same position already taken on the Visible Heart Labs pack."
    ),
    blood_pool_match=("cavity",),
    blood_pool_basis=(
        "The KIT model is a cavity-and-shell decomposition and names its casts: the four "
        "chamber surfaces are blood-pool casts, and the epicardium, the great-vessel trunks "
        "and the pericardium are tissue or an interface. The `cavity` pattern is matched "
        "against the source's own labels and must match something or the ingest fails."
    ),
    open_surfaces={
        "great-vessel-trunks-outer-surface": (
            "`outerTrunks.stl` is a 164-triangle sketch of the great-vessel stumps, open at "
            "both ends and in 8 pieces with 96 boundary edges. It is the one unclean surface "
            "in an otherwise exemplary source, whose other six are watertight, manifold and "
            "single-component. Closing it would fabricate vessel ends the source never cut."
        ),
    },
    known_problems=(
        "PERMANENTLY UNPUBLISHABLE. Non-commercial, confirmed. Kept for looking at, nothing "
        "more.",
        "THE PERICARDIUM ENCLOSES EVERYTHING. `outerPeri.stl` is a 183 mm shell of only 1,522 "
        "triangles wrapped round the whole heart, so the default view of this pack is a "
        "coarse faceted bag with the anatomy inside it. Turning the cutter on opens it. There "
        "is no per-structure show/hide control yet, so nothing else does.",
        "CONTACT SURFACES EXCLUDED. `master.stl` and `slave.stl` are the mechanics solver's "
        "contact pair, not anatomy: both are coincident with the epicardium at coarser "
        "resolution (identical extents and centre, 14,848 and 1,522 triangles against the "
        "epicardium's 19,816), so including them would z-fight with the anatomy for no "
        "anatomical gain. Excluded, and recorded here rather than silently dropped.",
        "CAVITIES ONLY, NO WALL THICKNESS. The chambers are blood-pool casts and there is one "
        "epicardium; there is no per-chamber myocardium, so wall thickness is not derivable "
        "by pairing them — the same defect that lost the Alberta pack the wave 1a comparison.",
        "VALVES ARE PLANES IN THE VOLUMETRIC MESH, NOT SURFACES HERE. LabelIDs.txt names "
        "mitral, tricuspid, aortic and pulmonary valve labels, and vein and caval orifices — "
        "all of them tags in M.vtu, none of them separate files in Surfaces.zip. This pack "
        "therefore carries no valves at all.",
        "ONE 33-YEAR-OLD MALE VOLUNTEER. Adult, and a single subject.",
    ),
    notes=[
        "EP.vtu (640 MB) is deliberately not fetched.",
        "Surfaces.zip mixes ASCII and binary STL under identical headers; the reader decides "
        "by file size arithmetic rather than by the word 'solid'.",
    ],
)


#: One Girder item per file. Item ids rather than paths, because the Girder API
#: addresses content by id and a path-shaped URL does not exist. Recorded here
#: so the fetch is reproducible without re-querying the collection.
GIRDER_ITEM = (
    "https://humanheart-project.creatis.insa-lyon.fr/database/api/v1/item/{item}/download"
)

_STRAUS_FRAMES = (
    ("usmesh00.vtk", "587f5bbee1af3f30a298129e"),
    ("usmesh01.vtk", "587f5bc0e1af3f30a29812a1"),
    ("usmesh02.vtk", "587f5bc1e1af3f30a29812a4"),
    ("usmesh03.vtk", "587f5bc3e1af3f30a29812a7"),
    ("usmesh04.vtk", "587f5bc5e1af3f30a29812aa"),
    ("usmesh05.vtk", "587f5bc6e1af3f30a29812ad"),
    ("usmesh06.vtk", "587f5bc8e1af3f30a29812b0"),
    ("usmesh07.vtk", "587f5bcae1af3f30a29812b3"),
    ("usmesh08.vtk", "587f5bcce1af3f30a29812b6"),
    ("usmesh09.vtk", "587f5bcde1af3f30a29812b9"),
    ("usmesh10.vtk", "587f5bcfe1af3f30a29812bc"),
    ("usmesh11.vtk", "587f5bd1e1af3f30a29812bf"),
    ("usmesh12.vtk", "587f5bd3e1af3f30a29812c2"),
    ("usmesh13.vtk", "587f5bd4e1af3f30a29812c5"),
    ("usmesh14.vtk", "587f5bd6e1af3f30a29812c8"),
    ("usmesh15.vtk", "587f5bd8e1af3f30a29812cb"),
    ("usmesh16.vtk", "587f5bd9e1af3f30a29812ce"),
    ("usmesh17.vtk", "587f5bdbe1af3f30a29812d1"),
    ("usmesh18.vtk", "587f5bdde1af3f30a29812d4"),
    ("usmesh19.vtk", "587f5bdfe1af3f30a29812d7"),
    ("usmesh20.vtk", "587f5be0e1af3f30a29812da"),
    ("usmesh21.vtk", "587f5be2e1af3f30a29812dd"),
    ("usmesh22.vtk", "587f5be4e1af3f30a29812e0"),
    ("usmesh23.vtk", "587f5be6e1af3f30a29812e3"),
    ("usmesh24.vtk", "587f5be7e1af3f30a29812e6"),
    ("usmesh25.vtk", "587f5be9e1af3f30a29812e9"),
    ("usmesh26.vtk", "587f5bebe1af3f30a29812ec"),
    ("usmesh27.vtk", "587f5bece1af3f30a29812ef"),
    ("usmesh28.vtk", "587f5beee1af3f30a29812f2"),
    ("usmesh29.vtk", "587f5bf0e1af3f30a29812f5"),
)

STRAUS_US = GeometrySource(
    key="straus-us",
    pack_id="motion-straus-us-patient01",
    display_name="Multimodality STRAUS — simulated ultrasound myocardium, one healthy patient",
    anatomy="Biventricular myocardium, synthetic healthy subject, 30 time steps",
    canonical_variant=(
        "patient01_healthy from the STRAUS multi-modality simulation; the ULTRASOUND "
        "modality's mesh sequence, 30 frames covering one whole cardiac cycle"
    ),
    files=tuple(
        RemoteFile(
            url=GIRDER_ITEM.format(item=item),
            name=name,
            md5=None,
            size_bytes=1269033,
        )
        for name, item in _STRAUS_FRAMES
    ),
    members=tuple(name for name, _ in _STRAUS_FRAMES),
    animated=True,
    # The frames span one cycle and the source states no rate. A phase axis is
    # what an unstated rate supports; a heart rate would be invented.
    fps=None,
    loop=True,
    # The claim this source is here for, and it is CHECKED rather than trusted:
    # all 30 files are byte-for-byte the same length, 11,370 points and 47,186
    # tetrahedra each, in the same order. This is the only source in the
    # repository from which a deformation field could ever be derived.
    vertex_correspondence=True,
    coverage="one whole cardiac cycle, 30 frames, ends meeting",
    structure_label="Biventricular myocardium (source carries no per-chamber labels)",
    part_labels={},
    creator=(
        "Alessandrini, M., De Craene, M., Bernard, O., et al. "
        "(CREATIS, Universite de Lyon; Philips Research Paris; Inria Asclepios)"
    ),
    source_text=(
        "Multimodality STRAUS open-access database, Girder collection "
        "587de6f4e1af3f30a2980a58, folder patient01_healthy/us/mesh"
    ),
    source_url="https://humanheart-project.creatis.insa-lyon.fr/multimodalityStraus.html",
    # Not a placeholder: this IS the licence position, stated. "UNKNOWN" would
    # read as an unfilled field and `check:provenance` rejects it as one, which
    # is right — a blank standing in for a real grant is exactly what that gate
    # is for. What is true here is that the rights holder has said nothing.
    license="No licence stated at the source",
    license_url="https://humanheart-project.creatis.insa-lyon.fr/multimodalityStraus.html",
    license_state="unconfirmed",
    citation=(
        "Alessandrini M, De Craene M, Bernard O, Giffard-Roisin S, Allain P, Waechter-Stehle "
        "I, Weese J, Saloux E, Delingette H, Sermesant M, D'hooge J. A pipeline for the "
        "generation of realistic 3D synthetic echocardiographic sequences: methodology and "
        "open-access database. IEEE Transactions on Medical Imaging 34(7): 1436-1451 (2015)."
    ),
    license_quote=(
        "NO LICENCE STATEMENT EXISTS. The dataset page, the Girder collection description and "
        "the collection metadata were all read on 2026-08-19 and none of them names a licence. "
        "The only access statement anywhere is that the database is public and needs no login. "
        "That is permission to DOWNLOAD and says nothing about redistribution or derivative "
        "works, so the state is \"unconfirmed\" and the pack cannot be published. Resolving it "
        "means writing to the depositors."
    ),
    blood_pool_basis=(
        "A simulated-ultrasound myocardial volume exported as its boundary: one undivided "
        "tissue surface per frame, with the endocardium tucked inside the epicardium as part "
        "of the same shell. No cavity is modelled as an object, so there is no cast here to "
        "mark, and the pack's single structure is tissue."
    ),
    known_problems=(
        "SYNTHETIC, NOT A PATIENT. This is the mesh half of a simulation pipeline: an "
        "electromechanical model driving a physical ultrasound simulator. It is a plausible "
        "heart rather than a measured one, and its motion is the model's motion.",
        "NO LABELS AND NO PER-CHAMBER DIVISION. One myocardial volume per frame; the pack "
        "carries its boundary as a single unnamed structure.",
        "LICENCE UNCONFIRMED. Public access is not a grant. Nothing derived from this may be "
        "published until a depositor says otherwise.",
        "THE BOUNDARY IS BOTH SURFACES AT ONCE. Extracting the boundary of a myocardial "
        "volume yields the epicardium AND the endocardium as one closed shell, so the "
        "endocardial surface is inside the epicardial one and only the cutter reveals it.",
    ),
    notes=[
        "38 MB over 30 files, fetched one folder at a time through the Girder API. The full "
        "collection is 14.4 GB and is NOT fetched.",
        "No published checksums; what arrived is recorded in the cache ledger.",
    ],
)


#: The one patient this pack carries, of the ten in the deposit.
#:
#: Ten patients would be ten packs — a pack is one anatomy — and each is about
#: 4 MB derived, which is 40 MB of committed assets for material that does not
#: ship. One is enough to see what a repaired Tetralogy of Fallot ventricle
#: looks like; adding the rest is a one-line change here if the owner wants
#: them, and the raw archive is already cached.
COBIVECO_PATIENT = "CHD0017001"

COBIVECO_TOF = GeometrySource(
    key="cobiveco-tof",
    pack_id="tof-cobivecox-chd0017001",
    display_name="Tetralogy of Fallot — CobivecoX patient-specific biventricular surfaces",
    anatomy="Repaired Tetralogy of Fallot, biventricular, one patient",
    canonical_variant=(
        f"Patient {COBIVECO_PATIENT} of the ten patient-specific TOF meshes accompanying "
        "CobivecoX; endocardium, epicardium and four valve annuli"
    ),
    files=(
        RemoteFile(
            url=(
                "https://zenodo.org/api/records/10577973/files/"
                "CobivecoX_TOF_patient_specific_data.zip/content"
            ),
            name="CobivecoX_TOF_patient_specific_data.zip",
            md5="ab1ae7c161937c86a24930098d6e8fc6",
            size_bytes=195883497,
            unpack=True,
        ),
    ),
    members=tuple(
        f"{COBIVECO_PATIENT}_{part}.ply"
        for part in ("epi_no_base", "epi_base", "endo_lv", "endo_rv", "mv", "tv", "av", "pv")
    ),
    animated=False,
    fps=None,
    loop=False,
    vertex_correspondence=False,
    coverage="",
    structure_label="",
    part_labels={
        f"{COBIVECO_PATIENT}_epi_no_base": "Epicardium, excluding the base",
        f"{COBIVECO_PATIENT}_epi_base": "Epicardial base",
        f"{COBIVECO_PATIENT}_endo_lv": "Left ventricular endocardium",
        f"{COBIVECO_PATIENT}_endo_rv": "Right ventricular endocardium",
        f"{COBIVECO_PATIENT}_mv": "Mitral valve annulus",
        f"{COBIVECO_PATIENT}_tv": "Tricuspid valve annulus",
        f"{COBIVECO_PATIENT}_av": "Aortic valve annulus",
        f"{COBIVECO_PATIENT}_pv": "Pulmonary valve annulus",
    },
    creator=(
        "Pankewitz, L. R., Hustad, K. G., Govil, S., Perry, J. C., Hegde, S., Tang, R., "
        "McCulloch, A. D., Omens, J. H., Young, A. A., Maleckar, M. M., Wang, V. Y."
    ),
    source_text=(
        "Zenodo record 10577973, 'A universal biventricular coordinate system incorporating "
        "valve annuli: Validation in congenital heart', file "
        "CobivecoX_TOF_patient_specific_data.zip"
    ),
    source_url="https://zenodo.org/records/10577973",
    license="CC-BY-4.0",
    license_url="https://creativecommons.org/licenses/by/4.0/",
    license_state="confirmed",
    citation=(
        "Pankewitz LR, Hustad KG, Govil S, Perry JC, Hegde S, Tang R, McCulloch AD, Omens JH, "
        "Young AA, Maleckar MM, Wang VY. A universal biventricular coordinate system "
        "incorporating valve annuli: Validation in congenital heart disease [Data set]. "
        "Zenodo (2023). doi:10.5281/zenodo.10577973"
    ),
    license_quote=(
        'the Zenodo record 10577973 declares license id "cc-by-4.0" (Creative Commons '
        "Attribution 4.0 International), read from the deposit's own record on 2026-08-19."
    ),
    blood_pool_basis=(
        "Endocardial and epicardial SHELLS with the annuli as rings — the surfaces bound the "
        "cavity rather than filling it, so nothing in this source is a solid cast of the "
        "lumen. That is the opposite of BodyParts3D, and it is why the same viewer rule has "
        "to be told which one it is looking at rather than guessing from a shape."
    ),
    open_surfaces={
        slug: (
            "OPEN BY CONSTRUCTION, not by damage. " + why + " This is the honest exception the "
            "watertightness rule exists to accommodate: the surfaces are single-component and "
            "manifold, and closing them would invent a base plane or a leaflet the imaging "
            "atlas never contained."
        )
        for slug, why in {
            "epicardium-excluding-the-base":
                "The ventricles are truncated at the base, so the epicardium ends in a rim.",
            "epicardial-base":
                "The basal patch is the truncation itself, bounded by that same rim.",
            "left-ventricular-endocardium":
                "Truncated at the base with the cavity open upward.",
            "right-ventricular-endocardium":
                "Truncated at the base with the cavity open upward.",
            "mitral-valve-annulus": "An annulus is a ring; a ring has two boundaries.",
            "tricuspid-valve-annulus": "An annulus is a ring; a ring has two boundaries.",
            "aortic-valve-annulus": "An annulus is a ring; a ring has two boundaries.",
            "pulmonary-valve-annulus": "An annulus is a ring; a ring has two boundaries.",
        }.items()
    },
    known_problems=(
        "ONE PATIENT OF TEN. The deposit carries ten patient-specific TOF meshes and this "
        "pack carries one, because ten packs of about 4 MB each is 40 MB of committed assets "
        "for material that does not ship. The other nine are one registry line away.",
        "REPAIRED, AND THE REPAIR IS NOT DESCRIBED. These are post-operative Tetralogy of "
        "Fallot ventricles from an imaging atlas. Which repair, at what age, and with what "
        "residual lesion are not stated in the deposit, so nothing here should be read as "
        "showing a particular surgical result.",
        "ANNULI, NOT VALVES. The four valve surfaces are RINGS — 445 to 1,840 triangles "
        "each, the annulus plane the coordinate system is built on. There are no leaflets and "
        "nothing opens or closes.",
        "TWO EPICARDIAL PIECES. The source splits the epicardium into `epi_no_base` and "
        "`epi_base`, which meet at the valve plane. They are carried as two structures "
        "because that is what the source provides; together they are one surface.",
        "NO MYOCARDIAL VOLUME IN THIS PACK. The endocardial and epicardial surfaces are "
        "separate shells, so wall thickness is between them rather than in them. The "
        "deposit's `result.vtu` per patient is the tetrahedral volume with the CobivecoX "
        "coordinates on it; it is not fetched into the pack.",
        "NO ATRIA, NO GREAT VESSELS. Biventricular only.",
    ),
    notes=[
        "196 MB archive; the 10.4 GB atlas is NOT fetched.",
        "ASCII PLY throughout, written by meshio.",
        "The archive is macOS-built and carries AppleDouble sidecars, which the unpack drops.",
    ],
)

GEOMETRY_SOURCES = {
    s.key: s
    for s in (CARDIAC_MOTION, BODYPARTS3D, KIT_FOUR_CHAMBER, STRAUS_US, COBIVECO_TOF)
}
