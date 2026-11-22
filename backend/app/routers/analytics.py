from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Camera, DetectionEvent, Location, Organization, User, Violation, Worker
from ..security import current_user

router = APIRouter(prefix="/api/analytics", tags=["advanced analytics"])


@router.get("/advanced")
def advanced_analytics(db: Session = Depends(get_db), user: User = Depends(current_user)):
    org = user.organization_id
    now = datetime.now(timezone.utc)
    current_start = now - timedelta(days=7)
    previous_start = now - timedelta(days=14)

    location_rows = db.execute(
        select(Location.name, DetectionEvent.status, func.count())
        .join(Camera, Camera.location_id == Location.id)
        .join(DetectionEvent, DetectionEvent.camera_id == Camera.id)
        .where(Location.organization_id == org, DetectionEvent.detected_at >= current_start)
        .group_by(Location.name, DetectionEvent.status)
    ).all()
    location_counts = {}
    for name, status, count in location_rows:
        location_counts.setdefault(name, {})[status] = count
    compliance_by_location = []
    for name, counts in location_counts.items():
        judged = counts.get("compliant", 0) + counts.get("non_compliant", 0)
        compliance_by_location.append({
            "name": name,
            "compliance_pct": round(100 * counts.get("compliant", 0) / judged, 1) if judged else None,
            "detections": sum(counts.values()),
        })

    department_rows = db.execute(
        select(Worker.department, Violation.id)
        .join(Violation, Violation.worker_id == Worker.id)
        .where(Worker.organization_id == org, Violation.created_at >= current_start)
    ).all()
    department_counts = {}
    for department, _ in department_rows:
        name = department or "Unassigned"
        department_counts[name] = department_counts.get(name, 0) + 1

    heatmap_rows = db.execute(
        select(Location.name, func.count())
        .join(Violation, Violation.location_id == Location.id)
        .where(Location.organization_id == org, Violation.created_at >= current_start)
        .group_by(Location.name)
        .order_by(func.count().desc())
    ).all()
    max_heat = max((count for _, count in heatmap_rows), default=0)

    repeated_rows = db.execute(
        select(Worker.id, Worker.name, Worker.employee_code, func.count(Violation.id))
        .join(Violation, Violation.worker_id == Worker.id)
        .where(Worker.organization_id == org)
        .group_by(Worker.id, Worker.name, Worker.employee_code)
        .having(func.count(Violation.id) >= 3)
        .order_by(func.count(Violation.id).desc())
        .limit(20)
    ).all()

    camera_rows = db.execute(
        select(Camera.id, Camera.name, Camera.kind, Camera.status,
               func.count(DetectionEvent.id), func.max(DetectionEvent.detected_at))
        .outerjoin(DetectionEvent, DetectionEvent.camera_id == Camera.id)
        .where(Camera.organization_id == org)
        .group_by(Camera.id, Camera.name, Camera.kind, Camera.status)
        .order_by(Camera.name)
    ).all()

    current_violations = db.scalar(select(func.count(Violation.id)).where(
        Violation.organization_id == org, Violation.created_at >= current_start
    )) or 0
    previous_violations = db.scalar(select(func.count(Violation.id)).where(
        Violation.organization_id == org,
        Violation.created_at >= previous_start,
        Violation.created_at < current_start,
    )) or 0
    if previous_violations == 0:
        trend = "insufficient_baseline" if current_violations == 0 else "increasing"
    elif current_violations > previous_violations:
        trend = "increasing"
    elif current_violations < previous_violations:
        trend = "decreasing"
    else:
        trend = "stable"

    evidence = db.execute(
        select(Violation.id, Violation.evidence_path, Violation.created_at)
        .where(
            Violation.organization_id == org,
            Violation.evidence_path.is_not(None),
        )
        .order_by(Violation.created_at.desc())
        .limit(12)
    ).all()
    organization = db.get(Organization, org)
    return {
        "window_days": 7,
        "compliance_by_location": compliance_by_location,
        "violations_by_department": [{"name": name, "count": count} for name, count in sorted(
            department_counts.items(), key=lambda item: item[1], reverse=True
        )],
        "safety_heatmap": [{"name": name, "count": count, "intensity": round(count / max_heat, 2) if max_heat else 0}
                           for name, count in heatmap_rows],
        "repeated_violations": [{"worker_id": worker_id, "name": name, "employee_code": code, "count": count}
                                for worker_id, name, code, count in repeated_rows],
        "camera_health": [{
            "id": camera_id, "name": name, "kind": kind, "status": status,
            "detection_events": count, "last_detection": last.isoformat() if last else None,
        } for camera_id, name, kind, status, count, last in camera_rows],
        "predictive_estimate": {
            "label": "Estimate based on the last two 7-day periods",
            "current_violations": current_violations,
            "previous_violations": previous_violations,
            "trend": trend,
        },
        "evidence": [{"violation_id": violation_id, "path": path, "created_at": created.isoformat()}
                     for violation_id, path, created in evidence],
        "retention_days": organization.evidence_retention_days if organization else 30,
    }
