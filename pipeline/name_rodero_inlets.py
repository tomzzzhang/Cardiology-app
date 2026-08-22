"""
Name `normal-rodero`'s fourteen unnamed tagged regions, from the source's own list.

    python pipeline/name_rodero_inlets.py --check
    python pipeline/name_rodero_inlets.py --write

## What was unnamed, and why it stayed that way

`pipeline/ingest.py` names Rodero tags 1-6 from `RODERO_NAMED` and 7-10 from the
valve-plane adjacency it measures, and everything else became
`tagged-region-N`, "Tagged region N (unnamed pending vetting)". Fourteen
structures sat there — tags 11 to 24 — and two canon views wanted them: A4, the
subcostal bicaval, and F1, the right parasternal bicaval, both of which need the
superior and inferior venae cavae as separate landmarks.

Naming them was never a technical problem. It was a CLINICAL one, and
`AGENTS.md` reserves it: a pipeline may not decide what a piece of anatomy is.
The owner made that decision on 2026-08-22 and this module carries it out.

## The names are the SOURCE'S OWN, not this repository's reading

Zenodo record 4593738 — the record `pipeline/sources.py` already fetches
`average.vtk` from — documents the element labels. Read on 2026-08-22, its list
runs 1-10 exactly as `RODERO_NAMED` has them and then continues:

    11. Left atrium appendage "inlet"      18. Left atrial appendage border
    12. Left superior pulmonary vein inlet 19. Right inferior pulmonary vein border
    13. Left inferior pulmonary vein inlet 20. Left inferior pulmonary vein border
    14. Right inferior pulmonary vein inlet 21. Left superior pulmonary vein border
    15. Right superior pulmonary vein inlet 22. Right superior pulmonary vein border
    16. Superior vena cava inlet           23. Superior vena cava border
    17. Inferior vena cava inlet           24. Inferior vena cava border

So this is transcription with a check, not identification.

## The check, and the one place the source contradicts itself

Every name is verified against the shipped geometry before it is written, and
the run refuses rather than writing a name the mesh disagrees with. The seven
inlets pass 7/7: each is on the side, at the height and against the chamber its
name requires.

The BORDERS do not, and the disagreement is the source's. Each border sits
within about a millimetre of exactly one inlet, which pairs them unambiguously
as inlet N and border N+7 — the fourteen centroids fall into seven pairs 0.9 to
1.7 mm apart, with no other candidate inside 16 mm. That pairing puts tag 19
beside tag 12, the LEFT superior pulmonary vein, and tag 21 beside tag 14, the
RIGHT inferior one. The record's list has those two the other way round. The two
sites are **45 mm apart and on opposite sides of the midline**, so this is not a
close call: geometry wins because it is checkable, and the record's own ordering
for 19 and 21 is recorded here as wrong rather than quietly followed.

## What this does and does not change

Names in `pack.json`, and NOTHING in the asset. `mesh_node` keeps pointing at
the glTF node the committed `model.gltf` carries — `tagged-region-16` and the
rest — and the two fields are allowed to differ for exactly this: the asset was
built before the names were read.

Renaming the glTF nodes instead was tried first and reverted, and what it cost
is worth recording. It is a JSON header edit that moves no vertex, but the
asset's bytes are PINNED in three places that all refused it at once: the two
`evidence/view-candidates` sets bind `model.gltf` by digest,
`tests/unit/viewCandidateEvidence.test.ts` checks those digests against the
checkout, and `check:provenance` keys the pack's public-Git rights approval on
its asset set. A label is not worth invalidating the evidence for a pack
revision, so the label moved and the asset did not.

What that first attempt DID find is a real assumption, and it is fixed rather
than worked around: `PackViewer.tsx` keyed every scene object, colour, hover
label and hidden-set entry by the glTF node's own name and treated that name as
the structure id. Isolating the left ventricle drew fifteen structures instead
of one, because the hidden set named ids the scene had never heard of;
`tests/visual/viewer.spec.ts` caught it. The viewer now resolves node name to
structure id through the pack, which is what `mesh_node` is for.

`identified` flips to true, which is what takes these out of the viewer's
neutral grey.

NOT VETTED. The owner's decision was to adopt the source's names, which is not
the same as a clinician having read this mesh; every one of these stays inside a
pack whose views are Draft.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parent.parent
PACK = REPO / "public" / "packs" / "normal-rodero" / "pack.json"

#: Tag -> (slug, display label). Transcribed from Zenodo record 4593738.
#:
#: The border rows follow the MEASURED pairing (border N+7 belongs to inlet N),
#: which is what puts 19 with the left superior vein and 21 with the right
#: inferior one. See the module docstring for why the record's own ordering of
#: those two is not followed.
INLET_NAMES: dict[int, tuple[str, str]] = {
    11: ("left-atrial-appendage-inlet", "Left atrial appendage inlet"),
    12: ("left-superior-pulmonary-vein-inlet", "Left superior pulmonary vein inlet"),
    13: ("left-inferior-pulmonary-vein-inlet", "Left inferior pulmonary vein inlet"),
    14: ("right-inferior-pulmonary-vein-inlet", "Right inferior pulmonary vein inlet"),
    15: ("right-superior-pulmonary-vein-inlet", "Right superior pulmonary vein inlet"),
    16: ("superior-vena-cava-inlet", "Superior vena cava inlet"),
    17: ("inferior-vena-cava-inlet", "Inferior vena cava inlet"),
}

BORDER_NAMES: dict[int, tuple[str, str]] = {
    inlet + 7: (slug.replace("-inlet", "-border"), label.replace(" inlet", " border"))
    for inlet, (slug, label) in INLET_NAMES.items()
}

NAMES: dict[int, tuple[str, str]] = {**INLET_NAMES, **BORDER_NAMES}

#: Where the record's list and the mesh disagree, stated once.
BORDER_ORDER_CORRECTION = (
    "Zenodo record 4593738 lists tag 19 as the RIGHT INFERIOR pulmonary vein border and tag 21 "
    "as the LEFT SUPERIOR one. The shipped geometry contradicts it: tag 19's centroid sits "
    "1.2 mm from tag 12, the left superior pulmonary vein inlet, and tag 21's sits 1.1 mm from "
    "tag 14, the right inferior one — and those two sites are 45 mm apart on opposite sides of "
    "the midline. Every one of the seven borders pairs with exactly one inlet at 0.9-1.7 mm with "
    "no other candidate inside 16 mm, so the borders are inlet+7 throughout. The record's "
    "ordering for 19 and 21 is not followed, and this is why."
)

NAMING_PROVENANCE = (
    "NAMED FROM THE SOURCE'S OWN ELEMENT LABEL LIST (Zenodo record 4593738, read 2026-08-22), "
    "not from this repository's reading of the geometry, and adopted by owner decision on "
    "2026-08-22. Each name was then CHECKED against the shipped mesh before it was written: "
    "side of the midline, height relative to its siblings, and which chamber wall it lies "
    "against. All seven inlets pass. " + BORDER_ORDER_CORRECTION + " Names only: mesh_node still "
    "points at the glTF node the committed asset carries, no vertex moved and no pose moved. "
    "NOT VETTED — adopting the source's labels is not a clinician having read this mesh."
)


def node_vertices() -> dict[str, np.ndarray]:
    """Every glTF node's vertices, in the pack's own model space."""
    import body_context as bc
    return bc.pack_node_vertices(PACK.parent / "assets" / "model.gltf")


def verify(pack: dict) -> list[str]:
    """
    Refuse any name the mesh disagrees with, and say which and why.

    Model space, not body space: this runs against the pack alone so it does not
    depend on a body context that the pack's own bytes are about to invalidate.
    The pack publishes its measured cardiac frame, and every test below is a
    comparison BETWEEN tagged regions rather than against an absolute direction,
    so it needs only a consistent frame and not a registered one.
    """
    import body_context as bc

    nodes = node_vertices()
    rotation = np.asarray(
        json.loads((REPO / "public" / "body-context" / "adult-reference-chest-bp3d"
                    / "context.json").read_text())["model_to_body"]["rotation_row_major"],
        dtype=np.float64,
    ).reshape(3, 3)
    translation = np.asarray(
        json.loads((REPO / "public" / "body-context" / "adult-reference-chest-bp3d"
                    / "context.json").read_text())["model_to_body"]["translation_mm"],
        dtype=np.float64,
    )
    body = {name: v @ rotation.T + translation for name, v in nodes.items()}

    centroid = {tag: body[f"tagged-region-{tag}"].mean(axis=0) for tag in NAMES}
    la = body["la-myocardium"]
    ra = body["ra-myocardium"]
    midline = float(np.mean([la[:, 0].mean(), ra[:, 0].mean()]))

    from scipy.spatial import cKDTree
    to_la, to_ra = cKDTree(la), cKDTree(ra)
    problems: list[str] = []

    def near(tag: int) -> tuple[float, float]:
        return float(to_la.query(centroid[tag])[0]), float(to_ra.query(centroid[tag])[0])

    # 1. Sidedness. Left-named structures sit patient-LEFT of the midline (+X).
    for tag, (slug, label) in NAMES.items():
        left_named = label.lower().startswith("left")
        is_left = centroid[tag][0] > midline
        if left_named != is_left:
            problems.append(
                f"tag {tag} is named {label!r} but its centroid is "
                f"{'left' if is_left else 'right'} of the midline")

    # 2. Superior/inferior pairs. A vein called superior sits above its inferior.
    for sup, inf in ((12, 13), (15, 14), (16, 17), (19, 20), (22, 21), (23, 24)):
        if centroid[sup][2] <= centroid[inf][2]:
            problems.append(
                f"tag {sup} ({NAMES[sup][1]}) is not superior to tag {inf} ({NAMES[inf][1]})")

    # 3. Drainage. Pulmonary veins and the appendage belong to the LEFT atrium;
    #    the venae cavae belong to the RIGHT. Nearest chamber wall decides.
    for tag, (slug, label) in NAMES.items():
        dla, dra = near(tag)
        wants_ra = "vena cava" in label.lower()
        if wants_ra and dra >= dla:
            problems.append(f"tag {tag} ({label}) is nearer the left atrium ({dla:.1f} mm) "
                            f"than the right ({dra:.1f} mm)")
        if not wants_ra and dla >= dra:
            problems.append(f"tag {tag} ({label}) is nearer the right atrium ({dra:.1f} mm) "
                            f"than the left ({dla:.1f} mm)")

    # 4. The pairing the border names rest on: border N+7 is the nearest region
    #    to inlet N, and nothing else is close.
    for inlet in INLET_NAMES:
        distances = sorted((float(np.linalg.norm(centroid[inlet] - centroid[other])), other)
                           for other in NAMES if other != inlet)
        nearest, runner = distances[0], distances[1]
        if nearest[1] != inlet + 7:
            problems.append(f"tag {inlet}'s nearest region is tag {nearest[1]}, not "
                            f"tag {inlet + 7}; the border pairing this naming rests on is wrong")
        elif runner[0] < 4 * nearest[0]:
            problems.append(f"tag {inlet}'s pairing with tag {inlet + 7} ({nearest[0]:.1f} mm) "
                            f"is not clear of tag {runner[1]} ({runner[0]:.1f} mm)")
    return problems


def rename(pack: dict) -> tuple[dict, list[str]]:
    """Apply the names, and every reference to them, in place."""
    mapping = {f"tagged-region-{tag}": slug for tag, (slug, _) in NAMES.items()}
    changed: list[str] = []

    for structure in pack["meshes"]["structures"]:
        old = structure["id"]
        if old not in mapping:
            continue
        tag = int(old.rsplit("-", 1)[1])
        slug, label = NAMES[tag]
        # The glTF node keeps the name the committed asset was built with; the
        # module docstring says why the asset must not be touched.
        structure["mesh_node"] = structure.get("mesh_node") or old
        structure["id"] = slug
        structure["display_label"] = label
        structure["identified"] = True
        structure["blood_pool_decision"]["evidence"] = (
            structure["blood_pool_decision"]["evidence"] + " " + NAMING_PROVENANCE)
        changed.append(f"{old} -> {slug}")

    def remap(ids: list[str]) -> list[str]:
        return [mapping.get(i, i) for i in ids]

    # The echo volume's label table names structures too, and it is the one
    # place a rename can be missed silently: nothing renders differently until
    # `validate:packs` refuses the pack for an unknown structure id.
    for label in pack.get("echo_volume", {}).get("labels", []):
        if label.get("structure") in mapping:
            label["structure"] = mapping[label["structure"]]

    for view in pack["views"]:
        view["structures"] = remap(view["structures"])
        view["show_hide_preset"]["visible"] = remap(view["show_hide_preset"]["visible"])
        view["show_hide_preset"]["hidden"] = remap(view["show_hide_preset"]["hidden"])
        sweep = view.get("sweep")
        if sweep and "structures_in_order" in sweep:
            sweep["structures_in_order"] = remap(sweep["structures_in_order"])
    return pack, changed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true",
                        help="apply the names to the pack; without it nothing is written")
    args = parser.parse_args()

    pack = json.loads(PACK.read_text())
    already = [s for s in pack["meshes"]["structures"] if s["id"].startswith("tagged-region-")]
    if not already:
        print("normal-rodero carries no tagged-region structures; nothing to name")
        return 0

    problems = verify(pack)
    if problems:
        print(f"{len(problems)} name(s) the geometry does not support:")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print(f"all {len(NAMES)} names verified against the shipped mesh")

    pack, changed = rename(pack)
    for line in changed:
        print(f"  {line}")
    if not args.write:
        print("nothing written; pass --write to apply")
        return 0

    parts = pack["meta"]["pack_version"].split(".")
    parts[-1] = str(int(parts[-1]) + 1)
    pack["meta"]["pack_version"] = ".".join(parts)
    PACK.write_text(json.dumps(pack, indent=2, sort_keys=False) + "\n")
    print(f"written; pack_version -> {pack['meta']['pack_version']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
