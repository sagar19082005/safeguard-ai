import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import AuditLog, Base, Organization, User
from app.routers.auth import PasswordChange, change_password
from app.routers.users import UserCreate, UserUpdate, create_user, list_users, update_user
from app.security import hash_password, require_roles


class UserManagementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(cls.engine)
        cls.Session = sessionmaker(cls.engine)

    def setUp(self):
        self.db = self.Session()
        org = Organization(name=f"Site {self._testMethodName}")
        self.db.add(org)
        self.db.flush()
        self.admin = User(
            organization_id=org.id,
            email=f"admin-{self._testMethodName}@example.com",
            full_name="Admin",
            password_hash=hash_password("admin-password"),
            role="admin",
        )
        self.viewer = User(
            organization_id=org.id,
            email=f"viewer-{self._testMethodName}@example.com",
            full_name="Viewer",
            password_hash=hash_password("viewer-password"),
            role="viewer",
        )
        self.db.add_all([self.admin, self.viewer])
        self.db.commit()
        self.db.refresh(self.admin)
        self.db.refresh(self.viewer)

    def tearDown(self):
        self.db.rollback()
        self.db.close()

    def test_admin_can_create_and_list_organization_user(self):
        created = create_user(
            UserCreate(
                email="new-user@example.com",
                full_name="New User",
                password="temporary-password",
                role="safety_officer",
            ),
            self.db,
            self.admin,
        )
        users = list_users(self.db, self.admin)
        self.assertEqual(created["role"], "safety_officer")
        self.assertEqual({item["email"] for item in users}, {self.admin.email, self.viewer.email, "new-user@example.com"})
        self.assertIsNotNone(self.db.scalar(select(AuditLog.id).where(AuditLog.action == "user.created")))

    def test_admin_cannot_deactivate_self(self):
        with self.assertRaises(HTTPException) as error:
            update_user(
                self.admin.id,
                UserUpdate(full_name="Admin", role="admin", is_active=False),
                self.db,
                self.admin,
            )
        self.assertEqual(error.exception.status_code, 400)

    def test_viewer_is_denied_admin_guard(self):
        with self.assertRaises(HTTPException) as error:
            require_roles("admin")(self.viewer)
        self.assertEqual(error.exception.status_code, 403)

    def test_password_change_rejects_old_password_and_records_success(self):
        with self.assertRaises(HTTPException) as error:
            change_password(
                PasswordChange(current_password="wrong", new_password="new-password"),
                self.db,
                self.admin,
            )
        self.assertEqual(error.exception.status_code, 400)

        result = change_password(
            PasswordChange(current_password="admin-password", new_password="new-password"),
            self.db,
            self.admin,
        )
        self.assertEqual(result, {"changed": True})
        self.assertIsNotNone(self.db.scalar(select(AuditLog.id).where(AuditLog.action == "auth.password_changed")))


if __name__ == "__main__":
    unittest.main()
