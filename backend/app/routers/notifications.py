from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Notification, User
from ..security import current_user

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
def list_notifications(db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = db.scalars(
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc())
        .limit(100)
    ).all()
    return [{
        "id": item.id,
        "alert_id": item.alert_id,
        "channel": item.channel,
        "read": item.read_at is not None,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    } for item in rows]


@router.patch("/{notification_id}/read")
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    item = db.scalar(select(Notification).where(
        Notification.id == notification_id,
        Notification.user_id == user.id,
    ))
    if item is None:
        return {"read": False}
    from datetime import datetime, timezone
    item.read_at = datetime.now(timezone.utc)
    db.commit()
    return {"read": True}
