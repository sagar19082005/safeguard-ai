from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Location, User
from ..security import current_user, require_roles

router = APIRouter(prefix="/api/locations", tags=["locations"])


class LocationIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    site: str | None = Field(default=None, max_length=120)


def _out(location: Location) -> dict:
    return {"id": location.id, "name": location.name, "site": location.site}


@router.get("")
def list_locations(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return [_out(item) for item in db.scalars(
        select(Location).where(Location.organization_id == user.organization_id).order_by(Location.name)
    ).all()]


@router.post("", status_code=201)
def create_location(
    body: LocationIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "safety_officer")),
):
    location = Location(organization_id=user.organization_id, name=body.name.strip(), site=body.site)
    db.add(location)
    db.commit()
    db.refresh(location)
    return _out(location)


@router.patch("/{location_id}")
def update_location(
    location_id: int,
    body: LocationIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "safety_officer")),
):
    location = db.scalar(select(Location).where(
        Location.id == location_id,
        Location.organization_id == user.organization_id,
    ))
    if location is None:
        raise HTTPException(404, "Location not found.")
    location.name = body.name.strip()
    location.site = body.site
    db.commit()
    return _out(location)


@router.delete("/{location_id}")
def delete_location(
    location_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin")),
):
    location = db.scalar(select(Location).where(
        Location.id == location_id,
        Location.organization_id == user.organization_id,
    ))
    if location is None:
        raise HTTPException(404, "Location not found.")
    db.delete(location)
    db.commit()
    return {"deleted": True}
