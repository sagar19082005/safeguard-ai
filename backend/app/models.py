from datetime import datetime
from sqlalchemy import (JSON, Boolean, DateTime, Float, ForeignKey, Integer,
                        Index, String, Text, UniqueConstraint, func)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Stamp:
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


def fk(table: str, null=False, index=True):
    return mapped_column(ForeignKey(f"{table}.id", ondelete="CASCADE" if not null else "SET NULL"), nullable=null, index=index)


class Organization(Stamp, Base):
    __tablename__ = "organizations"
    name: Mapped[str] = mapped_column(String(160))
    evidence_retention_days: Mapped[int] = mapped_column(Integer, default=30)


class User(Stamp, Base):
    __tablename__ = "users"
    organization_id: Mapped[int] = fk("organizations")
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(20), default="viewer")  # admin | safety_officer | viewer
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    __table_args__ = (Index("ix_users_organization_active", "organization_id", "is_active"),)


class Worker(Stamp, Base):
    __tablename__ = "workers"
    organization_id: Mapped[int] = fk("organizations")
    employee_code: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(120))
    department: Mapped[str | None] = mapped_column(String(80))
    designation: Mapped[str | None] = mapped_column(String(80))
    location_id: Mapped[int | None] = fk("locations", null=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    __table_args__ = (UniqueConstraint("organization_id", "employee_code"),)


class Location(Stamp, Base):
    __tablename__ = "locations"
    organization_id: Mapped[int] = fk("organizations")
    site: Mapped[str | None] = mapped_column(String(120))  # multi-site support
    name: Mapped[str] = mapped_column(String(120))


class Camera(Stamp, Base):
    __tablename__ = "cameras"
    organization_id: Mapped[int] = fk("organizations")
    location_id: Mapped[int | None] = fk("locations", null=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(20))  # mobile | webcam | ip | video
    status: Mapped[str] = mapped_column(String(20), default="offline", index=True)
    stream_secret_enc: Mapped[str | None] = mapped_column(Text)  # RTSP credentials, never sent to client
    confidence_threshold: Mapped[float] = mapped_column(Float, default=0.5)


class PPEType(Stamp, Base):
    __tablename__ = "ppe_types"
    code: Mapped[str] = mapped_column(String(30), unique=True)
    name: Mapped[str] = mapped_column(String(60))


class SafetyRule(Stamp, Base):
    __tablename__ = "safety_rules"
    location_id: Mapped[int] = fk("locations")
    ppe_type_id: Mapped[int] = fk("ppe_types")
    requirement: Mapped[str] = mapped_column(String(10), default="required")  # required | optional
    severity: Mapped[str] = mapped_column(String(20), default="high")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    __table_args__ = (
        UniqueConstraint("location_id", "ppe_type_id"),
        Index("ix_safety_rules_location_enabled", "location_id", "enabled"),
    )


class DetectionEvent(Stamp, Base):
    __tablename__ = "detection_events"
    camera_id: Mapped[int] = fk("cameras")
    tracking_id: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), index=True)  # compliant | non_compliant | uncertain
    confidence: Mapped[float | None] = mapped_column(Float)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    detail: Mapped[dict | None] = mapped_column(JSON)
    __table_args__ = (Index("ix_detection_events_camera_detected_at", "camera_id", "detected_at"),)


class Violation(Stamp, Base):
    __tablename__ = "violations"
    organization_id: Mapped[int] = fk("organizations")
    camera_id: Mapped[int] = fk("cameras")
    location_id: Mapped[int | None] = fk("locations", null=True)
    ppe_type_id: Mapped[int] = fk("ppe_types")
    worker_id: Mapped[int | None] = fk("workers", null=True)
    tracking_id: Mapped[int | None] = mapped_column(Integer)
    confidence: Mapped[float | None] = mapped_column(Float)
    severity: Mapped[str] = mapped_column(String(20), default="high")
    evidence_path: Mapped[str | None] = mapped_column(String(300))
    review_status: Mapped[str] = mapped_column(String(20), default="new", index=True)
    __table_args__ = (
        Index("ix_violations_organization_created_at", "organization_id", "created_at"),
        Index("ix_violations_camera_tracking", "camera_id", "tracking_id"),
    )


class Alert(Stamp, Base):
    __tablename__ = "alerts"
    organization_id: Mapped[int] = fk("organizations")
    violation_id: Mapped[int] = fk("violations")
    status: Mapped[str] = mapped_column(String(20), default="new", index=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    comment: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (Index("ix_alerts_organization_status", "organization_id", "status"),)


class AlertAssignment(Stamp, Base):
    __tablename__ = "alert_assignments"
    alert_id: Mapped[int] = fk("alerts")
    user_id: Mapped[int] = fk("users")


class Notification(Stamp, Base):
    __tablename__ = "notifications"
    user_id: Mapped[int] = fk("users")
    alert_id: Mapped[int | None] = fk("alerts", null=True)
    channel: Mapped[str] = mapped_column(String(20))  # in_app | browser | email
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (Index("ix_notifications_user_read_at", "user_id", "read_at"),)


class Report(Stamp, Base):
    __tablename__ = "reports"
    organization_id: Mapped[int] = fk("organizations")
    kind: Mapped[str] = mapped_column(String(40))
    params: Mapped[dict | None] = mapped_column(JSON)
    created_by: Mapped[int | None] = fk("users", null=True)


class RestrictedZone(Stamp, Base):
    __tablename__ = "restricted_zones"
    camera_id: Mapped[int] = fk("cameras")
    name: Mapped[str] = mapped_column(String(120))
    polygon: Mapped[list] = mapped_column(JSON)  # normalised [[x, y], ...]
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class AuditLog(Stamp, Base):
    __tablename__ = "audit_logs"
    organization_id: Mapped[int | None] = fk("organizations", null=True)
    user_id: Mapped[int | None] = fk("users", null=True)
    action: Mapped[str] = mapped_column(String(80))
    detail: Mapped[dict | None] = mapped_column(JSON)
    __table_args__ = (Index("ix_audit_logs_organization_created_at", "organization_id", "created_at"),)


class NotificationSetting(Stamp, Base):
    __tablename__ = "notification_settings"
    user_id: Mapped[int] = fk("users")
    browser_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    email_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    sound_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    escalation_minutes: Mapped[int] = mapped_column(Integer, default=10)


class ProcessingJob(Stamp, Base):
    __tablename__ = "processing_jobs"
    organization_id: Mapped[int] = fk("organizations")
    camera_id: Mapped[int | None] = fk("cameras", null=True)
    created_by: Mapped[int | None] = fk("users", null=True)
    kind: Mapped[str] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    input_path: Mapped[str | None] = mapped_column(String(500))
    result: Mapped[dict | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)
