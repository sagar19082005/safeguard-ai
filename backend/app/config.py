from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BACKEND_DIR / ".env"
DEFAULT_DB_PATH = BACKEND_DIR / "safeguard.db"
DEFAULT_PERSON_MODEL = BACKEND_DIR / "yolo11n.pt"
DEFAULT_PPE_MODEL = BACKEND_DIR / "models" / "construction-ppe-yolov8.pt"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(ENV_PATH) if ENV_PATH.exists() else ".env", extra="ignore")
    database_url: str = f"sqlite:///{DEFAULT_DB_PATH}"  # dev default; use PostgreSQL in production
    secret_key: str  # required: no insecure default
    access_token_minutes: int = 480
    person_model_path: str = str(DEFAULT_PERSON_MODEL) if DEFAULT_PERSON_MODEL.exists() else "yolo11n.pt"
    ppe_model_path: str = str(DEFAULT_PPE_MODEL) if DEFAULT_PPE_MODEL.exists() else ""
    detection_confidence: float = 0.5
    tracking_distance_px: float = 100.0
    public_app_url: str = "http://localhost:5173"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    max_image_upload_bytes: int = 10 * 1024 * 1024
    max_video_upload_bytes: int = 500 * 1024 * 1024
    worker_poll_seconds: float = 1.0


settings = Settings()

