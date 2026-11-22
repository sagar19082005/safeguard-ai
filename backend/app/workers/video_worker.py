import os
import time

import cv2
from sqlalchemy import select

from ..db import SessionLocal
from ..detection import YoloPPEEngine
from ..models import Camera, ProcessingJob
from ..config import settings
from ..routers.detection import _people_payload, _process_frame_detections
from ..safety import required_ppe_for_camera

engine = YoloPPEEngine(
    settings.person_model_path,
    settings.ppe_model_path,
    settings.detection_confidence,
    settings.tracking_distance_px,
)


def process_job(job: ProcessingJob) -> dict:
    if not engine.configured:
        raise RuntimeError("Configure PPE_MODEL_PATH with a trained YOLO PPE model first.")
    if not job.input_path or not os.path.isfile(job.input_path):
        raise RuntimeError("Queued video file is missing.")

    cap = cv2.VideoCapture(job.input_path)
    if not cap.isOpened():
        raise RuntimeError("The uploaded video could not be decoded.")

    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    frame_interval = max(1, int(fps))
    timeline = []
    total_violations = 0
    frame_idx = 0
    analyzed_count = 0

    try:
        while cap.isOpened() and analyzed_count < 60:
            ret, frame = cap.read()
            if not ret:
                break
            if frame_idx % frame_interval == 0:
                analyzed_count += 1
                timestamp_sec = round(frame_idx / fps, 2)
                with SessionLocal() as db:
                    camera = db.get(Camera, job.camera_id) if job.camera_id else None
                    required_items = required_ppe_for_camera(db, camera) if camera else {"helmet", "vest"}
                    people = _people_payload(engine.analyze(frame, required_items), required_items)
                    new_violations = []
                    if camera and people:
                        new_violations = _process_frame_detections(
                            db, camera, frame, people, required_items, source="video_upload"
                        )
                        db.commit()
                        total_violations += len(new_violations)
                timeline.append({
                    "timestamp": timestamp_sec,
                    "frame_index": frame_idx,
                    "people": people,
                    "person_count": len(people),
                    "compliant_count": sum(p["status"] == "compliant" for p in people),
                    "non_compliant_count": sum(p["status"] == "non_compliant" for p in people),
                    "uncertain_count": sum(p["status"] == "uncertain" for p in people),
                })
            frame_idx += 1
    finally:
        cap.release()

    return {
        "frames_analyzed": analyzed_count,
        "timeline": timeline,
        "total_violations": total_violations,
    }


def run() -> None:
    while True:
        with SessionLocal() as db:
            job = db.scalar(
                select(ProcessingJob)
                .where(ProcessingJob.status == "queued", ProcessingJob.kind == "video_analysis")
                .order_by(ProcessingJob.created_at)
                .limit(1)
            )
            if job is None:
                job_id = None
            else:
                job_id = job.id
                job.status = "processing"
                db.commit()

        if job_id is not None:
            with SessionLocal() as db:
                job = db.get(ProcessingJob, job_id)
                try:
                    result = process_job(job)
                    job.status = "completed"
                    job.result = result
                    job.error = None
                except Exception as exc:
                    job.status = "failed"
                    job.error = str(exc)
                db.commit()
            if job.input_path and os.path.exists(job.input_path):
                os.remove(job.input_path)
        else:
            time.sleep(settings.worker_poll_seconds)


if __name__ == "__main__":
    run()
