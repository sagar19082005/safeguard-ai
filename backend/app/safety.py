from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Camera, PPEType, SafetyRule


DEFAULT_REQUIRED_PPE = {"helmet", "vest"}


def required_ppe_for_camera(db: Session, camera: Camera) -> set[str]:
    """Return enabled required PPE for a camera's location.

    The prototype default keeps existing cameras useful until an administrator
    assigns a location and configures its rules.
    """
    if camera.location_id is None:
        return set(DEFAULT_REQUIRED_PPE)

    codes = db.scalars(
        select(PPEType.code)
        .join(SafetyRule, SafetyRule.ppe_type_id == PPEType.id)
        .where(
            SafetyRule.location_id == camera.location_id,
            SafetyRule.enabled.is_(True),
            SafetyRule.requirement == "required",
        )
    ).all()
    return set(codes) or set(DEFAULT_REQUIRED_PPE)


def severity_for_camera_ppe(db: Session, camera: Camera, ppe_code: str) -> str:
    if camera.location_id is None:
        return "high"
    severity = db.scalar(
        select(SafetyRule.severity)
        .join(PPEType, PPEType.id == SafetyRule.ppe_type_id)
        .where(
            SafetyRule.location_id == camera.location_id,
            SafetyRule.ppe_type_id == PPEType.id,
            PPEType.code == ppe_code,
            SafetyRule.enabled.is_(True),
            SafetyRule.requirement == "required",
        )
    )
    return severity or "high"
