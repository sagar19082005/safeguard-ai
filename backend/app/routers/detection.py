from datetime import datetime, timedelta, timezone
from pathlib import Path
import os
import tempfile
import uuid

import jwt
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ..config import settings
from ..db import SessionLocal, get_db
from ..security import current_user
from ..detection import YoloPPEEngine, point_in_polygon
from ..models import Alert, Camera, DetectionEvent, Notification, PPEType, ProcessingJob, RestrictedZone, User, Violation
from ..safety import required_ppe_for_camera, severity_for_camera_ppe

router = APIRouter(prefix="/api/detection", tags=["detection"])
engine = YoloPPEEngine(
    settings.person_model_path,
    settings.ppe_model_path,
    settings.detection_confidence,
    settings.tracking_distance_px,
)

EVIDENCE_DIR = Path(__file__).resolve().parent.parent.parent / "evidence"
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _stream_user_id(token: str) -> int:
    try:
        return int(jwt.decode(token, settings.secret_key, algorithms=["HS256"])["sub"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(401, "Session expired. Sign in again.") from exc


PPE_LABELS = {
    "helmet": "helmet",
    "vest": "safety vest",
    "gloves": "gloves",
    "shoes": "safety shoes",
    "goggles": "safety goggles",
    "mask": "face mask",
    "ear": "ear protection",
    "harness": "safety harness",
}


def _people_payload(results, required_items: set[str]):
    required_labels = [PPE_LABELS.get(item, item.replace("_", " ")) for item in sorted(required_items)]
    return [
        _person_payload(person, required_items, required_labels)
        for person in results
    ]


def _person_payload(person, required_items: set[str], required_labels: list[str]) -> dict:
    detected_labels = set(person.equipment)
    missing_items = sorted(required_items - detected_labels)
    missing_labels = [PPE_LABELS.get(item, item.replace("_", " ")) for item in missing_items]
    if person.status == "compliant":
        reason = f"Compliant: all required PPE detected ({', '.join(required_labels)})."
    elif person.status == "non_compliant":
        reason = f"Non-compliant: missing required PPE ({', '.join(missing_labels)})."
    else:
        reason = "Review required: PPE visibility was insufficient to confirm compliance."
    return {
        "tracking_id": person.tracking_id,
        "status": person.status,
        "confidence": person.box.confidence,
        "box": [person.box.x1, person.box.y1, person.box.x2, person.box.y2],
        "equipment": [
            {"label": label, "confidence": box.confidence}
            for label, box in person.equipment.items()
        ],
        "required_equipment": sorted(required_items),
        "missing_equipment": missing_items,
        "compliance_reason": reason,
    }


def _process_frame_detections(
    db: Session,
    camera: Camera,
    frame,
    people: list[dict],
    required_items: set[str],
    source: str = "live_stream",
) -> list[dict]:
    ppe_types = {
        ppe.code: ppe
        for ppe in db.scalars(select(PPEType)).all()
    }
    zones = db.scalars(
        select(RestrictedZone).where(
            RestrictedZone.camera_id == camera.id,
            RestrictedZone.enabled.is_(True),
        )
    ).all()
    created_violations = []
    import cv2

    frame_h, frame_w = frame.shape[:2]

    for person in people:
        x1, y1, x2, y2 = person["box"]
        # Check restricted zones (bottom center / feet coordinate)
        norm_x = ((x1 + x2) / 2) / max(1, frame_w)
        norm_y = y2 / max(1, frame_h)
        breached_zones = [z for z in zones if point_in_polygon(norm_x, norm_y, z.polygon)]
        if breached_zones:
            person["breached_zone"] = breached_zones[0].name

        db.add(
            DetectionEvent(
                camera_id=camera.id,
                tracking_id=person["tracking_id"],
                status=person["status"],
                confidence=person["confidence"],
                detail={
                    "source": source,
                    "box": person["box"],
                    "equipment": person["equipment"],
                    "breached_zone": person.get("breached_zone"),
                },
            )
        )

        now_utc = datetime.now(timezone.utc)
        now_ts = int(now_utc.timestamp())

        # If person entered a restricted zone, trigger critical violation
        if breached_zones:
            zone_obj = breached_zones[0]
            zone_ppe = ppe_types.get("restricted_zone")
            if zone_ppe is not None:
                recent_zone = db.scalar(
                    select(Violation.id).where(
                        Violation.camera_id == camera.id,
                        Violation.tracking_id == person["tracking_id"],
                        Violation.ppe_type_id == zone_ppe.id,
                        Violation.created_at >= now_utc - timedelta(seconds=60),
                    ).limit(1)
                )
                if recent_zone is None:
                    evidence_filename = f"evidence_{camera.id}_{person['tracking_id']}_zone_{now_ts}.jpg"
                    evidence_filepath = EVIDENCE_DIR / evidence_filename
                    try:
                        cv2.imwrite(str(evidence_filepath), frame)
                        evidence_url = f"/evidence/{evidence_filename}"
                    except Exception:
                        evidence_url = None

                    violation = Violation(
                        organization_id=camera.organization_id,
                        camera_id=camera.id,
                        location_id=camera.location_id,
                        ppe_type_id=zone_ppe.id,
                        tracking_id=person["tracking_id"],
                        confidence=person["confidence"],
                        severity="critical",
                        evidence_path=evidence_url,
                        review_status="new",
                    )
                    db.add(violation)
                    db.flush()
                    alert = Alert(organization_id=camera.organization_id, violation_id=violation.id)
                    db.add(alert)
                    db.flush()
                    recipients = db.scalars(select(User).where(
                        User.organization_id == camera.organization_id,
                        User.is_active.is_(True),
                    )).all()
                    db.add_all(Notification(user_id=recipient.id, alert_id=alert.id, channel="in_app") for recipient in recipients)
                    created_violations.append({
                        "id": violation.id,
                        "tracking_id": person["tracking_id"],
                        "missing_item": f"Restricted Area Breach: {zone_obj.name}",
                        "evidence_path": evidence_url,
                    })

        # Process missing mandatory PPE
        if person["status"] == "non_compliant":
            detected_labels = {item["label"] for item in person["equipment"]}
            missing = [code for code in required_items if code not in detected_labels]
            for code in missing:
                ppe_type = ppe_types.get(code)
                if ppe_type is None:
                    continue

                recent = db.scalar(
                    select(Violation.id).where(
                        Violation.camera_id == camera.id,
                        Violation.tracking_id == person["tracking_id"],
                        Violation.ppe_type_id == ppe_type.id,
                        Violation.created_at >= now_utc - timedelta(seconds=60),
                    ).limit(1)
                )
                if recent is not None:
                    continue

                evidence_filename = f"evidence_{camera.id}_{person['tracking_id']}_{now_ts}.jpg"
                evidence_filepath = EVIDENCE_DIR / evidence_filename
                try:
                    cv2.imwrite(str(evidence_filepath), frame)
                    evidence_url = f"/evidence/{evidence_filename}"
                except Exception:
                    evidence_url = None

                violation = Violation(
                    organization_id=camera.organization_id,
                    camera_id=camera.id,
                    location_id=camera.location_id,
                    ppe_type_id=ppe_type.id,
                    tracking_id=person["tracking_id"],
                    confidence=person["confidence"],
                    severity=severity_for_camera_ppe(db, camera, code),
                    evidence_path=evidence_url,
                    review_status="new",
                )
                db.add(violation)
                db.flush()
                alert = Alert(organization_id=camera.organization_id, violation_id=violation.id)
                db.add(alert)
                db.flush()
                recipients = db.scalars(select(User).where(
                    User.organization_id == camera.organization_id,
                    User.is_active.is_(True),
                )).all()
                db.add_all(Notification(user_id=recipient.id, alert_id=alert.id, channel="in_app") for recipient in recipients)
                created_violations.append({
                    "id": violation.id,
                    "tracking_id": person["tracking_id"],
                    "missing_item": ppe_type.name,
                    "evidence_path": evidence_url,
                })
    db.commit()
    return created_violations


@router.get("/status")
def detection_status(_: User = Depends(current_user)):
    return {
        "configured": engine.configured,
        "person_model": settings.person_model_path,
        "ppe_model_configured": bool(settings.ppe_model_path),
        "confidence": settings.detection_confidence,
    }


@router.get("/cameras")
def detection_cameras(
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    cameras = db.scalars(
        select(Camera)
        .where(Camera.organization_id == user.organization_id)
        .order_by(Camera.name)
    ).all()
    return [
        {"id": camera.id, "name": camera.name, "kind": camera.kind, "status": camera.status}
        for camera in cameras
    ]


@router.post("/analyze-image")
async def analyze_image(
    image: UploadFile = File(...),
    camera_id: int | None = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    if not engine.configured:
        raise HTTPException(503, "Configure PPE_MODEL_PATH with a trained YOLO PPE model first.")
    if image.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(415, "Only JPEG, PNG, and WebP images are supported.")
    content = await image.read(settings.max_image_upload_bytes + 1)
    if len(content) > settings.max_image_upload_bytes:
        raise HTTPException(413, "Image exceeds the configured upload limit.")
    signatures = (
        content.startswith(b"\xff\xd8\xff"),
        content.startswith(b"\x89PNG\r\n\x1a\n"),
        content.startswith(b"RIFF") and content[8:12] == b"WEBP",
    )
    if not any(signatures):
        raise HTTPException(415, "The uploaded file is not a valid JPEG, PNG, or WebP image.")
    camera = None
    if camera_id is not None:
        camera = db.scalar(
            select(Camera).where(
                Camera.id == camera_id,
                Camera.organization_id == user.organization_id,
            )
        )
        if camera is None:
            raise HTTPException(404, "Camera not found in your organization.")
    try:
        import cv2
        import numpy as np

        frame = cv2.imdecode(np.frombuffer(content, dtype=np.uint8), cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError("The uploaded image could not be decoded.")
        required_items = required_ppe_for_camera(db, camera) if camera is not None else {"helmet", "vest"}
        results = engine.analyze(frame, required_items)
    except HTTPException:
        raise
    except (ImportError, OSError, RuntimeError, ValueError) as exc:
        raise HTTPException(422, f"Inference failed: {exc}") from exc

    people = _people_payload(results, required_items)
    new_violations = []
    if camera is not None and people:
        new_violations = _process_frame_detections(
            db, camera, frame, people, required_items, source="image_upload"
        )

    return {
        "people": people,
        "events_persisted": len(people) if camera is not None else 0,
        "violations_created": len(new_violations),
        "new_violations": new_violations,
    }


@router.post("/analyze-video")
async def analyze_video(
    video: UploadFile = File(...),
    camera_id: int | None = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    if not engine.configured:
        raise HTTPException(503, "Configure PPE_MODEL_PATH with a trained YOLO PPE model first.")
    suffix = os.path.splitext(video.filename or "video.mp4")[1].lower()
    allowed_suffixes = {".mp4", ".avi", ".mov"}
    allowed_types = {"video/mp4", "video/x-msvideo", "video/quicktime", "application/octet-stream"}
    if suffix not in allowed_suffixes:
        raise HTTPException(415, "Only MP4, AVI, and MOV video files are supported.")
    if video.content_type not in allowed_types:
        raise HTTPException(415, "Unsupported video content type.")
    content = await video.read(settings.max_video_upload_bytes + 1)
    if len(content) > settings.max_video_upload_bytes:
        raise HTTPException(413, "Video exceeds the configured upload limit.")
    if len(content) < 12:
        raise HTTPException(415, "The uploaded video is empty or invalid.")
    camera = None
    if camera_id is not None:
        camera = db.scalar(
            select(Camera).where(
                Camera.id == camera_id,
                Camera.organization_id == user.organization_id,
            )
        )
        if camera is None:
            raise HTTPException(404, "Camera not found in your organization.")
    input_path = UPLOAD_DIR / f"{uuid.uuid4().hex}{suffix}"
    input_path.write_bytes(content)
    job = ProcessingJob(
        organization_id=user.organization_id,
        camera_id=camera.id if camera else None,
        created_by=user.id,
        kind="video_analysis",
        status="queued",
        input_path=str(input_path),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return {
        "job_id": job.id,
        "status": job.status,
        "message": "Video queued for background PPE analysis.",
    }


@router.get("/jobs/{job_id}")
def video_job_status(
    job_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    job = db.scalar(
        select(ProcessingJob).where(
            ProcessingJob.id == job_id,
            ProcessingJob.organization_id == user.organization_id,
        )
    )
    if job is None:
        raise HTTPException(404, "Processing job not found.")
    return {
        "job_id": job.id,
        "status": job.status,
        "result": job.result,
        "error": job.error,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "updated_at": job.updated_at.isoformat() if job.updated_at else None,
    }


@router.websocket("/stream/{camera_id}")
async def detection_stream(websocket: WebSocket, camera_id: int, token: str):
    try:
        user_id = _stream_user_id(token)
    except HTTPException:
        await websocket.close(code=1008, reason="Invalid session")
        return

    with SessionLocal() as db:
        camera = db.scalar(
            select(Camera).join(User, User.organization_id == Camera.organization_id).where(
                Camera.id == camera_id,
                User.id == user_id,
                User.is_active.is_(True),
            )
        )
        if camera is None:
            await websocket.close(code=1008, reason="Camera not found")
            return

    await websocket.accept()
    try:
        import cv2
        import numpy as np

        while True:
            payload = await websocket.receive_bytes()
            frame = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_COLOR)
            if frame is None:
                await websocket.send_json({"type": "error", "message": "Frame could not be decoded."})
                continue

            with SessionLocal() as db:
                cam = db.get(Camera, camera_id)
                if cam is None:
                    await websocket.close(code=1008, reason="Camera not found")
                    return
                required_items = required_ppe_for_camera(db, cam)

            try:
                raw_people = engine.analyze(frame, required_items)
                people = _people_payload(raw_people, required_items)
            except (ImportError, OSError, RuntimeError, ValueError) as exc:
                await websocket.send_json({"type": "error", "message": f"Inference failed: {exc}"})
                continue

            new_violations = []
            if people:
                try:
                    with SessionLocal() as db:
                        cam = db.get(Camera, camera_id)
                        if cam:
                            new_violations = _process_frame_detections(
                                db, cam, frame, people, required_items, source="live_stream"
                            )
                except SQLAlchemyError as exc:
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Unable to persist detection results: {exc}",
                    })

            await websocket.send_json({
                "type": "detection",
                "people": people,
                "person_count": len(people),
                "compliant_count": sum(person["status"] == "compliant" for person in people),
                "non_compliant_count": sum(person["status"] == "non_compliant" for person in people),
                "uncertain_count": sum(person["status"] == "uncertain" for person in people),
                "violation_detected": len(new_violations) > 0 or any(p["status"] == "non_compliant" for p in people),
                "new_violations": new_violations,
            })
    except WebSocketDisconnect:
        return
