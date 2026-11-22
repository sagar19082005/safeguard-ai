from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Camera, Location, PPEType, User, Violation
from ..security import current_user, require_roles

router = APIRouter(prefix="/api/violations", tags=["violations"])


class ReviewUpdate(BaseModel):
    review_status: str = Field(pattern="^(new|acknowledged|under_review|resolved|false_positive)$")


@router.get("")
def list_violations(
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    query = (
        select(Violation, Camera.name, Location.name, PPEType.name)
        .join(Camera, Camera.id == Violation.camera_id)
        .outerjoin(Location, Location.id == Violation.location_id)
        .join(PPEType, PPEType.id == Violation.ppe_type_id)
        .where(Violation.organization_id == user.organization_id)
        .order_by(Violation.created_at.desc())
        .limit(200)
    )
    if status:
        query = query.where(Violation.review_status == status)
    rows = db.execute(query).all()
    return [{
        "id": violation.id,
        "camera_id": violation.camera_id,
        "camera_name": camera_name,
        "location_name": location_name,
        "missing_item": ppe_name,
        "tracking_id": violation.tracking_id,
        "confidence": violation.confidence,
        "severity": violation.severity,
        "evidence_path": violation.evidence_path,
        "review_status": violation.review_status,
        "created_at": violation.created_at.isoformat() if violation.created_at else None,
    } for violation, camera_name, location_name, ppe_name in rows]


@router.patch("/{violation_id}")
def update_violation(
    violation_id: int,
    body: ReviewUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "safety_officer")),
):
    violation = db.scalar(select(Violation).where(
        Violation.id == violation_id,
        Violation.organization_id == user.organization_id,
    ))
    if violation is None:
        raise HTTPException(404, "Violation not found.")
    violation.review_status = body.review_status
    db.commit()
    return {"id": violation.id, "review_status": violation.review_status}
