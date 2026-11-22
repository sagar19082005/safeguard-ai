from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Depends, Header, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from .config import settings
from .db import SessionLocal, engine, get_db
from .migrations import run_migrations
from .models import PPEType, User, Violation
from .security import current_user
from .routers import auth, cameras, dashboard, detection, locations, notifications, rules, violations, alerts, workers, zones, reports, analytics, users

PPE = [("helmet", "Helmet"), ("vest", "Safety vest"), ("gloves", "Gloves"), ("shoes", "Safety shoes"),
       ("goggles", "Safety goggles"), ("mask", "Face mask"), ("ear", "Ear protection"), ("harness", "Safety harness"),
       ("restricted_zone", "Restricted Area Breach")]


@asynccontextmanager
async def lifespan(_: FastAPI):
    print("Starting SafeGuard AI migrations...", flush=True)
    run_migrations()
    print("SafeGuard AI migrations complete", flush=True)
    try:
        with SessionLocal() as db:
            for c, n in PPE:
                if not db.scalar(select(PPEType.id).where(PPEType.code == c).limit(1)):
                    db.add(PPEType(code=c, name=n))
            db.commit()
    except Exception as exc:
        print(f"SafeGuard AI startup seed failed: {type(exc).__name__}: {exc}", flush=True)
        raise
    print("SafeGuard AI startup complete", flush=True)
    yield


EVIDENCE_DIR = Path(__file__).resolve().parent.parent / "evidence"
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="SafeGuard AI", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(self), microphone=(self), geolocation=()"
    response.headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:"
    return response


@app.get("/evidence/{filename}")
def protected_evidence(
    filename: str,
    token: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
    db=Depends(get_db),
):
    import jwt

    access_token = token
    if access_token is None and authorization and authorization.lower().startswith("bearer "):
        access_token = authorization.split(" ", 1)[1].strip()
    if not access_token:
        raise HTTPException(401, "Authentication required.")
    try:
        user_id = int(jwt.decode(access_token, settings.secret_key, algorithms=["HS256"])["sub"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        raise HTTPException(401, "Session expired. Sign in again.")
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(401, "Session expired. Sign in again.")
    if Path(filename).name != filename:
        raise HTTPException(404, "Evidence not found.")
    evidence_path = f"/evidence/{filename}"
    violation = db.scalar(
        select(Violation).where(
            Violation.organization_id == user.organization_id,
            Violation.evidence_path == evidence_path,
        )
    )
    if violation is None:
        raise HTTPException(404, "Evidence not found.")
    file_path = (EVIDENCE_DIR / filename).resolve()
    if EVIDENCE_DIR.resolve() not in file_path.parents or not file_path.is_file():
        raise HTTPException(404, "Evidence not found.")
    return FileResponse(file_path)
app.include_router(auth.router)
app.include_router(dashboard.router)
app.include_router(detection.router)
app.include_router(cameras.router)
app.include_router(locations.router)
app.include_router(rules.router)
app.include_router(violations.router)
app.include_router(alerts.router)
app.include_router(notifications.router)
app.include_router(workers.router)
app.include_router(zones.router)
app.include_router(reports.router)
app.include_router(analytics.router)
app.include_router(users.router)



@app.get("/api/health")
def health():
    return {"ok": True}
