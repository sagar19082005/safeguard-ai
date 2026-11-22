import unittest
from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base, Camera, DetectionEvent, Location, Organization, PPEType, User, Violation
from app.routers.reports import export_csv, report_data


class ReportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(cls.engine)
        cls.Session = sessionmaker(cls.engine)

    def setUp(self):
        self.db = self.Session()
        org = Organization(name="Test site")
        other_org = Organization(name="Other site")
        self.db.add_all([org, other_org])
        self.db.flush()
        self.user = User(
            organization_id=org.id,
            email=f"admin-{self._testMethodName}@example.com",
            full_name="Admin",
            password_hash="hash",
            role="admin",
        )
        camera = Camera(organization_id=org.id, name="Camera A", kind="webcam")
        other_camera = Camera(organization_id=other_org.id, name="Camera B", kind="webcam")
        ppe = PPEType(code=f"helmet-{org.id}", name="Helmet")
        other_ppe = PPEType(code=f"vest-{org.id}", name="Vest")
        location = Location(organization_id=org.id, name="Zone A")
        self.db.add_all([self.user, camera, other_camera, ppe, other_ppe, location])
        self.db.flush()
        captured = datetime(2026, 11, 17, 10, 0, tzinfo=timezone.utc)
        self.db.add_all([
            DetectionEvent(camera_id=camera.id, status="compliant", detected_at=captured),
            DetectionEvent(camera_id=camera.id, status="non_compliant", detected_at=captured),
            Violation(
                organization_id=org.id,
                camera_id=camera.id,
                location_id=location.id,
                ppe_type_id=ppe.id,
                confidence=0.8,
                severity="high",
                created_at=captured,
            ),
            DetectionEvent(camera_id=other_camera.id, status="non_compliant", detected_at=captured),
            Violation(
                organization_id=other_org.id,
                camera_id=other_camera.id,
                ppe_type_id=other_ppe.id,
                confidence=0.8,
                severity="high",
                created_at=captured,
            ),
        ])
        self.db.commit()
        self.db.refresh(self.user)

    def tearDown(self):
        self.db.rollback()
        self.db.close()

    def test_summary_is_scoped_and_calculates_score(self):
        data = report_data(self.db, self.user, "day", captured_date())
        self.assertEqual(data["detections"], {"total": 2, "compliant": 1, "non_compliant": 1, "uncertain": 0})
        self.assertEqual(data["compliance_score"], 50.0)
        self.assertEqual(data["violation_total"], 1)
        self.assertEqual(data["analytics"][0]["location"], "Zone A")

    def test_csv_export_has_expected_columns(self):
        response = export_csv(
            "day", captured_date(), None, None, None, None, db=self.db, user=self.user
        )
        self.assertEqual(response.media_type, "text/csv")
        self.assertIn("date,missing_item,location,camera,worker,severity,count", response.body.decode())


def captured_date():
    return datetime(2026, 11, 17, tzinfo=timezone.utc).date()


if __name__ == "__main__":
    unittest.main()
