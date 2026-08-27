"""Assessment services: authoring, attempts, scoring, and certificate issuance (FR-6.x).

Security rules enforced here (Section 4, point 3):
  * `question_options.is_correct` is NEVER included in a trainee-facing payload before
    that trainee has submitted. `serialize_for_taking` builds the public shape and has
    no path to the flag at all; the full shape is a separate function.
  * A trainee may only start an attempt on a *published* assessment belonging to a
    course they are *enrolled in*.
  * A trainee may only read their OWN attempts. Trainers read attempts for their own
    courses; admins read everything.
  * Scoring happens server-side from the stored answer key — the client never sends marks.
"""

from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import BadRequest, Conflict, Forbidden, NotFound
from app.db.models import (
    Assessment,
    AssessmentAttempt,
    AttemptAnswer,
    CertificateIssued,
    Course,
    Enrollment,
    Notification,
    Question,
    QuestionOption,
    Subject,
)
from app.deps import CurrentUser
from app.services import audit, courses as course_service

# ------------------------------- Authoring -------------------------------


async def create_assessment(
    db: AsyncSession,
    current_user: CurrentUser,
    *,
    course_id: uuid.UUID,
    subject_id: uuid.UUID | None,
    title: str,
    deadline: dt.datetime | None,
    time_limit_minutes: int | None,
    pass_percentage: int,
    status: str,
) -> Assessment:
    """Create an assessment under a course the caller owns."""
    await course_service.get_editable_course(db, current_user, course_id)
    if current_user.trainer_profile_id is None:
        raise Conflict("A trainer profile is required", code="trainer_profile_missing")
    if subject_id is not None and await db.get(Subject, subject_id) is None:
        raise NotFound("Subject not found", code="subject_not_found")

    assessment = Assessment(
        course_id=course_id,
        subject_id=subject_id,
        title=title,
        created_by=current_user.trainer_profile_id,
        deadline=deadline,
        time_limit_minutes=time_limit_minutes,
        pass_percentage=pass_percentage,
        status=status,
    )
    db.add(assessment)
    await db.flush()
    # A freshly inserted row has no loaded `questions` collection, and every serializer
    # below reads it — an implicit lazy load under asyncio would raise `MissingGreenlet`.
    await db.refresh(assessment, attribute_names=["questions"])
    await audit.record(
        db,
        actor_id=current_user.id,
        action="assessment.created",
        target_entity="assessments",
        target_id=assessment.id,
        meta={"course_id": str(course_id), "title": title},
    )
    return assessment


async def get_editable_assessment(
    db: AsyncSession, current_user: CurrentUser, assessment_id: uuid.UUID
) -> Assessment:
    """Load an assessment and verify the caller may edit its parent course."""
    assessment = await db.get(Assessment, assessment_id)
    if assessment is None:
        raise NotFound("Assessment not found", code="assessment_not_found")
    await course_service.get_editable_course(db, current_user, assessment.course_id)
    return assessment


async def update_assessment(
    db: AsyncSession, current_user: CurrentUser, assessment_id: uuid.UUID, values: dict[str, Any]
) -> Assessment:
    assessment = await get_editable_assessment(db, current_user, assessment_id)

    if values.get("status") == "published" and not assessment.questions:
        raise Conflict(
            "Add at least one question before publishing", code="assessment_empty"
        )

    for field in (
        "title",
        "subject_id",
        "deadline",
        "time_limit_minutes",
        "pass_percentage",
        "status",
    ):
        if field in values and values[field] is not None:
            setattr(assessment, field, values[field])

    await db.flush()
    return assessment


async def delete_assessment(
    db: AsyncSession, current_user: CurrentUser, assessment_id: uuid.UUID
) -> None:
    """Delete an assessment, refusing once attempts exist.

    Attempts cascade, so deleting would erase trainee results; closing the assessment
    is the non-destructive path.
    """
    assessment = await get_editable_assessment(db, current_user, assessment_id)

    attempts = await db.scalar(
        select(func.count(AssessmentAttempt.id)).where(
            AssessmentAttempt.assessment_id == assessment_id
        )
    )
    if attempts:
        raise Conflict(
            f"{attempts} attempt(s) exist. Close the assessment instead of deleting it.",
            code="assessment_has_attempts",
        )

    await db.delete(assessment)
    await db.flush()


async def add_questions(
    db: AsyncSession,
    current_user: CurrentUser,
    assessment_id: uuid.UUID,
    questions: list[dict[str, Any]],
) -> Assessment:
    """Bulk-append questions with their options and answer key."""
    assessment = await get_editable_assessment(db, current_user, assessment_id)

    for spec in questions:
        question = Question(
            assessment_id=assessment.id,
            question_text=spec["question_text"],
            marks=spec.get("marks", 1),
        )
        db.add(question)
        await db.flush()
        for option in spec["options"]:
            db.add(
                QuestionOption(
                    question_id=question.id,
                    option_text=option["option_text"],
                    is_correct=option.get("is_correct", False),
                )
            )

    await db.flush()
    await db.refresh(assessment)
    return assessment


async def delete_question(
    db: AsyncSession, current_user: CurrentUser, question_id: uuid.UUID
) -> None:
    question = await db.get(Question, question_id)
    if question is None:
        raise NotFound("Question not found", code="question_not_found")
    await get_editable_assessment(db, current_user, question.assessment_id)
    await db.delete(question)
    await db.flush()


# ------------------------------ Serialization ------------------------------


def _totals(assessment: Assessment) -> tuple[int, int]:
    return len(assessment.questions), sum(q.marks or 1 for q in assessment.questions)


def _header(assessment: Assessment) -> dict[str, Any]:
    question_count, total_marks = _totals(assessment)
    return {
        "id": assessment.id,
        "course_id": assessment.course_id,
        "subject_id": assessment.subject_id,
        "title": assessment.title,
        "deadline": assessment.deadline,
        "time_limit_minutes": assessment.time_limit_minutes,
        "pass_percentage": assessment.pass_percentage or 50,
        "status": assessment.status,
        "created_by": assessment.created_by,
        "question_count": question_count,
        "total_marks": total_marks,
    }


serialize_summary = _header


def serialize_for_taking(assessment: Assessment) -> dict[str, Any]:
    """Trainee-facing payload. Deliberately never reads `option.is_correct`."""
    payload = _header(assessment)
    payload["questions"] = [
        {
            "id": question.id,
            "question_text": question.question_text,
            "marks": question.marks or 1,
            "options": [
                {"id": option.id, "option_text": option.option_text}
                for option in question.options
            ],
        }
        for question in assessment.questions
    ]
    return payload


def serialize_full(assessment: Assessment) -> dict[str, Any]:
    """Trainer/admin payload including the answer key."""
    payload = _header(assessment)
    payload["questions"] = [
        {
            "id": question.id,
            "question_text": question.question_text,
            "marks": question.marks or 1,
            "options": [
                {
                    "id": option.id,
                    "option_text": option.option_text,
                    "is_correct": bool(option.is_correct),
                }
                for option in question.options
            ],
        }
        for question in assessment.questions
    ]
    return payload


# -------------------------------- Reading --------------------------------


async def list_assessments(
    db: AsyncSession,
    current_user: CurrentUser,
    *,
    course_id: uuid.UUID | None = None,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    """List assessments the caller may see.

    Trainees only see published assessments on courses they are enrolled in — an
    unenrolled trainee should not be able to enumerate a course's exams.
    """
    query = select(Assessment)
    count_q = select(func.count(Assessment.id))

    filters = []
    if course_id:
        filters.append(Assessment.course_id == course_id)
    if status:
        filters.append(Assessment.status == status)

    if current_user.is_admin:
        pass
    elif current_user.is_trainer and current_user.trainer_profile_id:
        owned = select(Course.id).where(Course.created_by == current_user.trainer_profile_id)
        filters.append(Assessment.course_id.in_(owned))
    else:
        if current_user.trainee_profile_id is None:
            return [], 0
        enrolled = select(Enrollment.course_id).where(
            Enrollment.trainee_profile_id == current_user.trainee_profile_id
        )
        filters.append(Assessment.course_id.in_(enrolled))
        filters.append(Assessment.status == "published")

    for f in filters:
        query = query.where(f)
        count_q = count_q.where(f)

    total = (await db.scalar(count_q)) or 0
    rows = await db.scalars(query.order_by(Assessment.title).limit(limit).offset(offset))
    return [_header(a) for a in rows.all()], total


async def get_assessment_for_caller(
    db: AsyncSession, current_user: CurrentUser, assessment_id: uuid.UUID
) -> tuple[Assessment, bool]:
    """Load an assessment plus whether the caller may see the answer key.

    Returns `(assessment, may_see_key)`. Routers use the flag to pick between
    `serialize_full` and `serialize_for_taking`, so the choice is made from an
    authorization result rather than from the caller's own request.
    """
    assessment = await db.get(Assessment, assessment_id)
    if assessment is None:
        raise NotFound("Assessment not found", code="assessment_not_found")

    if current_user.is_admin:
        return assessment, True

    course = await db.get(Course, assessment.course_id)
    if course is None:
        raise NotFound("Assessment not found", code="assessment_not_found")

    if course_service._is_owner(course, current_user):
        return assessment, True

    # Trainee path: must be published and the trainee must be enrolled.
    if assessment.status != "published":
        raise NotFound("Assessment not found", code="assessment_not_found")
    if current_user.trainee_profile_id is None:
        raise Forbidden("Enroll in the course to view this assessment", code="not_enrolled")

    enrolled = await db.scalar(
        select(func.count(Enrollment.id)).where(
            Enrollment.trainee_profile_id == current_user.trainee_profile_id,
            Enrollment.course_id == assessment.course_id,
        )
    )
    if not enrolled:
        raise Forbidden("Enroll in the course to view this assessment", code="not_enrolled")

    return assessment, False


# -------------------------------- Attempts --------------------------------


def _expires_at(attempt: AssessmentAttempt, assessment: Assessment) -> dt.datetime | None:
    if not assessment.time_limit_minutes or attempt.started_at is None:
        return None
    return attempt.started_at + dt.timedelta(minutes=assessment.time_limit_minutes)


async def start_attempt(
    db: AsyncSession, current_user: CurrentUser, assessment_id: uuid.UUID
) -> dict[str, Any]:
    """Begin (or resume) an attempt and return the paper without the answer key."""
    if current_user.trainee_profile_id is None:
        raise Conflict("Only trainees can take assessments", code="trainee_profile_missing")

    assessment, may_see_key = await get_assessment_for_caller(db, current_user, assessment_id)
    if may_see_key and not current_user.is_trainee:
        raise Forbidden(
            "Course owners and admins cannot take their own assessments",
            code="author_cannot_attempt",
        )
    if assessment.status != "published":
        raise Conflict("This assessment is not open", code="assessment_not_published")
    if not assessment.questions:
        raise Conflict("This assessment has no questions yet", code="assessment_empty")

    now = dt.datetime.now(dt.timezone.utc)
    if assessment.deadline is not None and now > assessment.deadline:
        raise Conflict("The deadline for this assessment has passed", code="deadline_passed")

    # Resume an unfinished attempt rather than silently starting a second one.
    attempt = await db.scalar(
        select(AssessmentAttempt).where(
            AssessmentAttempt.assessment_id == assessment_id,
            AssessmentAttempt.trainee_profile_id == current_user.trainee_profile_id,
            AssessmentAttempt.status == "in_progress",
        )
    )
    if attempt is not None:
        deadline = _expires_at(attempt, assessment)
        if deadline is not None and now > deadline:
            attempt.status = "expired"
            await db.flush()
            raise Conflict(
                "Your previous attempt ran out of time", code="attempt_expired"
            )
    else:
        submitted = await db.scalar(
            select(func.count(AssessmentAttempt.id)).where(
                AssessmentAttempt.assessment_id == assessment_id,
                AssessmentAttempt.trainee_profile_id == current_user.trainee_profile_id,
                AssessmentAttempt.status == "submitted",
            )
        )
        if submitted:
            raise Conflict(
                "You have already submitted this assessment", code="already_submitted"
            )

        attempt = AssessmentAttempt(
            assessment_id=assessment_id,
            trainee_profile_id=current_user.trainee_profile_id,
            status="in_progress",
            started_at=now,
        )
        db.add(attempt)
        await db.flush()

    return {
        "id": attempt.id,
        "assessment_id": attempt.assessment_id,
        "trainee_profile_id": attempt.trainee_profile_id,
        "started_at": attempt.started_at,
        "status": attempt.status,
        "time_limit_minutes": assessment.time_limit_minutes,
        "expires_at": _expires_at(attempt, assessment),
        "assessment": serialize_for_taking(assessment),
    }


async def submit_attempt(
    db: AsyncSession,
    current_user: CurrentUser,
    attempt_id: uuid.UUID,
    answers: list[dict[str, uuid.UUID]],
) -> dict[str, Any]:
    """Score a submission server-side and issue a certificate when it passes.

    Marks come only from the stored answer key; the request body carries selections
    and nothing else, so a client cannot influence its own score.
    """
    attempt = await db.get(AssessmentAttempt, attempt_id)
    if attempt is None or attempt.trainee_profile_id != current_user.trainee_profile_id:
        raise NotFound("Attempt not found", code="attempt_not_found")
    if attempt.status == "submitted":
        raise Conflict("This attempt has already been submitted", code="already_submitted")
    if attempt.status == "expired":
        raise Conflict("This attempt has expired", code="attempt_expired")

    assessment = await db.get(Assessment, attempt.assessment_id)
    if assessment is None:
        raise NotFound("Assessment not found", code="assessment_not_found")

    now = dt.datetime.now(dt.timezone.utc)
    deadline = _expires_at(attempt, assessment)
    if deadline is not None and now > deadline:
        attempt.status = "expired"
        await db.flush()
        raise Conflict("Your time limit has passed", code="attempt_expired")

    # Build the answer key in one pass over the eager-loaded questions.
    questions = {q.id: q for q in assessment.questions}
    correct_by_question: dict[uuid.UUID, uuid.UUID | None] = {}
    valid_options: dict[uuid.UUID, set[uuid.UUID]] = {}
    for question in assessment.questions:
        valid_options[question.id] = {o.id for o in question.options}
        correct = next((o.id for o in question.options if o.is_correct), None)
        correct_by_question[question.id] = correct

    submitted: dict[uuid.UUID, uuid.UUID] = {}
    for answer in answers:
        question_id = answer["question_id"]
        option_id = answer["selected_option_id"]
        if question_id not in questions:
            raise BadRequest(
                "An answer refers to a question outside this assessment",
                code="unknown_question",
            )
        if option_id not in valid_options[question_id]:
            raise BadRequest(
                "An answer refers to an option that does not belong to its question",
                code="unknown_option",
            )
        submitted[question_id] = option_id

    # Replace any partial answers from a resumed attempt.
    for existing in list(attempt.answers):
        await db.delete(existing)
    await db.flush()

    total_marks = 0
    obtained_marks = 0
    results: list[dict[str, Any]] = []

    for question in assessment.questions:
        marks = question.marks or 1
        total_marks += marks
        selected = submitted.get(question.id)
        correct_option = correct_by_question[question.id]
        is_correct = selected is not None and selected == correct_option
        if is_correct:
            obtained_marks += marks

        db.add(
            AttemptAnswer(
                attempt_id=attempt.id,
                question_id=question.id,
                selected_option_id=selected,
                is_correct=is_correct,
            )
        )
        results.append(
            {
                "question_id": question.id,
                "selected_option_id": selected,
                "correct_option_id": correct_option,
                "is_correct": is_correct,
                "marks_awarded": marks if is_correct else 0,
            }
        )

    percentage = (obtained_marks / total_marks * 100) if total_marks else 0.0
    pass_percentage = assessment.pass_percentage or 50
    passed = percentage >= pass_percentage

    attempt.status = "submitted"
    attempt.submitted_at = now
    attempt.score = Decimal(str(round(percentage, 2)))
    await db.flush()

    certificate_url: str | None = None
    certificate_issued = False
    if passed:
        certificate_url, certificate_issued = await _issue_certificate(
            db, current_user, assessment, percentage
        )

    await audit.record(
        db,
        actor_id=current_user.id,
        action="attempt.submitted",
        target_entity="assessment_attempts",
        target_id=attempt.id,
        meta={
            "assessment_id": str(assessment.id),
            "score": round(percentage, 2),
            "passed": passed,
        },
    )

    return {
        "id": attempt.id,
        "assessment_id": attempt.assessment_id,
        "trainee_profile_id": attempt.trainee_profile_id,
        "started_at": attempt.started_at,
        "submitted_at": attempt.submitted_at,
        "score": float(attempt.score) if attempt.score is not None else None,
        "status": attempt.status,
        "total_marks": total_marks,
        "obtained_marks": obtained_marks,
        "pass_percentage": pass_percentage,
        "passed": passed,
        "certificate_issued": certificate_issued,
        "certificate_url": certificate_url,
        "answers": results,
    }


async def _issue_certificate(
    db: AsyncSession,
    current_user: CurrentUser,
    assessment: Assessment,
    percentage: float,
) -> tuple[str | None, bool]:
    """Issue a completion certificate once, and mark the enrollment complete (FR-6.5).

    The PDF itself is rendered by a background job; the row is created now so the
    trainee immediately sees that they earned it.
    """
    existing = await db.scalar(
        select(CertificateIssued).where(
            CertificateIssued.trainee_profile_id == current_user.trainee_profile_id,
            CertificateIssued.course_id == assessment.course_id,
        )
    )
    if existing is not None:
        return existing.certificate_url, False

    certificate = CertificateIssued(
        trainee_profile_id=current_user.trainee_profile_id,
        course_id=assessment.course_id,
        issue_date=dt.date.today(),
    )
    db.add(certificate)

    enrollment = await db.scalar(
        select(Enrollment).where(
            Enrollment.trainee_profile_id == current_user.trainee_profile_id,
            Enrollment.course_id == assessment.course_id,
        )
    )
    if enrollment is not None:
        enrollment.status = "completed"
        enrollment.progress_percent = 100
        enrollment.completed_at = dt.datetime.now(dt.timezone.utc)

    db.add(
        Notification(
            type="achievement",
            title=f"Certificate earned: {assessment.title}",
            body=f"You passed with {percentage:.1f}%. Your certificate is being prepared.",
            published_by=current_user.id,
            target_role="all",
        )
    )
    await db.flush()
    return certificate.certificate_url, True


async def get_attempt_result(
    db: AsyncSession, current_user: CurrentUser, attempt_id: uuid.UUID
) -> dict[str, Any]:
    """Return a submitted attempt with the answer key.

    Readable by the owning trainee, the course owner, or an admin. The key is only
    ever revealed for an attempt in a terminal state.
    """
    attempt = await db.get(AssessmentAttempt, attempt_id)
    if attempt is None:
        raise NotFound("Attempt not found", code="attempt_not_found")

    assessment = await db.get(Assessment, attempt.assessment_id)
    if assessment is None:
        raise NotFound("Attempt not found", code="attempt_not_found")

    is_owner_trainee = attempt.trainee_profile_id == current_user.trainee_profile_id
    if not is_owner_trainee and not current_user.is_admin:
        course = await db.get(Course, assessment.course_id)
        if course is None or not course_service._is_owner(course, current_user):
            raise NotFound("Attempt not found", code="attempt_not_found")

    if attempt.status == "in_progress":
        raise Conflict(
            "This attempt has not been submitted yet", code="attempt_in_progress"
        )

    questions = {q.id: q for q in assessment.questions}
    correct_by_question = {
        q.id: next((o.id for o in q.options if o.is_correct), None)
        for q in assessment.questions
    }

    total_marks = sum(q.marks or 1 for q in assessment.questions)
    obtained_marks = 0
    results = []
    for answer in attempt.answers:
        question = questions.get(answer.question_id)
        marks = (question.marks or 1) if question else 0
        if answer.is_correct:
            obtained_marks += marks
        results.append(
            {
                "question_id": answer.question_id,
                "selected_option_id": answer.selected_option_id,
                "correct_option_id": correct_by_question.get(answer.question_id),
                "is_correct": bool(answer.is_correct),
                "marks_awarded": marks if answer.is_correct else 0,
            }
        )

    pass_percentage = assessment.pass_percentage or 50
    score = float(attempt.score) if attempt.score is not None else 0.0

    certificate = await db.scalar(
        select(CertificateIssued).where(
            CertificateIssued.trainee_profile_id == attempt.trainee_profile_id,
            CertificateIssued.course_id == assessment.course_id,
        )
    )

    return {
        "id": attempt.id,
        "assessment_id": attempt.assessment_id,
        "trainee_profile_id": attempt.trainee_profile_id,
        "started_at": attempt.started_at,
        "submitted_at": attempt.submitted_at,
        "score": score,
        "status": attempt.status,
        "total_marks": total_marks,
        "obtained_marks": obtained_marks,
        "pass_percentage": pass_percentage,
        "passed": score >= pass_percentage,
        "certificate_issued": certificate is not None,
        "certificate_url": certificate.certificate_url if certificate else None,
        "answers": results,
    }


async def list_attempts(
    db: AsyncSession,
    current_user: CurrentUser,
    *,
    assessment_id: uuid.UUID | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    """List attempts scoped to what the caller may read."""
    query = select(AssessmentAttempt)
    count_q = select(func.count(AssessmentAttempt.id))

    filters = []
    if assessment_id:
        filters.append(AssessmentAttempt.assessment_id == assessment_id)

    if current_user.is_admin:
        pass
    elif current_user.is_trainer and current_user.trainer_profile_id:
        owned = select(Assessment.id).join(Course, Course.id == Assessment.course_id).where(
            Course.created_by == current_user.trainer_profile_id
        )
        filters.append(AssessmentAttempt.assessment_id.in_(owned))
    else:
        if current_user.trainee_profile_id is None:
            return [], 0
        filters.append(
            AssessmentAttempt.trainee_profile_id == current_user.trainee_profile_id
        )

    for f in filters:
        query = query.where(f)
        count_q = count_q.where(f)

    total = (await db.scalar(count_q)) or 0
    rows = await db.scalars(
        query.order_by(AssessmentAttempt.started_at.desc()).limit(limit).offset(offset)
    )
    attempts = list(rows.all())
    if not attempts:
        return [], total

    # Resolve each assessment's pass mark and total marks in two grouped queries so
    # the summary rows carry real numbers without an N+1 over the page.
    assessment_ids = {a.assessment_id for a in attempts}
    pass_marks = dict(
        (
            await db.execute(
                select(Assessment.id, Assessment.pass_percentage).where(
                    Assessment.id.in_(assessment_ids)
                )
            )
        ).all()
    )
    total_marks_by_assessment = dict(
        (
            await db.execute(
                select(Question.assessment_id, func.coalesce(func.sum(Question.marks), 0))
                .where(Question.assessment_id.in_(assessment_ids))
                .group_by(Question.assessment_id)
            )
        ).all()
    )

    items = []
    for attempt in attempts:
        pass_percentage = pass_marks.get(attempt.assessment_id) or 50
        total_marks = int(total_marks_by_assessment.get(attempt.assessment_id, 0) or 0)
        score = float(attempt.score) if attempt.score is not None else None
        submitted = attempt.status == "submitted"
        items.append(
            {
                "id": attempt.id,
                "assessment_id": attempt.assessment_id,
                "trainee_profile_id": attempt.trainee_profile_id,
                "started_at": attempt.started_at,
                "submitted_at": attempt.submitted_at,
                "score": score,
                "status": attempt.status,
                "total_marks": total_marks,
                "obtained_marks": round(total_marks * score / 100) if score else 0,
                "pass_percentage": pass_percentage,
                "passed": bool(submitted and score is not None and score >= pass_percentage),
                # Certificate state and the answer key belong to the detail endpoint.
                "certificate_issued": False,
                "certificate_url": None,
                "answers": [],
            }
        )
    return items, total
