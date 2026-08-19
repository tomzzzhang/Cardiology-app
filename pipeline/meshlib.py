"""
Mesh I/O for the ingest pipeline.

Deliberately dependency-light and format-explicit. The pipeline reads the
formats the real sources actually arrive in — an ASCII VTK tetrahedral grid, a
Sketchfab glTF, a binary STL, VTK PolyData surfaces, XML VTU grids, and Wavefront
OBJ — and writes exactly one: a `.gltf` + external `.bin` pair.

The readers are hand-written rather than delegated to `meshio` or `vtk` because
the pipeline runs in CI and in a conda environment that carries neither, and
because a reader that silently reinterprets a file it half-understands is worse
than one that refuses it. Every reader below fails loudly on a variant it does
not implement, naming the variant.

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
from dataclasses import dataclass, field
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
    #: Per-POINT scalar fields carried by the source, by name. The Rodero export
    #: ships the universal ventricular coordinates (Bayer et al.): `Z.dat`
    #: apicobasal, `RHO.dat` transmural, `PHI.dat` rotational, `V.dat` which
    #: ventricle. They are what makes the apex a MEASUREMENT rather than an
    #: assumption, so they are read rather than skipped past.
    point_data: dict[str, np.ndarray] = field(default_factory=dict)

    def uvc(self, name: str) -> np.ndarray:
        """One UVC field by short name (`Z`, `RHO`, `PHI`, `V`)."""
        for key in (name, f"{name}.dat"):
            if key in self.point_data:
                return self.point_data[key]
        raise KeyError(
            f"source carries no {name!r} field; available: {sorted(self.point_data)}"
        )


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

    # POINT_DATA scalars, if present. Every SCALARS block after the POINT_DATA
    # header is one per-point field; the Rodero export writes four. A source
    # that writes none is still valid and yields an empty mapping, which the
    # frame derivation reports as a missing input rather than silently
    # substituting a guess.
    point_data: dict[str, np.ndarray] = {}
    try:
        point_offset, _ = find("POINT_DATA")
    except ValueError:
        point_offset = None
    if point_offset is not None:
        for position, _, words in headers:
            if position <= point_offset or words[0] != "SCALARS" or len(words) < 2:
                continue
            lookup = next(
                (p for p, _, w in headers if p > position and w[0] == "LOOKUP_TABLE"),
                None,
            )
            if lookup is None:
                continue
            point_data[words[1]] = parse(lookup, n_points, np.float64)

    return TetMesh(points=points, tets=tets, tags=tags, point_data=point_data)


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



def _legacy_cell_index(flat: np.ndarray, cells: int) -> tuple[np.ndarray, np.ndarray]:
    """
    Per-cell size and connectivity start from a classic `CELLS` array.

    The array is `[size, i0, i1, ..., size, i0, ...]`, so the sizes cannot be
    read without knowing where they are. Where every cell has the SAME size —
    which every mesh this pipeline has met does, tetrahedra throughout — the
    whole thing is one reshape. The mixed case falls back to walking it, which
    is O(cells) in Python and only pays where it is actually needed.
    """
    if cells == 0:
        return np.empty(0, dtype=np.int64), np.empty(0, dtype=np.int64)

    width = int(flat[0])
    if len(flat) == cells * (width + 1) and np.all(flat[::width + 1] == width):
        sizes = np.full(cells, width, dtype=np.int64)
        starts = np.arange(cells, dtype=np.int64) * (width + 1) + 1
        return sizes, starts

    sizes_list, starts_list, cursor = [], [], 0
    for _ in range(cells):
        size = int(flat[cursor])
        sizes_list.append(size)
        starts_list.append(cursor + 1)
        cursor += size + 1
    return np.asarray(sizes_list, dtype=np.int64), np.asarray(starts_list, dtype=np.int64)


def _legacy_lines(raw: bytes) -> tuple[list[str], int]:
    """
    The four-line legacy VTK header, and the offset just past it.

    Four, not five: the fifth line is already the first SECTION (`POINTS ...`),
    and consuming it here would leave the section search starting past the
    section it is looking for.
    """
    lines, cursor = [], 0
    while len(lines) < 4 and cursor < len(raw):
        stop = raw.find(b"\n", cursor)
        if stop < 0:
            break
        lines.append(raw[cursor:stop].decode("ascii", "replace").strip())
        cursor = stop + 1
    return lines, cursor


def _legacy_dataset(raw: bytes, path: Path) -> bytes:
    """The `DATASET` keyword of a legacy VTK file."""
    lines, _ = _legacy_lines(raw)
    if not lines or not lines[0].startswith("# vtk DataFile Version"):
        raise ValueError(f"{path.name}: not a legacy VTK file")
    if len(lines) < 4 or not lines[3].upper().startswith("DATASET"):
        raise ValueError(f"{path.name}: no DATASET line")
    return lines[3].split()[1].upper().encode()


def _legacy_header(raw: bytes, path: Path, expected: bytes) -> tuple[str, int]:
    """Validate the header and return `(encoding, offset past it)`."""
    lines, cursor = _legacy_lines(raw)
    if not lines or not lines[0].startswith("# vtk DataFile Version"):
        raise ValueError(f"{path.name}: not a legacy VTK file")
    encoding = lines[2].upper()
    if encoding not in ("ASCII", "BINARY"):
        raise ValueError(f"{path.name}: unknown VTK encoding {lines[2]!r}")
    if _legacy_dataset(raw, path) != expected:
        raise ValueError(f"{path.name}: expected DATASET {expected.decode()}, got {lines[3]!r}")
    return encoding, cursor


def _legacy_section(raw: bytes, keyword: bytes, after: int, path: Path) -> tuple[list[bytes], int]:
    """A section's header tokens, and the offset of its payload."""
    at = raw.find(keyword, after)
    if at < 0:
        raise ValueError(f"{path.name}: no {keyword.decode()} section")
    stop = raw.find(b"\n", at)
    return raw[at:stop].split(), stop + 1


def read_vtk_polydata(path: Path) -> Surface:
    """
    Read a legacy VTK `DATASET POLYDATA` surface, ASCII or binary.

    Polygons are fan-triangulated. Degenerate faces — a polygon repeating a
    vertex index, which the 4D biventricular deposit does carry — are dropped
    rather than emitted as zero-area triangles that would break normals and
    every downstream area computation.

    Only the classic `POLYGONS ncells nints` layout is implemented. VTK 5.1
    replaced it with OFFSETS/CONNECTIVITY sub-arrays; a file using that is
    refused by name rather than misread, because the two layouts are
    indistinguishable from the counts alone.
    """
    raw = path.read_bytes()
    header_end = 0
    lines: list[str] = []
    while len(lines) < 5 and header_end < len(raw):
        stop = raw.find(b"\n", header_end)
        if stop < 0:
            break
        lines.append(raw[header_end:stop].decode("ascii", "replace").strip())
        header_end = stop + 1

    if not lines or not lines[0].startswith("# vtk DataFile Version"):
        raise ValueError(f"{path.name}: not a legacy VTK file")
    encoding = lines[2].upper()
    if encoding not in ("ASCII", "BINARY"):
        raise ValueError(f"{path.name}: unknown VTK encoding {lines[2]!r}")
    if not lines[3].upper().startswith("DATASET POLYDATA"):
        raise ValueError(f"{path.name}: expected DATASET POLYDATA, got {lines[3]!r}")

    if encoding == "ASCII":
        return _polydata_ascii(path, raw.decode("ascii", "replace"))
    return _polydata_binary(path, raw)


def _fan_triangulate(polygons: list[np.ndarray], path: Path) -> np.ndarray:
    faces: list[tuple[int, int, int]] = []
    for polygon in polygons:
        for corner in range(1, len(polygon) - 1):
            tri = (int(polygon[0]), int(polygon[corner]), int(polygon[corner + 1]))
            if tri[0] != tri[1] and tri[1] != tri[2] and tri[0] != tri[2]:
                faces.append(tri)
    if not faces:
        raise ValueError(f"{path.name}: no non-degenerate triangles")
    return np.asarray(faces, dtype=np.int32)


def _polydata_ascii(path: Path, text: str) -> Surface:
    tokens = text.split()
    try:
        points_at = tokens.index("POINTS")
    except ValueError as cause:
        raise ValueError(f"{path.name}: no POINTS section") from cause

    count = int(tokens[points_at + 1])
    start = points_at + 3  # skip POINTS n <dtype>
    values = np.asarray(tokens[start:start + count * 3], dtype=np.float64)
    vertices = values.reshape(count, 3)

    if "POLYGONS" not in tokens:
        raise ValueError(f"{path.name}: no POLYGONS section — this reader emits surfaces only")
    polys_at = tokens.index("POLYGONS")
    cells, ints = int(tokens[polys_at + 1]), int(tokens[polys_at + 2])
    if tokens[polys_at + 3] in ("OFFSETS", "CONNECTIVITY"):
        raise ValueError(
            f"{path.name}: VTK 5.1 OFFSETS/CONNECTIVITY polygons are not implemented"
        )
    flat = np.asarray(tokens[polys_at + 3:polys_at + 3 + ints], dtype=np.int64)

    polygons, cursor = [], 0
    for _ in range(cells):
        size = int(flat[cursor])
        polygons.append(flat[cursor + 1:cursor + 1 + size])
        cursor += size + 1
    return Surface(name=path.stem, vertices=vertices.astype(np.float32),
                   faces=_fan_triangulate(polygons, path))


def _polydata_binary(path: Path, raw: bytes) -> Surface:
    """Binary legacy VTK: ASCII section headers, big-endian payloads."""
    def section(keyword: bytes, after: int) -> tuple[list[bytes], int]:
        at = raw.find(keyword, after)
        if at < 0:
            raise ValueError(f"{path.name}: no {keyword.decode()} section")
        stop = raw.find(b"\n", at)
        return raw[at:stop].split(), stop + 1

    header, cursor = section(b"POINTS", 0)
    count = int(header[1])
    dtype = {b"float": ">f4", b"double": ">f8"}.get(header[2].lower())
    if dtype is None:
        raise ValueError(f"{path.name}: unsupported POINTS type {header[2]!r}")
    width = 4 if dtype == ">f4" else 8
    vertices = np.frombuffer(raw, dtype=dtype, count=count * 3, offset=cursor)
    vertices = vertices.reshape(count, 3).astype(np.float32)

    header, cursor = section(b"POLYGONS", cursor + count * 3 * width)
    cells, ints = int(header[1]), int(header[2])
    flat = np.frombuffer(raw, dtype=">i4", count=ints, offset=cursor).astype(np.int64)

    polygons, at = [], 0
    for _ in range(cells):
        size = int(flat[at])
        polygons.append(flat[at + 1:at + 1 + size])
        at += size + 1
    return Surface(name=path.stem, vertices=vertices, faces=_fan_triangulate(polygons, path))


#: Cell types whose boundary this pipeline can extract, VTK's own numbering.
_VTK_TRIANGLE, _VTK_QUAD, _VTK_TETRA, _VTK_HEXAHEDRON = 5, 9, 10, 12


def read_vtu(path: Path) -> Surface:
    """
    Read an XML VTU (`UnstructuredGrid`) and return its BOUNDARY surface.

    A VTU is usually volumetric. What the viewer needs is a surface, and the
    boundary of a tetrahedral volume is exactly the set of triangular faces
    belonging to one element only — the same derivation `tet_group_surface`
    performs for the Rodero mesh, done here without the tag selection.

    Surface cells (triangles, quads) are taken as they stand: a file that is
    already a surface has no interior faces to discard.

    `appended` raw/base64 data and both zlib and uncompressed encodings are
    handled. Any other compressor is refused by name.
    """
    import xml.etree.ElementTree as ElementTree

    raw = path.read_bytes()
    # The appended-data block is not valid XML, so it is cut out before parsing
    # rather than after: an XML parser handed raw binary fails on the first byte
    # that is not UTF-8, which is a confusing error for a well-formed file.
    appended = b""
    appended_base64 = False
    marker = raw.find(b"<AppendedData")
    if marker >= 0:
        # The appended block carries its OWN encoding, independent of every
        # DataArray's `format`. VTK writes `raw` or `base64` here, and the KIT
        # mechanics mesh uses base64 — so an "appended" array in that file is a
        # base64 string at a character offset, not bytes at a byte offset.
        head = raw[marker:raw.find(b">", marker)]
        appended_base64 = b'encoding="base64"' in head
        start = raw.find(b"_", marker) + 1
        stop = raw.rfind(b"</AppendedData>")
        appended = raw[start:stop]
        raw = raw[:marker] + b"</VTKFile>"

    root = ElementTree.fromstring(raw.decode("utf-8", "replace"))
    order = "<" if root.get("byte_order", "LittleEndian") == "LittleEndian" else ">"
    header_type = root.get("header_type", "UInt32")
    compressor = root.get("compressor", "")
    if compressor and "ZLib" not in compressor:
        raise ValueError(f"{path.name}: unsupported compressor {compressor!r}")

    piece = root.find(".//Piece")
    if piece is None:
        raise ValueError(f"{path.name}: no Piece element")

    def array(parent_tag: str, name: str) -> np.ndarray:
        parent = piece.find(parent_tag)
        if parent is None:
            raise ValueError(f"{path.name}: no {parent_tag} element")
        for node in parent.findall("DataArray"):
            if node.get("Name") == name or parent_tag == "Points":
                return _vtu_array(node, appended, appended_base64, order, header_type,
                                  bool(compressor), path)
        raise ValueError(f"{path.name}: no DataArray named {name!r}")

    points = array("Points", "Points").reshape(-1, 3).astype(np.float32)
    connectivity = array("Cells", "connectivity").astype(np.int64)
    offsets = array("Cells", "offsets").astype(np.int64)
    types = array("Cells", "types").astype(np.int64)

    starts = np.concatenate(([0], offsets[:-1]))
    sizes = offsets - starts

    def gather(cell_type: int, width: int) -> np.ndarray:
        """The connectivity of every cell of one type, as an (N, width) block."""
        selected = np.flatnonzero((types == cell_type) & (sizes == width))
        if selected.size == 0:
            return np.empty((0, width), dtype=np.int64)
        picks = starts[selected][:, None] + np.arange(width)[None, :]
        return connectivity[picks]

    return boundary_surface(
        path.stem,
        points,
        triangles=gather(_VTK_TRIANGLE, 3),
        quads=gather(_VTK_QUAD, 4),
        tets=gather(_VTK_TETRA, 4),
        present=sorted(set(types.tolist())),
        origin=path.name,
    )


def boundary_surface(name: str, points: np.ndarray, *, triangles: np.ndarray,
                     quads: np.ndarray, tets: np.ndarray, present: list[int],
                     origin: str) -> Surface:
    """
    The renderable surface of a cell complex: its surface cells plus the
    BOUNDARY of its volumetric ones.

    Shared by the XML VTU reader and the legacy VTK unstructured-grid reader,
    which differ entirely in how they get the arrays and not at all in what has
    to be done with them.

    Vectorised on purpose. A Python loop over cells is unusable here: the KIT
    mechanics mesh carries hundreds of thousands of tetrahedra, and walking them
    one at a time took over ten minutes before this was rewritten.
    """
    blocks = [triangles]
    if quads.size:
        blocks.append(quads[:, [0, 1, 2]])
        blocks.append(quads[:, [0, 2, 3]])

    if tets.size:
        faces = np.concatenate([
            tets[:, [0, 2, 1]], tets[:, [0, 1, 3]], tets[:, [0, 3, 2]], tets[:, [1, 2, 3]],
        ])
        # Interior faces are shared by two tetrahedra, boundary faces by one.
        # Sorting each face's indices makes the two orientations of one shared
        # face compare equal, which is what "shared" has to mean here — and the
        # ORIGINAL winding is kept, so the boundary comes out facing outward.
        keyed = np.sort(faces, axis=1)
        order = np.lexsort((keyed[:, 2], keyed[:, 1], keyed[:, 0]))
        keyed, faces = keyed[order], faces[order]
        same_as_next = np.zeros(len(keyed), dtype=bool)
        same_as_next[:-1] = np.all(keyed[1:] == keyed[:-1], axis=1)
        shared = same_as_next.copy()
        shared[1:] |= same_as_next[:-1]
        blocks.append(faces[~shared])

    kept = [block for block in blocks if block.size]
    if not kept:
        unsupported = sorted(set(present) - {_VTK_TRIANGLE, _VTK_QUAD, _VTK_TETRA})
        raise ValueError(
            f"{origin}: no surface cells; unsupported VTK cell types present: {unsupported}"
        )
    return Surface(name=name, vertices=points,
                   faces=np.concatenate(kept).astype(np.int32))


def read_vtk_unstructured(path: Path) -> Surface:
    """
    Read a legacy VTK `DATASET UNSTRUCTURED_GRID` and return its boundary.

    ASCII or binary, classic `CELLS n size` layout. Cells of unsupported types
    are skipped rather than misread — a grid of hexahedra would come back empty
    and raise, naming the types it found.

    The STRAUS ultrasound meshes are this: binary, 11,370 points and 47,186
    tetrahedra per frame, one file per time step.
    """
    raw = path.read_bytes()
    encoding, cursor = _legacy_header(raw, path, b"UNSTRUCTURED_GRID")
    text = raw.decode("ascii", "replace") if encoding == "ASCII" else ""

    if encoding == "ASCII":
        tokens = text.split()
        at = tokens.index("POINTS")
        count = int(tokens[at + 1])
        points = np.asarray(tokens[at + 3:at + 3 + count * 3],
                            dtype=np.float64).reshape(count, 3).astype(np.float32)
        at = tokens.index("CELLS")
        cells, ints = int(tokens[at + 1]), int(tokens[at + 2])
        flat = np.asarray(tokens[at + 3:at + 3 + ints], dtype=np.int64)
        at = tokens.index("CELL_TYPES")
        types = np.asarray(tokens[at + 2:at + 2 + cells], dtype=np.int64)
    else:
        header, cursor = _legacy_section(raw, b"POINTS", cursor, path)
        count = int(header[1])
        dtype = {b"float": ">f4", b"double": ">f8"}.get(header[2].lower())
        if dtype is None:
            raise ValueError(f"{path.name}: unsupported POINTS type {header[2]!r}")
        points = np.frombuffer(raw, dtype=dtype, count=count * 3, offset=cursor)
        points = points.reshape(count, 3).astype(np.float32)
        cursor += count * 3 * np.dtype(dtype).itemsize

        header, cursor = _legacy_section(raw, b"CELLS", cursor, path)
        cells, ints = int(header[1]), int(header[2])
        flat = np.frombuffer(raw, dtype=">i4", count=ints, offset=cursor).astype(np.int64)
        cursor += ints * 4

        header, cursor = _legacy_section(raw, b"CELL_TYPES", cursor, path)
        types = np.frombuffer(raw, dtype=">i4", count=cells, offset=cursor).astype(np.int64)

    sizes, starts = _legacy_cell_index(flat, cells)

    def gather(cell_type: int, width: int) -> np.ndarray:
        selected = np.flatnonzero((types == cell_type) & (sizes == width))
        if selected.size == 0:
            return np.empty((0, width), dtype=np.int64)
        return flat[starts[selected][:, None] + np.arange(width)[None, :]]

    return boundary_surface(
        path.stem, points,
        triangles=gather(_VTK_TRIANGLE, 3),
        quads=gather(_VTK_QUAD, 4),
        tets=gather(_VTK_TETRA, 4),
        present=sorted(set(types.tolist())),
        origin=path.name,
    )


def read_vtk(path: Path) -> Surface:
    """A legacy `.vtk` file of either dataset kind this pipeline can render."""
    raw = path.read_bytes()
    dataset = _legacy_dataset(raw, path)
    if dataset == b"POLYDATA":
        return read_vtk_polydata(path)
    if dataset == b"UNSTRUCTURED_GRID":
        return read_vtk_unstructured(path)
    raise ValueError(f"{path.name}: DATASET {dataset.decode()} is not implemented")




def _vtu_array(node, appended: bytes, appended_base64: bool, order: str, header_type: str,
               compressed: bool, path: Path) -> np.ndarray:
    """One VTU `DataArray`, whichever of the encodings it uses."""
    numpy_type = {
        "Float32": "f4", "Float64": "f8",
        "Int8": "i1", "UInt8": "u1", "Int16": "i2", "UInt16": "u2",
        "Int32": "i4", "UInt32": "u4", "Int64": "i8", "UInt64": "u8",
    }.get(node.get("type", ""))
    if numpy_type is None:
        raise ValueError(f"{path.name}: unsupported DataArray type {node.get('type')!r}")
    dtype = np.dtype(order + numpy_type)
    head = np.dtype(order + ("u8" if header_type == "UInt64" else "u4"))

    encoding = node.get("format", "ascii")
    if encoding == "ascii":
        return np.asarray((node.text or "").split(), dtype=dtype.newbyteorder("="))

    if encoding == "appended":
        offset = int(node.get("offset", "0"))
        payload = (
            _from_base64(appended[offset:].decode("ascii", "replace"), head, compressed)
            if appended_base64 else appended[offset:]
        )
    elif encoding == "binary":
        payload = _from_base64((node.text or "").strip(), head, compressed)
    else:
        raise ValueError(f"{path.name}: unsupported DataArray format {encoding!r}")

    if compressed:
        return _zlib_blocks(payload, head, dtype)
    size = int(np.frombuffer(payload, dtype=head, count=1)[0])
    return np.frombuffer(payload, dtype=dtype, count=size // dtype.itemsize,
                         offset=head.itemsize)


def _base64_length(byte_count: int) -> int:
    """Base64 characters needed to encode `byte_count` bytes."""
    return ((byte_count + 2) // 3) * 4


def _from_base64(text: str, head: np.dtype, compressed: bool) -> bytes:
    """
    Decode ONE base64-encoded array to the bytes a raw payload would have given.

    Two things make this more than a `b64decode` call.

    VTK encodes a COMPRESSED array as two separate base64 strings laid end to
    end — the block header, then the blocks — so decoding the whole thing in one
    call yields garbage after the first string.

    And in a base64 `AppendedData` block every array's string is concatenated
    with the next one's, so `text` runs past the end of the array being read.
    Both branches therefore decode exactly as many characters as the declared
    lengths call for and no more; taking the rest would run into the following
    array's padding, where the decoder gives up or silently truncates.
    """
    if not compressed:
        # header and data are one base64 string. 12 characters decode to 9
        # bytes, enough for the length under either header width.
        length = int(np.frombuffer(base64.b64decode(text[:12]), dtype=head, count=1)[0])
        return base64.b64decode(text[:_base64_length(head.itemsize + length)])

    blocks = int(np.frombuffer(base64.b64decode(text[:12]), dtype=head, count=1)[0])
    header_chars = _base64_length((3 + blocks) * head.itemsize)
    header = base64.b64decode(text[:header_chars])
    sizes = np.frombuffer(header, dtype=head, count=blocks, offset=3 * head.itemsize)
    data_chars = _base64_length(int(sizes.sum()))
    return header + base64.b64decode(text[header_chars:header_chars + data_chars])


def _zlib_blocks(payload: bytes, head: np.dtype, dtype: np.dtype) -> np.ndarray:
    """
    Decompress VTK's block-structured zlib payload.

    Layout: `[block count, uncompressed block size, size of the last block,
    compressed size of block 0, ... of block n-1]`, then the compressed blocks
    laid end to end.
    """
    import zlib

    blocks = int(np.frombuffer(payload, dtype=head, count=1)[0])
    sizes = np.frombuffer(payload, dtype=head, count=blocks, offset=3 * head.itemsize)
    cursor = (3 + blocks) * head.itemsize
    chunks = []
    for size in sizes:
        chunks.append(zlib.decompress(payload[cursor:cursor + int(size)]))
        cursor += int(size)
    return np.frombuffer(b"".join(chunks), dtype=dtype)


def read_ply(path: Path) -> Surface:
    """
    Read an ASCII PLY triangle surface.

    Only `format ascii 1.0`, and only the `x`/`y`/`z` vertex properties plus a
    face index list. Binary PLY is refused by name rather than guessed at: the
    property list in the header is free-form, and a reader that assumed a layout
    would silently return a mesh of noise for a file that used a different one.

    The CobivecoX deposit writes ASCII PLY throughout, one file per surface —
    endocardium, epicardium, and one ring per valve annulus.
    """
    with path.open("r", errors="replace") as handle:
        if handle.readline().strip() != "ply":
            raise ValueError(f"{path.name}: not a PLY file")

        encoding, vertex_count, face_count = "", 0, 0
        element, properties = "", []
        while True:
            line = handle.readline()
            if not line:
                raise ValueError(f"{path.name}: PLY header has no end_header")
            fields = line.split()
            if not fields:
                continue
            if fields[0] == "format":
                encoding = fields[1]
            elif fields[0] == "element":
                element = fields[1]
                if element == "vertex":
                    vertex_count = int(fields[2])
                elif element == "face":
                    face_count = int(fields[2])
            elif fields[0] == "property" and element == "vertex" and fields[1] != "list":
                properties.append(fields[-1])
            elif fields[0] == "end_header":
                break

        if encoding != "ascii":
            raise ValueError(f"{path.name}: only ASCII PLY is implemented, not {encoding!r}")
        for axis in ("x", "y", "z"):
            if axis not in properties:
                raise ValueError(f"{path.name}: vertices carry no {axis!r} property")
        columns = [properties.index(axis) for axis in ("x", "y", "z")]

        vertices = np.empty((vertex_count, 3), dtype=np.float64)
        for index in range(vertex_count):
            fields = handle.readline().split()
            vertices[index] = [float(fields[column]) for column in columns]

        polygons = []
        for _ in range(face_count):
            fields = handle.readline().split()
            polygons.append(np.asarray(fields[1:1 + int(fields[0])], dtype=np.int64))

    if not polygons:
        raise ValueError(f"{path.name}: PLY carries no faces")
    return Surface(
        name=path.stem,
        vertices=vertices.astype(np.float32),
        faces=_fan_triangulate(polygons, path),
    )


def read_obj(path: Path) -> Surface:
    """
    Read a Wavefront OBJ as one triangle surface.

    Groups and materials are ignored on purpose: where a source divides its
    anatomy, it does so with separate FILES (BodyParts3D ships one OBJ per
    element), and the geometry ingest maps one file to one structure. Reading
    `g` groups as well would give two competing definitions of a structure.
    """
    vertices: list[tuple[float, float, float]] = []
    polygons: list[list[int]] = []
    with path.open("r", errors="replace") as handle:
        for line in handle:
            if line.startswith("v "):
                parts = line.split()
                vertices.append((float(parts[1]), float(parts[2]), float(parts[3])))
            elif line.startswith("f "):
                corners = []
                for token in line.split()[1:]:
                    index = int(token.split("/")[0])
                    # OBJ indices are 1-based, and negative means "from the end".
                    corners.append(index - 1 if index > 0 else len(vertices) + index)
                polygons.append(corners)
    if not vertices or not polygons:
        raise ValueError(f"{path.name}: OBJ carries no faces")
    return Surface(
        name=path.stem,
        vertices=np.asarray(vertices, dtype=np.float32),
        faces=_fan_triangulate([np.asarray(p) for p in polygons], path),
    )


def read_stl(path: Path) -> Surface:
    """
    Read an STL, binary or ASCII, deciding by ARITHMETIC rather than by the word
    "solid".

    An ASCII STL begins "solid" — and so do plenty of binary ones, because the
    80-byte binary header is free text and exporters write a name into it. The
    KIT four-chamber deposit ships both flavours in one archive, every file
    headed "Visualization Toolkit generated SLA File", so the header says
    nothing at all about which is which.

    A binary STL is exactly `84 + 50 * count` bytes, where `count` is the
    little-endian uint32 at offset 80. If the file size matches that to the
    byte, it is binary; nothing else plausibly does. Anything else is read as
    ASCII.
    """
    raw = path.read_bytes()
    if len(raw) >= 84:
        count = struct.unpack("<I", raw[80:84])[0]
        if len(raw) == 84 + 50 * count:
            return read_binary_stl(path)
    return read_ascii_stl(path)


def read_ascii_stl(path: Path) -> Surface:
    """Read an ASCII STL into a welded surface."""
    corners: list[tuple[float, float, float]] = []
    with path.open("r", errors="replace") as handle:
        for line in handle:
            stripped = line.strip()
            if stripped.startswith("vertex "):
                _, x, y, z = stripped.split()
                corners.append((float(x), float(y), float(z)))
    if len(corners) < 3 or len(corners) % 3 != 0:
        raise ValueError(f"{path.name}: {len(corners)} vertices is not whole triangles")

    points = np.asarray(corners, dtype=np.float32)
    vertices, inverse = np.unique(points, axis=0, return_inverse=True)
    return Surface(
        name=path.stem,
        vertices=vertices.astype(np.float32),
        faces=inverse.reshape(-1, 3).astype(np.int32),
    )


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
