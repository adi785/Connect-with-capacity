# System Design Document
## Corporate Training & Learning Management Platform

**Version:** 1.0
**Status:** Draft
**Companion to:** Product Requirements Document (PRD) v1.0

---

## 1. Architecture Overview

### 1.1 Architectural Style
A **layered, service-oriented web architecture** (monolith-first, modular by domain, designed to be split into microservices later if scale demands it). This balances development speed for an academic/early-stage project with a clean upgrade path to microservices.

```
┌──────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                          │
│   Web App (Responsive SPA) — Trainee / Trainer / Admin UI     │
│   React (or Angular/Vue) + Tailwind/Bootstrap, PWA-ready      │
└───────────────────────────┬────────────────────────────────────┘
                            │ HTTPS (REST/JSON, JWT auth)
┌───────────────────────────▼────────────────────────────────────┐
│                       API GATEWAY LAYER                        │
│   Auth middleware, rate limiting, request validation, routing  │
└───────────────────────────┬────────────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────────────┐
│                     APPLICATION / SERVICE LAYER                │
│ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌──────────────────┐ │
│ │  Auth &   │ │  User &   │ │  Course & │ │   Assessment &   │ │
│ │  Identity │ │  Profile  │ │  Content  │ │  Certification   │ │
│ │  Service  │ │  Service  │ │  Service  │ │     Service      │ │
│ └───────────┘ └───────────┘ └───────────┘ └──────────────────┘ │
│ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌──────────────────┐ │
│ │ Competency│ │Notification│ │ Analytics │ │   Admin/Approval │ │
│ │  Mapping  │ │ & Announce │ │& Dashboard│ │     Service      │ │
│ │  Service  │ │  Service   │ │  Service  │ │                  │ │
│ └───────────┘ └───────────┘ └───────────┘ └──────────────────┘ │
└───────────────────────────┬────────────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────────────┐
│                        DATA LAYER                               │
│  Primary DB: PostgreSQL/MySQL (relational, transactional data)  │
│  Object Storage: AWS S3 / Azure Blob (lectures, docs, certs)    │
│  Cache: Redis (sessions, hot dashboard queries)                 │
│  Search (optional): Elasticsearch (course/content search)       │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 Key Architectural Decisions

| Decision | Rationale |
|---|---|
| **Monolith-first, modular by domain** | Faster to build/test for a project of this scope; module boundaries (Auth, Course, Assessment, etc.) allow future extraction into microservices without a full rewrite. |
| **REST API + JSON** | Simple, well-understood, easy to secure and document (OpenAPI/Swagger). |
| **JWT-based stateless auth** | Scales horizontally without server-side session storage; refresh-token rotation for security. |
| **Relational DB (PostgreSQL)** | Data is highly relational (users, roles, enrollments, assessments) — strong consistency and referential integrity matter more than NoSQL flexibility here. |
| **Object storage for files** | Lecture recordings, presentations, and certificates should not sit in the relational DB — use S3-compatible storage with signed URLs for secure access. |
| **Redis cache** | Speeds up Admin dashboards (aggregation-heavy) and session/token blacklisting. |
| **RBAC at the API gateway + service layer** | Every request is checked against role permissions before reaching business logic — defense in depth. |

### 1.3 Suggested Tech Stack

| Layer | Options |
|---|---|
| Frontend | React.js + Tailwind CSS (responsive SPA) |
| Backend | Node.js (Express/NestJS) **or** Python (Django/FastAPI) |
| Database | PostgreSQL |
| Cache | Redis |
| File Storage | AWS S3 (or Azure Blob/GCS) |
| Auth | JWT + bcrypt/argon2 password hashing, optional OAuth2 for SSO |
| Hosting | Docker containers on AWS/Azure/GCP, behind a load balancer |
| CI/CD | GitHub Actions / GitLab CI |
| Monitoring | Prometheus + Grafana, or cloud-native equivalents |

### 1.4 Security Architecture
- **Transport security:** TLS 1.2+ everywhere.
- **AuthN/AuthZ:** JWT access tokens (short-lived) + refresh tokens (rotated, stored securely); RBAC middleware enforcing Trainee/Trainer/Admin permissions on every route.
- **Password storage:** bcrypt or argon2 with per-user salt.
- **File uploads:** type/size whitelisting, virus scanning, private bucket with signed/expiring URLs (no public file exposure).
- **Input validation:** server-side schema validation (e.g., Joi/Zod/Pydantic) on all endpoints to prevent injection attacks.
- **Audit logging:** immutable log of approvals, role changes, content publishing, and assessment submissions.
- **Rate limiting & lockout:** on login and password-reset endpoints.

### 1.5 Scalability Notes
- Stateless application servers behind a load balancer → horizontal scaling.
- Read-heavy dashboard queries served from Redis cache or read replicas.
- Large file delivery (lecture videos) offloaded to CDN, not application servers.
- Database indexing on high-traffic query paths (enrollments by trainee, assessments by course, notifications by user).
- Queue-based background processing (e.g., BullMQ/Celery) for heavy tasks: certificate generation, email notifications, report exports.

---

## 2. Database Schema (Entity-Relationship Design)

### 2.1 Entity-Relationship Diagram (Text Form)

```
User ──1:1── TraineeProfile
User ──1:1── TrainerProfile
User ──1:N── AuditLog

TraineeProfile ──1:N── Qualification
TraineeProfile ──1:N── WorkExperience
TraineeProfile ──1:N── Interest
TraineeProfile ──1:N── Skill
TraineeProfile ──1:N── Certificate

TrainerProfile ──M:N── Subject   (via CompetencyMap)

Course ──N:1── TrainerProfile (created_by)
Course ──1:N── CourseModule
CourseModule ──1:N── LearningResource
Course ──1:N── Enrollment
Enrollment ──N:1── TraineeProfile

Course ──1:N── Assessment
Assessment ──1:N── Question
Question ──1:N── QuestionOption
Assessment ──1:N── AssessmentAttempt
AssessmentAttempt ──N:1── TraineeProfile
AssessmentAttempt ──1:N── AttemptAnswer

Course ──1:N── Feedback
Feedback ──N:1── TraineeProfile

Course ──1:N── CertificateIssued
CertificateIssued ──N:1── TraineeProfile

Admin ──1:N── ApprovalRequest
ApprovalRequest ──N:1── User

Notification ──N:1── User (published_by, Admin)
Subject ──1:N── Course
Subject ──M:N── TrainerProfile (via CompetencyMap)
```

### 2.2 Table Definitions

#### `users`
| Column | Type | Notes |
|---|---|---|
| id | UUID / BIGINT PK | |
| name | VARCHAR(150) | |
| email | VARCHAR(150) UNIQUE | |
| password_hash | VARCHAR(255) | bcrypt/argon2 hash |
| role | ENUM('trainee','trainer','admin') | |
| status | ENUM('pending','approved','rejected','suspended') | default 'pending' |
| email_verified | BOOLEAN | default false |
| mfa_enabled | BOOLEAN | default false |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |
| last_login_at | TIMESTAMP | |

#### `trainee_profiles`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| user_id | UUID FK → users.id | UNIQUE (1:1) |
| headline | VARCHAR(200) | e.g., "Software Engineer" |
| bio | TEXT | |
| profile_photo_url | VARCHAR(500) | |
| updated_at | TIMESTAMP | |

#### `qualifications`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| trainee_profile_id | UUID FK | |
| degree | VARCHAR(150) | |
| institution | VARCHAR(200) | |
| year_of_completion | INT | |

#### `work_experience`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| trainee_profile_id | UUID FK | |
| organization | VARCHAR(200) | |
| designation | VARCHAR(150) | |
| start_date | DATE | |
| end_date | DATE (nullable) | |
| description | TEXT | |

#### `interests`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| trainee_profile_id | UUID FK | |
| interest_name | VARCHAR(100) | |

#### `skills`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| trainee_profile_id | UUID FK (nullable) | shared table, also used by trainers |
| trainer_profile_id | UUID FK (nullable) | |
| skill_name | VARCHAR(100) | |
| proficiency_level | ENUM('beginner','intermediate','advanced','expert') | |

#### `certificates` (self-declared, uploaded by trainee — distinct from platform-issued certs)
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| trainee_profile_id | UUID FK | |
| title | VARCHAR(200) | |
| issuing_body | VARCHAR(200) | |
| issue_date | DATE | |
| file_url | VARCHAR(500) | object storage link |

#### `trainer_profiles`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| user_id | UUID FK → users.id | UNIQUE (1:1) |
| bio | TEXT | |
| designation | VARCHAR(150) | |
| profile_photo_url | VARCHAR(500) | |
| updated_at | TIMESTAMP | |

#### `subjects`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| name | VARCHAR(150) UNIQUE | e.g., "Data Structures" |
| category | VARCHAR(100) | |

#### `competency_map`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| trainer_profile_id | UUID FK | |
| subject_id | UUID FK | |
| proficiency_score | DECIMAL(4,2) | derived or manually set |
| source | ENUM('self_declared','admin_assigned','system_derived') | |
| updated_at | TIMESTAMP | |

*(Composite unique constraint on `trainer_profile_id + subject_id`.)*

#### `courses`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| title | VARCHAR(200) | |
| description | TEXT | |
| subject_id | UUID FK | |
| created_by | UUID FK → trainer_profiles.id | |
| status | ENUM('draft','published','archived') | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

#### `course_modules`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| course_id | UUID FK | |
| title | VARCHAR(200) | |
| sequence_no | INT | |

#### `learning_resources`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| course_module_id | UUID FK | |
| type | ENUM('lecture_video','presentation','document','link') | |
| title | VARCHAR(200) | |
| file_url | VARCHAR(500) | object storage / CDN link |
| uploaded_by | UUID FK → trainer_profiles.id | |
| uploaded_at | TIMESTAMP | |

#### `enrollments`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| trainee_profile_id | UUID FK | |
| course_id | UUID FK | |
| status | ENUM('enrolled','in_progress','completed','dropped') | |
| progress_percent | INT | default 0 |
| enrolled_at | TIMESTAMP | |
| completed_at | TIMESTAMP (nullable) | |

*(Composite unique constraint on `trainee_profile_id + course_id`.)*

#### `assessments`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| course_id | UUID FK | |
| subject_id | UUID FK | for subject-wise assessments |
| title | VARCHAR(200) | |
| created_by | UUID FK → trainer_profiles.id | |
| deadline | TIMESTAMP | |
| time_limit_minutes | INT | |
| pass_percentage | INT | |
| status | ENUM('draft','published','closed') | |

#### `questions`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| assessment_id | UUID FK | |
| question_text | TEXT | |
| marks | INT | default 1 |

#### `question_options`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| question_id | UUID FK | |
| option_text | VARCHAR(500) | |
| is_correct | BOOLEAN | |

#### `assessment_attempts`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| assessment_id | UUID FK | |
| trainee_profile_id | UUID FK | |
| started_at | TIMESTAMP | |
| submitted_at | TIMESTAMP (nullable) | |
| score | DECIMAL(6,2) | |
| status | ENUM('in_progress','submitted','expired') | |

#### `attempt_answers`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| attempt_id | UUID FK | |
| question_id | UUID FK | |
| selected_option_id | UUID FK | |
| is_correct | BOOLEAN | |

#### `certificates_issued` (platform-generated, on course/assessment completion)
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| trainee_profile_id | UUID FK | |
| course_id | UUID FK | |
| issue_date | DATE | |
| certificate_url | VARCHAR(500) | generated PDF |

#### `feedback`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| trainee_profile_id | UUID FK | |
| course_id | UUID FK | |
| rating | INT | 1–5 |
| comments | TEXT | |
| submitted_at | TIMESTAMP | |

#### `approval_requests`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| user_id | UUID FK → users.id | |
| requested_role | ENUM('trainee','trainer') | |
| reviewed_by | UUID FK → users.id (nullable) | admin |
| status | ENUM('pending','approved','rejected') | |
| requested_at | TIMESTAMP | |
| reviewed_at | TIMESTAMP (nullable) | |

#### `notifications`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| type | ENUM('announcement','achievement','new_content','deadline_reminder') | |
| title | VARCHAR(200) | |
| body | TEXT | |
| published_by | UUID FK → users.id | admin |
| target_role | ENUM('all','trainee','trainer','admin') | |
| published_at | TIMESTAMP | |

#### `notification_reads`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| notification_id | UUID FK | |
| user_id | UUID FK | |
| read_at | TIMESTAMP (nullable) | |

#### `audit_logs`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| user_id | UUID FK | actor |
| action | VARCHAR(150) | e.g., "role_change", "content_published" |
| target_entity | VARCHAR(100) | |
| target_id | UUID | |
| metadata | JSONB | |
| created_at | TIMESTAMP | |

### 2.3 Indexing Recommendations
- `users(email)` — unique index (login lookups).
- `enrollments(trainee_profile_id, course_id)` — composite unique + lookup index.
- `assessment_attempts(assessment_id, trainee_profile_id)` — composite index.
- `competency_map(trainer_profile_id, subject_id)` — composite unique index.
- `notifications(published_at DESC)` — for homepage feed queries.
- `courses(status, subject_id)` — for catalog browsing/filtering.

---

## 3. API Design (High-Level Endpoint Groups)

| Group | Example Endpoints |
|---|---|
| Auth | `POST /auth/signup`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/forgot-password` |
| Profile | `GET/PUT /trainee/profile`, `GET/PUT /trainer/profile` |
| Courses | `GET /courses`, `POST /courses` (trainer), `POST /courses/:id/enroll` (trainee) |
| Learning Resources | `GET /courses/:id/resources`, `POST /courses/:id/resources` (trainer) |
| Assessments | `POST /assessments` (trainer), `POST /assessments/:id/attempt` (trainee), `GET /assessments/:id/results` |
| Feedback | `POST /courses/:id/feedback` |
| Competency Mapping | `GET /subjects/:id/trainers`, `POST /competency-map` (admin) |
| Admin | `GET /admin/approvals`, `POST /admin/approvals/:id/decision`, `GET /admin/dashboard` |
| Notifications | `GET /notifications`, `POST /notifications` (admin) |

All endpoints require a valid JWT except `/auth/signup` and `/auth/login`; role-based middleware restricts access per group (e.g., only `trainer` role can `POST /courses`).

---

## 4. Deployment View (Suggested)

```
Internet
   │
   ▼
[Load Balancer / CDN]
   │
   ▼
[App Servers - Dockerized, auto-scaled]
   │            │
   ▼            ▼
[PostgreSQL]  [Redis Cache]
   │
   ▼
[Object Storage - S3] ← lecture videos, docs, certificates (via signed URLs)
```

- **Environments:** Dev → Staging → Production, with CI/CD pipeline running tests + migrations before deploy.
- **Backups:** Automated daily DB backups + point-in-time recovery.
- **Monitoring:** Application logs, error tracking (e.g., Sentry), uptime monitoring.

---

## 5. Next Steps
- Finalize tech stack choice (Node.js vs Python backend).
- Define detailed API contracts (OpenAPI spec).
- Create low-fidelity wireframes for Trainee/Trainer/Admin dashboards.
- Set up initial DB migrations from this schema.
