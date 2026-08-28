"""Auth and profile schemas (Pydantic v2)."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Literal, Optional

from pydantic import EmailStr, Field, field_validator

from app.schemas.base import APIModel, ResponseModel

Role = Literal["trainee", "trainer", "admin"]
UserStatus = Literal["pending", "approved", "rejected", "suspended"]
ProficiencyLevel = Literal["beginner", "intermediate", "advanced", "expert"]


# ------------------------------- Profile -------------------------------


class RegisterProfileRequest(APIModel):
    """Body for POST /auth/register-profile.

    name/email are optional: when omitted they come from the verified token.
    role is the role the user is signing up as (admin cannot be self-assigned).
    """

    name: Optional[str] = Field(default=None, max_length=150)
    email: Optional[EmailStr] = None
    role: Literal["trainee", "trainer"] = "trainee"

    @field_validator("email")
    @classmethod
    def _lower(cls, v: Optional[str]) -> Optional[str]:
        return v.lower() if v else v


class ProfileUpdate(APIModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    mfa_enabled: Optional[bool] = None


class ProfileResponse(ResponseModel):
    id: uuid.UUID
    supabase_uid: Optional[str] = None
    firebase_uid: str
    name: str
    email: str
    role: Role
    status: UserStatus
    mfa_enabled: bool = False
    created_at: Optional[dt.datetime] = None
    updated_at: Optional[dt.datetime] = None
    last_login_at: Optional[dt.datetime] = None


class MeResponse(ProfileResponse):
    """Profile plus the resolved role-side ids, handy for the frontend."""

    trainee_profile_id: Optional[uuid.UUID] = None
    trainer_profile_id: Optional[uuid.UUID] = None


# --------------------------- Trainee sub-entities ---------------------------


class QualificationCreate(APIModel):
    degree: str = Field(min_length=1, max_length=150)
    institution: str = Field(min_length=1, max_length=200)
    year_of_completion: Optional[int] = Field(default=None, ge=1900, le=2100)


class QualificationUpdate(APIModel):
    degree: Optional[str] = Field(default=None, min_length=1, max_length=150)
    institution: Optional[str] = Field(default=None, min_length=1, max_length=200)
    year_of_completion: Optional[int] = Field(default=None, ge=1900, le=2100)


class QualificationResponse(ResponseModel):
    id: uuid.UUID
    degree: Optional[str] = None
    institution: Optional[str] = None
    year_of_completion: Optional[int] = None


class WorkExperienceCreate(APIModel):
    organization: str = Field(min_length=1, max_length=200)
    designation: Optional[str] = Field(default=None, max_length=150)
    start_date: Optional[dt.date] = None
    end_date: Optional[dt.date] = None
    description: Optional[str] = None


class WorkExperienceUpdate(APIModel):
    organization: Optional[str] = Field(default=None, min_length=1, max_length=200)
    designation: Optional[str] = Field(default=None, max_length=150)
    start_date: Optional[dt.date] = None
    end_date: Optional[dt.date] = None
    description: Optional[str] = None


class WorkExperienceResponse(ResponseModel):
    id: uuid.UUID
    organization: Optional[str] = None
    designation: Optional[str] = None
    start_date: Optional[dt.date] = None
    end_date: Optional[dt.date] = None
    description: Optional[str] = None


class InterestCreate(APIModel):
    interest_name: str = Field(min_length=1, max_length=100)


class InterestResponse(ResponseModel):
    id: uuid.UUID
    interest_name: Optional[str] = None


class SkillCreate(APIModel):
    skill_name: str = Field(min_length=1, max_length=100)
    proficiency_level: ProficiencyLevel


class SkillResponse(ResponseModel):
    id: uuid.UUID
    skill_name: str
    proficiency_level: ProficiencyLevel


class CertificateCreate(APIModel):
    title: str = Field(min_length=1, max_length=200)
    issuing_body: Optional[str] = Field(default=None, max_length=200)
    issue_date: Optional[dt.date] = None
    file_url: Optional[str] = Field(default=None, max_length=500)


class CertificateResponse(ResponseModel):
    id: uuid.UUID
    title: str
    issuing_body: Optional[str] = None
    issue_date: Optional[dt.date] = None
    file_url: Optional[str] = None


class TraineeProfileUpdate(APIModel):
    headline: Optional[str] = Field(default=None, max_length=200)
    bio: Optional[str] = None
    profile_photo_url: Optional[str] = Field(default=None, max_length=500)


class TraineeProfileResponse(ResponseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    headline: Optional[str] = None
    bio: Optional[str] = None
    profile_photo_url: Optional[str] = None
    updated_at: Optional[dt.datetime] = None
    qualifications: list[QualificationResponse] = Field(default_factory=list)
    work_experience: list[WorkExperienceResponse] = Field(default_factory=list)
    interests: list[InterestResponse] = Field(default_factory=list)
    skills: list[SkillResponse] = Field(default_factory=list)
    certificates: list[CertificateResponse] = Field(default_factory=list)


# --------------------------- Trainer profile ---------------------------


class TrainerCompetencyResponse(ResponseModel):
    id: uuid.UUID
    subject_id: uuid.UUID
    subject_name: Optional[str] = None
    proficiency_score: Optional[float] = None
    source: Optional[str] = None


class TrainerProfileUpdate(APIModel):
    bio: Optional[str] = None
    designation: Optional[str] = Field(default=None, max_length=150)
    organization: Optional[str] = Field(default=None, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=50)
    experience_years: Optional[int] = Field(default=None, ge=0, le=100)
    profile_photo_url: Optional[str] = Field(default=None, max_length=500)


class TrainerProfileResponse(ResponseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    bio: Optional[str] = None
    designation: Optional[str] = None
    organization: Optional[str] = None
    phone: Optional[str] = None
    experience_years: Optional[int] = None
    profile_photo_url: Optional[str] = None
    updated_at: Optional[dt.datetime] = None
    skills: list[SkillResponse] = Field(default_factory=list)
    competencies: list[TrainerCompetencyResponse] = Field(default_factory=list)
