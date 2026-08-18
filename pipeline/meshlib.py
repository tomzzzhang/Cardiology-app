"""
Mesh I/O for the ingest pipeline.

Deliberately dependency-light and format-explicit. The pipeline reads three very
different things — an ASCII VTK tetrahedral grid, a Sketchfab glTF, and a binary
STL — and writes exactly one: a `.gltf` + external `.bin` pair.

`.gltf` rather than `.glb` on purpose: `scripts/lib/packAssets.ts` inspects JSON
glTF and reports binary containers as *skipped*, so shipping `.glb` would quietly
retire the `mesh_node` validation that `npm run validate:packs` performs. Staying
with JSON keeps that gate real.
"""
from __future__ import annotations

import base64
import json
import re
import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np

# --------------------------------------------------------------------------- #
# containers                                                                   #
# --------------------------------------------------------------------------- #


@dataclass
class Surface:
    """A named triangle surface in model space."""

    name: str
    vertices: np.ndarray  # (V, 3) float32
    faces: np.ndarray     # (F, 3) int32

    @property
    def triangle_count(self) -> int:
        return int(self.faces.shape[0])

    @property
    def vertex_count(self) -> int:
        return int(self.vertices.shape[0])

    def bounds(self) -> tuple[np.ndarray, np.ndarray]:
        return self.vertices.min(axis=0), self.vertices.max(axis=0)


@dataclass
class TetMesh:
    """A tetrahedral volume with a per-element integer tissue tag."""

    points: np.ndarray  # (N, 3) float64
    tets: np.ndarray    # (M, 4) int32
    tags: np.ndarray    # (M,)   int32


# --------------------------------------------------------------------------- #
# readers                                                                      #
# --------------------------------------------------------------------------- #


def read_vtk_tets(path: Path) -> TetMesh:
    """
    Read an ASCII VTK 3.0 UNSTRUCTURED_GRID of tetrahedra carrying a per-cell
    integer scalar named `ID`.

    Two properties of the real file drive this implementation:

    * **Section order is not the documented order.** The Rodero export writes
      CELL_TYPES *before* CELLS, so sections are located by keyword rather than
      by walking the file top-down.
    * **Whitespace is irregular.** Header and data lines use runs of two spaces
      (`CELLS  1766006  8830030`, `4  53565 166278 ...`). Counting tokens by
      counting spaces overshoots, and `np.fromstring` stops silently at the first
      non-numeric token, so a reader that guesses where a section ends truncates
      the mesh without ever raising.

    Both are handled by slicing each section between its own header line and the
    *next* header line, parsing only that slice, and asserting the value count.
    """
    text = path.read_text()

    header_pattern = re.compile(
        r"^(POINTS|CELLS|CELL_TYPES|CELL_DATA|POINT_DATA|SCALARS|VECTORS|LOOKUP_TABLE|FIELD|METADATA)\b[^\n]*$",
        re.MULTILINE,
    )
    headers = [
        (match.start(), match.end(), match.group(0).split())
        for match in header_pattern.finditer(text)
    ]
    header_starts = [h[0] for h in headers]

    def parse(position: int, count: int, dtype) -> np.ndarray:
        """Parse the data block between header `position` and the next header."""
        index = header_starts.index(position)
        data_start = headers[index][1] + 1
        data_end = header_starts[index + 1] if index + 1 < len(headers) else len(text)
        values = np.fromstring(text[data_start:data_end], dtype=np.float64, sep=" ")
        if values.size != count:
            raise ValueError(
                f"section at offset {position}: expected {count} values, parsed {values.size}"
            )
        return values.astype(dtype)

    def find(keyword: str, *, named: str | None = None) -> tuple[int, list[str]]:
        for position, _, words in headers:
            if words[0] != keyword:
                continue
            if named is not None and (len(words) < 2 or words[1] != named):
                continue
            return position, words
        raise ValueError(f"VTK file has no {keyword} section" + (f" named {named!r}" if named else ""))

    position, words = find("POINTS")
    n_points = int(words[1])
    points = parse(position, n_points * 3, np.float64).reshape(n_points, 3)

    position, words = find("CELLS")
    n_cells, n_ints = int(words[1]), int(words[2])
    flat = parse(position, n_ints, np.int64).reshape(n_cells, 5)
    if not np.all(flat[:, 0] == 4):
        raise ValueError("CELLS contains a non-tetrahedral element")
    tets = flat[:, 1:].astype(np.int32)

    position, words = find("CELL_TYPES")
    if int(words[1]) != n_cells:
        raise ValueError("CELL_TYPES count disagrees with CELLS count")
    if not np.all(parse(position, n_cells, np.int64) == 10):  # VTK_TETRA
        raise ValueError("CELL_TYPES contains a non-VTK_TETRA element")

    # SCALARS ID int -> LOOKUP_TABLE -> one value per cell.
    scalars_offset, _ = find("SCALARS", named="ID")
    lookup_offset = next(
        position for position, _, words in headers
        if position > scalars_offset and words[0] == "LOOKUP_TABLE"
    )
    tags = parse(lookup_offset, n_cells, np.int32)

    return TetMesh(points=points, tets=tets, tags=tags)


def _gltf_accessor(doc: dict, buffers: list[bytes], accessor_index: int) -> np.ndarray:
    """Read one glTF accessor into a numpy array, honouring stride."""
    accessor = doc["accessors"][accessor_index]
    view = doc["bufferViews"][accessor["bufferView"]]
    data = buffers[view.get("buffer", 0)]

    component = {
        5120: ("i1", 1), 5121: ("u1", 1), 5122: ("i2", 2),
        5123: ("u2", 2), 5125: ("u4", 4), 5126: ("f4", 4),
    }[accessor["componentType"]]
    per_element = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[accessor["type"]]

    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    count = accessor["count"]
    stride = view.get("byteStride") or component[1] * per_element
    packed = component[1] * per_element

    if stride == packed:
        raw = data[start:start + count * packed]
        return np.frombuffer(raw, dtype=np.dtype(component[0])).reshape(count, per_element)

    out = np.empty((count, per_element), dtype=np.dtype(component[0]))
    for i in range(count):
        offset = start + i * stride
        out[i] = np.frombuffer(data[offset:offset + packed], dtype=np.dtype(component[0]))
    return out


def read_gltf_surfaces(path: Path) -> list[tuple[Surface, int, int]]:
    """
    Read a JSON glTF into `(Surface, material_index, node_index)` triples, one
    per primitive, with node transforms applied.

    The node index is returned rather than inferred by the caller: a primitive's
    position in this list is not its mesh index in the document, and grouping
    primitives back into structures depends on getting that mapping exactly
    right.

    Sketchfab splits a single logical object across many primitives to stay under
    a 16-bit index limit, so a primitive is a *buffer chunk*, not a structure.
    Grouping them back into structures is the caller's job.
    """
    doc = json.loads(path.read_text())
    buffers: list[bytes] = []
    for buffer in doc.get("buffers", []):
        uri = buffer.get("uri")
        if uri is None:
            raise ValueError("GLB-embedded buffers are not supported by this reader")
        if uri.startswith("data:"):
            buffers.append(base64.b64decode(uri.split(",", 1)[1]))
        else:
            buffers.append((path.parent / uri).read_bytes())

    # Resolve each node's world transform by walking the scene graph.
    world: dict[int, np.ndarray] = {}

    def local(node: dict) -> np.ndarray:
        if "matrix" in node:
            return np.array(node["matrix"], dtype=np.float64).reshape(4, 4).T
        matrix = np.eye(4)
        if "scale" in node:
            matrix = np.diag([*node["scale"], 1.0]) @ matrix
        if "rotation" in node:
            x, y, z, w = node["rotation"]
            rotation = np.array([
                [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0],
                [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0],
                [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0],
                [0, 0, 0, 1],
            ])
            matrix = rotation @ matrix
        if "translation" in node:
            translate = np.eye(4)
            translate[:3, 3] = node["translation"]
            matrix = translate @ matrix
        return matrix

    def walk(node_index: int, parent: np.ndarray) -> None:
        node = doc["nodes"][node_index]
        here = parent @ local(node)
        world[node_index] = here
        for child in node.get("children", []):
            walk(child, here)

    roots = doc["scenes"][doc.get("scene", 0)]["nodes"]
    for root in roots:
        walk(root, np.eye(4))

    out: list[tuple[Surface, int, int]] = []
    for node_index, node in enumerate(doc["nodes"]):
        if "mesh" not in node or node_index not in world:
            continue
        transform = world[node_index]
        mesh = doc["meshes"][node["mesh"]]
        for prim_index, primitive in enumerate(mesh.get("primitives", [])):
            if primitive.get("mode", 4) != 4:
                continue
            positions = _gltf_accessor(doc, buffers, primitive["attributes"]["POSITION"]).astype(np.float64)
            homogeneous = np.hstack([positions, np.ones((positions.shape[0], 1))])
            positions = (homogeneous @ transform.T)[:, :3]
            if "indices" in primitive:
                faces = _gltf_accessor(doc, buffers, primitive["indices"]).reshape(-1, 3)
            else:
                faces = np.arange(positions.shape[0], dtype=np.int32).reshape(-1, 3)
            name = mesh.get("name") or node.get("name") or f"node{node_index}"
            out.append((
                Surface(
                    name=f"{name}#{prim_index}",
                    vertices=positions.astype(np.float32),
                    faces=faces.astype(np.int32),
                ),
                primitive.get("material", -1),
                node_index,
            ))
    return out


def read_binary_stl(path: Path) -> Surface:
    """Read a binary STL into a welded surface."""
    raw = path.read_bytes()
    count = struct.unpack("<I", raw[80:84])[0]
    record = np.dtype([("normal", "<f4", 3), ("v", "<f4", (3, 3)), ("attr", "<u2")])
    data = np.frombuffer(raw, dtype=record, count=count, offset=84)
    corners = data["v"].reshape(-1, 3)
    vertices, inverse = np.unique(corners, axis=0, return_inverse=True)
    return Surface(
        name=path.stem,
        vertices=vertices.astype(np.float32),
        faces=inverse.reshape(-1, 3).astype(np.int32),
    )


# --------------------------------------------------------------------------- #
# writer                                                                       #
# --------------------------------------------------------------------------- #


def write_gltf(path: Path, surfaces: list[Surface], *, bin_name: str | None = None) -> tuple[int, int]:
    """
    Write `surfaces` as a JSON glTF plus one external `.bin`.

    Each surface becomes one node whose `name` is the surface name — that name is
    what a pack's `structures[].mesh_node` refers to, and what
    `npm run validate:packs` resolves. Returns `(gltf_bytes, bin_bytes)`.
    """
    bin_name = bin_name or (path.stem + ".bin")
    blob = bytearray()
    buffer_views: list[dict] = []
    accessors: list[dict] = []
    meshes: list[dict] = []
    nodes: list[dict] = []

    def add_view(payload: bytes, target: int) -> int:
        while len(blob) % 4:
            blob.append(0)
        offset = len(blob)
        blob.extend(payload)
        buffer_views.append({
            "buffer": 0, "byteOffset": offset, "byteLength": len(payload), "target": target,
        })
        return len(buffer_views) - 1

    for surface in surfaces:
        vertices = np.ascontiguousarray(surface.vertices, dtype=np.float32)
        # 32-bit indices throughout: these meshes exceed the 16-bit limit, and
        # splitting them into chunks to avoid that is exactly what makes the
        # Sketchfab sources unreadable as structures.
        faces = np.ascontiguousarray(surface.faces, dtype=np.uint32)

        position_view = add_view(vertices.tobytes(), 34962)
        accessors.append({
            "bufferView": position_view, "componentType": 5126, "count": int(vertices.shape[0]),
            "type": "VEC3",
            "min": vertices.min(axis=0).astype(float).tolist(),
            "max": vertices.max(axis=0).astype(float).tolist(),
        })
        position_accessor = len(accessors) - 1

        normals = _vertex_normals(vertices, surface.faces)
        normal_view = add_view(normals.tobytes(), 34962)
        accessors.append({
            "bufferView": normal_view, "componentType": 5126,
            "count": int(normals.shape[0]), "type": "VEC3",
        })
        normal_accessor = len(accessors) - 1

        index_view = add_view(faces.tobytes(), 34963)
        accessors.append({
            "bufferView": index_view, "componentType": 5125,
            "count": int(faces.size), "type": "SCALAR",
        })
        index_accessor = len(accessors) - 1

        meshes.append({
            "name": surface.name,
            "primitives": [{
                "attributes": {"POSITION": position_accessor, "NORMAL": normal_accessor},
                "indices": index_accessor,
                "mode": 4,
            }],
        })
        nodes.append({"name": surface.name, "mesh": len(meshes) - 1})

    document = {
        "asset": {
            "version": "2.0",
            "generator": "Cardiology app ingest pipeline (pipeline/ingest.py)",
        },
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": meshes,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"uri": bin_name, "byteLength": len(blob)}],
    }

    path.parent.mkdir(parents=True, exist_ok=True)
    (path.parent / bin_name).write_bytes(bytes(blob))
    text = json.dumps(document, indent=1, sort_keys=True) + "\n"
    path.write_text(text)
    return len(text.encode()), len(blob)


def _vertex_normals(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """Area-weighted vertex normals."""
    normals = np.zeros_like(vertices, dtype=np.float32)
    a, b, c = vertices[faces[:, 0]], vertices[faces[:, 1]], vertices[faces[:, 2]]
    face_normal = np.cross(b - a, c - a).astype(np.float32)
    for column in range(3):
        np.add.at(normals, faces[:, column], face_normal)
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    lengths[lengths == 0] = 1.0
    return np.ascontiguousarray(normals / lengths, dtype=np.float32)
