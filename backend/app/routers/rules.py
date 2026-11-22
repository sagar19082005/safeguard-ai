from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Location, PPEType, SafetyRule, User
from ..security import current_user, require_roles

router = APIRouter(prefix="/api/rules", tags=["safety rules"])


class RuleIn(BaseModel):
    location_id: int
    ppe_type_id: int
    requirement: str = Field(default="required")
    severity: str = Field(default="high")
    enabled: bool = True


def _rule_response(rule: SafetyRule, location: Location, ppe: PPEType) -> dict:
    return {
        "id": rule.id,
        "location_id": location.id,
        "location_name": location.name,
        "ppe_type_id": ppe.id,
        "ppe_code": ppe.code,
        "ppe_name": ppe.name,
        "requirement": rule.requirement,
        "severity": rule.severity,
        "enabled": rule.enabled,
    }


def _get_parts(db: Session, body: RuleIn, organization_id: int) -> tuple[Location, PPEType]:
    location = db.scalar(select(Location).where(
        Location.id == body.location_id,
        Location.organization_id == organization_id,
    ))
    ppe = db.get(PPEType, body.ppe_type_id)
    if location is None or ppe is None:
        raise HTTPException(404, "Location or PPE type not found.")
    if body.requirement not in {"required", "optional"}:
        raise HTTPException(422, "Requirement must be required or optional.")
    if body.severity not in {"critical", "high", "medium", "review"}:
        raise HTTPException(422, "Invalid severity.")
    return location, ppe


@router.get("/ppe-types")
def list_ppe_types(_: User = Depends(current_user), db: Session = Depends(get_db)):
    return [
        {"id": item.id, "code": item.code, "name": item.name}
        for item in db.scalars(select(PPEType).order_by(PPEType.name)).all()
    ]


@router.get("")
def list_rules(db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = db.execute(
        select(SafetyRule, Location, PPEType)
        .join(Location, Location.id == SafetyRule.location_id)
        .join(PPEType, PPEType.id == SafetyRule.ppe_type_id)
        .where(Location.organization_id == user.organization_id)
        .order_by(Location.name, PPEType.name)
    ).all()
    return [_rule_response(rule, location, ppe) for rule, location, ppe in rows]


@router.post("", status_code=201)
def create_rule(
    body: RuleIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "safety_officer")),
):
    location, ppe = _get_parts(db, body, user.organization_id)
    if db.scalar(select(SafetyRule).where(
        SafetyRule.location_id == location.id,
        SafetyRule.ppe_type_id == ppe.id,
    )):
        raise HTTPException(409, "A rule for this PPE type already exists at this location.")
    rule = SafetyRule(
        location_id=location.id,
        ppe_type_id=ppe.id,
        requirement=body.requirement,
        severity=body.severity,
        enabled=body.enabled,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return _rule_response(rule, location, ppe)


@router.patch("/{rule_id}")
def update_rule(
    rule_id: int,
    body: RuleIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "safety_officer")),
):
    rule = db.scalar(
        select(SafetyRule).join(Location).where(
            SafetyRule.id == rule_id,
            Location.organization_id == user.organization_id,
        )
    )
    if rule is None:
        raise HTTPException(404, "Safety rule not found.")
    location, ppe = _get_parts(db, body, user.organization_id)
    duplicate = db.scalar(select(SafetyRule).where(
        SafetyRule.location_id == location.id,
        SafetyRule.ppe_type_id == ppe.id,
        SafetyRule.id != rule_id,
    ))
    if duplicate:
        raise HTTPException(409, "A rule for this PPE type already exists at this location.")
    rule.location_id = location.id
    rule.ppe_type_id = ppe.id
    rule.requirement = body.requirement
    rule.severity = body.severity
    rule.enabled = body.enabled
    db.commit()
    return _rule_response(rule, location, ppe)


@router.delete("/{rule_id}")
def delete_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "safety_officer")),
):
    rule = db.scalar(
        select(SafetyRule).join(Location).where(
            SafetyRule.id == rule_id,
            Location.organization_id == user.organization_id,
        )
    )
    if rule is None:
        raise HTTPException(404, "Safety rule not found.")
    db.delete(rule)
    db.commit()
    return {"deleted": True}
