from __future__ import annotations

from dataclasses import dataclass
from math import hypot
from typing import Any


LABEL_ALIASES = {
    "hard_hat": "helmet",
    "hard-hat": "helmet",
    "no-helmet": "no_helmet",
    "no_helmet": "no_helmet",
    "no-vest": "no_vest",
    "no_vest": "no_vest",
    "boots": "shoes",
    "no-boots": "no_shoes",
    "no_boots": "no_shoes",
    "glass": "goggles",
    "glasses": "goggles",
    "no-glass": "no_goggles",
    "no_glass": "no_goggles",
    "glove": "gloves",
    "no-glove": "no_gloves",
    "no_glove": "no_gloves",
    "ear-protection": "ear",
    "ear_protection": "ear",
    "no-ear-protection": "no_ear",
    "no_ear_protection": "no_ear",
    "mask": "mask",
    "no-mask": "no_mask",
    "no_mask": "no_mask",
    "vest": "vest",
}


def normalize_label(label: str) -> str:
    cleaned = label.strip().lower()
    normalized = cleaned.replace(" ", "_").replace("-", "_")
    return LABEL_ALIASES.get(cleaned, LABEL_ALIASES.get(normalized, normalized))


@dataclass(frozen=True)
class DetectionBox:
    label: str
    confidence: float
    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def center(self) -> tuple[float, float]:
        return ((self.x1 + self.x2) / 2, (self.y1 + self.y2) / 2)

    def contains_center(self, other: DetectionBox) -> bool:
        x, y = other.center
        h = max(1.0, self.y2 - self.y1)
        w = max(1.0, self.x2 - self.x1)
        # Margin: 15% above head (helmets/goggles), 10% below feet (boots), 5% horizontally
        pad_top = 0.15 * h
        pad_bottom = 0.10 * h
        pad_x = 0.05 * w
        return (self.x1 - pad_x) <= x <= (self.x2 + pad_x) and (self.y1 - pad_top) <= y <= (self.y2 + pad_bottom)


def point_in_polygon(x: float, y: float, polygon: list[list[float]]) -> bool:
    """Ray casting algorithm to determine if point (x, y) is inside polygon."""
    n = len(polygon)
    if n < 3:
        return False
    inside = False
    p1x, p1y = polygon[0]
    for i in range(1, n + 1):
        p2x, p2y = polygon[i % n]
        if y > min(p1y, p2y):
            if y <= max(p1y, p2y):
                if x <= max(p1x, p2x):
                    if p1y != p2y:
                        xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    if p1x == p2x or x <= xinters:
                        inside = not inside
        p1x, p1y = p2x, p2y
    return inside


@dataclass
class TrackedPerson:
    tracking_id: int
    box: DetectionBox
    equipment: dict[str, DetectionBox]
    status: str


def associate_equipment(
    people: list[DetectionBox],
    equipment: list[DetectionBox],
) -> list[dict[str, DetectionBox]]:
    associated: list[dict[str, DetectionBox]] = []
    for person in people:
        matches: dict[str, DetectionBox] = {}
        for item in equipment:
            if person.contains_center(item):
                current = matches.get(item.label)
                if current is None or item.confidence > current.confidence:
                    matches[item.label] = item
        associated.append(matches)
    return associated


def classify_person(
    equipment: dict[str, DetectionBox],
    required_items: set[str],
    *,
    visible: bool = True,
) -> str:
    if not visible:
        return "uncertain"
    missing_items = required_items - equipment.keys()
    explicit_missing = {f"no_{item}" for item in required_items} & equipment.keys()
    if not missing_items and not explicit_missing:
        return "compliant"
    if equipment or explicit_missing:
        return "non_compliant"
    return "uncertain"


class CentroidTracker:
    def __init__(self, max_distance: float = 100.0) -> None:
        self.max_distance = max_distance
        self._next_id = 1
        self._centers: dict[int, tuple[float, float]] = {}

    def update(self, boxes: list[DetectionBox]) -> list[int]:
        remaining = set(self._centers)
        ids: list[int] = []
        new_centers: dict[int, tuple[float, float]] = {}
        for box in boxes:
            center = box.center
            nearest = min(
                remaining,
                key=lambda identifier: hypot(
                    center[0] - self._centers[identifier][0],
                    center[1] - self._centers[identifier][1],
                ),
                default=None,
            )
            if nearest is not None:
                distance = hypot(
                    center[0] - self._centers[nearest][0],
                    center[1] - self._centers[nearest][1],
                )
            else:
                distance = float("inf")
            identifier = nearest if nearest is not None and distance <= self.max_distance else self._next_id
            if identifier == self._next_id:
                self._next_id += 1
            remaining.discard(identifier)
            new_centers[identifier] = center
            ids.append(identifier)
        self._centers = new_centers
        return ids


class YoloPPEEngine:
    """YOLO adapter for person + PPE models.

    The PPE model must be trained with labels such as ``helmet`` and ``vest``.
    A general COCO model can detect people, but cannot reliably detect PPE.
    """

    def __init__(
        self,
        person_model_path: str,
        ppe_model_path: str,
        confidence: float = 0.5,
        tracking_distance_px: float = 100.0,
    ) -> None:
        self.person_model_path = person_model_path
        self.ppe_model_path = ppe_model_path
        self.confidence = confidence
        self.tracker = CentroidTracker(tracking_distance_px)
        self._person_model: Any = None
        self._ppe_model: Any = None

    @property
    def configured(self) -> bool:
        return bool(self.ppe_model_path)

    def _load_models(self) -> None:
        if not self.configured:
            raise RuntimeError(
                "PPE_MODEL_PATH is not configured. Provide a trained YOLO PPE model "
                "with helmet and vest classes before running inference."
            )
        try:
            from ultralytics import YOLO
        except ImportError as exc:
            raise RuntimeError("The ultralytics package is required for Phase 2 inference.") from exc
        if self._person_model is None:
            self._person_model = YOLO(self.person_model_path)
        if self._ppe_model is None:
            self._ppe_model = YOLO(self.ppe_model_path)

    def _boxes(self, result: Any, *, labels: set[str] | None = None) -> list[DetectionBox]:
        names = result.names
        boxes: list[DetectionBox] = []
        for coordinates, confidence, class_id in zip(
            result.boxes.xyxy.tolist(),
            result.boxes.conf.tolist(),
            result.boxes.cls.tolist(),
        ):
            label = normalize_label(str(names[int(class_id)]))
            if labels is not None and label not in labels:
                continue
            if confidence < self.confidence:
                continue
            boxes.append(DetectionBox(label, float(confidence), *map(float, coordinates)))
        return boxes

    def analyze(self, frame: Any, required_items: set[str]) -> list[TrackedPerson]:
        self._load_models()
        ppe_result = self._ppe_model(frame, verbose=False)[0]
        equipment = [
            box for box in self._boxes(ppe_result)
            if box.label not in {"worker", "person"}
        ]
        people = self._boxes(ppe_result, labels={"worker", "person"})
        if not people:
            person_result = self._person_model(frame, verbose=False)[0]
            people = self._boxes(person_result, labels={"person"})
        matches = associate_equipment(people, equipment)
        tracking_ids = self.tracker.update(people)
        return [
            TrackedPerson(
                tracking_id=tracking_id,
                box=person,
                equipment=items,
                status=classify_person(items, required_items),
            )
            for tracking_id, person, items in zip(tracking_ids, people, matches)
        ]
