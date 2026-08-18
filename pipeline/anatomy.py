"""
The anatomical frame, derived from the mesh rather than assumed.

`docs/build_plan.md` requires a pack to declare its orientation convention. The
first version of this pipeline satisfied that by measuring the superior axis
from the ventricular centroid to the aortic-wall centroid. That is a guess
dressed as a measurement, and it is wrong: in the frame it produces, the
inferior vena cava comes out SUPERIOR to the valve plane.

## What a heart-only mesh can and cannot tell you

It cannot tell you the patient's axes. Three defensible proxies for body
superior-inferior disagree badly on this mesh:

| proxy | superior axis (source coords) | verdict |
| --- | --- | --- |
| ventricular centroid -> aortic wall | `[-0.583, 0.040, 0.812]` | fails the IVC check |
| SVC centroid - IVC centroid | `[-0.043, -0.533, 0.845]` | 46 deg from the above |
| averaged caval disc normals | `[ 0.508, -0.098, 0.856]` | the two cavae disagree by 68 deg |

The cavae are truncated stubs — flat discs, not tubes (third singular value
0.16-0.31 of the first) — so neither their principal axes nor their normals
carry a reliable direction. A heart in isolation has no spine, no diaphragm and
no chest wall, and no amount of arithmetic recovers axes the geometry does not
contain. So this module does not claim them.

What the mesh CAN tell you, and tightly, is the **cardiac** frame:

* the apex, from the universal ventricular coordinates the source already ships
  (`Z = 0` on the left-ventricular myocardium), stable to 1.7 mm across a
  twenty-fold change in the sampling threshold;
* the base, from the four valve-ring centroids, which fit a common plane to
  within 5.8 mm;
* the long axis between them, 86.7 mm on this mesh, agreeing with the fitted
  base-plane normal to 6 degrees;
* left-right, from the left- and right-atrial centroids.

That is also the frame the content actually needs. Every plane in
`docs/view_canon.md` is defined against cardiac landmarks — the apical
four-chamber is the plane through the long axis and both atrioventricular
valves, the short axis is the plane perpendicular to it — not against the
patient's axes. The probe PLACEMENTS are described on the chest, but the
placements are prose for the learner; the geometry is cardiac.

## Reproducibility

`derive_cardiac_frame` returns the basis together with every input it measured
and the result of every check it ran, and the caller writes that record into the
pack. A reader with the pack alone can see which tags were used, what the
residuals were, and which checks passed — and re-run them.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from meshlib import TetMesh

#: Per-element tags of the four valve rings. Their centroids define the base.
VALVE_RING_TAGS = (7, 8, 9, 10)
#: Left- and right-atrial myocardium, for the left-right axis.
LA_TAG, RA_TAG = 3, 4
#: Left-ventricular myocardium, whose universal coordinates locate the apex.
LV_TAG, RV_TAG = 1, 2
#: Caval tags, used only as CHECKS on the derived frame, never as inputs.
SVC_TAG, IVC_TAG = 16, 17

#: Fraction of left-ventricular points, lowest apicobasal coordinate first,
#: averaged to locate the apex. One percent is ~1700 points here: enough to be
#: insensitive to a single stray element, few enough to stay at the apex.
APEX_PERCENTILE = 1.0

#: Universal-coordinate values outside [0, 1] are the source's "not applicable"
#: sentinel (it writes -10), carried by every point with no ventricular
#: coordinate. Including them would drag the apex toward the atria.
UVC_SENTINEL_FLOOR = -1.0


@dataclass
class CardiacFrame:
    """A measured cardiac basis, plus everything needed to check it."""

    #: Rows map source coordinates onto (x = patient-left, y = base, z = anterior).
    rotation: np.ndarray
    apex: np.ndarray
    base: np.ndarray
    long_axis_mm: float
    ring_centroids: dict[int, np.ndarray]
    base_plane_residuals_mm: list[float]
    base_normal_vs_long_axis_deg: float
    checks: dict[str, bool] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return all(self.checks.values())


def _unit(vector: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vector))
    if norm == 0.0:
        raise ValueError("cannot normalise a zero-length vector")
    return vector / norm


def _tag_points(mesh: TetMesh, tag: int) -> np.ndarray:
    selector = mesh.tags == tag
    if not selector.any():
        raise ValueError(f"mesh carries no elements tagged {tag}")
    return mesh.points[np.unique(mesh.tets[selector])]


def _centroid(mesh: TetMesh, tag: int) -> np.ndarray:
    return _tag_points(mesh, tag).mean(axis=0)


def apex_from_uvc(mesh: TetMesh) -> np.ndarray:
    """
    The left-ventricular apex, from the source's own apicobasal coordinate.

    `Z` runs 0 at the apex to 1 at the base over the ventricular myocardium.
    Taking the mean of the lowest percentile is far more robust than taking the
    single most-apical vertex, which is one decimation artefact away from moving
    several millimetres.
    """
    apicobasal = mesh.uvc("Z")
    points = np.unique(mesh.tets[mesh.tags == LV_TAG])
    valid = points[apicobasal[points] >= UVC_SENTINEL_FLOOR]
    if valid.size == 0:
        raise ValueError("no left-ventricular point carries a usable apicobasal coordinate")
    threshold = np.percentile(apicobasal[valid], APEX_PERCENTILE)
    return mesh.points[valid[apicobasal[valid] <= threshold]].mean(axis=0)


def derive_cardiac_frame(mesh: TetMesh) -> CardiacFrame:
    """
    Measure the cardiac basis, then check it against anatomy it did not use.

    The construction is one strong primary axis, one strong secondary, and a
    third that is forced:

    * **primary** `L`, apex to base. Both ends are measured from different
      evidence — the apex from the universal coordinates, the base from the
      valve rings — so their agreement with the independently fitted base-plane
      normal is a real corroboration rather than an identity.
    * **secondary** `R`, right atrium to left atrium, orthogonalised against
      `L`. The atria sit side by side, which makes this the cleanest left-right
      evidence in the mesh.
    * **third** `A = R x L`, which completes a right-handed basis.

    Every check below uses structures that are NOT inputs to the construction,
    or relations that orthogonalisation cannot force. `LA left of RA` is
    deliberately absent: it is true by construction and would only flatter the
    result.
    """
    rings = {tag: _centroid(mesh, tag) for tag in VALVE_RING_TAGS}
    base = np.mean(list(rings.values()), axis=0)
    apex = apex_from_uvc(mesh)

    long_axis = _unit(base - apex)
    left_raw = _centroid(mesh, LA_TAG) - _centroid(mesh, RA_TAG)
    left = _unit(left_raw - np.dot(left_raw, long_axis) * long_axis)
    anterior = np.cross(left, long_axis)

    rotation = np.vstack([left, long_axis, anterior])
    if float(np.linalg.det(rotation)) < 0:
        raise ValueError("derived cardiac frame is left-handed")

    # Independent fit of the base plane through the four ring centroids. Its
    # normal is a second, unrelated construction of "which way is basal", so the
    # angle between it and the long axis measures whether the two agree.
    stacked = np.array(list(rings.values())) - base
    base_normal = np.linalg.svd(stacked)[2][2]
    if np.dot(base_normal, base - apex) < 0:
        base_normal = -base_normal

    def framed(point: np.ndarray) -> np.ndarray:
        return rotation @ point

    apex_f, base_f = framed(apex), framed(base)
    lv, rv = framed(_centroid(mesh, LV_TAG)), framed(_centroid(mesh, RV_TAG))
    la, ra = framed(_centroid(mesh, LA_TAG)), framed(_centroid(mesh, RA_TAG))
    svc, ivc = framed(_centroid(mesh, SVC_TAG)), framed(_centroid(mesh, IVC_TAG))
    checks = {
        # Sign of the anterior axis. The pulmonary valve is the most anterior of
        # the four, and nothing in the construction knows that.
        "pulmonary valve anterior to aortic valve":
            framed(rings[10])[2] > framed(rings[9])[2],
        # Sign of the left axis, from valves rather than from the atria that set it.
        "mitral valve left of tricuspid valve":
            framed(rings[7])[0] > framed(rings[8])[0],
        "left ventricle left of right ventricle": lv[0] > rv[0],
        "aortic valve right of mitral valve":
            framed(rings[9])[0] < framed(rings[7])[0],
        # Sign of the long axis: the atria are basal to their ventricles.
        "left atrium basal to left ventricle": la[1] > lv[1],
        "right atrium basal to right ventricle": ra[1] > rv[1],
        # The cavae are never inputs. The SVC joins the right atrium above the
        # valve plane and the IVC enters behind the SVC; both are free checks.
        "superior vena cava basal to the valve plane": svc[1] > base_f[1],
        "inferior vena cava posterior to superior vena cava": ivc[2] < svc[2],
        "apex apical to every valve ring":
            all(apex_f[1] < framed(centroid)[1] for centroid in rings.values()),
    }

    frame = CardiacFrame(
        rotation=rotation,
        apex=apex,
        base=base,
        long_axis_mm=float(np.linalg.norm(base - apex)),
        ring_centroids=rings,
        base_plane_residuals_mm=[float(value) for value in stacked @ base_normal],
        base_normal_vs_long_axis_deg=float(
            np.degrees(np.arccos(np.clip(np.dot(base_normal, long_axis), -1.0, 1.0)))
        ),
        checks=checks,
    )

    if not frame.ok:
        failed = [name for name, passed in checks.items() if not passed]
        frame.notes.append("FRAME CHECKS FAILED: " + "; ".join(failed))
    return frame


def frame_record(frame: CardiacFrame) -> dict:
    """
    The derivation, as it is written into the pack.

    This exists so the basis is checkable by someone holding only the pack: it
    names the tags used, the landmark positions measured, the residuals, and the
    outcome of every check, in the SOURCE coordinates the measurements were made
    in. A basis with no record is indistinguishable from a hand-tuned one.
    """
    return {
        "method": "cardiac-landmarks-v1",
        "description": (
            "Cardiac basis measured from the mesh. Primary axis: left-ventricular apex to the "
            "centroid of the four valve-ring centroids, the apex located from the source's "
            "universal ventricular coordinate Z. Secondary axis: right-atrial to left-atrial "
            "myocardium centroid, orthogonalised against the primary. Third axis completes a "
            "right-handed basis. Axes are CARDIAC, not the patient's: a heart-only mesh carries "
            "no spine, diaphragm or chest wall, and the three defensible proxies for body "
            "superior-inferior disagree by up to 46 degrees on this mesh, so no body frame is "
            "claimed. See pipeline/anatomy.py."
        ),
        "inputs": {
            "apex": {
                "source": "universal ventricular coordinate Z on left-ventricular myocardium",
                "tag": LV_TAG,
                "percentile": APEX_PERCENTILE,
            },
            "base": {"source": "mean of the valve-ring centroids", "tags": list(VALVE_RING_TAGS)},
            "left_right": {"source": "right-atrial to left-atrial centroid", "tags": [RA_TAG, LA_TAG]},
        },
        "landmarks_source_mm": {
            "apex": [float(v) for v in frame.apex],
            "base": [float(v) for v in frame.base],
            "valve_rings": {
                str(tag): [float(v) for v in centroid]
                for tag, centroid in frame.ring_centroids.items()
            },
        },
        "basis_source_to_pack": {
            "patient_left": [float(v) for v in frame.rotation[0]],
            "basal": [float(v) for v in frame.rotation[1]],
            "anterior": [float(v) for v in frame.rotation[2]],
        },
        "measurements": {
            "long_axis_mm": round(frame.long_axis_mm, 2),
            "base_plane_residuals_mm": [round(v, 2) for v in frame.base_plane_residuals_mm],
            "base_normal_vs_long_axis_deg": round(frame.base_normal_vs_long_axis_deg, 1),
        },
        "checks": {name: bool(passed) for name, passed in frame.checks.items()},
        "checks_passed": int(sum(frame.checks.values())),
        "checks_total": len(frame.checks),
    }
