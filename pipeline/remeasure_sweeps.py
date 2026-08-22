"""
Remeasure `structures_in_order` for sweeps whose probe has moved.

## Why this step exists at all

`scripts/lib/authoringIngest.ts` clears a sweep's `structures_in_order` when it
replaces a probe pose, and it is right to. The list is a MEASUREMENT — walk the
sweep, and at each position record which labelled structures have geometry
inside the sector — so a list measured against the old pose describes a sweep
that no longer exists. Carrying it forward would be shipping a stale
measurement under a new pose, which is worse than shipping none.

But "none" is not the finished state either. The ingest says so itself, in the
provenance note it writes: *cleared pending remeasurement*. This is the
remeasurement.

## What it may and may not do

It re-runs `views.structures_in_order` against the pack's own shipped geometry
and the pack's own new pose. It decides nothing: not what a sweep is for, not
what a clinician would call out, not which structures matter. Those are the
canon's business and a vetter's, and this pipeline may not assert them —
`views.py` makes that argument at length and this module inherits it whole.

The views are NAMED on the command line, never inferred. Inference was tried and
is not safe: `ingest-reference-pose` also carries an ingest's cleared-ordering
marker from its own history, but its list is empty ON PURPOSE — its sweep is a
mechanical tilt for exercising the sweep path rather than a clinical sweep, and
`ingest.py` leaves it empty because naming what a sweep crosses is a clinical
reading. A rule that filled in every empty list would have manufactured a claim
out of a housekeeping pose.

A named view that has NOT had its ordering cleared by an ingest is refused
rather than measured, so this cannot become a way to author a list nobody
invalidated. A view that already carries a measurement is skipped.

`views.structures_in_order` returns an empty list when the ordering is vacuous —
every structure first reached at the same sample, so the order says something
about mesh size rather than about the sweep. That empty result is a real answer
and is written back as one.

## What it does not touch

Review status, poses, sweep axes, meshes, provenance beyond appending a sentence
that records this run. Nothing here promotes anything.
"""
from __future__ import annotations

import argparse
import collections
import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from meshlib import Surface, read_gltf_surfaces
from views import Sector, structures_in_order

REPO = Path(__file__).resolve().parent.parent

#: What `scripts/lib/authoringIngest.ts` writes when it invalidates an ordering.
#: Matching on it is what keeps this script to views an ingest actually cleared,
#: rather than every view that happens to be empty.
CLEARED_MARKER = "structures_in_order was cleared pending remeasurement"

#: Appended to a view's provenance note so the remeasurement is on the record
#: beside the clearing it answers.
REMEASURED_NOTE = (
    "structures_in_order was then REMEASURED against this pose by "
    "pipeline/remeasure_sweeps.py, walking the sweep and recording which labelled structures "
    "have geometry inside the sector. The list is a measurement, not a clinical reading of "
    "what the sweep is for."
)


@dataclass(frozen=True)
class LabelledStructure:
    """What `views.first_seen_samples` iterates: a slug and its surface."""

    slug: str
    surface: Surface


def load_structures(gltf: Path, identified: set[str]) -> list[LabelledStructure]:
    """
    The pack's own shipped geometry, grouped back into structures.

    From the glTF rather than from the source mesh, deliberately: this measures
    what the pack actually ships and therefore what the viewer actually draws.
    A measurement taken against a denser source would describe a sweep through
    geometry nobody sees.

    IDENTIFIED structures only, which is what `ingest.py` measured against when
    it produced the orderings this replaces. The unidentified `tagged-region-N`
    surfaces are real geometry the sweep really crosses, but a scrubber
    annotation reading "tagged region 19" names nothing a learner can use and
    claims more than the pack knows about that region. Including them would also
    change what the list MEANS between one revision and the next, which is worse
    than either choice on its own.
    """
    grouped: dict[str, list[Surface]] = collections.defaultdict(list)
    for surface, _material, _node in read_gltf_surfaces(gltf):
        slug = surface.name.rsplit("#", 1)[0]
        if slug not in identified:
            continue
        grouped[slug].append(surface)

    out: list[LabelledStructure] = []
    for slug, parts in grouped.items():
        vertices = np.vstack([np.asarray(p.vertices, dtype=np.float32) for p in parts])
        faces_blocks = []
        offset = 0
        for part in parts:
            faces_blocks.append(np.asarray(part.faces, dtype=np.int32) + offset)
            offset += len(part.vertices)
        out.append(LabelledStructure(
            slug=slug,
            surface=Surface(
                name=slug,
                vertices=np.ascontiguousarray(vertices, dtype=np.float32),
                faces=np.ascontiguousarray(np.vstack(faces_blocks), dtype=np.int32),
            ),
        ))
    return out


def sector_of(probe: dict) -> Sector:
    """
    The fan a probe images, in pack coordinates.

    `lateral` is re-orthogonalised against `beam` for the same reason
    `echo/probeFrame.ts` does it: the schema's orthogonality tolerance is 1e-3,
    and a basis that is only nearly orthogonal produces a sector that is only
    nearly planar. The viewer and this measurement must read the same fan.
    """
    origin = np.asarray(probe["origin"], dtype=np.float64)
    beam = np.asarray(probe["beam_axis"], dtype=np.float64)
    beam = beam / np.linalg.norm(beam)
    lateral = np.asarray(probe["lateral_axis"], dtype=np.float64)
    lateral = lateral - np.dot(lateral, beam) * beam
    lateral = lateral / np.linalg.norm(lateral)
    return Sector(
        origin=origin,
        beam=beam,
        lateral=lateral,
        half_angle=math.radians(float(probe["fan"]["angle_deg"]) / 2.0),
        depth_mm=float(probe["fan"]["depth_cm"]) * 10.0,
    )


def remeasure(
    pack: dict, structures: list[LabelledStructure], wanted: set[str],
) -> list[dict]:
    """Fill empty `structures_in_order` in place; report what changed."""
    changes: list[dict] = []
    for view in pack["views"]:
        sweep = view.get("sweep")
        if sweep is None:
            continue
        if view["view_id"] not in wanted:
            continue
        if sweep.get("structures_in_order"):
            continue  # already measured; not this script's business
        if CLEARED_MARKER not in view["provenance"]["modified"].get("note", ""):
            raise SystemExit(
                f"{view['view_id']}: asked to remeasure, but its provenance does not record "
                "an ingest clearing the ordering. Refusing: filling in a list that nobody "
                "invalidated would be inventing content rather than restoring it."
            )

        order = structures_in_order(structures, sector_of(view["probe"]), sweep)
        sweep["structures_in_order"] = order

        note = view["provenance"]["modified"].get("note", "")
        if REMEASURED_NOTE not in note:
            view["provenance"]["modified"]["note"] = f"{note} {REMEASURED_NOTE}".strip()
        changes.append({"view_id": view["view_id"], "structures_in_order": order})
    return changes


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--pack",
        type=Path,
        default=REPO / "public" / "packs" / "normal-rodero" / "pack.json",
    )
    parser.add_argument(
        "--views",
        nargs="+",
        required=True,
        help=(
            "view ids to remeasure. Explicit rather than inferred: several views are empty "
            "on purpose, and an ingest marker alone cannot tell those apart from the ones a "
            "pose change invalidated."
        ),
    )
    parser.add_argument("--write", action="store_true", help="replace the pack")
    args = parser.parse_args()

    pack = json.loads(args.pack.read_text())
    identified = {
        s["id"] for s in pack["meshes"]["structures"] if s.get("identified")
    }
    structures = load_structures(args.pack.parent / pack["meshes"]["gltf"], identified)
    changes = remeasure(pack, structures, set(args.views))

    if not changes:
        print("nothing to remeasure: every sweep already carries an ordering")
        return

    for change in changes:
        order = change["structures_in_order"]
        print(f"{change['view_id']}: {len(order)} structure(s)")
        for slug in order:
            print(f"    {slug}")
        if not order:
            print("    (empty: the ordering is vacuous and none is claimed)")

    if not args.write:
        print("\nPreview only. Re-run with --write to replace the pack.")
        return

    args.pack.write_text(json.dumps(pack, indent=2) + "\n")
    print(f"\nwrote {args.pack}")


if __name__ == "__main__":
    main()
