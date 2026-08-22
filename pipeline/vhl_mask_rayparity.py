"""
Chamber space by RAY PARITY against a smoothed epicardial surface.

The problem this replaces
------------------------
`vhl_seed_partition.chamber_space` defines the space inside the heart as
`epicardial_envelope(tissue, 10 mm) AND NOT tissue`. The envelope is a
dilate -> fill -> erode, so it bridges the atrioventricular groove and the
gaps between the great vessels. The space it returns is therefore three
things: real chamber lumen, the trabecular interstices, and a FILM between
the true epicardial surface and the envelope that wraps the whole organ as
one connected sheet. Whichever flood label reaches the film first inherits
the entire wrap, which is why the right ventricle has measured anywhere
between 165 and 279 mL depending on the flood.

The fix here is not a better flood. It is a better surface.

The method
----------
The 553 tag-99 marks are a human-placed sample of the epicardial surface,
taken at their ``model_point_mm`` (the ``voxel`` field on those marks is
corrupt -- it disagrees with ``model_point_mm`` by up to 13.6 mm because the
labeller snapped each click to the nearest surface voxel, sometimes landing
in a trabecular interstice inside a chamber).

About an interior origin ``o`` the marks are converted to spherical
coordinates and a radius field ``r(theta, phi)`` is fitted by real spherical
harmonics with a Laplacian (bending-energy) penalty. The heart is verified
to be star-shaped about ``o`` before this is done, rather than assumed. The
resulting surface is a zero-thickness closed sheet, so

    inside_epi(v) = |v - o| < r(direction to v)

is a ray-parity test against that sheet. Unlike a dilate/erode it cannot
bridge a groove, because a groove is a dip in ``r`` and the fit reproduces
the dip; and unlike an erosion it cannot eat volume, because it never moves
a boundary inward by a fixed amount.

The residual film
-----------------
A least-squares surface passes through the middle of the mark cloud, so
wherever it sits outside the true epicardium a thin film survives between
the two. The film still touches chamber lumen at the CUT ENDS of the
great-vessel and venous stubs, which is where the lumen opens to the
outside world in this model. Two explicit treatments, both measured by the
runner rather than assumed:

* ``shrink_mm`` pulls the fitted radius inward by a fixed amount taken from
  the fit's own held-out residual, so the sheet sits inside its own
  uncertainty band and most of the film falls outside it.
* ``open_mm`` is a morphological opening of the candidate space. The film
  that survives the shrink is thinner than the valve orifices and the stub
  lumina by a wide margin, so an opening severs it while leaving the lumen
  connected. This deletes lumen thinner than ``2 * open_mm`` as well; the
  runner reports how much.

Nothing in this module is tuned against a chamber volume. The origin, the
degree and the penalty weight are all chosen by held-out residual on the
marks alone.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage
from scipy.special import sph_harm_y

from vhl_partition import components, erode, dilate


# --------------------------------------------------------------------------- #
# real spherical harmonic basis                                                #
# --------------------------------------------------------------------------- #


def sh_design(directions: np.ndarray, degree: int) -> tuple[np.ndarray, np.ndarray]:
    """
    Real orthonormal spherical-harmonic design matrix for unit `directions`.

    Returns the (N, (degree+1)^2) matrix and the degree ``l`` of each column.
    Column order is l ascending, and within l: m=0, then Re/Im of each m>0.
    The particular real basis does not matter -- any orthonormal one spans the
    same space, and least squares is invariant to the choice.
    """
    directions = np.asarray(directions, dtype=np.float64)
    x, y, z = directions[:, 0], directions[:, 1], directions[:, 2]
    theta = np.arccos(np.clip(z, -1.0, 1.0))
    phi = np.arctan2(y, x)
    columns: list[np.ndarray] = []
    degrees: list[int] = []
    for l in range(degree + 1):
        for m in range(0, l + 1):
            harmonic = sph_harm_y(l, m, theta, phi)
            if m == 0:
                columns.append(harmonic.real)
                degrees.append(l)
            else:
                columns.append(np.sqrt(2.0) * harmonic.real)
                degrees.append(l)
                columns.append(np.sqrt(2.0) * harmonic.imag)
                degrees.append(l)
    return np.column_stack(columns), np.asarray(degrees, dtype=np.int64)


def _penalty(degrees: np.ndarray) -> np.ndarray:
    """Bending energy of each basis function: the squared Laplace eigenvalue."""
    return (degrees * (degrees + 1.0)) ** 2


@dataclass
class RadiusFit:
    """A fitted star-shaped surface r(theta, phi) about `origin`."""

    origin: np.ndarray
    degree: int
    penalty_weight: float
    coefficients: np.ndarray
    #: Signed in-sample residual per mark, fitted minus observed, mm.
    residual_mm: np.ndarray
    #: Signed held-out residual per mark from k-fold cross validation, mm.
    cv_residual_mm: np.ndarray
    #: Lookup table of radius over (theta, phi), built lazily.
    _table: np.ndarray | None = field(default=None, repr=False)

    @property
    def cv_rms_mm(self) -> float:
        return float(np.sqrt((self.cv_residual_mm ** 2).mean()))

    def radius(self, directions: np.ndarray) -> np.ndarray:
        """Fitted radius for unit `directions`, evaluated exactly."""
        design, _ = sh_design(directions, self.degree)
        return design @ self.coefficients

    # -- fast path ---------------------------------------------------------- #
    #
    # The mask needs r() at several million voxel directions. Evaluating the
    # basis there directly costs (degree+1)^2 associated-Legendre calls per
    # voxel. The field is band limited at `degree`, so a (theta, phi) table
    # sampled far above its Nyquist rate and bilinearly interpolated is exact
    # to well under a voxel; `table_error_mm` measures that rather than
    # asserting it.

    def build_table(self, n_theta: int = 721, n_phi: int = 1441) -> np.ndarray:
        theta = np.linspace(0.0, np.pi, n_theta)
        phi = np.linspace(-np.pi, np.pi, n_phi)
        tt, pp = np.meshgrid(theta, phi, indexing="ij")
        directions = np.column_stack([
            (np.sin(tt) * np.cos(pp)).ravel(),
            (np.sin(tt) * np.sin(pp)).ravel(),
            np.cos(tt).ravel(),
        ])
        self._table = self.radius(directions).reshape(n_theta, n_phi)
        return self._table

    def radius_fast(self, directions: np.ndarray) -> np.ndarray:
        if self._table is None:
            self.build_table()
        table = self._table
        n_theta, n_phi = table.shape
        directions = np.asarray(directions, dtype=np.float64)
        theta = np.arccos(np.clip(directions[:, 2], -1.0, 1.0))
        phi = np.arctan2(directions[:, 1], directions[:, 0])
        a = theta / np.pi * (n_theta - 1)
        b = (phi + np.pi) / (2 * np.pi) * (n_phi - 1)
        i0 = np.clip(np.floor(a).astype(np.int64), 0, n_theta - 2)
        j0 = np.clip(np.floor(b).astype(np.int64), 0, n_phi - 2)
        fa = (a - i0)[:, None]
        fb = (b - j0)
        top = table[i0, j0] * (1 - fb) + table[i0, j0 + 1] * fb
        bottom = table[i0 + 1, j0] * (1 - fb) + table[i0 + 1, j0 + 1] * fb
        return top * (1 - fa[:, 0]) + bottom * fa[:, 0]

    def table_error_mm(self, n: int = 20000, seed: int = 0) -> float:
        rng = np.random.default_rng(seed)
        directions = rng.normal(size=(n, 3))
        directions /= np.linalg.norm(directions, axis=1)[:, None]
        return float(np.abs(self.radius(directions) - self.radius_fast(directions)).max())


def fit_radius(marks_mm: np.ndarray, origin: np.ndarray, degree: int,
               penalty_weight: float, folds: int = 10, seed: int = 0) -> RadiusFit:
    """Penalised least-squares fit of r(theta, phi) to `marks_mm` about `origin`."""
    origin = np.asarray(origin, dtype=np.float64)
    offset = np.asarray(marks_mm, dtype=np.float64) - origin
    radius = np.linalg.norm(offset, axis=1)
    direction = offset / radius[:, None]
    design, degrees = sh_design(direction, degree)
    weight = penalty_weight * np.diag(_penalty(degrees))

    def solve(rows: np.ndarray) -> np.ndarray:
        gram = design[rows].T @ design[rows] + weight
        return np.linalg.solve(gram, design[rows].T @ radius[rows])

    everything = np.arange(len(radius))
    coefficients = solve(everything)

    order = np.random.default_rng(seed).permutation(len(radius))
    held_out = np.zeros(len(radius))
    for fold in range(folds):
        test = order[fold::folds]
        train = np.setdiff1d(order, test)
        held_out[test] = design[test] @ solve(train) - radius[test]

    return RadiusFit(origin=origin, degree=degree, penalty_weight=penalty_weight,
                     coefficients=coefficients,
                     residual_mm=design @ coefficients - radius,
                     cv_residual_mm=held_out)


def select_fit(marks_mm: np.ndarray, origins: dict[str, np.ndarray],
               degrees: tuple[int, ...], penalty_weights: tuple[float, ...],
               folds: int = 10, seed: int = 0) -> tuple[str, RadiusFit, list[dict]]:
    """
    Pick the origin, degree and penalty weight by held-out residual alone.

    The selection criterion never sees a chamber volume, which is the point:
    a surface chosen to make a ventricle land in range would be worthless.
    """
    trace: list[dict] = []
    best: tuple[float, str, RadiusFit] | None = None
    for name, origin in origins.items():
        for degree in degrees:
            for weight in penalty_weights:
                try:
                    fit = fit_radius(marks_mm, origin, degree, weight, folds, seed)
                except np.linalg.LinAlgError:
                    continue
                score = fit.cv_rms_mm
                trace.append({"origin": name, "degree": degree, "penalty": weight,
                              "cv_rms_mm": score,
                              "cv_p90_mm": float(np.percentile(np.abs(fit.cv_residual_mm), 90)),
                              "cv_max_mm": float(np.abs(fit.cv_residual_mm).max())})
                if best is None or score < best[0]:
                    best = (score, name, fit)
    assert best is not None
    return best[1], best[2], trace


# --------------------------------------------------------------------------- #
# star-shapedness, checked rather than assumed                                 #
# --------------------------------------------------------------------------- #


def star_check(solid: np.ndarray, grid_origin: np.ndarray, pitch: float,
               origin: np.ndarray, marks_mm: np.ndarray,
               step_fraction: float = 0.5, skin_mm: float = 1.0) -> dict:
    """
    Is `solid` star-shaped about `origin`?

    Two independent measurements, neither of which assumes the answer:

    * ``segment_gap_mm`` -- length of the open segment from `origin` to each
      mark that falls OUTSIDE the solid. A star-shaped body has zero. The last
      ``skin_mm`` before the mark is ignored because a click sits on the
      surface and the voxelisation of a surface is fuzzy at that scale.
    * ``beyond_mm`` -- how much further along the same ray the solid persists
      past the mark. A positive value means the surface is multivalued in that
      direction: something (a vessel stub, the far lip of a groove) sticks out
      beyond where the observer clicked. That is the direction in which a star
      parameterisation loses material rather than gaining it.
    """
    origin = np.asarray(origin, dtype=np.float64)
    size = solid.shape[0]
    offset = np.asarray(marks_mm, dtype=np.float64) - origin
    radius = np.linalg.norm(offset, axis=1)
    direction = offset / radius[:, None]
    step = step_fraction * pitch

    def occupied(points: np.ndarray) -> np.ndarray:
        index = np.rint((points - grid_origin) / pitch - 0.5).astype(np.int64)
        inside = np.all((index >= 0) & (index < size), axis=1)
        out = np.zeros(len(points), dtype=bool)
        out[inside] = solid[index[inside, 0], index[inside, 1], index[inside, 2]]
        return out

    gap = np.zeros(len(radius))
    beyond = np.zeros(len(radius))
    far = np.arange(0.0, radius.max() * 1.35, step)
    for i in range(len(radius)):
        samples = np.arange(0.0, radius[i], step)
        hit = occupied(origin + samples[:, None] * direction[i])
        interior = samples < radius[i] - skin_mm
        gap[i] = float((~hit[interior]).sum()) * step
        hit_far = occupied(origin + far[:, None] * direction[i])
        seen = np.flatnonzero(hit_far)
        beyond[i] = (far[seen[-1]] if seen.size else 0.0) - radius[i]

    return {
        "segment_gap_p50_mm": float(np.median(gap)),
        "segment_gap_p90_mm": float(np.percentile(gap, 90)),
        "segment_gap_max_mm": float(gap.max()),
        "marks_with_gap_over_2mm": int((gap > 2.0).sum()),
        "beyond_p50_mm": float(np.median(beyond)),
        "beyond_p90_mm": float(np.percentile(beyond, 90)),
        "beyond_max_mm": float(beyond.max()),
        "marks_with_solid_over_3mm_beyond": int((beyond > 3.0).sum()),
        "marks": int(len(radius)),
    }


# --------------------------------------------------------------------------- #
# the mask                                                                     #
# --------------------------------------------------------------------------- #


def inside_epi(fit: RadiusFit, candidate: np.ndarray, grid_origin: np.ndarray,
               pitch: float, shrink_mm: float = 0.0,
               chunk: int = 1_000_000) -> np.ndarray:
    """
    Ray parity against the fitted sheet, evaluated on the voxels of `candidate`.

    Restricting to `candidate` (the old, over-large chamber space) is what
    makes this affordable at 384^3, and it also makes the operation purely
    subtractive: the result is a subset of the old space, so nothing new is
    invented, only film is removed.
    """
    index = np.argwhere(candidate)
    keep = np.zeros(len(index), dtype=bool)
    for start in range(0, len(index), chunk):
        block = index[start:start + chunk]
        point = grid_origin + (block + 0.5) * pitch
        offset = point - fit.origin
        radius = np.linalg.norm(offset, axis=1)
        safe = np.where(radius > 1e-9, radius, 1.0)
        keep[start:start + chunk] = radius < (
            fit.radius_fast(offset / safe[:, None]) - shrink_mm)
    out = np.zeros_like(candidate)
    out[index[keep, 0], index[keep, 1], index[keep, 2]] = True
    return out


def seed_components(mask: np.ndarray, seed_voxels: np.ndarray) -> np.ndarray:
    """The components of `mask` that hold at least one of `seed_voxels`."""
    labels, _ = components(mask)
    wanted = {int(labels[tuple(v)]) for v in seed_voxels}
    wanted.discard(0)
    if not wanted:
        return np.zeros_like(mask)
    return np.isin(labels, list(wanted))


def opening_mm(mask: np.ndarray, radius_mm: float, pitch: float) -> np.ndarray:
    """Opening by an exact Euclidean ball, intersected back into `mask`."""
    if radius_mm <= 0:
        return mask
    core = erode(mask, radius_mm, pitch)
    if not core.any():
        return np.zeros_like(mask)
    return dilate(core, radius_mm, pitch) & mask


def build_mask(candidate: np.ndarray, fit: RadiusFit, grid_origin: np.ndarray,
               pitch: float, seed_voxels: np.ndarray, shrink_mm: float,
               open_mm: float) -> dict:
    """
    Full mask construction, returning every intermediate so each can be measured.

    Stages: ray parity -> opening (severs the residual film) -> keep only the
    components that hold a chamber seed.
    """
    parity = inside_epi(fit, candidate, grid_origin, pitch, shrink_mm)
    opened = opening_mm(parity, open_mm, pitch)
    final = seed_components(opened, seed_voxels)
    return {"parity": parity, "opened": opened, "final": final}
