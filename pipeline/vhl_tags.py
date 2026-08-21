"""
The tag vocabulary, extended past the six chambers to the vessel stubs.

`vhl_seed_partition.TAG_NAMES` covers tags 1-6, which is what a chamber
partition needs and no more. It is not enough here: a pulmonary vein is
continuous with the left atrium through a wide ostium, and a caval stub with the
right atrium through no valve at all, so both land inside their chamber's label
and inflate it. Neither calibre nor connectivity separates them - two attempts
are recorded in the log - and what does is a name.

The numbers are `anatomy.py`'s own, so anything tagged here can be handed to it
unchanged: 16 and 17 are the cavae, and 11-24 are the veins, stubs and appendage
that each border exactly one chamber. Using any other number would collide with
that convention silently, which is the trap the barrier tag 99 was chosen to
avoid.
"""
from __future__ import annotations

#: Tag -> (short name, normal range in mL for a 14-year-old, or None).
#: A vessel stub has no chamber volume to be in range of: how much of it the
#: specimen retains is a property of where it was trimmed, not of the donor.
TAGS: dict[int, tuple[str, tuple[int, int] | None]] = {
    1: ("LV", (60, 100)),
    2: ("RV", (60, 100)),
    3: ("LA", (25, 45)),
    4: ("RA", (25, 45)),
    5: ("Aorta", (15, 25)),
    6: ("PA", (15, 25)),
    11: ("pulm vein", None),
    16: ("SVC", None),
    17: ("IVC", None),
}

#: Tags that are a cardiac chamber or great vessel, in report order.
CHAMBERS = (1, 2, 3, 4, 5, 6)
#: Tags that are a vessel stub hanging off a chamber.
STUBS = (11, 16, 17)

NAMES = {tag: name for tag, (name, _range) in TAGS.items()}
EXPECTED = {tag: rng for tag, (_name, rng) in TAGS.items() if rng}

#: Which chamber each stub drains into, for checking a partition against anatomy.
DRAINS_INTO = {11: 3, 16: 4, 17: 4}
