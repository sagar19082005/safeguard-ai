from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from ..db import get_db
from ..models import AuditLog, Organization, User
from ..security import create_token, current_user, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterIn(BaseModel):
    organization: str = Field(min_length=2, max_length=160)
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=10, max_length=128)


def user_out(u: User):
    return {"id": u.id, "email": u.email, "full_name": u.full_name, "role": u.role}


@router.get("/status")
def status(db: Session = Depends(get_db)):
    return {"initialized": db.scalar(select(func.count(User.id))) > 0}


@router.post("/register", status_code=201)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    """First-run setup only: creates the organization and its admin."""
    if db.scalar(select(func.count(User.id))) > 0:
        raise HTTPException(403, "Setup is already complete. Ask an admin to create your account.")
    org = Organization(name=body.organization)
    db.add(org); db.flush()
    user = User(organization_id=org.id, email=body.email.lower(), full_name=body.full_name,
                password_hash=hash_password(body.password), role="admin")
    db.add(user); db.flush()
    db.add(AuditLog(organization_id=org.id, user_id=user.id, action="organization.created"))
    db.commit()
    return {"access_token": create_token(user), "user": user_out(user)}


@router.post("/login")
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == form.username.lower()))
    if not user or not user.is_active or not verify_password(form.password, user.password_hash):
        db.add(AuditLog(action="auth.login_failed"))
        db.commit()
        raise HTTPException(401, "Email or password is incorrect.")
    db.add(AuditLog(organization_id=user.organization_id, user_id=user.id, action="auth.login"))
    db.commit()
    return {"access_token": create_token(user), "user": user_out(user)}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user_out(user)


@router.post("/change-password")
def change_password(body: PasswordChange, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect.")
    user.password_hash = hash_password(body.new_password)
    db.add(AuditLog(organization_id=user.organization_id, user_id=user.id, action="auth.password_changed"))
    db.commit()
    return {"changed": True}
