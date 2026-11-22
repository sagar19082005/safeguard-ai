import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import get_db
from app.main import app
from app.models import Base, Organization, ProcessingJob


class Phase20SmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(cls.engine)
        cls.Session = sessionmaker(cls.engine)

        def override_db():
            with cls.Session() as db:
                yield db

        app.dependency_overrides[get_db] = override_db
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.clear()
        cls.client.close()

    def setUp(self):
        with self.Session() as db:
            db.query(ProcessingJob).delete()
            db.commit()

    def test_health_endpoint(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})

    def test_protected_api_rejects_missing_token(self):
        response = self.client.get("/api/dashboard/summary")
        self.assertEqual(response.status_code, 401)

    def test_evidence_route_rejects_missing_token(self):
        response = self.client.get("/evidence/evidence_test.jpg")
        self.assertEqual(response.status_code, 401)

    def test_processing_job_round_trip(self):
        with self.Session() as db:
            org = Organization(name="Phase 20 Test")
            db.add(org)
            db.flush()
            job = ProcessingJob(
                organization_id=org.id,
                kind="video_analysis",
                status="queued",
                input_path="/tmp/phase20-test.mp4",
            )
            db.add(job)
            db.commit()
            job_id = job.id

            stored = db.get(ProcessingJob, job_id)
            self.assertEqual(stored.status, "queued")
            self.assertEqual(stored.kind, "video_analysis")


if __name__ == "__main__":
    unittest.main()
