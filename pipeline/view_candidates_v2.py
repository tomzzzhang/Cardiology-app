"""Generate Rodero candidate-set-002 with measured fan-envelope containment.

Candidate set 001 and every file in its derivation closure are immutable.  This
versioned generator imports that frozen implementation for its established
landmarks, planes, source bindings, and evidence vocabulary, then changes only
the aperture position and fan depth of four proposed candidate families,
including the existing Draft B1 reference pose after visual review found the
same lateral clipping there.

The correction is measured on the checksum-bound tetrahedral source.  For each
pose, the source is clipped exactly to the same +/-12 mm slab used by the
candidate depth gate.  The aperture moves backwards along the beam far enough
to satisfy BOTH a 30 mm provisional adult Rodero aperture-gap proxy and the
requirement that clipped geometry occupy at most 1 / 1.12 of either fan
half-width.  The 30 mm value is informed by published adult skin-to-heart
averages; it is not a chest-wall measurement, pediatric value, or clinical
acquisition standard.  Moving along the beam leaves the infinite imaging plane
and its clinical landmarks unchanged.  Depth is then expanded (never shrunk)
to leave 5 mm beyond the farthest clipped point, and focus moves by the same
axial distance so its world-space location is preserved to the schema's 0.01 cm
precision.

This module writes evidence only.  It has no pack-writing or review-promotion
path.
"""
from __future__ import annotations

import argparse
import copy
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

import numpy as np

import view_candidates as legacy


ROOT = Path(__file__).resolve().parent.parent
OUTPUT_REL = Path(
    "evidence/view-candidates/normal-rodero/pack-0.1.1/candidate-set-002.json"
)
OUTPUT_PATH = ROOT / OUTPUT_REL
CANDIDATE_SET_ID = "normal-rodero-pack-0.1.1-candidate-set-002"

# Set 001's closure stays frozen.  Set 002 adds this versioned derivation file.
DERIVATION_RELATIVE_FILES = (*legacy.DERIVATION_RELATIVE_FILES, "pipeline/view_candidates_v2.py")

# The existing candidate depth evidence uses this 24 mm measurement slab.
MEASUREMENT_SLAB_HALF_MM = 12.0

# Reuse the platform's established visible containment margin.  A limiting
# point occupies 1 / 1.12 = 89.286% of the local half-width, leaving a visible
# band rather than replacing clipping with exact tangency.
LATERAL_MARGIN_FACTOR = 1.12

# Provisional ADULT Rodero layout proxy, not a patient or chest-wall model.
# Rahko measured mean shortest skin-to-heart distances of 31.3 +/- 11.3 mm
# apical and 32.1 +/- 7.9 mm parasternal in 150 standing adults.  A round 30 mm
# lower bound is therefore a defensible review placement for this adult average
# heart, while remaining explicitly unsuitable as a pediatric or clinical
# default.  Requiring the whole tetrahedral source to be at least this far
# FORWARD of the aperture plane is slightly conservative relative to shortest
# Euclidean distance and remains exact under tetrahedral interpolation.
PROVISIONAL_ADULT_APERTURE_GAP_MM = 30.0
PROVISIONAL_PROXY_REFERENCE_PMID = "18187292"
PROVISIONAL_PROXY_REFERENCE_URL = "https://pubmed.ncbi.nlm.nih.gov/18187292/"
PROVISIONAL_PROXY_APICAL_MEAN_MM = 31.3
PROVISIONAL_PROXY_APICAL_SD_MM = 11.3
PROVISIONAL_PROXY_PARASTERNAL_MEAN_MM = 32.1
PROVISIONAL_PROXY_PARASTERNAL_SD_MM = 7.9
PROVISIONAL_PROXY_INPUT = (
    "30 mm provisional adult Rodero aperture-gap proxy "
    "(Rahko 2008, PMID 18187292)"
)
PROVISIONAL_PROXY_LIMITATION = (
    "The 30 mm forward aperture gap is a provisional adult Rodero layout proxy. The "
    "supporting cohort was standing adults and distance varied with BMI; this is not a "
    "measured chest wall, patient-specific distance, pediatric default, or clinical standard."
)

# Small, explicit distal band.  The previous 8% rule preserved the large blank
# region the visual review identified; 5 mm uses that room while keeping tissue
# clear of the far arc.
DISTAL_GUARD_MM = 5.0

# Probe focus is stored to 0.01 cm, so preserving a world point can differ by at
# most half of that increment (0.05 mm), plus a tiny numerical allowance.
FOCUS_WORLD_TOLERANCE_MM = 0.051

# Origins are serialized to nine decimal places, so an in-plane translation can
# acquire a sub-nanometre normal component when read back.  This tolerance is
# four orders of magnitude below the source resolution and still records the
# actual displacement in the check.
PLANE_PRESERVATION_TOLERANCE_MM = 1e-8

# One nanometre of model-space distance is physically negligible but comfortably
# larger than nine-decimal serialization error.  It keeps the imported JSON on
# the safe side of an exact <= envelope predicate instead of relying on a test
# tolerance at tangency.
SERIALIZATION_GUARD_MM = 1e-6

TETRA_EDGES = ((0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3))
DEFAULT_TETRA_CHUNK = 200_000


@dataclass(frozen=True)
class EnvelopeRequirement:
    """The measured minimum backward translation for one fixed pose."""

    shift_mm: float
    source_vertices_in_slab: int
    slab_edge_intersections: int
    tetrahedra_intersecting_slab: int


@dataclass(frozen=True)
class EnvelopeMeasurement:
    """Post-translation geometry used by the immutable machine checks."""

    farthest_mm: float
    maximum_abs_fan_angle_deg: float
    maximum_half_width_occupancy: float
    minimum_side_clearance_mm: float
    minimum_forward_projection_mm: float


@dataclass(frozen=True)
class FittedProbe:
    """A corrected probe and the measurements that justify it."""

    probe: dict[str, Any]
    original_probe: dict[str, Any]
    requirement: EnvelopeRequirement
    required_aperture_gap_shift_mm: float
    measurement: EnvelopeMeasurement
    minimum_source_forward_projection_mm: float
    applied_shift_mm: float
    required_depth_cm: float
    old_focus_world: np.ndarray
    new_focus_world: np.ndarray


def _ceil_hundredth_cm(value_mm: float) -> float:
    """Convert millimetres to centimetres, rounding upward to schema precision."""

    return math.ceil((value_mm / 10.0) * 100.0 - 1e-12) / 100.0


def _probe_frame(probe: dict[str, Any]) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, float]:
    origin = np.array(probe["origin"], dtype=float)
    beam = np.array(probe["beam_axis"], dtype=float)
    lateral = np.array(probe["lateral_axis"], dtype=float)
    normal = np.cross(beam, lateral)
    half_angle = math.radians(float(probe["fan"]["angle_deg"]) / 2.0)
    return origin, beam, lateral, normal, half_angle


def _coordinate_arrays(
    points: np.ndarray,
    probe: dict[str, Any],
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    origin, beam, lateral, normal, _half_angle = _probe_frame(probe)
    offsets = points - origin
    return offsets @ beam, offsets @ lateral, offsets @ normal


def measure_required_aperture_gap_shift(
    points: np.ndarray,
    probe: dict[str, Any],
    *,
    minimum_forward_mm: float = PROVISIONAL_ADULT_APERTURE_GAP_MM,
) -> float:
    """Return the beam retreat needed for the provisional forward gap.

    Forward projection is linear over a tetrahedron, so its minimum occurs at
    a source vertex.  Testing every checksum-bound source vertex therefore
    proves the same lower bound for the full tetrahedral volume without
    pretending that the heart-only source contains skin or a chest wall.
    """

    if not math.isfinite(minimum_forward_mm) or minimum_forward_mm <= 0.0:
        raise legacy.CandidateEvidenceError(
            "provisional aperture gap must be a positive finite distance"
        )
    forward, _lateral, _normal = _coordinate_arrays(points, probe)
    if forward.size == 0:
        raise legacy.CandidateEvidenceError("cannot measure aperture gap from an empty source")
    return max(0.0, minimum_forward_mm - float(np.min(forward)))


def _clipped_slab_coordinates(
    x: np.ndarray,
    y: np.ndarray,
    z: np.ndarray,
    tets: np.ndarray,
    *,
    half_mm: float = MEASUREMENT_SLAB_HALF_MM,
    chunk_size: int = DEFAULT_TETRA_CHUNK,
) -> Iterator[tuple[np.ndarray, np.ndarray, np.ndarray, bool]]:
    """Yield every vertex of the tetrahedral source clipped to a finite slab.

    The vertices of ``tetrahedron intersect slab`` are either original source
    vertices inside the slab or tetrahedron-edge intersections with one of the
    two slab boundary planes.  Evaluating the fan's linear side inequalities on
    exactly those points therefore proves containment of the whole clipped
    tetrahedral volume, including a tetrahedron that crosses the slab while all
    four of its original vertices lie outside it.

    The boolean identifies the first, original-vertex batch.  Edge vertices may
    repeat across adjacent tetrahedra; duplicates do not change an extremum and
    avoiding a global uniqueness pass keeps source replay small and deterministic.
    """

    inside = np.abs(z) <= half_mm
    if bool(inside.any()):
        yield x[inside], y[inside], z[inside], True

    for start in range(0, len(tets), chunk_size):
        chunk = tets[start : start + chunk_size]
        for left_index, right_index in TETRA_EDGES:
            left = chunk[:, left_index]
            right = chunk[:, right_index]
            z_left = z[left]
            z_right = z[right]
            denominator = z_right - z_left
            for boundary in (-half_mm, half_mm):
                crosses = (
                    ((z_left - boundary) * (z_right - boundary) <= 0.0)
                    & (denominator != 0.0)
                )
                if not bool(crosses.any()):
                    continue
                selected = np.flatnonzero(crosses)
                fraction = (
                    (boundary - z_left[selected]) / denominator[selected]
                )
                clipped_x = x[left[selected]] + fraction * (
                    x[right[selected]] - x[left[selected]]
                )
                clipped_y = y[left[selected]] + fraction * (
                    y[right[selected]] - y[left[selected]]
                )
                clipped_z = np.full_like(clipped_x, boundary)
                yield clipped_x, clipped_y, clipped_z, False


def measure_required_shift(
    points: np.ndarray,
    tets: np.ndarray,
    probe: dict[str, Any],
    *,
    slab_half_mm: float = MEASUREMENT_SLAB_HALF_MM,
    lateral_margin_factor: float = LATERAL_MARGIN_FACTOR,
) -> EnvelopeRequirement:
    """Return the exact beam-axis translation needed for side containment.

    For a clipped source point with axial coordinate ``x`` and lateral
    coordinate ``y``, translating the aperture backwards by ``d`` changes only
    the axial coordinate: ``x' = x + d``.  The visible-margin predicate is

        margin * abs(y) <= (x + d) * tan(half_angle)

    so every point supplies one lower bound on ``d`` and the maximum is the
    exact answer.
    """

    if not (lateral_margin_factor >= 1.0):
        raise legacy.CandidateEvidenceError("lateral margin factor must be at least 1")
    x, y, z = _coordinate_arrays(points, probe)
    _origin, _beam, _lateral, _normal, half_angle = _probe_frame(probe)
    tangent = math.tan(half_angle)
    if not (tangent > 0.0):
        raise legacy.CandidateEvidenceError("fan half-angle must have a positive tangent")

    maximum = -math.inf
    original_count = int(np.count_nonzero(np.abs(z) <= slab_half_mm))
    intersection_count = 0
    for clipped_x, clipped_y, _clipped_z, originals in _clipped_slab_coordinates(
        x, y, z, tets, half_mm=slab_half_mm
    ):
        required = lateral_margin_factor * np.abs(clipped_y) / tangent - clipped_x
        maximum = max(maximum, float(np.max(required)))
        if not originals:
            intersection_count += int(clipped_x.size)

    if not math.isfinite(maximum):
        raise legacy.CandidateEvidenceError("no checksum-bound source geometry intersects the slab")

    tetrahedra_intersecting = 0
    for start in range(0, len(tets), DEFAULT_TETRA_CHUNK):
        chunk = tets[start : start + DEFAULT_TETRA_CHUNK]
        elevations = z[chunk]
        tetrahedra_intersecting += int(np.count_nonzero(
            (np.min(elevations, axis=1) <= slab_half_mm)
            & (np.max(elevations, axis=1) >= -slab_half_mm)
        ))

    return EnvelopeRequirement(
        shift_mm=max(0.0, maximum),
        source_vertices_in_slab=original_count,
        slab_edge_intersections=intersection_count,
        tetrahedra_intersecting_slab=tetrahedra_intersecting,
    )


def measure_fitted_envelope(
    points: np.ndarray,
    tets: np.ndarray,
    probe: dict[str, Any],
    shift_mm: float,
    *,
    slab_half_mm: float = MEASUREMENT_SLAB_HALF_MM,
) -> EnvelopeMeasurement:
    """Measure fan occupancy and depth after a known backward translation."""

    x, y, z = _coordinate_arrays(points, probe)
    _origin, _beam, _lateral, _normal, half_angle = _probe_frame(probe)
    tangent = math.tan(half_angle)
    sine = math.sin(half_angle)
    cosine = math.cos(half_angle)

    farthest = 0.0
    maximum_angle = 0.0
    maximum_occupancy = 0.0
    minimum_clearance = math.inf
    minimum_forward = math.inf
    for clipped_x, clipped_y, clipped_z, _originals in _clipped_slab_coordinates(
        x, y, z, tets, half_mm=slab_half_mm
    ):
        forward = clipped_x + shift_mm
        lateral = np.abs(clipped_y)
        ranges = np.sqrt(forward * forward + lateral * lateral + clipped_z * clipped_z)
        angles = np.arctan2(lateral, forward)
        occupancy = np.divide(
            lateral,
            forward * tangent,
            out=np.full_like(lateral, math.inf),
            where=forward > 0.0,
        )
        clearance = forward * sine - lateral * cosine

        farthest = max(farthest, float(np.max(ranges)))
        maximum_angle = max(maximum_angle, float(np.max(angles)))
        maximum_occupancy = max(maximum_occupancy, float(np.max(occupancy)))
        minimum_clearance = min(minimum_clearance, float(np.min(clearance)))
        minimum_forward = min(minimum_forward, float(np.min(forward)))

    if not all(math.isfinite(value) for value in (
        farthest,
        maximum_angle,
        maximum_occupancy,
        minimum_clearance,
        minimum_forward,
    )):
        raise legacy.CandidateEvidenceError("non-finite fitted fan-envelope measurement")

    return EnvelopeMeasurement(
        farthest_mm=farthest,
        maximum_abs_fan_angle_deg=math.degrees(maximum_angle),
        maximum_half_width_occupancy=maximum_occupancy,
        minimum_side_clearance_mm=minimum_clearance,
        minimum_forward_projection_mm=minimum_forward,
    )


def fit_probe(
    points: np.ndarray,
    tets: np.ndarray,
    probe: dict[str, Any],
    *,
    applied_shift_mm: float | None = None,
    common_depth_cm: float | None = None,
    common_focus_cm: float | None = None,
) -> FittedProbe:
    """Translate one probe within its plane and expand only its local fan."""

    original = copy.deepcopy(probe)
    requirement = measure_required_shift(points, tets, original)
    required_aperture_gap_shift = measure_required_aperture_gap_shift(points, original)
    minimum_required_shift = max(requirement.shift_mm, required_aperture_gap_shift)
    shift = (
        minimum_required_shift + SERIALIZATION_GUARD_MM
        if applied_shift_mm is None
        else float(applied_shift_mm)
    )
    if shift + legacy.VECTOR_TOLERANCE < minimum_required_shift:
        raise legacy.CandidateEvidenceError(
            f"applied shift {shift:.6f} mm is below measured requirement "
            f"{minimum_required_shift:.6f} mm"
        )

    origin, beam, _lateral, _normal, _half_angle = _probe_frame(original)
    new_origin = origin - shift * beam
    fitted = copy.deepcopy(original)
    fitted["origin"] = legacy.vector_list(new_origin)

    # All evidence below is measured from the SERIALIZED pose, rather than the
    # higher-precision intermediate.  That closes the exact boundary the app
    # will import: nine-decimal origin rounding cannot turn a passing in-memory
    # pose into a subtly failing JSON pose.
    serialized_origin = np.array(fitted["origin"], dtype=float)
    beam_norm_squared = float(np.dot(beam, beam))
    actual_shift = float(np.dot(origin - serialized_origin, beam) / beam_norm_squared)
    measurement = measure_fitted_envelope(points, tets, fitted, 0.0)
    minimum_source_forward = float(np.min(_coordinate_arrays(points, fitted)[0]))
    required_depth_cm = _ceil_hundredth_cm(measurement.farthest_mm + DISTAL_GUARD_MM)
    old_depth_cm = float(original["fan"]["depth_cm"])
    depth_cm = max(old_depth_cm, required_depth_cm)
    if common_depth_cm is not None:
        depth_cm = float(common_depth_cm)
        if depth_cm + 1e-12 < max(old_depth_cm, required_depth_cm):
            raise legacy.CandidateEvidenceError("common depth is below a variant's measured need")

    focus_cm = round(float(original["fan"]["focus_cm"]) + actual_shift / 10.0, 2)
    if common_focus_cm is not None:
        focus_cm = float(common_focus_cm)
    if focus_cm > depth_cm:
        raise legacy.CandidateEvidenceError("preserved focus lies beyond fitted fan depth")

    fitted["fan"]["depth_cm"] = depth_cm
    fitted["fan"]["focus_cm"] = focus_cm

    old_focus_world = origin + beam * float(original["fan"]["focus_cm"]) * 10.0
    new_focus_world = serialized_origin + beam * focus_cm * 10.0
    return FittedProbe(
        probe=fitted,
        original_probe=original,
        requirement=requirement,
        required_aperture_gap_shift_mm=required_aperture_gap_shift,
        measurement=measurement,
        minimum_source_forward_projection_mm=minimum_source_forward,
        applied_shift_mm=actual_shift,
        required_depth_cm=required_depth_cm,
        old_focus_world=old_focus_world,
        new_focus_world=new_focus_world,
    )


def _fit_checks(candidate_id: str, fitted: FittedProbe) -> list[dict[str, Any]]:
    old_origin, old_beam, old_lateral, old_normal, half_angle = _probe_frame(
        fitted.original_probe
    )
    new_origin, new_beam, new_lateral, new_normal, _new_half_angle = _probe_frame(fitted.probe)
    allowed_occupancy = 1.0 / LATERAL_MARGIN_FACTOR
    allowed_angle_deg = math.degrees(math.atan(math.tan(half_angle) * allowed_occupancy))
    plane_displacement = float(np.dot(new_origin - old_origin, old_normal))
    focus_error = float(np.linalg.norm(fitted.new_focus_world - fitted.old_focus_world))
    depth_mm = float(fitted.probe["fan"]["depth_cm"]) * 10.0
    depth_margin = depth_mm - fitted.measurement.farthest_mm

    return [
        legacy.measurement_check(
            f"{candidate_id}.aperture-gap-proxy",
            (
                "every checksum-bound Rodero source point is at least 30 mm forward of "
                "the aperture plane under a provisional adult layout proxy"
            ),
            {
                "provisional_adult_aperture_gap_mm": PROVISIONAL_ADULT_APERTURE_GAP_MM,
                "minimum_source_forward_projection_mm": legacy.rounded(
                    fitted.minimum_source_forward_projection_mm, 6
                ),
                "measured_minimum_backward_shift_mm": legacy.rounded(
                    fitted.required_aperture_gap_shift_mm, 6
                ),
                "applied_backward_shift_mm": legacy.rounded(fitted.applied_shift_mm, 6),
                "adult_reference_pmid": PROVISIONAL_PROXY_REFERENCE_PMID,
                "adult_reference_url": PROVISIONAL_PROXY_REFERENCE_URL,
                "adult_reference_apical_mean_mm": PROVISIONAL_PROXY_APICAL_MEAN_MM,
                "adult_reference_apical_sd_mm": PROVISIONAL_PROXY_APICAL_SD_MM,
                "adult_reference_parasternal_mean_mm": (
                    PROVISIONAL_PROXY_PARASTERNAL_MEAN_MM
                ),
                "adult_reference_parasternal_sd_mm": PROVISIONAL_PROXY_PARASTERNAL_SD_MM,
                "proxy_scope": (
                    "adult Rodero visual-review layout only; source has no skin or chest wall"
                ),
            },
            (
                fitted.minimum_source_forward_projection_mm
                + legacy.VECTOR_TOLERANCE
                >= PROVISIONAL_ADULT_APERTURE_GAP_MM
                and fitted.applied_shift_mm + legacy.VECTOR_TOLERANCE
                >= fitted.required_aperture_gap_shift_mm
            ),
        ),
        legacy.measurement_check(
            f"{candidate_id}.fan-envelope",
            (
                "every checksum-bound tetrahedral source point in the clipped 24 mm slab "
                "occupies at most 1/1.12 of a fan half-width"
            ),
            {
                "measurement_slab_half_mm": MEASUREMENT_SLAB_HALF_MM,
                "source_vertices_in_slab": fitted.requirement.source_vertices_in_slab,
                "slab_edge_intersections": fitted.requirement.slab_edge_intersections,
                "tetrahedra_intersecting_slab": fitted.requirement.tetrahedra_intersecting_slab,
                "lateral_margin_factor": LATERAL_MARGIN_FACTOR,
                "allowed_maximum_half_width_occupancy": legacy.rounded(allowed_occupancy, 9),
                "maximum_half_width_occupancy": legacy.rounded(
                    fitted.measurement.maximum_half_width_occupancy, 9
                ),
                "allowed_maximum_abs_fan_angle_deg": legacy.rounded(allowed_angle_deg, 6),
                "maximum_abs_fan_angle_deg": legacy.rounded(
                    fitted.measurement.maximum_abs_fan_angle_deg, 6
                ),
                "minimum_side_clearance_mm": legacy.rounded(
                    fitted.measurement.minimum_side_clearance_mm, 6
                ),
                "minimum_forward_projection_mm": legacy.rounded(
                    fitted.measurement.minimum_forward_projection_mm, 6
                ),
                "measured_minimum_backward_shift_mm": legacy.rounded(
                    fitted.requirement.shift_mm, 6
                ),
                "applied_backward_shift_mm": legacy.rounded(fitted.applied_shift_mm, 6),
            },
            (
                fitted.measurement.maximum_half_width_occupancy
                <= allowed_occupancy + legacy.VECTOR_TOLERANCE
                and fitted.measurement.minimum_forward_projection_mm >= -legacy.VECTOR_TOLERANCE
                and fitted.applied_shift_mm + legacy.VECTOR_TOLERANCE
                >= fitted.requirement.shift_mm
            ),
        ),
        legacy.measurement_check(
            f"{candidate_id}.plane-preserved",
            "backward placement changes neither the imaging plane nor either probe axis",
            {
                "origin_normal_displacement_mm": legacy.rounded(plane_displacement, 9),
                "beam_max_abs_change": legacy.rounded(
                    float(np.max(np.abs(new_beam - old_beam))), 12
                ),
                "lateral_max_abs_change": legacy.rounded(
                    float(np.max(np.abs(new_lateral - old_lateral))), 12
                ),
                "normal_max_abs_change": legacy.rounded(
                    float(np.max(np.abs(new_normal - old_normal))), 12
                ),
            },
            (
                abs(plane_displacement) <= PLANE_PRESERVATION_TOLERANCE_MM
                and bool(np.array_equal(new_beam, old_beam))
                and bool(np.array_equal(new_lateral, old_lateral))
                and bool(np.array_equal(new_normal, old_normal))
            ),
        ),
        legacy.measurement_check(
            f"{candidate_id}.focus-preserved",
            "focus moves axially with the aperture so its world-space point is preserved",
            {
                "old_focus_cm": fitted.original_probe["fan"]["focus_cm"],
                "new_focus_cm": fitted.probe["fan"]["focus_cm"],
                "world_focus_error_mm": legacy.rounded(focus_error, 9),
                "rounding_tolerance_mm": FOCUS_WORLD_TOLERANCE_MM,
            },
            focus_error <= FOCUS_WORLD_TOLERANCE_MM,
        ),
        legacy.measurement_check(
            f"{candidate_id}.depth-guard",
            "fan depth never shrinks and clears the exact clipped source envelope by 5 mm",
            {
                "farthest_clipped_source_point_mm": legacy.rounded(
                    fitted.measurement.farthest_mm, 6
                ),
                "distal_guard_mm": DISTAL_GUARD_MM,
                "required_depth_cm": fitted.required_depth_cm,
                "old_depth_cm": fitted.original_probe["fan"]["depth_cm"],
                "fan_depth_cm": fitted.probe["fan"]["depth_cm"],
                "depth_margin_mm": legacy.rounded(depth_margin, 6),
            },
            (
                depth_margin + 1e-9 >= DISTAL_GUARD_MM
                and float(fitted.probe["fan"]["depth_cm"])
                >= float(fitted.original_probe["fan"]["depth_cm"])
            ),
        ),
    ]


def _standard_fitted_checks(
    candidate_id: str,
    fitted: FittedProbe,
    points: np.ndarray,
) -> list[dict[str, Any]]:
    return [
        *legacy.standard_pose_checks(candidate_id, fitted.probe, points),
        *_fit_checks(candidate_id, fitted),
    ]


def build_b1(inputs: legacy.Inputs) -> dict[str, Any]:
    """Propose a same-id layout correction for the existing Draft B1 pose."""

    source = next(
        record
        for record in legacy.existing_view_records(inputs)
        if record["source_view_id"] == "b1-apical-four-chamber"
    )
    candidate_id = "b1-apical-four-chamber-fan-envelope-candidate-002"
    fitted = fit_probe(inputs.points, inputs.mesh.tets, source["coordinates"]["probe"])
    sector = legacy.sector_from_probe(fitted.probe)
    checks = _standard_fitted_checks(candidate_id, fitted, inputs.points)
    checks.append(legacy.landmark_check(
        candidate_id,
        sector,
        {
            "apex": inputs.landmarks["apex"],
            "mitral_ring": inputs.landmarks["mitral_ring"],
            "tricuspid_ring": inputs.landmarks["tricuspid_ring"],
        },
    ))
    return {
        "kind": "single",
        "candidate_id": candidate_id,
        "intended_view_id": "b1-apical-four-chamber",
        "replaces_source_view_id": "b1-apical-four-chamber",
        "candidate_status": "draft",
        "derivation": {
            "method": "existing-b1-plane-fan-envelope-v2",
            "inputs": [
                "bound pack Draft B1 probe pose",
                "checksum-bound Rodero tetrahedral source",
                "apex and atrioventricular-ring landmarks",
                PROVISIONAL_PROXY_INPUT,
            ],
            "description": (
                "The pack-authored Draft B1 imaging plane and axes are preserved. "
                "The aperture is translated backwards within that exact plane by the greater "
                "of the retreat required for the 30 mm provisional adult Rodero aperture-gap "
                "proxy and the measured minimum that leaves the checksum-bound clipped source "
                "envelope inside 1/1.12 of each fan half-width; fan depth then leaves a 5 mm "
                "distal guard and focus follows the aperture axially."
            ),
        },
        "coordinates": {"probe": fitted.probe},
        "checks": checks,
        "limitations": [
            "This is a Draft layout correction to the fixed B1 reference pose, not clinical review.",
            "authoring-slots/v1 carries this fixed pose only; the pack-authored B1 sweep is unchanged.",
            PROVISIONAL_PROXY_LIMITATION,
        ],
    }


def build_b4(inputs: legacy.Inputs) -> dict[str, Any]:
    original = legacy.build_b4(inputs)
    candidate_id = "b4-apical-three-chamber-candidate-002"
    fitted = fit_probe(inputs.points, inputs.mesh.tets, original["coordinates"]["probe"])
    sector = legacy.sector_from_probe(fitted.probe)
    checks = _standard_fitted_checks(candidate_id, fitted, inputs.points)
    checks.append(legacy.landmark_check(
        candidate_id,
        sector,
        {
            "apex": inputs.landmarks["apex"],
            "mitral_ring": inputs.landmarks["mitral_ring"],
            "aortic_ring": inputs.landmarks["aortic_ring"],
        },
    ))
    result = copy.deepcopy(original)
    result["candidate_id"] = candidate_id
    result["coordinates"]["probe"] = fitted.probe
    result["checks"] = checks
    result["derivation"]["method"] = "measured-landmark-plane-fan-envelope-v2"
    result["derivation"]["inputs"].append(PROVISIONAL_PROXY_INPUT)
    result["derivation"]["description"] += (
        " The aperture is then translated backwards within that exact plane by the greater "
        "of the retreat required for the 30 mm provisional adult Rodero aperture-gap proxy "
        "and the measured minimum that leaves the checksum-bound clipped source envelope "
        "inside 1/1.12 of each fan half-width."
    )
    result["limitations"].append(PROVISIONAL_PROXY_LIMITATION)
    return result


def build_f1(inputs: legacy.Inputs) -> dict[str, Any]:
    original = legacy.build_f1(inputs)
    candidate_id = "f1-right-parasternal-bicaval-candidate-002"
    fitted = fit_probe(inputs.points, inputs.mesh.tets, original["coordinates"]["probe"])
    sector = legacy.sector_from_probe(fitted.probe)
    checks = _standard_fitted_checks(candidate_id, fitted, inputs.points)
    checks.append(legacy.landmark_check(
        candidate_id,
        sector,
        {
            "superior_vena_cava_centroid": inputs.landmarks["superior_vena_cava_centroid"],
            "inferior_vena_cava_centroid": inputs.landmarks["inferior_vena_cava_centroid"],
            "atrial_septum_interface_centroid": inputs.atrial_septum,
        },
    ))
    old_interface = next(
        check for check in original["checks"] if check["check_id"].endswith(".atrial-interface")
    )
    interface = copy.deepcopy(old_interface)
    interface["check_id"] = f"{candidate_id}.atrial-interface"
    checks.append(interface)

    result = copy.deepcopy(original)
    result["candidate_id"] = candidate_id
    result["coordinates"]["probe"] = fitted.probe
    result["checks"] = checks
    result["derivation"]["method"] = "measured-caval-septal-plane-fan-envelope-v2"
    result["derivation"]["inputs"].append(PROVISIONAL_PROXY_INPUT)
    result["derivation"]["description"] += (
        " The aperture is then translated backwards within that exact plane by the greater "
        "of the retreat required for the 30 mm provisional adult Rodero aperture-gap proxy "
        "and the measured minimum that leaves the checksum-bound clipped source envelope "
        "inside 1/1.12 of each fan half-width."
    )
    result["limitations"].append(PROVISIONAL_PROXY_LIMITATION)
    return result


def build_b2_series(inputs: legacy.Inputs) -> dict[str, Any]:
    original = legacy.build_b2_series(inputs)
    candidate_id = "b2-apical-five-chamber-series-002"

    requirements = [
        measure_required_shift(inputs.points, inputs.mesh.tets, variant["coordinates"]["probe"])
        for variant in original["variants"]
    ]
    aperture_gap_requirements = [
        measure_required_aperture_gap_shift(inputs.points, variant["coordinates"]["probe"])
        for variant in original["variants"]
    ]
    common_shift = (
        max(
            max(requirement.shift_mm for requirement in requirements),
            max(aperture_gap_requirements),
        )
        + SERIALIZATION_GUARD_MM
    )
    first_pass = [
        fit_probe(
            inputs.points,
            inputs.mesh.tets,
            variant["coordinates"]["probe"],
            applied_shift_mm=common_shift,
        )
        for variant in original["variants"]
    ]
    common_depth = max(
        max(
            float(fitted.original_probe["fan"]["depth_cm"]),
            fitted.required_depth_cm,
        )
        for fitted in first_pass
    )
    common_focus = round(
        float(original["variants"][0]["coordinates"]["probe"]["fan"]["focus_cm"])
        + common_shift / 10.0,
        2,
    )

    variants: list[dict[str, Any]] = []
    for old_variant in original["variants"]:
        angle = int(old_variant["source_parameter"]["derived_value"]["value"])
        variant_id = f"b2-anterior-{angle:02d}-deg-candidate-002"
        fitted = fit_probe(
            inputs.points,
            inputs.mesh.tets,
            old_variant["coordinates"]["probe"],
            applied_shift_mm=common_shift,
            common_depth_cm=common_depth,
            common_focus_cm=common_focus,
        )
        sector = legacy.sector_from_probe(fitted.probe)
        checks = _standard_fitted_checks(variant_id, fitted, inputs.points)
        checks.append(legacy.landmark_check(
            variant_id,
            sector,
            {
                "apex": inputs.landmarks["apex"],
                "aortic_ring": inputs.landmarks["aortic_ring"],
            },
        ))
        variant = copy.deepcopy(old_variant)
        variant["variant_id"] = variant_id
        variant["coordinates"]["probe"] = fitted.probe
        variant["checks"] = checks
        variants.append(variant)

    series_checks = copy.deepcopy(original["checks"])
    for check in series_checks:
        suffix = check["check_id"].split(".", 1)[1]
        check["check_id"] = f"{candidate_id}.{suffix}"
    series_checks.append(legacy.measurement_check(
        f"{candidate_id}.common-envelope-settings",
        (
            "all B2 comparison variants use one conservative fan/proxy shift, depth, and focus"
        ),
        {
            "variant_count": len(variants),
            "common_backward_shift_mm": legacy.rounded(common_shift, 6),
            "common_depth_cm": common_depth,
            "common_focus_cm": common_focus,
            "maximum_individual_required_shift_mm": legacy.rounded(
                max(requirement.shift_mm for requirement in requirements), 6
            ),
            "maximum_individual_required_aperture_gap_shift_mm": legacy.rounded(
                max(aperture_gap_requirements), 6
            ),
            "provisional_adult_aperture_gap_mm": PROVISIONAL_ADULT_APERTURE_GAP_MM,
        },
        (
            len({variant["coordinates"]["probe"]["fan"]["depth_cm"] for variant in variants}) == 1
            and len({variant["coordinates"]["probe"]["fan"]["focus_cm"] for variant in variants}) == 1
        ),
    ))

    result = copy.deepcopy(original)
    result["candidate_id"] = candidate_id
    result["variants"] = variants
    result["checks"] = series_checks
    result["derivation"]["method"] = "sample-existing-b1-anterior-sweep-fan-envelope-v2"
    result["derivation"]["inputs"].append(PROVISIONAL_PROXY_INPUT)
    result["derivation"]["description"] += (
        " Each fixed plane keeps its original beam and lateral axes while its aperture moves "
        "backwards along that beam by the one conservative shift required across the full "
        "series to satisfy both the 30 mm provisional adult Rodero aperture-gap proxy and "
        "fan-envelope containment; all variants share the resulting depth and focus."
    )
    result["limitations"].append(PROVISIONAL_PROXY_LIMITATION)
    return result


def derivation_file_records() -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    for relative in DERIVATION_RELATIVE_FILES:
        path = ROOT / relative
        legacy.require(path.is_file(), f"derivation input is missing: {relative}")
        records.append({"path": relative, "sha256": legacy.sha256_file(path)})
    return records


def global_checks(inputs: legacy.Inputs) -> list[dict[str, Any]]:
    checks = copy.deepcopy(legacy.global_checks(inputs))
    by_id = {check["check_id"]: check for check in checks}
    derivation = by_id["binding.derivation-files"]
    records = derivation_file_records()
    derivation["measurement"] = {
        "file_count": len(records),
        "sha256_by_path": {record["path"]: record["sha256"] for record in records},
    }
    no_promotion = by_id["policy.no-pack-promotion"]
    no_promotion["measurement"]["output_path"] = OUTPUT_REL.as_posix()
    return checks


def build_artifact() -> dict[str, Any]:
    inputs = legacy.load_inputs()
    frame_record = inputs.pack["meshes"]["anatomical_frame"]
    existing_views = [
        record
        for record in legacy.existing_view_records(inputs)
        if record["source_view_id"] != "b1-apical-four-chamber"
    ]
    artifact: dict[str, Any] = {
        "artifact_schema": "view-candidates/v1",
        "candidate_set_id": CANDIDATE_SET_ID,
        "status": "draft_evidence_only",
        "integrity": {
            "algorithm": "sha256",
            "scope": "canonical-json-with-integrity.canonical_payload_sha256-null",
            "canonical_payload_sha256": None,
        },
        "binding": {
            "source_pack_id": "normal-rodero",
            "source_pack_version": "0.1.1",
            "source_pack_schema_version": "0.1",
            "source_pack_path": legacy.PACK_REL.as_posix(),
            "source_pack_sha256": legacy.EXPECTED_PACK_SHA256,
            "source": {
                "path": legacy.SOURCE_REL.as_posix(),
                "sha256": legacy.EXPECTED_SOURCE_SHA256,
                "size_bytes": legacy.EXPECTED_SOURCE_SIZE,
                "archive_md5": legacy.EXPECTED_ARCHIVE_MD5,
                "source_url": "https://zenodo.org/records/4593738",
            },
            "pack_assets": [
                {"path": path, "sha256": digest}
                for path, digest in legacy.EXPECTED_ASSET_SHA256.items()
            ],
            "derivation_files": derivation_file_records(),
            "source_pack_revision": legacy.SOURCE_PACK_REVISION,
            "coordinate_frame": {
                "method": "cardiac-landmarks-v2",
                "basis_source_to_pack": copy.deepcopy(frame_record["basis_source_to_pack"]),
                "checks_passed": frame_record["checks_passed"],
                "checks_total": frame_record["checks_total"],
            },
        },
        "existing_views": existing_views,
        "candidates": [build_b1(inputs), build_b4(inputs), build_f1(inputs), build_b2_series(inputs)],
        "deferred": legacy.deferred_records(inputs),
        "unsupported": legacy.unsupported_records(),
        "non_promotion": {
            "effect_on_pack_review_status": "none",
            "may_write_pack": False,
            "may_promote_pack_review_status": False,
            "source_pack_review_status": "draft",
            "candidate_review_status": "draft",
            "generation_writes_only": OUTPUT_REL.as_posix(),
        },
        "checks": global_checks(inputs),
        "limitations": [
            "These are Draft coordinate proposals and machine-checked geometry evidence, not clinically validated views.",
            "Rodero is a static adult population-average CT-derived heart, not pediatric patient anatomy.",
            "The heart-only source does not establish chest-wall reachability, ultrasound physics, motion, Doppler, or artifacts.",
            "Fan-envelope containment is a technical layout guarantee over the clipped source slab, not evidence of a clinically correct acquisition.",
            PROVISIONAL_PROXY_LIMITATION,
            "No candidate or check in this file changes pack content or provenance.vetted status.",
        ],
    }
    artifact["integrity"]["canonical_payload_sha256"] = legacy.canonical_payload_sha256(artifact)
    return artifact


def write_artifact(expected: str) -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = expected.encode("utf-8")
    if OUTPUT_PATH.exists():
        if OUTPUT_PATH.read_bytes() == payload:
            return
        legacy.require(
            not legacy.git_tracks(OUTPUT_PATH),
            "refusing to overwrite an immutable tracked candidate set; bump the set id and path",
        )
    temporary = OUTPUT_PATH.with_suffix(OUTPUT_PATH.suffix + ".tmp")
    legacy.require(not temporary.exists(), f"refusing to overwrite stale temporary file {temporary}")
    temporary.write_bytes(payload)
    temporary.replace(OUTPUT_PATH)


def check_artifact(expected: str, artifact: dict[str, Any]) -> None:
    legacy.require(OUTPUT_PATH.is_file(), f"candidate evidence is missing: {OUTPUT_PATH}")
    actual = OUTPUT_PATH.read_bytes()
    legacy.require(actual == expected.encode("utf-8"), "candidate evidence is stale: create a new set")
    parsed = json.loads(actual.decode("utf-8"))
    legacy.require(
        parsed.get("integrity", {}).get("canonical_payload_sha256")
        == legacy.canonical_payload_sha256(parsed),
        "candidate evidence canonical payload digest is invalid",
    )
    legacy.require(parsed == artifact, "candidate evidence parsed content differs from generated content")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true", help="write only candidate-set-002 JSON")
    mode.add_argument("--check", action="store_true", help="fail unless candidate-set-002 is current")
    args = parser.parse_args()

    try:
        artifact = build_artifact()
        expected = legacy.serialize_artifact(artifact)
        if args.write:
            write_artifact(expected)
            action = "wrote"
        else:
            check_artifact(expected, artifact)
            action = "checked"
        legacy.verify_inputs_unchanged()
    except (legacy.CandidateEvidenceError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        print(f"view-candidates-v2: FAIL: {error}", file=sys.stderr)
        return 1

    print(
        f"view-candidates-v2: PASS: {action} {OUTPUT_REL.as_posix()} "
        f"({len(artifact['existing_views'])} existing, "
        f"{len(artifact['candidates'])} candidate entries, "
        f"{len(artifact['deferred'])} deferred, {len(artifact['unsupported'])} unsupported)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
