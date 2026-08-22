"""Focused tests for the labelled Heart0102 pack recipe."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from meshlib import Surface
import vhl_pack as subject


class DominantNonzeroTests(unittest.TestCase):
    def test_one_nonzero_voxel_survives_a_two_cubed_block(self) -> None:
        labels = np.zeros((384, 384, 384), dtype=np.uint8)
        labels[1, 1, 1] = 6
        reduced = subject.dominant_nonzero_downsample(labels)
        self.assertEqual(int(reduced[0, 0, 0]), 6)

    def test_equal_counts_choose_the_lower_tag(self) -> None:
        labels = np.zeros((384, 384, 384), dtype=np.uint8)
        labels[0, 0, 0] = 2
        labels[0, 0, 1] = 1
        reduced = subject.dominant_nonzero_downsample(labels)
        self.assertEqual(int(reduced[0, 0, 0]), 1)


class CoordinateTests(unittest.TestCase):
    def test_crop_keeps_a_zero_border_and_shifts_origin(self) -> None:
        mask = np.zeros((8, 9, 10), dtype=bool)
        mask[2:5, 3:7, 4:8] = True
        origin = np.array([-2.0, 5.0, 9.0])
        cropped, shifted = subject.cropped_binary(mask, origin, 0.5)
        self.assertEqual(cropped.shape, (5, 6, 6))
        self.assertEqual(subject.boundary_nonzero(cropped), 0)
        np.testing.assert_allclose(shifted, origin + np.array([1, 2, 3]) * 0.5)

    def test_rotated_mesh_to_volume_recovers_source_voxel_coordinates(self) -> None:
        rotation = subject.EXPECTED_ROTATION
        origin = np.array([-73.7, -74.3, -66.6])
        pitch = 0.387
        source = np.array([12.5, -7.25, 31.75])
        pack = rotation @ source
        actual = subject.apply_column_major(
            subject.mesh_to_volume(rotation, origin, pitch), pack,
        )
        np.testing.assert_allclose(actual, (source - origin) / (2.0 * pitch), atol=1e-10)


class GltfTests(unittest.TestCase):
    def test_multibuffer_writer_uses_one_distinct_buffer_per_structure(self) -> None:
        vertices = np.array([
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
        ], dtype=np.float32)
        faces = np.array([[0, 1, 2]], dtype=np.int32)
        surfaces = [
            Surface(name="first", vertices=vertices, faces=faces),
            Surface(name="second", vertices=vertices + 2.0, faces=faces),
        ]
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "model.gltf"
            subject.write_multibuffer_gltf(path, surfaces)
            document = json.loads(path.read_text())
            self.assertEqual([node["name"] for node in document["nodes"]], ["first", "second"])
            self.assertEqual(
                [buffer["uri"] for buffer in document["buffers"]],
                ["model.first.bin", "model.second.bin"],
            )
            self.assertEqual(
                [view["buffer"] for view in document["bufferViews"]],
                [0, 0, 0, 1, 1, 1],
            )
            self.assertTrue(all((path.parent / buffer["uri"]).is_file()
                                for buffer in document["buffers"]))


class MetadataPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        pack_path = subject.REPO / "public" / "packs" / subject.PACK_ID / "pack.json"
        cls.pack = json.loads(pack_path.read_text())
        cls.pack_note = cls.pack["provenance"]["modified"]["note"]
        cls.view_note = cls.pack["views"][0]["provenance"]["modified"]["note"]

    def test_plain_language_disclaimer_is_reproducible(self) -> None:
        for note in (self.pack_note, self.view_note):
            self.assertIn(subject.EDUCATIONAL_RESEARCH_DISCLAIMER, note)
            self.assertIn("SIMULATED ECHO", note)
            self.assertIn("educational and research/development proof-of-concept use only", note)
            self.assertIn("not for diagnosis, treatment, or clinical decision-making", note)
        self.assertNotIn("RUO", json.dumps(self.pack))

    def test_noncommercial_license_and_authored_identities_are_explicit(self) -> None:
        provenance = self.pack["provenance"]
        self.assertEqual(provenance["license"], "CC-BY-NC-4.0")
        self.assertEqual(provenance["license_state"], "non_commercial")
        self.assertIn("HAND-SEEDED DERIVATIVE", self.pack_note)
        self.assertIn("Every one of the twelve structure identities", self.pack_note)
        structures = self.pack["meshes"]["structures"]
        self.assertEqual(len(structures), 12)
        self.assertTrue(all(
            structure["blood_pool_decision"]["basis"] == "authored"
            for structure in structures
        ))

    def test_three_anatomy_caveats_remain_explicit(self) -> None:
        self.assertIn("RV lumen is 148.3 mL against an expected 60–100 mL", self.pack_note)
        self.assertIn("the excess volume is unresolved", self.pack_note)
        self.assertIn("RA lumen is 75.0 mL against 25–45 mL", self.pack_note)
        self.assertIn("includes the caval stubs and atrial appendage", self.pack_note)
        self.assertIn("LV wall : RV wall is 1.09 : 1", self.pack_note)
        self.assertIn("must not be used to teach wall thickness", self.pack_note)


if __name__ == "__main__":
    unittest.main()
