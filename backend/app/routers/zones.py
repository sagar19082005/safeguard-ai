from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Camera, RestrictedZone, User
from ..security import current_user, require_roles

router = APIRouter(prefix="/api/zones", tags=["restricted zones"])


class ZoneIn(BaseModel):
    camera_id: int
    name: str = Field(min_length=1, max_length=120)
    polygon: list[list[float]] = Field(min_length=3)
    enabled: bool = True

    @field_validator("polygon")
    @classmethod
    def valid_polygon(cls, value):
        if any(len(point) != 2 or not all(0 <= coordinate <= 1 for coordinate in point) for point in value):
            raise ValueError("Polygon points must be [x, y] values between 0 and 1.")
        return value


def _camera(db: Session, camera_id: int, org_id: int) -> Camera:
    camera = db.scalar(select(Camera).where(Camera.id == camera_id, Camera.organization_id == org_id))
    if camera is None:
        raise HTTPException(404, "Camera not found in your organization.")
    return camera


def _out(zone: RestrictedZone, camera_name: str) -> dict:
    return {"id": zone.id, "camera_id": zone.camera_id, "camera_name": camera_name, "name": zone.name, "polygon": zone.polygon, "enabled": zone.enabled}


@router.get("")
def list_zones(db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = db.execute(select(RestrictedZone, Camera.name).join(Camera).where(
        Camera.organization_id == user.organization_id
    ).order_by(RestrictedZone.name)).all()
    return [_out(zone, camera_name) for zone, camera_name in rows]


@router.post("", status_code=201)
def create_zone(body: ZoneIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "safety_officer"))):
    camera = _camera(db, body.camera_id, user.organization_id)
    zone = RestrictedZone(camera_id=camera.id, name=body.name.strip(), polygon=body.polygon, enabled=body.enabled)
    db.add(zone); db.commit(); db.refresh(zone)
    return _out(zone, camera.name)


@router.patch("/{zone_id}")
def update_zone(zone_id: int, body: ZoneIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "safety_officer"))):
    zone = db.scalar(select(RestrictedZone).join(Camera).where(
        RestrictedZone.id == zone_id, Camera.organization_id == user.organization_id
    ))
    if zone is None:
        raise HTTPException(404, "Restricted zone not found.")
    camera = _camera(db, body.camera_id, user.organization_id)
    zone.camera_id, zone.name, zone.polygon, zone.enabled = camera.id, body.name.strip(), body.polygon, body.enabled
    db.commit()
    return _out(zone, camera.name)


@router.delete("/{zone_id}")
def delete_zone(zone_id: int, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "safety_officer"))):
    zone = db.scalar(select(RestrictedZone).join(Camera).where(
        RestrictedZone.id == zone_id, Camera.organization_id == user.organization_id
    ))
    if zone is None:
        raise HTTPException(404, "Restricted zone not found.")
    db.delete(zone); db.commit()
    return {"deleted": True}
