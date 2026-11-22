"""Create the SafeGuard AI relational schema.

Revision ID: 0001_initial_schema
Revises:
"""

from alembic import op

from app.models import Base

revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The declarative model is the single schema definition. Alembic records
    # this revision so future changes can be incremental and reviewable.
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)
    for table in Base.metadata.tables.values():
        for index in table.indexes:
            index.create(bind=bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
