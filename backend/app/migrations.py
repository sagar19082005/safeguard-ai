from pathlib import Path

from alembic import command
from alembic.config import Config
from .config import settings


def _config() -> Config:
    config = Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))
    config.set_main_option("script_location", str(Path(__file__).resolve().parent.parent / "alembic"))
    return config


def run_migrations() -> None:
    """Apply schema revisions, preserving tables created before Alembic."""
    config = _config()
    command.upgrade(config, "head")
