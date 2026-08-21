"""Focused geometry tests for the immutable candidate-set-002 derivation."""
from __future__ import annotations

import math
import unittest

import numpy as np

import view_candidates_v2 as subject


def probe() -> dict:
    return {
        "origin": [0.0, 0.0, 0.0],
        "beam_axis": [1.0, 0.0, 0.0],
        "lateral_axis": [0.0, 1.0, 0.0],
        "fan": {"angle_deg": 80.0, "depth_cm": 2.0, "focus_cm": 1.0},
        "display": {"vertex": "down", "flip_lr": False, "marker_side": "left"},
    }


class ClippedTetraEnvelopeTests(unittest.TestCase):
    def crossing_tetra(self, lateral_sign: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
        # No original vertex is inside +/-12 mm.  The A-B edge nevertheless
        # crosses the slab, reaching y=+/-40 mm at z=+12 mm.  A vertex-only
        # implementation would see no geometry and cannot pass this case.
        points = np.array([
            [10.0, 0.0, -20.0],
            [10.0, lateral_sign * 50.0, 20.0],
            [20.0, 0.0, -20.0],
            [20.0, 0.0, 20.0],
        ])
        return points, np.array([[0, 1, 2, 3]], dtype=np.int64)

    def test_edge_intersections_cover_a_tetra_with_no_vertex_in_the_slab(self) -> None:
        points, tets = self.crossing_tetra()
        measured = subject.measure_required_shift(points, tets, probe())
        expected = (
            subject.LATERAL_MARGIN_FACTOR * 40.0 / math.tan(math.radians(40.0))
            - 10.0
        )
        self.assertEqual(measured.source_vertices_in_slab, 0)
        self.assertGreater(measured.slab_edge_intersections, 0)
        self.assertEqual(measured.tetrahedra_intersecting_slab, 1)
        self.assertAlmostEqual(measured.shift_mm, expected, places=10)

    def test_both_fan_sides_have_the_same_exact_answer(self) -> None:
        positive = subject.measure_required_shift(*self.crossing_tetra(1.0), probe())
        negative = subject.measure_required_shift(*self.crossing_tetra(-1.0), probe())
        self.assertAlmostEqual(positive.shift_mm, negative.shift_mm, places=12)

    def test_a_pose_with_room_already_available_does_not_move(self) -> None:
        points = np.array([
            [20.0, -1.0, -1.0],
            [20.0, 1.0, -1.0],
            [22.0, 0.0, 1.0],
            [24.0, 0.0, 0.0],
        ])
        tets = np.array([[0, 1, 2, 3]], dtype=np.int64)
        measured = subject.measure_required_shift(points, tets, probe())
        self.assertEqual(measured.shift_mm, 0.0)

    def test_provisional_aperture_gap_is_independent_of_fan_side_room(self) -> None:
        points = np.array([
            [20.0, -1.0, -1.0],
            [20.0, 1.0, -1.0],
            [22.0, 0.0, 1.0],
            [24.0, 0.0, 0.0],
        ])
        tets = np.array([[0, 1, 2, 3]], dtype=np.int64)

        self.assertEqual(subject.measure_required_shift(points, tets, probe()).shift_mm, 0.0)
        self.assertEqual(
            subject.measure_required_aperture_gap_shift(points, probe()),
            subject.PROVISIONAL_ADULT_APERTURE_GAP_MM - 20.0,
        )
        fitted = subject.fit_probe(points, tets, probe())
        self.assertGreaterEqual(
            fitted.minimum_source_forward_projection_mm,
            subject.PROVISIONAL_ADULT_APERTURE_GAP_MM,
        )
        self.assertAlmostEqual(fitted.applied_shift_mm, 10.000001, places=6)

    def test_explicit_shift_cannot_undercut_the_provisional_aperture_gap(self) -> None:
        points = np.array([
            [20.0, -1.0, -1.0],
            [20.0, 1.0, -1.0],
            [22.0, 0.0, 1.0],
            [24.0, 0.0, 0.0],
        ])
        tets = np.array([[0, 1, 2, 3]], dtype=np.int64)
        with self.assertRaisesRegex(Exception, "below measured requirement"):
            subject.fit_probe(points, tets, probe(), applied_shift_mm=9.0)

    def test_fit_preserves_plane_focus_and_never_shrinks_depth(self) -> None:
        points, tets = self.crossing_tetra()
        original = probe()
        fitted = subject.fit_probe(points, tets, original)

        old_origin = np.array(original["origin"])
        new_origin = np.array(fitted.probe["origin"])
        beam = np.array(original["beam_axis"])
        lateral = np.array(original["lateral_axis"])
        normal = np.cross(beam, lateral)
        self.assertAlmostEqual(float(np.dot(new_origin - old_origin, normal)), 0.0, places=12)
        np.testing.assert_array_equal(fitted.probe["beam_axis"], original["beam_axis"])
        np.testing.assert_array_equal(fitted.probe["lateral_axis"], original["lateral_axis"])
        self.assertLessEqual(
            float(np.linalg.norm(fitted.new_focus_world - fitted.old_focus_world)),
            subject.FOCUS_WORLD_TOLERANCE_MM,
        )
        self.assertGreaterEqual(
            float(fitted.probe["fan"]["depth_cm"]),
            float(original["fan"]["depth_cm"]),
        )
        depth_margin = (
            float(fitted.probe["fan"]["depth_cm"]) * 10.0
            - fitted.measurement.farthest_mm
        )
        self.assertGreaterEqual(depth_margin + 1e-9, subject.DISTAL_GUARD_MM)
        self.assertLessEqual(
            fitted.measurement.maximum_half_width_occupancy,
            1.0 / subject.LATERAL_MARGIN_FACTOR + 1e-12,
        )

    def test_margin_smaller_than_one_is_rejected(self) -> None:
        points, tets = self.crossing_tetra()
        with self.assertRaisesRegex(Exception, "margin factor"):
            subject.measure_required_shift(
                points,
                tets,
                probe(),
                lateral_margin_factor=0.99,
            )

    def test_existing_b1_becomes_an_explicit_probe_only_layout_replacement(self) -> None:
        inputs = subject.legacy.load_inputs()
        candidate = subject.build_b1(inputs)
        source = next(
            view
            for view in inputs.pack["views"]
            if view["view_id"] == "b1-apical-four-chamber"
        )

        self.assertEqual(candidate["kind"], "single")
        self.assertEqual(candidate["intended_view_id"], source["view_id"])
        self.assertEqual(candidate["replaces_source_view_id"], source["view_id"])
        self.assertNotIn("sweep", candidate["coordinates"])
        fitted = candidate["coordinates"]["probe"]
        np.testing.assert_array_equal(fitted["beam_axis"], source["probe"]["beam_axis"])
        np.testing.assert_array_equal(fitted["lateral_axis"], source["probe"]["lateral_axis"])
        self.assertEqual(fitted["fan"]["depth_cm"], 18.26)
        self.assertEqual(fitted["fan"]["focus_cm"], 11.43)
        proxy = next(
            check
            for check in candidate["checks"]
            if check["check_id"].endswith(".aperture-gap-proxy")
        )
        self.assertEqual(
            proxy["measurement"]["provisional_adult_aperture_gap_mm"],
            30.0,
        )
        self.assertAlmostEqual(
            proxy["measurement"]["minimum_source_forward_projection_mm"],
            30.000001,
            places=6,
        )
        envelope = next(
            check for check in candidate["checks"] if check["check_id"].endswith(".fan-envelope")
        )
        self.assertAlmostEqual(
            envelope["measurement"]["applied_backward_shift_mm"],
            21.99935,
            places=6,
        )
        self.assertGreaterEqual(envelope["measurement"]["minimum_side_clearance_mm"], 4.6)


if __name__ == "__main__":
    unittest.main()
