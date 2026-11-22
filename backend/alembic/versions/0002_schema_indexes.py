"""Add indexes for organization-scoped queries and monitoring history.

Revision ID: 0002_schema_indexes
Revises: 0001_initial_schema
"""

from alembic import op

from app.models import Base

revision = "0002_schema_indexes"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    for table in Base.metadata.tables.values():
        for index in table.indexes:
            index.create(bind=bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    for table in reversed(list(Base.metadata.tables.values())):
        for index in table.indexes:
            index.drop(bind=bind, checkfirst=True)
