import asyncio
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import SessionLocal, get_db
from ..models import Alert, AlertAssignment, Camera, Location, Notification, PPEType, User, Violation
from ..security import current_user, require_roles

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


class AlertUpdate(BaseModel):
    status: str = Field(pattern="^(new|acknowledged|under_review|resolved|false_positive|escalated)$")
    comment: str | None = Field(default=None, max_length=2000)


class AssignmentIn(BaseModel):
    user_id: int


def _payload(alert: Alert, violation: Violation, camera_name: str, location_name: str | None, ppe_name: str) -> dict:
    return {
        "id": alert.id,
        "status": alert.status,
        "comment": alert.comment,
        "created_at": alert.created_at.isoformat() if alert.created_at else None,
        "acknowledged_at": alert.acknowledged_at.isoformat() if alert.acknowledged_at else None,
        "resolved_at": alert.resolved_at.isoformat() if alert.resolved_at else None,
        "violation_id": violation.id,
        "camera_id": violation.camera_id,
        "camera_name": camera_name,
        "location_name": location_name,
        "missing_item": ppe_name,
        "tracking_id": violation.tracking_id,
        "confidence": violation.confidence,
        "severity": violation.severity,
        "evidence_path": violation.evidence_path,
    }


def _query(db: Session, organization_id: int, status: str | None = None):
    query = (
        select(Alert, Violation, Camera.name, Location.name, PPEType.name)
        .join(Violation, Violation.id == Alert.violation_id)
        .join(Camera, Camera.id == Violation.camera_id)
        .outerjoin(Location, Location.id == Violation.location_id)
        .join(PPEType, PPEType.id == Violation.ppe_type_id)
        .where(Alert.organization_id == organization_id)
        .order_by(Alert.created_at.desc())
        .limit(200)
    )
    if status:
        query = query.where(Alert.status == status)
    return db.execute(query).all()


def _escalate_overdue(db: Session, organization_id: int) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=10)
    rows = db.execute(
        select(Alert, Violation).join(Violation, Violation.id == Alert.violation_id).where(
            Alert.organization_id == organization_id,
            Alert.status == "new",
            Violation.severity == "critical",
            Alert.created_at <= cutoff,
        )
    ).all()
    if not rows:
        return
    recipients = db.scalars(select(User).where(
        User.organization_id == organization_id,
        User.is_active.is_(True),
    )).all()
    for alert, _ in rows:
        alert.status = "escalated"
        db.add_all(Notification(user_id=recipient.id, alert_id=alert.id, channel="in_app") for recipient in recipients)
    db.commit()


@router.get("")
def list_alerts(
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    _escalate_overdue(db, user.organization_id)
    return [_payload(*row) for row in _query(db, user.organization_id, status)]


@router.patch("/{alert_id}")
def update_alert(
    alert_id: int,
    body: AlertUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "safety_officer")),
):
    alert = db.scalar(select(Alert).where(
        Alert.id == alert_id,
        Alert.organization_id == user.organization_id,
    ))
    if alert is None:
        raise HTTPException(404, "Alert not found.")
    alert.status = body.status
    if body.comment is not None:
        alert.comment = body.comment.strip() or None
    now = datetime.now(timezone.utc)
    if body.status == "acknowledged":
        alert.acknowledged_at = alert.acknowledged_at or now
    if body.status == "resolved":
        alert.acknowledged_at = alert.acknowledged_at or now
        alert.resolved_at = now
    db.commit()
    return {"id": alert.id, "status": alert.status}


@router.post("/{alert_id}/assign")
def assign_alert(
    alert_id: int,
    body: AssignmentIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "safety_officer")),
):
    alert = db.scalar(select(Alert).where(
        Alert.id == alert_id,
        Alert.organization_id == user.organization_id,
    ))
    assignee = db.scalar(select(User).where(
        User.id == body.user_id,
        User.organization_id == user.organization_id,
        User.is_active.is_(True),
    ))
    if alert is None or assignee is None:
        raise HTTPException(404, "Alert or assignee not found.")
    existing = db.scalar(select(AlertAssignment).where(
        AlertAssignment.alert_id == alert.id,
        AlertAssignment.user_id == assignee.id,
    ))
    if existing is None:
        db.add(AlertAssignment(alert_id=alert.id, user_id=assignee.id))
        db.commit()
    return {"assigned": True, "user_id": assignee.id}


def _stream_user_id(token: str) -> int | None:
    try:
        return int(jwt.decode(token, settings.secret_key, algorithms=["HS256"])["sub"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        return None


@router.websocket("/stream")
async def alert_stream(websocket: WebSocket, token: str):
    user_id = _stream_user_id(token)
    if user_id is None:
        await websocket.close(code=1008, reason="Invalid session")
        return
    with SessionLocal() as db:
        user = db.get(User, user_id)
        if user is None or not user.is_active:
            await websocket.close(code=1008, reason="Invalid session")
            return
        organization_id = user.organization_id

    await websocket.accept()
    last_seen = 0
    initialized = False
    try:
        while True:
            with SessionLocal() as db:
                _escalate_overdue(db, organization_id)
                rows = _query(db, organization_id)
                if not initialized:
                    last_seen = max((row[0].id for row in rows), default=0)
                    initialized = True
                pending = [row for row in rows if row[0].id > last_seen]
                for row in reversed(pending):
                    await websocket.send_json({"type": "alert", "alert": _payload(*row)})
                    last_seen = max(last_seen, row[0].id)
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        return
