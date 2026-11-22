from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Camera, Location, PPEType, User, Violation, Worker
from ..security import current_user, require_roles

router = APIRouter(prefix="/api/workers", tags=["workers"])


class WorkerIn(BaseModel):
    employee_code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    department: str | None = Field(default=None, max_length=80)
    designation: str | None = Field(default=None, max_length=80)
    location_id: int | None = None
    is_active: bool = True


def _out(worker: Worker, location_name: str | None = None) -> dict:
    return {
        "id": worker.id, "employee_code": worker.employee_code, "name": worker.name,
        "department": worker.department, "designation": worker.designation,
        "location_id": worker.location_id, "location_name": location_name,
        "is_active": worker.is_active,
    }


def _location(db: Session, location_id: int | None, org_id: int) -> Location | None:
    if location_id is None:
        return None
    location = db.scalar(select(Location).where(Location.id == location_id, Location.organization_id == org_id))
    if location is None:
        raise HTTPException(404, "Location not found in your organization.")
    return location


@router.get("")
def list_workers(db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = db.execute(select(Worker, Location.name).outerjoin(Location).where(
        Worker.organization_id == user.organization_id
    ).order_by(Worker.name)).all()
    return [_out(worker, location_name) for worker, location_name in rows]


@router.post("", status_code=201)
def create_worker(body: WorkerIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "safety_officer"))):
    location = _location(db, body.location_id, user.organization_id)
    if db.scalar(select(Worker.id).where(
        Worker.organization_id == user.organization_id, Worker.employee_code == body.employee_code.strip()
    )):
        raise HTTPException(409, "Employee code already exists.")
    worker = Worker(
        organization_id=user.organization_id, employee_code=body.employee_code.strip(),
        name=body.name.strip(), department=body.department, designation=body.designation,
        location_id=location.id if location else None, is_active=body.is_active,
    )
    db.add(worker); db.commit(); db.refresh(worker)
    return _out(worker, location.name if location else None)


@router.get("/{worker_id}/history")
def worker_history(
    worker_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    worker = db.scalar(select(Worker).where(
        Worker.id == worker_id, Worker.organization_id == user.organization_id
    ))
    if worker is None:
        raise HTTPException(404, "Worker not found.")
    rows = db.execute(
        select(Violation, PPEType.name, Camera.name, Location.name)
        .join(PPEType, PPEType.id == Violation.ppe_type_id)
        .join(Camera, Camera.id == Violation.camera_id)
        .outerjoin(Location, Location.id == Violation.location_id)
        .where(
            Violation.organization_id == user.organization_id,
            Violation.worker_id == worker_id,
        )
        .order_by(Violation.created_at.desc())
        .limit(200)
    ).all()
    by_item = {}
    for violation, ppe_name, _, _ in rows:
        by_item[ppe_name] = by_item.get(ppe_name, 0) + 1
    return {
        "worker": _out(worker),
        "total_violations": len(rows),
        "repeated_violation": len(rows) >= 3,
        "by_ppe": [{"name": name, "count": count} for name, count in sorted(
            by_item.items(), key=lambda item: item[1], reverse=True
        )],
        "violations": [{
            "id": violation.id,
            "missing_item": ppe_name,
            "camera_name": camera_name,
            "location_name": location_name or "Unassigned",
            "confidence": violation.confidence,
            "severity": violation.severity,
            "review_status": violation.review_status,
            "created_at": violation.created_at.isoformat() if violation.created_at else None,
        } for violation, ppe_name, camera_name, location_name in rows],
    }


@router.patch("/{worker_id}")
def update_worker(worker_id: int, body: WorkerIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "safety_officer"))):
    worker = db.scalar(select(Worker).where(Worker.id == worker_id, Worker.organization_id == user.organization_id))
    if worker is None:
        raise HTTPException(404, "Worker not found.")
    location = _location(db, body.location_id, user.organization_id)
    duplicate = db.scalar(select(Worker.id).where(
        Worker.organization_id == user.organization_id,
        Worker.employee_code == body.employee_code.strip(),
        Worker.id != worker_id,
    ))
    if duplicate:
        raise HTTPException(409, "Employee code already exists.")
    worker.employee_code, worker.name = body.employee_code.strip(), body.name.strip()
    worker.department, worker.designation = body.department, body.designation
    worker.location_id, worker.is_active = (location.id if location else None), body.is_active
    db.commit()
    return _out(worker, location.name if location else None)


@router.delete("/{worker_id}")
def deactivate_worker(worker_id: int, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "safety_officer"))):
    worker = db.scalar(select(Worker).where(Worker.id == worker_id, Worker.organization_id == user.organization_id))
    if worker is None:
        raise HTTPException(404, "Worker not found.")
    worker.is_active = False
    db.commit()
    return {"deactivated": True}
