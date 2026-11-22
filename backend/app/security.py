from datetime import datetime, timedelta, timezone
import bcrypt, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from .config import settings
from .db import get_db
from .models import User

oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def verify_password(p: str, h: str) -> bool:
    return bcrypt.checkpw(p.encode(), h.encode())


def create_token(user: User) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_minutes)
    return jwt.encode({"sub": str(user.id), "exp": exp}, settings.secret_key, algorithm="HS256")


def current_user(token: str = Depends(oauth2), db: Session = Depends(get_db)) -> User:
    err = HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired. Sign in again.")
    try:
        uid = int(jwt.decode(token, settings.secret_key, algorithms=["HS256"])["sub"])
    except (jwt.PyJWTError, ValueError):
        raise err
    user = db.get(User, uid)
    if not user or not user.is_active:
        raise err
    return user


def require_roles(*roles: str):
    def check(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role does not allow this action.")
        return user
    return check
