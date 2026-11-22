from datetime import datetime, timedelta, timezone
import base64
import hashlib
import secrets
from urllib.parse import urlparse

import jwt
from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import Camera, Location, User
from ..security import current_user, require_roles

router = APIRouter(prefix="/api/cameras", tags=["cameras"])
_signaling_peers: dict[str, set[WebSocket]] = {}


def _encrypt_stream_url(url: str | None) -> str | None:
    if not url:
        return None
    key = base64.urlsafe_b64encode(hashlib.sha256(settings.secret_key.encode()).digest())
    return Fernet(key).encrypt(url.encode()).decode()


class CameraCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: str
    location_id: int | None = None
    stream_url: str | None = None
    confidence_threshold: float = Field(default=0.5, ge=0.05, le=1)


class CameraStatusUpdate(BaseModel):
    status: str


def _validate_kind(kind: str) -> None:
    if kind not in {"mobile", "webcam", "ip", "video"}:
        raise HTTPException(422, "Camera type must be mobile, webcam, ip, or video.")


def _validate_ip_stream_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"rtsp", "rtsps", "http", "https"} or not parsed.hostname:
        raise HTTPException(422, "IP cameras require a valid RTSP, RTSPS, HTTP, or HTTPS stream URL.")


def _camera_response(camera: Camera) -> dict:
    return {
        "id": camera.id,
        "name": camera.name,
        "kind": camera.kind,
        "location_id": camera.location_id,
        "status": camera.status,
        "confidence_threshold": camera.confidence_threshold,
    }


@router.get("")
def list_cameras(db: Session = Depends(get_db), user: User = Depends(current_user)):
    cameras = db.scalars(
        select(Camera).where(Camera.organization_id == user.organization_id).order_by(Camera.name)
    ).all()
    return [_camera_response(camera) for camera in cameras]


@router.post("")
def create_camera(
    payload: CameraCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "safety_officer")),
):
    _validate_kind(payload.kind)
    if payload.kind == "ip" and not payload.stream_url:
        raise HTTPException(422, "An RTSP or IP stream URL is required for IP cameras.")
    if payload.kind == "ip" and payload.stream_url:
        _validate_ip_stream_url(payload.stream_url.strip())
    if payload.location_id is not None and db.scalar(
        select(Location.id).where(
            Location.id == payload.location_id,
            Location.organization_id == user.organization_id,
        )
    ) is None:
        raise HTTPException(404, "Location not found in your organization.")
    camera = Camera(
        organization_id=user.organization_id,
        location_id=payload.location_id,
        name=payload.name.strip(),
        kind=payload.kind,
        status="offline",
        stream_secret_enc=_encrypt_stream_url(payload.stream_url),
        confidence_threshold=payload.confidence_threshold,
    )
    db.add(camera)
    db.commit()
    db.refresh(camera)
    return _camera_response(camera)


@router.patch("/{camera_id}/status")
def update_camera_status(
    camera_id: int,
    payload: CameraStatusUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "safety_officer")),
):
    if payload.status not in {"online", "offline", "connecting", "error"}:
        raise HTTPException(422, "Invalid camera status.")
    camera = db.scalar(select(Camera).where(Camera.id == camera_id, Camera.organization_id == user.organization_id))
    if camera is None:
        raise HTTPException(404, "Camera not found.")
    camera.status = payload.status
    db.commit()
    return _camera_response(camera)


@router.delete("/{camera_id}")
def delete_camera(
    camera_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "safety_officer")),
):
    camera = db.scalar(select(Camera).where(Camera.id == camera_id, Camera.organization_id == user.organization_id))
    if camera is None:
        raise HTTPException(404, "Camera not found.")
    db.delete(camera)
    db.commit()
    return {"deleted": True}


@router.post("/{camera_id}/mobile-token")
def create_mobile_token(
    camera_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "safety_officer")),
):
    camera = db.scalar(select(Camera).where(
        Camera.id == camera_id, Camera.organization_id == user.organization_id, Camera.kind == "mobile"
    ))
    if camera is None:
        raise HTTPException(404, "Mobile camera not found.")
    expires = datetime.now(timezone.utc) + timedelta(minutes=10)
    token = jwt.encode(
        {"camera_id": camera.id, "organization_id": user.organization_id, "nonce": secrets.token_hex(8), "exp": expires},
        settings.secret_key,
        algorithm="HS256",
    )
    connection_url = f"{settings.public_app_url.rstrip('/')}/camera/connect?token={token}"
    return {"token": token, "expires_at": expires.isoformat(), "camera_id": camera.id, "connection_url": connection_url}


def _verify_mobile_token(token: str) -> int:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        return int(payload["camera_id"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(401, "Camera connection link is invalid or expired.") from exc


@router.websocket("/signal/{token}")
async def camera_signal(websocket: WebSocket, token: str):
    try:
        camera_id = _verify_mobile_token(token)
    except HTTPException:
        await websocket.close(code=1008, reason="Invalid or expired camera token")
        return
    await websocket.accept()
    peers = _signaling_peers.setdefault(str(camera_id), set())
    # Notify existing peers that a new peer joined
    for peer in list(peers):
        try:
            await peer.send_json({"type": "peer_joined"})
        except Exception:
            pass
    peers.add(websocket)
    try:
        while True:
            message = await websocket.receive_json()
            for peer in list(peers):
                if peer is not websocket:
                    try:
                        await peer.send_json(message)
                    except Exception:
                        pass
    except WebSocketDisconnect:
        peers.discard(websocket)
        for peer in list(peers):
            try:
                await peer.send_json({"type": "peer_left"})
            except Exception:
                pass
        if not peers:
            _signaling_peers.pop(str(camera_id), None)
