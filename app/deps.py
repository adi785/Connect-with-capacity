"""FastAPI dependencies: authentication, RBAC, and DB session wiring.

Authorization lives entirely in this layer plus `app/services`:
Supabase Auth manages identity and JWT issuance, and the FastAPI backend
is the gatekeeper for application data and business logic.
"""

from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import VerifiedToken, verify_supabase_token
from app.db.models import Profile, TrainerProfile, TraineeProfile
from app.db.session import get_db

bearer_scheme = HTTPBearer(auto_error=False, description="Supabase Auth JWT")
optional_bearer_scheme = HTTPBearer(auto_error=False, description="Supabase Auth JWT")


@dataclass(slots=True)
class CurrentUser:
    """The authenticated caller, with role-side profile ids pre-resolved.

    `trainee_profile_id` / `trainer_profile_id` are what ownership checks compare
    against, so resolving them once here keeps services free of repeat lookups.
    """

    id: uuid.UUID
    supabase_uid: str
    name: str
    email: str
    role: str
    status: str
    trainee_profile_id: uuid.UUID | None = None
    trainer_profile_id: uuid.UUID | None = None

    @property
    def firebase_uid(self) -> str:
        """Backwards-compatible alias for supabase_uid."""
        return self.supabase_uid

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @property
    def is_trainer(self) -> bool:
        return self.role == "trainer"

    @property
    def is_trainee(self) -> bool:
        return self.role == "trainee"

    @property
    def is_approved(self) -> bool:
        return self.status == "approved"


def _unauthenticated(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def _ensure_role_profile(db: AsyncSession, profile: Profile) -> tuple[
    uuid.UUID | None, uuid.UUID | None
]:
    """Guarantee the trainee/trainer side-table row exists for this profile.

    Both rows are keyed by profile id, so a role change later just creates the
    other side rather than migrating data.
    """
    trainee_id: uuid.UUID | None = None
    trainer_id: uuid.UUID | None = None

    if profile.role in ("trainee", "admin"):
        trainee_id = await db.scalar(
            select(TraineeProfile.id).where(TraineeProfile.user_id == profile.id)
        )
        if trainee_id is None:
            row = TraineeProfile(user_id=profile.id)
            db.add(row)
            await db.flush()
            trainee_id = row.id

    if profile.role in ("trainer", "admin"):
        trainer_id = await db.scalar(
            select(TrainerProfile.id).where(TrainerProfile.user_id == profile.id)
        )
        if trainer_id is None:
            row = TrainerProfile(
                user_id=profile.id,
                designation="Trainer" if profile.role == "trainer" else "Administrator",
            )
            db.add(row)
            await db.flush()
            trainer_id = row.id

    return trainee_id, trainer_id


async def get_or_create_profile(db: AsyncSession, token: VerifiedToken) -> Profile:
    """Look up the profile for a verified token, creating it on first sign-in.

    New accounts land as `status='pending'` and stay unusable for core actions
    until an admin approves them (FR-1.7). Emails in BOOTSTRAP_ADMIN_EMAILS are
    promoted to approved admin even when the Supabase auth-sync trigger created
    their profile before this first API sign-in.
    """
    email = (token.email or f"{token.uid}@unknown.local").lower().strip()
    is_bootstrap_admin = email in settings.admin_emails

    initial_role = "admin" if is_bootstrap_admin else token.raw_claims.get("role", "trainee")
    initial_status = "approved" if (is_bootstrap_admin or token.raw_claims.get("status") == "approved") else "pending"

    async def promote_bootstrap_admin(profile: Profile) -> None:
        """Apply the trusted bootstrap allowlist after any auth-triggered profile insert."""
        if is_bootstrap_admin and (profile.role != "admin" or profile.status != "approved"):
            profile.role = "admin"
            profile.status = "approved"
            await db.flush()

    profile = await db.scalar(
        select(Profile).where(
            or_(
                Profile.firebase_uid == token.uid,
                Profile.email == email,
            )
        )
    )

    if profile is not None:
        if profile.firebase_uid != token.uid:
            profile.firebase_uid = token.uid
            await db.flush()
        if settings.resolved_auth_mode == "dev" and token.raw_claims.get("role"):
            profile.role = token.raw_claims["role"]
            profile.status = token.raw_claims.get("status", "approved")
            await db.flush()
        await promote_bootstrap_admin(profile)
        return profile

    profile = Profile(
        firebase_uid=token.uid,
        name=(token.name or email.split("@")[0])[:150],
        email=email,
        role=initial_role,
        status=initial_status,
    )
    db.add(profile)
    try:
        await db.flush()
    except IntegrityError:
        # Two first-requests raced, or the email already belongs to another uid.
        await db.rollback()
        existing = await db.scalar(
            select(Profile).where(
                or_(
                    Profile.firebase_uid == token.uid,
                    Profile.email == email,
                )
            )
        )
        if existing is not None:
            if existing.firebase_uid != token.uid:
                existing.firebase_uid = token.uid
                await db.flush()
            await promote_bootstrap_admin(existing)
            return existing
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This email is already registered to a different account",
        ) from None

    return profile


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    """Verify the Supabase bearer token and load the caller's profile.

    Deliberately does NOT enforce approval — `/auth/register-profile` and `/me`
    must remain reachable while pending. Use `require_approved` for everything else.
    """
    if credentials is None or not credentials.credentials:
        raise _unauthenticated()

    token = verify_supabase_token(credentials.credentials)
    request.state.supabase_uid = token.uid
    request.state.firebase_uid = token.uid  # alias used for rate-limiting key

    profile = await get_or_create_profile(db, token)

    if profile.status == "suspended":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been suspended. Contact an administrator.",
        )

    trainee_id, trainer_id = await _ensure_role_profile(db, profile)

    return CurrentUser(
        id=profile.id,
        supabase_uid=profile.firebase_uid,
        name=profile.name,
        email=profile.email,
        role=profile.role,
        status=profile.status,
        trainee_profile_id=trainee_id,
        trainer_profile_id=trainer_id,
    )


async def get_current_user_optional(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(optional_bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser | None:
    """Same as `get_current_user` but returns None instead of raising."""
    if credentials is None:
        return None
    try:
        return await get_current_user(request, credentials, db)
    except HTTPException:
        return None


async def require_approved(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Gate for every core action: the account must be admin-approved."""
    if not current_user.is_approved:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Your account is awaiting administrator approval."
                if current_user.status == "pending"
                else f"Account status '{current_user.status}' cannot perform this action."
            ),
        )
    return current_user


def require_role(*allowed_roles: str):
    """Build a dependency requiring an approved account in one of `allowed_roles`."""

    async def dependency(
        current_user: CurrentUser = Depends(require_approved),
    ) -> CurrentUser:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires role: {', '.join(allowed_roles)}",
            )
        return current_user

    return dependency


# Pre-built role gates used across the routers.
require_admin = require_role("admin")
require_trainer = require_role("trainer")
require_trainee = require_role("trainee")
require_trainer_or_admin = require_role("trainer", "admin")


async def require_trainee_profile(
    current_user: CurrentUser = Depends(require_trainee),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    """A trainee action that needs the trainee side-table row to exist."""
    if current_user.trainee_profile_id is None:
        row = await db.scalar(select(TraineeProfile).where(TraineeProfile.user_id == current_user.id))
        if row is None:
            row = TraineeProfile(user_id=current_user.id)
            db.add(row)
            await db.flush()
        current_user.trainee_profile_id = row.id
    return current_user


async def require_trainer_profile(
    current_user: CurrentUser = Depends(require_trainer),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    """A trainer action that needs the trainer side-table row to exist."""
    if current_user.trainer_profile_id is None:
        row = await db.scalar(select(TrainerProfile).where(TrainerProfile.user_id == current_user.id))
        if row is None:
            row = TrainerProfile(
                user_id=current_user.id,
                designation="Trainer" if current_user.role == "trainer" else "Administrator",
            )
            db.add(row)
            await db.flush()
        current_user.trainer_profile_id = row.id
    return current_user


async def touch_last_login(db: AsyncSession, profile_id: uuid.UUID) -> None:
    """Record a sign-in timestamp (called from the register/me endpoints)."""
    profile = await db.get(Profile, profile_id)
    if profile is not None:
        profile.last_login_at = dt.datetime.now(dt.timezone.utc)
