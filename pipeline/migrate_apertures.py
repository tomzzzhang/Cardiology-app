"""
Move probe apertures back to the chest wall, now that there is one.

## What this corrects, and what it does not

The Rodero poses were authored against a heart-only mesh. There was no chest to
stand off from, so the stand-off was measured from the HEART and a 30 mm
"adult visual-layout proxy" stood in for a chest wall. That was the honest thing
to do with the evidence available, and it was recorded as a proxy.

There is a registered chest now. Measured against it, five of six apertures sit
INSIDE the body — B1 19.7 mm deep to the skin, B4 21.6 mm, C2 11.9 mm, F1
66.5 mm — because a stand-off from the epicardium is not a stand-off from a
chest. This slides the named apertures back along their own beams until they
reach the skin.

**The imaging plane is preserved exactly.** `beam_axis`, `lateral_axis` and the
fan angle are untouched, and the origin moves only along `-beam_axis`, so the
plane through the anatomy is the same plane — the transducer is where it should
have been all along, and it is looking down the same line. What changes is how
far away it stands, and therefore how deep it has to see.

`depth_cm` and `focus_cm` both grow by the retreat. The focus is a distance from
the aperture to a point in the anatomy; move the aperture back and that same
anatomical point is exactly that much further away. Growing only the depth would
quietly refocus the beam somewhere else.

## What it refuses to do

**F1 is not migrated, and this is why.** Its aperture is 66.5 mm inside the
thorax and reaching the skin needs a 73.7 mm retreat, which puts the required
depth at 22.19 cm — outside the range adult transthoracic imaging works in. A
number that large is not a stand-off error to be slid away; it says the
right-parasternal plane itself needs reauthoring against real anatomy. Sliding
it anyway would produce a pose that is geometrically consistent and clinically
useless, so this script names the views it moves and moves nothing else.

## What it does not touch

Review status stays `draft`. Positions being adopted as the working standard is
a decision about where the transducer goes; it is not a clinical review, and
only a review may change a review state.
"""
from __future__ import annotations

import argparse
import collections
import json
from pathlib import Path

import numpy as np
import trimesh

from bodyparts3d import read_element_map
from meshlib import read_obj
from remeasure_sweeps import CLEARED_MARKER, load_structures, remeasure

REPO = Path(__file__).resolve().parent.parent
CACHE = Path(__file__).resolve().parent / ".cache" / "bodyparts3d"
ARCHIVE_DIR = "partof_BP3D_4.0_obj_99"
SKIN_CONCEPT = "FMA7163"

#: Refuse a retreat larger than this. A stand-off correction is tens of
#: millimetres; anything approaching this size means the authored plane is wrong
#: rather than merely offset, and sliding it would hide that.
MAX_RETREAT_MM = 40.0


def skin_mesh(cache: Path) -> trimesh.Trimesh:
    rows = read_element_map(cache / "partof_element_parts.txt")
    by_concept: dict[str, set[str]] = collections.defaultdict(set)
    for concept, _name, element in rows:
        by_concept[concept].add(element)
    element = sorted(by_concept[SKIN_CONCEPT])[0]
    surface = read_obj(cache / ARCHIVE_DIR / f"{element}.obj")
    return trimesh.Trimesh(
        vertices=np.asarray(surface.vertices, dtype=np.float64),
        faces=np.asarray(surface.faces),
        process=False,
    )


def retreat_to_skin(skin: trimesh.Trimesh, origin: np.ndarray, beam: np.ndarray) -> float:
    """
    How far back along `-beam` the body surface is.

    The OUTERMOST crossing, not the nearest. BodyParts3D's skin is a thin closed
    shell rather than a solid — its own volume reads 3.4 L — so a ray leaving the
    body crosses it twice, once through the inner face and once through the
    outer. The outer one is the surface a transducer rests on; taking the nearest
    would leave the aperture buried inside the skin layer itself.
    """
    hits = skin.ray.intersects_location(
        ray_origins=origin[None, :], ray_directions=(-beam)[None, :],
    )[0]
    if len(hits) == 0:
        raise SystemExit(
            "no skin surface lies behind this aperture along -beam_axis, so there is no "
            "chest wall to migrate it to. Refusing rather than guessing a distance."
        )
    return float(np.linalg.norm(hits - origin, axis=1).max())


def migrate(pack: dict, skin: trimesh.Trimesh, rotation: np.ndarray,
            translation: np.ndarray, wanted: set[str]) -> list[dict]:
    changes: list[dict] = []
    for view in pack["views"]:
        if view["view_id"] not in wanted:
            continue
        probe = view["probe"]
        origin_model = np.asarray(probe["origin"], dtype=np.float64)
        beam_model = np.asarray(probe["beam_axis"], dtype=np.float64)
        beam_model = beam_model / np.linalg.norm(beam_model)

        origin_body = rotation @ origin_model + translation
        beam_body = rotation @ beam_model

        retreat = retreat_to_skin(skin, origin_body, beam_body)
        if retreat > MAX_RETREAT_MM:
            raise SystemExit(
                f"{view['view_id']}: reaching the skin needs a {retreat:.1f} mm retreat, over "
                f"the {MAX_RETREAT_MM:.0f} mm ceiling. A retreat this large means the authored "
                "plane is wrong rather than merely offset; reauthor it instead of sliding it."
            )

        # MODEL space, along the model-space beam. The transform is rigid and
        # unit-scale, so the distance measured in the body frame is the same
        # distance here — which is exactly why the registration refuses a scale.
        delta = -beam_model * retreat
        probe["origin"] = (origin_model + delta).tolist()
        probe["fan"]["depth_cm"] = round(float(probe["fan"]["depth_cm"]) + retreat / 10.0, 6)
        probe["fan"]["focus_cm"] = round(float(probe["fan"]["focus_cm"]) + retreat / 10.0, 6)

        sweep = view.get("sweep")
        if sweep is not None:
            # A TILT axis is a pivot line through the aperture, so it moves with
            # the aperture: the probe rocks about its own face, before and after.
            #
            # A TRANSLATE axis is a direction with no pivot — the probe slides
            # along it from wherever it now starts — so there is nothing to move
            # and moving something would change what the sweep does. C2 is the
            # translate case, which is why this is a branch and not an assumption.
            if "origin" in sweep["axis"]:
                axis_origin = np.asarray(sweep["axis"]["origin"], dtype=np.float64)
                sweep["axis"]["origin"] = (axis_origin + delta).tolist()
            sweep["structures_in_order"] = []

        view["placement_landmark"] = (
            f"{view['placement_landmark']} APERTURE MIGRATED to the chest wall of the registered "
            f"adult reference chest: moved {retreat:.1f} mm back along its own beam until it "
            "reached the skin. The imaging plane, beam and lateral axes are unchanged; depth and "
            "focus grew by the retreat."
        )
        note = view["provenance"]["modified"].get("note", "")
        view["provenance"]["modified"]["note"] = (
            f"{note} Aperture migrated {retreat:.1f} mm back along -beam_axis by "
            "pipeline/migrate_apertures.py to reach the skin of the registered BodyParts3D "
            "reference chest, which the heart-only authoring had no way to measure against. "
            "Plane preserved exactly; depth and focus grew by the retreat. Chest-wall positions "
            "are the working standard (owner decision, 2026-08-22) measured against a REFERENCE "
            "COMPOSITE - one adult male's chest around a population-average heart - not a "
            f"patient. Status remains Draft. {CLEARED_MARKER}."
        ).strip()

        changes.append({
            "view_id": view["view_id"],
            "retreat_mm": round(retreat, 3),
            "depth_cm": probe["fan"]["depth_cm"],
            "focus_cm": probe["fan"]["focus_cm"],
        })
    return changes


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--pack", type=Path,
        default=REPO / "public" / "packs" / "normal-rodero" / "pack.json",
    )
    parser.add_argument(
        "--context", type=Path,
        default=REPO / "public" / "body-context" / "adult-reference-chest-bp3d" / "context.json",
    )
    parser.add_argument("--views", nargs="+", required=True)
    parser.add_argument(
        "--pack-version",
        required=True,
        help=(
            "the next pack version. Required, not derived: these are model-space coordinates, "
            "and everything that binds to them — the body context, the candidate evidence, an "
            "authoring export — binds to a revision. Changing poses without saying so would "
            "leave those bindings pointing at content that silently moved."
        ),
    )
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    pack = json.loads(args.pack.read_text())
    context = json.loads(args.context.read_text())
    if context["pack_binding"]["pack_version"] != pack["meta"]["pack_version"]:
        raise SystemExit(
            "the body context is bound to pack "
            f"{context['pack_binding']['pack_version']} and the pack is "
            f"{pack['meta']['pack_version']}; rebind before migrating against it"
        )

    rotation = np.asarray(
        context["model_to_body"]["rotation_row_major"], dtype=np.float64,
    ).reshape(3, 3)
    translation = np.asarray(context["model_to_body"]["translation_mm"], dtype=np.float64)

    changes = migrate(pack, skin_mesh(CACHE), rotation, translation, set(args.views))
    if not changes:
        print("no named view needed migrating")
        return

    # The apertures moved, so the sweep orderings they produced are stale. Same
    # rule the authoring ingest follows, applied here for the same reason.
    identified = {s["id"] for s in pack["meshes"]["structures"] if s.get("identified")}
    structures = load_structures(args.pack.parent / pack["meshes"]["gltf"], identified)
    remeasured = remeasure(pack, structures, {c["view_id"] for c in changes})

    for change in changes:
        print(
            f"{change['view_id']:30s} back {change['retreat_mm']:6.1f} mm  "
            f"depth {change['depth_cm']:.2f} cm  focus {change['focus_cm']:.2f} cm"
        )
    for entry in remeasured:
        print(f"  {entry['view_id']}: {len(entry['structures_in_order'])} structure(s) remeasured")

    if args.pack_version == pack["meta"]["pack_version"]:
        raise SystemExit(
            f'next pack version "{args.pack_version}" equals the current version; '
            "moving poses requires an explicit version change"
        )
    pack["meta"]["pack_version"] = args.pack_version
    print(f"\npack version -> {args.pack_version}")

    if not args.write:
        print("Preview only. Re-run with --write to replace the pack.")
        return

    args.pack.write_text(json.dumps(pack, indent=2) + "\n")
    print(f"\nwrote {args.pack}")


if __name__ == "__main__":
    main()
