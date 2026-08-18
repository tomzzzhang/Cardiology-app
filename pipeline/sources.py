"""
Source registry for the model ingest pipeline.

One entry per candidate anatomical substrate. Everything licence-bearing lives
here, so the pack's provenance block is generated from the same declaration that
drives acquisition — a source cannot be ingested without its attribution.

Raw sources are 20-190 MB and are NEVER committed. They are fetched into a
gitignored cache and verified by checksum before use (`fetch.py`).
"""
from __future__ import annotations

from dataclasses import dataclass, field


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
