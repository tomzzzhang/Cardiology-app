"""
Chamber-space mask by Hoppe implicit surface reconstruction from the 553 marks.

The mask is defined as a level set of an implicit function built from the
observer's barrier marks alone, not from any morphological operation on the
tissue. That is the point: the envelope's dilate->fill->erode bridges the AV
groove and the great-vessel gaps, so `envelope AND NOT tissue` contains a film
that wraps the whole organ. A surface fitted THROUGH the human-placed points
cannot bridge anything the human did not click across.

Method (Hoppe et al. 1992, "Surface reconstruction from unorganized points"):

1.  For each mark p_i take its k nearest neighbours and run PCA on the centred
    neighbourhood. The eigenvector of the smallest eigenvalue is the normal
    n_i of the least-squares tangent plane; the plane passes through the
    neighbourhood centroid o_i.
2.  Orient the n_i consistently. Two ways are computed and compared:
      A. outward from the global centroid -- cheap, and wrong wherever the
         organ is concave (the AV groove, the interventricular groove, the
         crux, the notch between the great vessels).
      B. propagate orientation along the maximum spanning tree of the
         symmetric k-nearest-neighbour graph weighted by normal agreement
         |n_i . n_j|, rooted at the mark furthest from the centroid whose
         normal is forced outward. This is Hoppe's own fix and the one used
         for the result.
3.  The implicit function at a point q is the signed distance to the tangent
    plane of the mark nearest to q:  f(q) = (q - o_m) . n_m,  m = argmin |q-p|.
    `inside_epi` is f < 0.
4.  chamber_space = inside_epi AND NOT tissue, restricted to the components
    that hold chamber seeds.

Everything this module measures about its own reliability is exported by
`diagnose`, because the honest answer to "does 553 points support a 3-5 mm
ventricular wall" is a number, not an opinion.

Nothing here mutates `vhl_partition` or `vhl_seed_partition`; both are imported.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components, minimum_spanning_tree
from scipy.spatial import cKDTree

__all__ = ["MarkCloud", "estimate_normals", "orient_by_centroid",
           "orient_by_mst", "evaluate_field", "inside_from_field",
           "chamber_space_sdf", "spacing_stats", "voxel_of", "mm_of"]


# --------------------------------------------------------------------------- #
# grid <-> model space                                                         #
# --------------------------------------------------------------------------- #

def voxel_of(points_mm: np.ndarray, origin: np.ndarray, pitch: float,
             n: int) -> np.ndarray:
    """Integer voxel index [k, j, i] of model-space points, clipped to the grid."""
    v = np.floor((np.asarray(points_mm, float) - origin) / pitch).astype(np.int64)
    return np.clip(v, 0, n - 1)


def mm_of(voxels: np.ndarray, origin: np.ndarray, pitch: float) -> np.ndarray:
    """Model-space centre of integer voxel indices."""
    return origin + (np.asarray(voxels, float) + 0.5) * pitch


# --------------------------------------------------------------------------- #
# the cloud, its spacing, and its normals                                      #
# --------------------------------------------------------------------------- #

@dataclass
class MarkCloud:
    """The 553 barrier marks with tangent planes attached."""

    points: np.ndarray          # (m, 3) model mm -- the observer's clicks
    plane_origin: np.ndarray    # (m, 3) neighbourhood centroid o_i
    normal: np.ndarray          # (m, 3) unit, oriented outward
    planarity: np.ndarray       # (m,)   lambda0 / (lambda0+lambda1+lambda2)
    neighbour_radius: np.ndarray  # (m,) distance to the k-th neighbour, mm
    k: int
    centroid_flips: int = 0     # marks where centroid and MST orientation differ
    mst_root: int = -1
    graph_components: int = 1
    extra: dict = field(default_factory=dict)


def spacing_stats(points: np.ndarray) -> dict:
    """Nearest-neighbour spacing of the cloud, in mm. The sampling budget."""
    tree = cKDTree(points)
    d, _ = tree.query(points, k=2)
    nn = d[:, 1]
    d8, _ = tree.query(points, k=min(9, len(points)))
    return {
        "n": int(len(points)),
        "nn_min": float(nn.min()), "nn_p10": float(np.percentile(nn, 10)),
        "nn_p50": float(np.median(nn)), "nn_mean": float(nn.mean()),
        "nn_p90": float(np.percentile(nn, 90)), "nn_max": float(nn.max()),
        "r8_p50": float(np.median(d8[:, -1])),
        "r8_p90": float(np.percentile(d8[:, -1], 90)),
        "r8_max": float(d8[:, -1].max()),
    }


def estimate_normals(points: np.ndarray, k: int = 12
                     ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Local tangent plane per point by PCA over its k nearest neighbours.

    Returns (plane_origin, normal, planarity, neighbour_radius, neighbour_index).

    `planarity` is lambda0 / sum(lambda) of the neighbourhood covariance, the
    fraction of variance normal to the fitted plane. Zero is a perfect plane.
    It is reported rather than thresholded: on a surface sampled coarsely
    relative to its curvature the neighbourhood is not planar and the "normal"
    is partly an artefact of curvature, which is exactly the failure mode this
    method has to be honest about.
    """
    points = np.asarray(points, float)
    tree = cKDTree(points)
    _, idx = tree.query(points, k=k + 1)          # includes self at column 0
    nb = points[idx]                              # (m, k+1, 3)
    origin = nb.mean(axis=1)
    centred = nb - origin[:, None, :]
    cov = np.einsum("mki,mkj->mij", centred, centred) / (k + 1)
    evals, evecs = np.linalg.eigh(cov)            # ascending
    normal = evecs[:, :, 0]
    normal /= np.linalg.norm(normal, axis=1, keepdims=True)
    planarity = evals[:, 0] / np.maximum(evals.sum(axis=1), 1e-12)
    radius = np.linalg.norm(points[idx[:, -1]] - points, axis=1)
    return origin, normal, planarity, radius, idx


def orient_by_centroid(points: np.ndarray, normal: np.ndarray) -> np.ndarray:
    """Cheap orientation: point every normal away from the cloud centroid."""
    out = points - points.mean(axis=0)
    sign = np.sign(np.einsum("mi,mi->m", normal, out))
    sign[sign == 0] = 1.0
    return normal * sign[:, None]


def orient_by_mst(points: np.ndarray, normal: np.ndarray, neighbour_index: np.ndarray
                  ) -> tuple[np.ndarray, int, int]:
    """
    Hoppe's consistent orientation: propagate sign over a maximum spanning tree
    of the kNN graph weighted by normal agreement.

    scipy has only a MINIMUM spanning tree, so the edge cost is
    ``1 - |n_i . n_j| + eps``: cheap edges are the ones where the two tangent
    planes are nearly parallel, which is where a sign flip is least likely to
    be a mistake. eps keeps a perfectly-agreeing edge from being read as an
    absent entry by the sparse representation.

    Root: the mark furthest from the cloud centroid, whose normal must point
    away from the centroid -- on any closed surface the extreme point is
    convex, so this one seed is safe even though the global centroid rule is
    not.

    Returns (oriented normals, root index, number of graph components).
    """
    m = len(points)
    rows = np.repeat(np.arange(m), neighbour_index.shape[1] - 1)
    cols = neighbour_index[:, 1:].ravel()
    agree = np.abs(np.einsum("ei,ei->e", normal[rows], normal[cols]))
    cost = (1.0 - agree) + 1e-6
    graph = coo_matrix((cost, (rows, cols)), shape=(m, m)).tocsr()
    graph = graph.maximum(graph.T).tocsr()   # symmetrise; kNN is not mutual
    ncomp, comp_label = connected_components(graph, directed=False)

    mst = minimum_spanning_tree(graph)
    mst = mst + mst.T
    mst = mst.tocsr()

    out = normal.copy()
    away = points - points.mean(axis=0)
    root = int(np.argmax(np.linalg.norm(away, axis=1)))

    # Breadth-first over the tree, one pass per graph component so an isolated
    # island still gets a defined (if less trustworthy) orientation.
    visited = np.zeros(m, bool)
    for c in range(ncomp):
        members = np.flatnonzero(comp_label == c)
        start = root if comp_label[root] == c else int(
            members[np.argmax(np.linalg.norm(away[members], axis=1))])
        if float(np.dot(out[start], away[start])) < 0:
            out[start] = -out[start]
        visited[start] = True
        stack = [start]
        while stack:
            cur = stack.pop()
            for nxt in mst.indices[mst.indptr[cur]:mst.indptr[cur + 1]]:
                nxt = int(nxt)
                if visited[nxt]:
                    continue
                if float(np.dot(out[cur], out[nxt])) < 0:
                    out[nxt] = -out[nxt]
                visited[nxt] = True
                stack.append(nxt)
    return out, root, int(ncomp)


def build_cloud(points: np.ndarray, k: int = 12) -> MarkCloud:
    """Estimate tangent planes and orient them both ways, keeping the MST one."""
    origin, normal, planarity, radius, idx = estimate_normals(points, k)
    by_centroid = orient_by_centroid(points, normal)
    by_mst, root, ncomp = orient_by_mst(points, normal, idx)
    flips = int((np.einsum("mi,mi->m", by_centroid, by_mst) < 0).sum())
    return MarkCloud(points=points, plane_origin=origin, normal=by_mst,
                     planarity=planarity, neighbour_radius=radius, k=k,
                     centroid_flips=flips, mst_root=root, graph_components=ncomp,
                     extra={"normal_centroid": by_centroid, "neighbour_index": idx})


# --------------------------------------------------------------------------- #
# the implicit field                                                           #
# --------------------------------------------------------------------------- #

def evaluate_field(cloud: MarkCloud, shape: tuple[int, int, int],
                   origin: np.ndarray, pitch: float,
                   chunk: int = 8) -> np.ndarray:
    """
    f(q) = (q - o_m) . n_m for the nearest mark m, evaluated on the whole grid.

    Done a few k-slices at a time; the full coordinate array at 384^3 is 1.4 GB
    in float64 and there is no reason to hold it.
    """
    n0, n1, n2 = shape
    tree = cKDTree(cloud.points)
    offset = np.einsum("mi,mi->m", cloud.plane_origin, cloud.normal)
    out = np.empty(shape, np.float32)
    jj, ii = np.meshgrid(np.arange(n1), np.arange(n2), indexing="ij")
    yz = np.stack([jj.ravel(), ii.ravel()], axis=1).astype(np.float64)
    yz_mm = origin[None, 1:] + (yz + 0.5) * pitch
    for k0 in range(0, n0, chunk):
        k1 = min(k0 + chunk, n0)
        block = []
        for k in range(k0, k1):
            x = origin[0] + (k + 0.5) * pitch
            q = np.empty((len(yz_mm), 3))
            q[:, 0] = x
            q[:, 1:] = yz_mm
            block.append(q)
        q = np.concatenate(block, axis=0)
        _, m = tree.query(q, k=1, workers=-1)
        f = np.einsum("qi,qi->q", q, cloud.normal[m]) - offset[m]
        out[k0:k1] = f.reshape(k1 - k0, n1, n2).astype(np.float32)
    return out


def inside_from_field(field: np.ndarray, pitch: float, sigma_mm: float = 0.0,
                      ) -> np.ndarray:
    """
    `inside_epi` from the implicit field: the filled largest blob of f < 0.

    Smoothing is on the FIELD, not the mask, and `sigma_mm` is stated in mm so
    it can be compared against the sample spacing. Filling and largest-component
    selection remove the sign bubbles that the nearest-plane rule leaves behind
    where two neighbouring planes disagree; they are topology repair, not
    tuning, and their cost is reported by the caller.
    """
    f = field
    if sigma_mm > 0:
        f = ndimage.gaussian_filter(field, sigma_mm / pitch, mode="nearest")
    inside = f < 0
    lab, cnt = ndimage.label(inside)
    if cnt > 1:
        sizes = np.bincount(lab.ravel())
        sizes[0] = 0
        inside = lab == int(np.argmax(sizes))
    return ndimage.binary_fill_holes(inside)


def chamber_space_sdf(tissue: np.ndarray, inside_epi: np.ndarray,
                      chamber_voxels: np.ndarray) -> tuple[np.ndarray, dict]:
    """
    chamber_space = inside_epi AND NOT tissue, keeping only the components that
    contain a chamber seed.

    The dropped components are the residual film: sheets of space between the
    reconstructed epicardial surface and the real one that no observer seed
    reaches. Their total is returned so the film is a measured quantity rather
    than a hope.
    """
    raw = inside_epi & ~tissue
    lab, cnt = ndimage.label(raw)
    keep = set()
    for k, j, i in chamber_voxels:
        v = int(lab[k, j, i])
        if v:
            keep.add(v)
    sizes = np.bincount(lab.ravel(), minlength=cnt + 1)
    sizes[0] = 0
    mask = np.isin(lab, sorted(keep)) if keep else np.zeros_like(raw)
    stats = {
        "raw_voxels": int(raw.sum()),
        "components": int(cnt),
        "kept_components": len(keep),
        "kept_voxels": int(mask.sum()),
        "dropped_voxels": int(raw.sum() - mask.sum()),
        "largest_component_voxels": int(sizes.max()) if cnt else 0,
    }
    return mask, stats
