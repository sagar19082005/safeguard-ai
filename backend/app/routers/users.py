from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import AuditLog, User
from ..security import current_user, hash_password, require_roles

router = APIRouter(prefix="/api/users", tags=["users"])


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=10, max_length=128)
    role: str = Field(pattern="^(admin|safety_officer|viewer)$")


class UserUpdate(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    role: str = Field(pattern="^(admin|safety_officer|viewer)$")
    is_active: bool = True


def _out(user: User) -> dict:
    return {"id": user.id, "email": user.email, "full_name": user.full_name, "role": user.role, "is_active": user.is_active}


@router.get("")
def list_users(db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    return [_out(item) for item in db.scalars(
        select(User).where(User.organization_id == user.organization_id).order_by(User.full_name)
    ).all()]


@router.post("", status_code=201)
def create_user(body: UserCreate, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    email = body.email.lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(409, "A user with this email already exists.")
    created = User(
        organization_id=user.organization_id,
        email=email,
        full_name=body.full_name.strip(),
        password_hash=hash_password(body.password),
        role=body.role,
    )
    db.add(created)
    db.flush()
    db.add(AuditLog(organization_id=user.organization_id, user_id=user.id, action="user.created",
                    detail={"created_user_id": created.id, "role": created.role}))
    db.commit()
    db.refresh(created)
    return _out(created)


@router.patch("/{user_id}")
def update_user(user_id: int, body: UserUpdate, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    target = db.scalar(select(User).where(User.id == user_id, User.organization_id == user.organization_id))
    if target is None:
        raise HTTPException(404, "User not found.")
    if target.id == user.id and not body.is_active:
        raise HTTPException(400, "You cannot deactivate your own account.")
    target.full_name, target.role, target.is_active = body.full_name.strip(), body.role, body.is_active
    db.add(AuditLog(organization_id=user.organization_id, user_id=user.id, action="user.updated",
                    detail={"target_user_id": target.id, "role": target.role, "is_active": target.is_active}))
    db.commit()
    return _out(target)


@router.get("/audit-logs")
def audit_logs(db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    rows = db.execute(
        select(AuditLog, User.email)
        .outerjoin(User, User.id == AuditLog.user_id)
        .where(AuditLog.organization_id == user.organization_id)
        .order_by(AuditLog.created_at.desc())
        .limit(200)
    ).all()
    return [{"id": item.id, "action": item.action, "actor": email or "System",
             "detail": item.detail, "created_at": item.created_at.isoformat() if item.created_at else None}
            for item, email in rows]
