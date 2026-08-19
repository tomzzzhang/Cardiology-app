"""
Selecting the heart out of BodyParts3D, and naming its parts from the source.

BodyParts3D ships the whole body as ~1,250 separate OBJ files named by an opaque
element id (`FJ2420.obj`), plus `partof_element_parts.txt` — a concept-to-element
table that says which anatomical concept each file belongs to. One element
belongs to MANY concepts: the anterior mitral leaflet is part of the mitral
valve, the left ventricle, the left side of the heart, the heart, the thorax and
the human body, and the table lists every one of those.

So two questions have to be answered, and both are answered from the table
rather than by hand:

* **which files are the heart** — the elements listed under concept `FMA7088`,
  "heart", which is 83 of them, plus three single-element vessel stubs named in
  `EXTRA_CONCEPTS` and justified there;
* **what each one is called** — the MOST SPECIFIC concept that contains it,
  taken as the concept with the fewest elements. That is what turns `FJ2420.obj`
  into "anterior leaflet of mitral valve" rather than into "heart" repeated
  eighty-three times.

Naming by smallest containing concept is a rule, not a lookup table, so it
extends to every element without anyone reading anatomy off a filename.

It is also NOT sufficient on its own, and the reason is worth stating because it
is a fact about this source rather than about this code. Many elements belong to
several concepts that each contain exactly that one element, so "smallest" ties
and there is nothing in the table to break the tie with. `FJ2432` is listed
under "posterior leaflet of mitral valve" AND under "inferior wall of left
ventricle", "myocardium of left ventricle", "free wall of left ventricle" and
six more — ten single-element concepts for one mesh. The mapping is genuinely
many-to-many: one surface stands for every concept it is part of.

So the eleven valve elements are PINNED by id here, and the check the ingest
performs is the one that can actually be checked: that the source still lists
each pinned element under the concept this file names it for. Everything else
takes the smallest concept with an alphabetical tie-break — arbitrary but
deterministic, recorded rather than left to dictionary order — and the number of
elements whose name was ambiguous is reported into the pack.

"""
from __future__ import annotations

import collections
from pathlib import Path

#: The concept whose elements make up the heart.
HEART_CONCEPT = "FMA7088"

#: Three vessel stubs added to the heart, by concept, and the reason for each.
#:
#: BodyParts3D does not count the great vessels as part of the heart, so
#: `FMA7088` alone yields three aortic cusps and three pulmonary cusps floating
#: in space with no vessel behind them — which is close to unreadable. These
#: three concepts each contain exactly ONE element, so there is no ambiguity to
#: resolve, and each element stays inside the heart's own extent.
#:
#: The inferior vena cava and the aorta proper are deliberately NOT here. Their
#: elements run 96-144 mm and 171-335 mm respectively: they are the vessels
#: crossing the abdomen and the thorax, and including them would triple the
#: model bounds, which the camera framing and the unit inference are both
#: measured from. A pack framed on the descending aorta is not a pack of a heart.
EXTRA_CONCEPTS = {
    "FMA3736": "ascending aorta",
    "FMA8612": "pulmonary trunk",
    "FMA4720": "superior vena cava",
}

#: The element map, downloaded alongside the geometry.
ELEMENT_MAP = "partof_element_parts.txt"

#: Elements this pipeline has verified by id, so a silent change in the source's
#: numbering is caught rather than shipped. These are the valve leaflets and
#: cusps — the reason this source is worth having at all, since no other
#: available model carries them as separate meshes.
VERIFIED_ELEMENTS = {
    "FJ2420": "anterior leaflet of mitral valve",
    "FJ2432": "posterior leaflet of mitral valve",
    "FJ2421": "anterior leaflet of tricuspid valve",
    "FJ2433": "posterior leaflet of tricuspid valve",
    "FJ2436": "septal leaflet of tricuspid valve",
    "FJ2435": "anterior cusp of aortic valve",
    "FJ2431": "right posterior cusp of aortic valve",
    "FJ2426": "left posterior cusp of aortic valve",
    "FJ2417": "left anterior cusp of pulmonary valve",
    "FJ2434": "right anterior cusp of pulmonary valve",
    "FJ2427": "posterior cusp of pulmonary valve",
}


def read_element_map(path: Path) -> list[tuple[str, str, str]]:
    """`(concept id, concept name, element id)` rows, header dropped."""
    rows: list[tuple[str, str, str]] = []
    with path.open("r", errors="replace") as handle:
        next(handle, None)
        for line in handle:
            fields = line.rstrip("\n").split("\t")
            if len(fields) == 3:
                rows.append((fields[0], fields[1], fields[2]))
    if not rows:
        raise SystemExit(f"{path.name}: no element rows; the source format has changed")
    return rows


def concepts_by_element(rows: list[tuple[str, str, str]]) -> dict[str, set[str]]:
    """Element id -> every concept NAME the source lists it under."""
    concepts: dict[str, set[str]] = collections.defaultdict(set)
    for _, name, element in rows:
        concepts[element].add(name)
    return concepts


def smallest_concept_names(rows: list[tuple[str, str, str]]) -> dict[str, list[str]]:
    """
    Element id -> the names of the smallest concepts containing it, sorted.

    A list rather than one name, because ties are common and hiding them behind
    a pick would make an arbitrary choice look like a derivation.
    """
    elements_of: dict[str, set[str]] = collections.defaultdict(set)
    name_of: dict[str, str] = {}
    for concept, name, element in rows:
        elements_of[concept].add(element)
        name_of[concept] = name

    smallest: dict[str, int] = {}
    candidates: dict[str, set[str]] = collections.defaultdict(set)
    for concept, elements in elements_of.items():
        size = len(elements)
        for element in elements:
            if element not in smallest or size < smallest[element]:
                smallest[element] = size
                candidates[element] = {name_of[concept]}
            elif size == smallest[element]:
                candidates[element].add(name_of[concept])
    return {element: sorted(names) for element, names in candidates.items()}


def select_heart(cache_dir: Path) -> list[tuple[Path, str]]:
    """
    The heart's OBJ files and their names, in a stable order.

    Ordered by name rather than by element id, so the pack's structure list reads
    as anatomy rather than as an arbitrary numbering, and so the order does not
    move if the source renumbers.
    """
    maps = list(cache_dir.rglob(ELEMENT_MAP))
    if not maps:
        raise SystemExit(f"{ELEMENT_MAP} was not fetched into {cache_dir}")
    rows = read_element_map(maps[0])

    wanted = {HEART_CONCEPT, *EXTRA_CONCEPTS}
    heart = sorted({element for concept, _, element in rows if concept in wanted})
    if not heart:
        raise SystemExit(f"concept {HEART_CONCEPT} lists no elements; the source has changed")
    for concept, expected in EXTRA_CONCEPTS.items():
        elements = {element for cid, _, element in rows if cid == concept}
        if len(elements) != 1:
            raise SystemExit(
                f"{concept} ({expected}) now has {len(elements)} elements, not one; it was "
                "added on the basis of being a single compact stub and that no longer holds"
            )

    # The eleven valve elements are the whole reason this source is here. The
    # check is the one the table can actually support: the source must still
    # list each of them under the concept this module names it for. If that ever
    # stops being true the pack must fail rather than quietly ship eleven wrong
    # meshes under eleven right names.
    listed = concepts_by_element(rows)
    for element, expected in VERIFIED_ELEMENTS.items():
        if element not in heart:
            raise SystemExit(f"{element} ({expected}) is no longer part of {HEART_CONCEPT}")
        if expected not in listed.get(element, set()):
            raise SystemExit(
                f"{element} is no longer listed under {expected!r}; the source's concept map "
                "has changed and the valve labels cannot be trusted"
            )

    candidates = smallest_concept_names(rows)
    names = {element: display_label(element, candidates.get(element, [])) for element in heart}

    by_element = {path.stem: path for path in cache_dir.rglob("*.obj")}
    missing = [element for element in heart if element not in by_element]
    if missing:
        raise SystemExit(f"{len(missing)} heart element(s) have no OBJ file: {missing[:5]}")

    # Three separate meshes share the name "anterior cardiac venous tree". A
    # label that does not distinguish them makes three structures look like one
    # repeated, so the element id disambiguates — but only where it has to,
    # since carrying "FJ2420" on every label would be noise on the eighty that
    # are already unique.
    repeated = {name for name in names.values() if list(names.values()).count(name) > 1}
    for element, name in names.items():
        if name in repeated:
            names[element] = f"{name} ({element})"

    return sorted(
        ((by_element[element], names[element]) for element in heart),
        key=lambda pair: (pair[1], pair[0].stem),
    )


def display_label(element: str, candidates: list[str]) -> str:
    """
    One label for one mesh, carrying the ambiguity rather than hiding it.

    Where the source's smallest concepts tie, the label names two of them. That
    is not indecision: `FJ2432` really is listed as both the posterior mitral
    leaflet and the inferior wall of the left ventricle, and at 49 x 38 x 32 mm
    it is far too large to be a leaflet — so a label reading only "posterior
    leaflet of mitral valve" would be the pipeline asserting an anatomy the
    source does not support. Beyond two names the list is counted rather than
    printed; eight alternatives do not fit on a chip and the full set is in the
    pack's own provenance.
    """
    pinned = VERIFIED_ELEMENTS.get(element)
    ordered = ([pinned] + [name for name in candidates if name != pinned]) if pinned \
        else list(candidates)
    if not ordered:
        return element
    if len(ordered) == 1:
        return ordered[0]
    extra = f" +{len(ordered) - 2}" if len(ordered) > 2 else ""
    return f"{ordered[0]} / {ordered[1]}{extra}"


def ambiguous_names(cache_dir: Path) -> dict[str, list[str]]:
    """
    Heart elements whose smallest containing concept is not unique.

    Reported into the pack rather than smoothed over: a structure labelled
    "inferior wall of left ventricle" that the same table also calls the
    posterior mitral leaflet is a fact a reader needs, and it is invisible from
    the label alone.
    """
    rows = read_element_map(next(iter(cache_dir.rglob(ELEMENT_MAP))))
    wanted = {HEART_CONCEPT, *EXTRA_CONCEPTS}
    heart = {element for concept, _, element in rows if concept in wanted}
    candidates = smallest_concept_names(rows)
    return {
        element: candidates[element]
        for element in sorted(heart)
        if len(candidates.get(element, [])) > 1
    }
