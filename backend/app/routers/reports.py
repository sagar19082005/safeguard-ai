import csv
import io
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Camera, DetectionEvent, Location, PPEType, Report, User, Violation, Worker
from ..security import current_user

router = APIRouter(prefix="/api/reports", tags=["reports"])


def period_bounds(period: str, end: date | None) -> tuple[datetime, datetime]:
    finish = end or datetime.now(timezone.utc).date()
    if period == "day":
        start = finish
    elif period == "month":
        start = finish.replace(day=1)
    else:
        start = finish - timedelta(days=6)
    return (
        datetime.combine(start, time.min, tzinfo=timezone.utc),
        datetime.combine(finish + timedelta(days=1), time.min, tzinfo=timezone.utc),
    )


def report_data(
    db: Session,
    user: User,
    period: str,
    end: date | None,
    location_id: int | None = None,
    camera_id: int | None = None,
    ppe_type_id: int | None = None,
    worker_id: int | None = None,
):
    start, finish = period_bounds(period, end)
    org = user.organization_id
    detection_query = select(DetectionEvent.status, func.count()).join(Camera).where(
        Camera.organization_id == org, DetectionEvent.detected_at >= start, DetectionEvent.detected_at < finish
    )
    if location_id is not None:
        detection_query = detection_query.where(Camera.location_id == location_id)
    if camera_id is not None:
        detection_query = detection_query.where(Camera.id == camera_id)
    detections = dict(db.execute(
        detection_query.group_by(DetectionEvent.status)
    ).all())
    violation_query = select(
        func.date(Violation.created_at), PPEType.name, Location.name,
        Camera.name, Worker.name, Violation.severity, func.count(),
    ).join(PPEType, PPEType.id == Violation.ppe_type_id).join(Camera, Camera.id == Violation.camera_id).outerjoin(
        Location, Location.id == Violation.location_id
    ).outerjoin(Worker, Worker.id == Violation.worker_id).where(
        Violation.organization_id == org, Violation.created_at >= start, Violation.created_at < finish
    )
    if location_id is not None:
        violation_query = violation_query.where(Violation.location_id == location_id)
    if camera_id is not None:
        violation_query = violation_query.where(Violation.camera_id == camera_id)
    if ppe_type_id is not None:
        violation_query = violation_query.where(Violation.ppe_type_id == ppe_type_id)
    if worker_id is not None:
        violation_query = violation_query.where(Violation.worker_id == worker_id)
    violations = db.execute(
        violation_query.group_by(
            func.date(Violation.created_at), PPEType.name, Location.name,
            Camera.name, Worker.name, Violation.severity
        ).order_by(func.date(Violation.created_at).desc())
    ).all()
    compliant = detections.get("compliant", 0)
    non_compliant = detections.get("non_compliant", 0)
    judged = compliant + non_compliant
    return {
        "period": period,
        "from": start.date().isoformat(),
        "to": (finish - timedelta(days=1)).date().isoformat(),
        "compliance_score": round(100 * compliant / judged, 1) if judged else None,
        "detections": {
            "total": sum(detections.values()),
            "compliant": compliant,
            "non_compliant": non_compliant,
            "uncertain": detections.get("uncertain", 0),
        },
        "violation_total": sum(row[6] for row in violations),
        "analytics": [{"date": str(day), "missing_item": ppe, "location": location or "Unassigned",
                       "camera": camera, "worker": worker or "Unassigned", "severity": severity, "count": count}
                      for day, ppe, location, camera, worker, severity, count in violations],
        "by_worker": _counts(violations, 4),
        "by_location": _counts(violations, 2),
        "by_camera": _counts(violations, 3),
        "by_ppe": _counts(violations, 1),
        "filters": {"location_id": location_id, "camera_id": camera_id, "ppe_type_id": ppe_type_id, "worker_id": worker_id},
    }


def _counts(rows, index: int):
    counts = {}
    for row in rows:
        name = row[index] or "Unassigned"
        counts[name] = counts.get(name, 0) + row[-1]
    return [{"name": name, "count": count} for name, count in sorted(counts.items(), key=lambda item: item[1], reverse=True)]


@router.get("/filters")
def filters(db: Session = Depends(get_db), user: User = Depends(current_user)):
    org = user.organization_id
    return {
        "locations": [{"id": item.id, "name": item.name} for item in db.scalars(
            select(Location).where(Location.organization_id == org).order_by(Location.name)
        )],
        "cameras": [{"id": item.id, "name": item.name} for item in db.scalars(
            select(Camera).where(Camera.organization_id == org).order_by(Camera.name)
        )],
        "workers": [{"id": item.id, "name": item.name} for item in db.scalars(
            select(Worker).where(Worker.organization_id == org).order_by(Worker.name)
        )],
        "ppe_types": [{"id": item.id, "name": item.name} for item in db.scalars(select(PPEType).order_by(PPEType.name))],
    }


@router.get("/summary")
def summary(
    period: str = Query("week", pattern="^(day|week|month)$"),
    end: date | None = Query(None),
    location_id: int | None = Query(None),
    camera_id: int | None = Query(None),
    ppe_type_id: int | None = Query(None),
    worker_id: int | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    return report_data(db, user, period, end, location_id, camera_id, ppe_type_id, worker_id)


@router.get("/export.csv")
def export_csv(
    period: str = Query("week", pattern="^(day|week|month)$"),
    end: date | None = Query(None),
    location_id: int | None = Query(None),
    camera_id: int | None = Query(None),
    ppe_type_id: int | None = Query(None),
    worker_id: int | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    data = report_data(db, user, period, end, location_id, camera_id, ppe_type_id, worker_id)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["date", "missing_item", "location", "camera", "worker", "severity", "count"])
    for row in data["analytics"]:
        writer.writerow([row["date"], row["missing_item"], row["location"], row["camera"], row["worker"], row["severity"], row["count"]])
    db.add(Report(organization_id=user.organization_id, kind="csv", params=data, created_by=user.id))
    db.commit()
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="safeguard-{period}-report.csv"'},
    )


@router.get("/export.pdf")
def export_pdf(
    period: str = Query("week", pattern="^(day|week|month)$"),
    end: date | None = Query(None),
    location_id: int | None = Query(None),
    camera_id: int | None = Query(None),
    ppe_type_id: int | None = Query(None),
    worker_id: int | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    data = report_data(db, user, period, end, location_id, camera_id, ppe_type_id, worker_id)
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Spacer, Table, TableStyle, Paragraph

    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=letter, rightMargin=0.6 * inch, leftMargin=0.6 * inch)
    styles = getSampleStyleSheet()
    score = "No judged detections" if data["compliance_score"] is None else f'{data["compliance_score"]}%'
    elements = [
        Paragraph("SafeGuard AI safety report", styles["Title"]),
        Paragraph(f'Period: {data["from"]} to {data["to"]} ({period})', styles["Normal"]),
        Spacer(1, 0.15 * inch),
        Paragraph(f'Compliance score: {score} &nbsp;&nbsp; Violations: {data["violation_total"]}', styles["Heading2"]),
        Spacer(1, 0.12 * inch),
    ]
    rows = [["Date", "Missing PPE", "Location", "Camera", "Worker", "Severity", "Count"]]
    rows.extend([[r["date"], r["missing_item"], r["location"], r["camera"], r["worker"], r["severity"], str(r["count"])] for r in data["analytics"]])
    table = Table(rows, repeatRows=1, colWidths=[0.7 * inch, 1.0 * inch, 1.1 * inch, 1.0 * inch, 1.0 * inch, 0.7 * inch, 0.4 * inch])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f766e")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#cbd5e1")),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    elements.append(table)
    document.build(elements)
    db.add(Report(organization_id=user.organization_id, kind="pdf", params=data, created_by=user.id))
    db.commit()
    return Response(
        content=output.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="safeguard-{period}-report.pdf"'},
    )
