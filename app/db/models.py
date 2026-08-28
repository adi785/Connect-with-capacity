"""SQLAlchemy 2.0 ORM models mirroring migrations/20260824_initial_schema.sql.

Enum-like columns are plain VARCHAR + CHECK constraints (matching the migration)
rather than Postgres ENUM types, so values can be added without ALTER TYPE pain.
Nested collections that get serialized use lazy="selectin": SQLAlchemy's async
mode cannot perform implicit lazy loads, so anything we read must be eager.
"""

from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, new_uuid

# Value sets, kept next to the models so schemas and services share one source.
ROLES = ("trainee", "trainer", "admin")
USER_STATUSES = ("pending", "approved", "rejected", "suspended")
PROFICIENCY_LEVELS = ("beginner", "intermediate", "advanced", "expert")
COMPETENCY_SOURCES = ("self_declared", "admin_assigned", "system_derived")
COURSE_STATUSES = ("draft", "published", "archived")
RESOURCE_TYPES = ("lecture_video", "presentation", "document", "link")
ENROLLMENT_STATUSES = ("enrolled", "in_progress", "completed", "dropped")
ASSESSMENT_STATUSES = ("draft", "published", "closed")
ATTEMPT_STATUSES = ("in_progress", "submitted", "expired")
APPROVAL_STATUSES = ("pending", "approved", "rejected")
NOTIFICATION_TYPES = ("announcement", "achievement", "new_content", "deadline_reminder")
NOTIFICATION_STATUSES = ("draft", "published", "archived")
TARGET_ROLES = ("all", "trainee", "trainer", "admin")


def _in(column: str, values: tuple[str, ...]) -> str:
    """Render a SQL IN-list for a CHECK constraint."""
    rendered = ", ".join(f"'{v}'" for v in values)
    return f"{column} in ({rendered})"


def _pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)


# ============================ PROFILES & ROLES ============================


class Profile(Base):
    """Application user. Identity itself lives in Firebase; firebase_uid is the join key."""

    __tablename__ = "profiles"
    __table_args__ = (
        CheckConstraint(_in("role", ROLES), name="profiles_role_check"),
        CheckConstraint(_in("status", USER_STATUSES), name="profiles_status_check"),
        {"schema": None},
    )

    id: Mapped[uuid.UUID] = _pk()
    firebase_uid: Mapped[str] = mapped_column(Text, unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    email: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    employee_id: Mapped[str | None] = mapped_column(String(50), unique=True, nullable=True, index=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="trainee")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    mfa_enabled: Mapped[bool | None] = mapped_column(Boolean, default=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    last_login_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def supabase_uid(self) -> str:
        return self.firebase_uid

    @supabase_uid.setter
    def supabase_uid(self, value: str) -> None:
        self.firebase_uid = value


class TraineeProfile(Base):
    __tablename__ = "trainee_profiles"

    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    headline: Mapped[str | None] = mapped_column(String(200))
    bio: Mapped[str | None] = mapped_column(Text)
    profile_photo_url: Mapped[str | None] = mapped_column(String(500))
    updated_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    qualifications: Mapped[list[Qualification]] = relationship(
        back_populates="trainee_profile", lazy="selectin", cascade="all, delete-orphan"
    )
    work_experience: Mapped[list[WorkExperience]] = relationship(
        back_populates="trainee_profile", lazy="selectin", cascade="all, delete-orphan"
    )
    interests: Mapped[list[Interest]] = relationship(
        back_populates="trainee_profile", lazy="selectin", cascade="all, delete-orphan"
    )
    certificates: Mapped[list[Certificate]] = relationship(
        back_populates="trainee_profile", lazy="selectin", cascade="all, delete-orphan"
    )
    skills: Mapped[list[Skill]] = relationship(
        back_populates="trainee_profile",
        lazy="selectin",
        cascade="all, delete-orphan",
        foreign_keys="Skill.trainee_profile_id",
    )


class Qualification(Base):
    __tablename__ = "qualifications"

    id: Mapped[uuid.UUID] = _pk()
    trainee_profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("trainee_profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    degree: Mapped[str | None] = mapped_column(String(150))
    institution: Mapped[str | None] = mapped_column(String(200))
    year_of_completion: Mapped[int | None] = mapped_column(Integer)

    trainee_profile: Mapped[TraineeProfile] = relationship(back_populates="qualifications")


class WorkExperience(Base):
    __tablename__ = "work_experience"

    id: Mapped[uuid.UUID] = _pk()
    trainee_profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("trainee_profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    organization: Mapped[str | None] = mapped_column(String(200))
    designation: Mapped[str | None] = mapped_column(String(150))
    start_date: Mapped[dt.date | None] = mapped_column(Date)
    end_date: Mapped[dt.date | None] = mapped_column(Date)
    description: Mapped[str | None] = mapped_column(Text)

    trainee_profile: Mapped[TraineeProfile] = relationship(back_populates="work_experience")


class Interest(Base):
    __tablename__ = "interests"

    id: Mapped[uuid.UUID] = _pk()
    trainee_profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("trainee_profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    interest_name: Mapped[str | None] = mapped_column(String(100))

    trainee_profile: Mapped[TraineeProfile] = relationship(back_populates="interests")


class Skill(Base):
    """Skill claimed by either a trainee or a trainer (exactly one owner)."""

    __tablename__ = "skills"
    __table_args__ = (
        CheckConstraint(
            _in("proficiency_level", PROFICIENCY_LEVELS), name="skills_proficiency_check"
        ),
        CheckConstraint(
            "trainee_profile_id is not null or trainer_profile_id is not null",
            name="skills_owner_check",
        ),
    )

    id: Mapped[uuid.UUID] = _pk()
    trainee_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trainee_profiles.id", ondelete="CASCADE")
    )
    trainer_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trainer_profiles.id", ondelete="CASCADE")
    )
    skill_name: Mapped[str] = mapped_column(String(100), nullable=False)
    proficiency_level: Mapped[str] = mapped_column(String(20), nullable=False)

    trainee_profile: Mapped[TraineeProfile | None] = relationship(
        back_populates="skills", foreign_keys=[trainee_profile_id]
    )
    trainer_profile: Mapped[TrainerProfile | None] = relationship(
        back_populates="skills", foreign_keys=[trainer_profile_id]
    )


class Certificate(Base):
    """Self-declared certificate uploaded by a trainee (not platform-issued)."""

    __tablename__ = "certificates"

    id: Mapped[uuid.UUID] = _pk()
    trainee_profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("trainee_profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    issuing_body: Mapped[str | None] = mapped_column(String(200))
    issue_date: Mapped[dt.date | None] = mapped_column(Date)
    file_url: Mapped[str | None] = mapped_column(String(500))

    trainee_profile: Mapped[TraineeProfile] = relationship(back_populates="certificates")


# ================================ TRAINER ================================


class TrainerProfile(Base):
    __tablename__ = "trainer_profiles"

    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    bio: Mapped[str | None] = mapped_column(Text)
    designation: Mapped[str | None] = mapped_column(String(150))
    organization: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(50))
    experience_years: Mapped[int | None] = mapped_column(Integer)
    profile_photo_url: Mapped[str | None] = mapped_column(String(500))
    updated_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    skills: Mapped[list[Skill]] = relationship(
        back_populates="trainer_profile",
        lazy="selectin",
        cascade="all, delete-orphan",
        foreign_keys="Skill.trainer_profile_id",
    )
    competencies: Mapped[list[CompetencyMap]] = relationship(
        back_populates="trainer_profile", lazy="selectin", cascade="all, delete-orphan"
    )


class Subject(Base):
    __tablename__ = "subjects"

    id: Mapped[uuid.UUID] = _pk()
    name: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    category: Mapped[str | None] = mapped_column(String(100))


class CompetencyMap(Base):
    __tablename__ = "competency_map"
    __table_args__ = (
        UniqueConstraint("trainer_profile_id", "subject_id", name="competency_map_unique"),
        CheckConstraint(_in("source", COMPETENCY_SOURCES), name="competency_source_check"),
    )

    id: Mapped[uuid.UUID] = _pk()
    trainer_profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("trainer_profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    subject_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False
    )
    proficiency_score: Mapped[Decimal | None] = mapped_column(Numeric(4, 2))
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    updated_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    trainer_profile: Mapped[TrainerProfile] = relationship(back_populates="competencies")
    subject: Mapped[Subject] = relationship(lazy="selectin")


# ================================ COURSES ================================


class Course(Base):
    __tablename__ = "courses"
    __table_args__ = (
        CheckConstraint(_in("status", COURSE_STATUSES), name="courses_status_check"),
    )

    id: Mapped[uuid.UUID] = _pk()
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    subject_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subjects.id")
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trainer_profiles.id"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    modules: Mapped[list[CourseModule]] = relationship(
        back_populates="course", lazy="selectin", cascade="all, delete-orphan"
    )


class CourseModule(Base):
    __tablename__ = "course_modules"

    id: Mapped[uuid.UUID] = _pk()
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    sequence_no: Mapped[int] = mapped_column(Integer, nullable=False)

    course: Mapped[Course] = relationship(back_populates="modules")
    resources: Mapped[list[LearningResource]] = relationship(
        back_populates="module", lazy="selectin", cascade="all, delete-orphan"
    )


class LearningResource(Base):
    __tablename__ = "learning_resources"
    __table_args__ = (
        CheckConstraint(_in("type", RESOURCE_TYPES), name="resources_type_check"),
    )

    id: Mapped[uuid.UUID] = _pk()
    course_module_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("course_modules.id", ondelete="CASCADE"),
        nullable=False,
    )
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    file_url: Mapped[str | None] = mapped_column(String(500))
    uploaded_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trainer_profiles.id"), nullable=False
    )
    uploaded_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    module: Mapped[CourseModule] = relationship(back_populates="resources")


class Enrollment(Base):
    __tablename__ = "enrollments"
    __table_args__ = (
        UniqueConstraint("trainee_profile_id", "course_id", name="enrollments_unique"),
        CheckConstraint(_in("status", ENROLLMENT_STATUSES), name="enrollments_status_check"),
    )

    id: Mapped[uuid.UUID] = _pk()
    trainee_profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("trainee_profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="enrolled")
    progress_percent: Mapped[int | None] = mapped_column(Integer, default=0)
    enrolled_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    completed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


# ============================== ASSESSMENTS ==============================


class Assessment(Base):
    __tablename__ = "assessments"
    __table_args__ = (
        CheckConstraint(_in("status", ASSESSMENT_STATUSES), name="assessments_status_check"),
    )

    id: Mapped[uuid.UUID] = _pk()
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )
    subject_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subjects.id")
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trainer_profiles.id"), nullable=False
    )
    deadline: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    time_limit_minutes: Mapped[int | None] = mapped_column(Integer)
    pass_percentage: Mapped[int | None] = mapped_column(Integer, default=50)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")

    questions: Mapped[list[Question]] = relationship(
        back_populates="assessment", lazy="selectin", cascade="all, delete-orphan"
    )


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[uuid.UUID] = _pk()
    assessment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("assessments.id", ondelete="CASCADE"), nullable=False
    )
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    marks: Mapped[int | None] = mapped_column(Integer, default=1)

    assessment: Mapped[Assessment] = relationship(back_populates="questions")
    options: Mapped[list[QuestionOption]] = relationship(
        back_populates="question", lazy="selectin", cascade="all, delete-orphan"
    )


class QuestionOption(Base):
    __tablename__ = "question_options"

    id: Mapped[uuid.UUID] = _pk()
    question_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("questions.id", ondelete="CASCADE"), nullable=False
    )
    option_text: Mapped[str] = mapped_column(String(500), nullable=False)
    is_correct: Mapped[bool | None] = mapped_column(Boolean, default=False)

    question: Mapped[Question] = relationship(back_populates="options")


class AssessmentAttempt(Base):
    __tablename__ = "assessment_attempts"
    __table_args__ = (
        UniqueConstraint(
            "assessment_id", "trainee_profile_id", "started_at", name="attempts_unique"
        ),
        CheckConstraint(_in("status", ATTEMPT_STATUSES), name="attempts_status_check"),
    )

    id: Mapped[uuid.UUID] = _pk()
    assessment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("assessments.id", ondelete="CASCADE"), nullable=False
    )
    trainee_profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("trainee_profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    started_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    submitted_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    score: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="in_progress")

    answers: Mapped[list[AttemptAnswer]] = relationship(
        back_populates="attempt", lazy="selectin", cascade="all, delete-orphan"
    )


class AttemptAnswer(Base):
    __tablename__ = "attempt_answers"

    id: Mapped[uuid.UUID] = _pk()
    attempt_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("assessment_attempts.id", ondelete="CASCADE"),
        nullable=False,
    )
    question_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("questions.id", ondelete="CASCADE"), nullable=False
    )
    selected_option_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("question_options.id")
    )
    is_correct: Mapped[bool | None] = mapped_column(Boolean)

    attempt: Mapped[AssessmentAttempt] = relationship(back_populates="answers")


class CertificateIssued(Base):
    """Platform-issued completion certificate."""

    __tablename__ = "certificates_issued"

    id: Mapped[uuid.UUID] = _pk()
    trainee_profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("trainee_profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    course_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id")
    )
    issue_date: Mapped[dt.date | None] = mapped_column(Date, server_default=func.now())
    certificate_url: Mapped[str | None] = mapped_column(String(500))


# ================ FEEDBACK, APPROVALS, NOTIFICATIONS, AUDIT ================


class Feedback(Base):
    __tablename__ = "feedback"
    __table_args__ = (
        CheckConstraint("rating between 1 and 5", name="feedback_rating_check"),
    )

    id: Mapped[uuid.UUID] = _pk()
    trainee_profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("trainee_profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )
    rating: Mapped[int | None] = mapped_column(Integer)
    comments: Mapped[str | None] = mapped_column(Text)
    submitted_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class ApprovalRequest(Base):
    __tablename__ = "approval_requests"
    __table_args__ = (
        CheckConstraint(
            _in("requested_role", ("trainee", "trainer")), name="approval_role_check"
        ),
        CheckConstraint(_in("status", APPROVAL_STATUSES), name="approval_status_check"),
    )

    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    requested_role: Mapped[str] = mapped_column(String(20), nullable=False)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("profiles.id")
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    requested_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    reviewed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint(_in("type", NOTIFICATION_TYPES), name="notifications_type_check"),
        CheckConstraint(_in("target_role", TARGET_ROLES), name="notifications_target_check"),
    )

    id: Mapped[uuid.UUID] = _pk()
    type: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text)
    body: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="published")
    published_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("profiles.id"), nullable=False
    )
    target_role: Mapped[str | None] = mapped_column(String(20), default="all")
    published_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    expires_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class NotificationRead(Base):
    __tablename__ = "notification_reads"
    __table_args__ = (
        UniqueConstraint("notification_id", "user_id", name="notification_reads_unique"),
    )

    id: Mapped[uuid.UUID] = _pk()
    notification_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("notifications.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    read_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("profiles.id")
    )
    action: Mapped[str] = mapped_column(String(150), nullable=False)
    target_entity: Mapped[str | None] = mapped_column(String(100))
    target_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    # "metadata" is reserved on the declarative base, so map it under a safe attribute.
    meta: Mapped[dict | None] = mapped_column("metadata", JSONB)
    created_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


__all__ = [
    "Base",
    "Profile",
    "TraineeProfile",
    "Qualification",
    "WorkExperience",
    "Interest",
    "Skill",
    "Certificate",
    "TrainerProfile",
    "Subject",
    "CompetencyMap",
    "Course",
    "CourseModule",
    "LearningResource",
    "Enrollment",
    "Assessment",
    "Question",
    "QuestionOption",
    "AssessmentAttempt",
    "AttemptAnswer",
    "CertificateIssued",
    "Feedback",
    "ApprovalRequest",
    "Notification",
    "NotificationRead",
    "AuditLog",
]
