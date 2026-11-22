import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.detection import (
    CentroidTracker,
    DetectionBox,
    associate_equipment,
    classify_person,
    point_in_polygon,
    normalize_label,
)


class DetectionLogicTests(unittest.TestCase):
    def test_ppe_labels_are_normalized_consistently(self):
        self.assertEqual(normalize_label("Hard-Hat"), "helmet")
        self.assertEqual(normalize_label("No_Vest"), "no_vest")
        self.assertEqual(normalize_label("Safety Shoes"), "safety_shoes")

    def test_equipment_is_associated_with_containing_person(self):
        person = DetectionBox("person", 0.9, 0, 0, 100, 200)
        helmet = DetectionBox("helmet", 0.8, 40, 10, 60, 30)
        vest = DetectionBox("vest", 0.7, 40, 70, 60, 130)
        self.assertEqual(
            set(associate_equipment([person], [helmet, vest])[0]),
            {"helmet", "vest"},
        )

    def test_missing_equipment_is_non_compliant_when_detection_is_visible(self):
        helmet = DetectionBox("helmet", 0.8, 40, 10, 60, 30)
        self.assertEqual(classify_person({"helmet": helmet}, {"helmet", "vest"}), "non_compliant")

    def test_no_equipment_is_uncertain(self):
        self.assertEqual(classify_person({}, {"helmet"}), "uncertain")

    def test_tracker_keeps_id_for_nearby_person(self):
        tracker = CentroidTracker(max_distance=20)
        first = DetectionBox("person", 0.9, 0, 0, 10, 10)
        second = DetectionBox("person", 0.9, 5, 0, 15, 10)
        self.assertEqual(tracker.update([first]), [1])
        self.assertEqual(tracker.update([second]), [1])

    def test_restricted_zone_contains_worker_feet(self):
        zone = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]]
        self.assertTrue(point_in_polygon(0.5, 0.5, zone))
        self.assertFalse(point_in_polygon(0.05, 0.5, zone))


if __name__ == "__main__":
    unittest.main()
