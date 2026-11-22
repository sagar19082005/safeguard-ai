from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from ..db import get_db
from ..models import Alert, Camera, DetectionEvent, Location, PPEType, User, Violation
from ..security import current_user

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary")
def summary(db: Session = Depends(get_db), user: User = Depends(current_user)):
    org = user.organization_id
    now = datetime.now(timezone.utc)
    day0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week0 = day0 - timedelta(days=6)
    month0 = day0 - timedelta(days=29)

    cams = dict(db.execute(select(Camera.status, func.count()).where(Camera.organization_id == org)
                           .group_by(Camera.status)).all())
    det = dict(db.execute(select(DetectionEvent.status, func.count()).join(Camera)
                          .where(Camera.organization_id == org, DetectionEvent.detected_at >= now - timedelta(hours=24))
                          .group_by(DetectionEvent.status)).all())
    compliant, non_compliant = det.get("compliant", 0), det.get("non_compliant", 0)
    judged = compliant + non_compliant

    daily = {str(k): v for k, v in db.execute(
        select(func.date(Violation.created_at), func.count())
        .where(Violation.organization_id == org, Violation.created_at >= week0)
        .group_by(func.date(Violation.created_at))).all()}
    trend = [{"date": (d := (week0 + timedelta(days=i)).date().isoformat()), "violations": daily.get(d, 0)}
             for i in range(7)]
    monthly_daily = {str(k): v for k, v in db.execute(
        select(func.date(Violation.created_at), func.count())
        .where(Violation.organization_id == org, Violation.created_at >= month0)
        .group_by(func.date(Violation.created_at))).all()}
    monthly_trend = [{"date": (d := (month0 + timedelta(days=i)).date().isoformat()),
                      "violations": monthly_daily.get(d, 0)} for i in range(30)]

    compliance_daily = db.execute(
        select(func.date(DetectionEvent.detected_at), DetectionEvent.status, func.count())
        .join(Camera)
        .where(Camera.organization_id == org, DetectionEvent.detected_at >= week0)
        .group_by(func.date(DetectionEvent.detected_at), DetectionEvent.status)
    ).all()
    compliance_by_day = {}
    for day, status, count in compliance_daily:
        compliance_by_day.setdefault(str(day), {})[status] = count
    compliance_trend = []
    for i in range(7):
        day = (week0 + timedelta(days=i)).date().isoformat()
        counts = compliance_by_day.get(day, {})
        judged_day = counts.get("compliant", 0) + counts.get("non_compliant", 0)
        compliance_trend.append({"date": day, "compliance_pct": round(
            100 * counts.get("compliant", 0) / judged_day, 1) if judged_day else None})

    by_ppe = db.execute(select(PPEType.name, func.count()).join(Violation, Violation.ppe_type_id == PPEType.id)
                        .where(Violation.organization_id == org).group_by(PPEType.name)
                        .order_by(func.count().desc())).all()
    by_loc = db.execute(select(Location.name, func.count()).join(Violation, Violation.location_id == Location.id)
                        .where(Violation.organization_id == org).group_by(Location.name)
                        .order_by(func.count().desc()).limit(8)).all()
    by_camera = db.execute(
        select(Camera.name, func.count())
        .join(Violation, Violation.camera_id == Camera.id)
        .where(Camera.organization_id == org)
        .group_by(Camera.name)
        .order_by(func.count().desc())
        .limit(8)
    ).all()
    camera_list = db.execute(
        select(Camera.id, Camera.name, Camera.kind, Camera.status, Location.name)
        .outerjoin(Location, Location.id == Camera.location_id)
        .where(Camera.organization_id == org)
        .order_by(Camera.name)
    ).all()
    return {
        "people_detected": sum(det.values()),
        "compliant": compliant,
        "non_compliant": non_compliant,
        "uncertain": det.get("uncertain", 0),
        "compliance_pct": round(100 * compliant / judged, 1) if judged else None,
        "violations_today": db.scalar(select(func.count(Violation.id)).where(
            Violation.organization_id == org, Violation.created_at >= day0)),
        "active_alerts": db.scalar(select(func.count(Alert.id)).where(
            Alert.organization_id == org, Alert.status.in_(["new", "acknowledged"]))),
        "cameras_online": cams.get("online", 0),
        "cameras_offline": sum(v for k, v in cams.items() if k != "online"),
        "trend": trend,
        "monthly_trend": monthly_trend,
        "compliance_trend": compliance_trend,
        "by_ppe": [{"name": n, "count": c} for n, c in by_ppe],
        "by_location": [{"name": n, "count": c} for n, c in by_loc],
        "by_camera": [{"name": n, "count": c} for n, c in by_camera],
        "cameras": [{"id": i, "name": n, "kind": k, "status": s, "location": l or "Unassigned"}
                    for i, n, k, s, l in camera_list],
    }
