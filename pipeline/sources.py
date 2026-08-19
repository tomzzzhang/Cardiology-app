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

from bodyparts3d import select_heart


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
    known_problems=(
        "NO ECHO. The parts are separate surfaces with no labelled volume behind them, so this "
        "is an Explore-only pack like every other geometry-only source.",
        "SEMILUNAR CUSPS ARE COARSE. The aortic and pulmonary cusps are a few hundred "
        "triangles each and look faceted at any useful zoom. Not fixed here: smoothing them "
        "would be sculpting anatomy, which is a different task with a different licence "
        "consequence.",
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
        "EVERY SURFACE IS OPEN. All 86 parts carry boundary edges — 8 on the right coronary "
        "trunk, 1,826 on the right atrial wall — and many split into dozens of connected "
        "components. Nothing is watertight, so the free cutter's stencil caps will speckle "
        "wherever a cut crosses an opening. No hole is filled: on a source like this, filling "
        "would fabricate the very surfaces a learner would be reading.",
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

GEOMETRY_SOURCES = {
    s.key: s for s in (CARDIAC_MOTION, BODYPARTS3D, KIT_FOUR_CHAMBER)
}
