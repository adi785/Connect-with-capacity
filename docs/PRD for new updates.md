# PRD — CAPACITY CONNECT: Trainer & Admin Functionality Completion

## 1. Objective

Complete the CAPACITY CONNECT platform so that **Trainer** and **Admin** roles have all functionality required by the official SIH Problem Statement.

The current application has authentication and trainee-side functionality, but Trainers cannot properly create/manage courses or learning materials, and Admins cannot publish news/announcements.

Antigravity must inspect the **existing codebase, database schema, API routes, authentication/RBAC, and UI** before making changes.

### Critical Rule

**DO NOT rebuild the application from scratch.**

Extend and fix the existing implementation while preserving:
- Existing Supabase authentication
- Existing role system
- Existing trainee functionality
- Existing API architecture
- Existing database structure where possible
- Existing UI design system
- Existing working routes/components

Only introduce new tables, APIs, components, or migrations when genuinely required.

---

# 2. Official Product Scope

CAPACITY CONNECT is a centralized digital capacity-building and learning-management portal supporting:

- Trainees
- Trainers
- Administrators

The system must enable:
- Secure authentication
- Professional trainee profiles
- Trainer profiles and competency information
- Course creation and management
- Learning-material management
- Competency mapping
- Training participation
- News and announcements
- Administrative management
- Centralized knowledge sharing

---

# 3. Role-Based Access Control

Implement and verify strict RBAC.

## Trainee

Trainees can:

- Register/login
- Manage their professional profile
- Add qualifications
- Add work experience
- View available courses
- Enroll in courses
- Access published learning materials
- View announcements/news
- Track learning/progress where supported
- View competency-related information

Trainees MUST NOT:
- Create courses
- Edit trainer courses
- Upload trainer learning materials
- Publish announcements
- Access admin controls

---

# 4. Trainer Functional Requirements

Trainer functionality is currently incomplete and must be fully implemented.

## 4.1 Trainer Profile

Trainer must have a dedicated profile containing:

### Personal Information
- Name
- Email
- Phone/contact information
- Profile photo
- Organization/institution
- Designation

### Professional Information
- Total experience
- Years of training experience
- Educational qualifications
- Certifications
- Areas of expertise
- Technical/professional skills
- Subject expertise
- Previous organizations
- Training experience
- Achievements

### Competency Information

Trainer must be able to specify:

- Competencies
- Skill categories
- Skill level
- Areas of specialization
- Training subjects
- Relevant certifications
- Relevant professional experience

Provide an appropriate form for entering this information.

Trainer profile data must be stored persistently in Supabase/backend.

---

# 5. Trainer Dashboard

Create/fix a dedicated Trainer Dashboard.

Dashboard should provide clear access to:

- My Profile
- Competency Profile
- My Courses
- Create Course
- Learning Materials
- Course Participants
- Course Management
- Announcements relevant to trainers
- Dashboard statistics

Example statistics:

- Total Courses
- Published Courses
- Draft Courses
- Total Enrollments
- Total Learning Materials

Use the existing design language of the application.

---

# 6. Course Creation

This is a CRITICAL requirement.

A Trainer MUST be able to create a course from the UI.

Create a complete **Create Course** form.

Required fields:

- Course title
- Short description
- Full description
- Course category
- Subject/domain
- Difficulty level
- Duration
- Learning objectives
- Target audience
- Prerequisites
- Competencies covered
- Course thumbnail/image if supported
- Trainer/instructor
- Status

Statuses:

- Draft
- Published
- Archived

Trainer should initially be able to save a course as Draft.

---

# 7. Course Management

Trainer must be able to:

- Create course
- Save draft
- Edit course
- View course
- Publish course
- Unpublish course if permitted
- Archive course
- Delete own draft/course where appropriate
- View enrolled trainees
- View course statistics

Trainer should only be allowed to modify courses they own unless the Admin role has override permission.

---

# 8. Learning Material Management

Trainers must be able to upload/manage learning materials associated with their courses.

Supported material types should include where technically feasible:

- PDF
- DOC/DOCX
- PPT/PPTX
- Video
- External URL
- Text/resource
- Other educational files

Each learning material should contain:

- Title
- Description
- Type
- Course
- File/URL
- Upload date
- Trainer/owner
- Visibility/status

Trainer actions:

- Upload material
- Add material
- Edit material metadata
- Delete material
- View material
- Associate material with a course
- Publish/hide material where supported

Use Supabase Storage for files if the existing architecture supports it.

Do NOT expose private files publicly unless intended by the existing security model.

---

# 9. Course Structure

Where supported by the existing backend, allow Trainers to organize courses into:

Course
→ Modules
→ Lessons/Materials

Trainer should be able to:

- Create modules
- Rename modules
- Delete modules
- Reorder modules if practical
- Add learning materials to modules
- Edit learning materials

If the existing API already contains Module-related schemas/endpoints, USE THEM instead of creating duplicate functionality.

---

# 10. Competency Mapping

CAPACITY CONNECT must support competency-oriented training.

Trainer should be able to associate courses with:

- Skills
- Competencies
- Domains
- Learning objectives

Example:

Course:
"Advanced Python Programming"

Competencies:
- Python Programming
- Object-Oriented Programming
- Problem Solving
- Software Development

Skill levels can be:

- Beginner
- Intermediate
- Advanced
- Expert

The UI should make competency mapping simple and understandable.

---

# 11. Trainer Course Publishing Workflow

Implement this workflow:

Trainer Login
↓
Trainer Dashboard
↓
Create Course
↓
Enter Course Information
↓
Save Draft
↓
Add Modules
↓
Upload/Add Learning Materials
↓
Map Competencies
↓
Review Course
↓
Publish
↓
Course becomes visible to Trainees

A trainee must NOT see unpublished/draft courses.

---

# 12. Admin Functional Requirements

Admin functionality must be completed.

Admin must have a dedicated Admin Dashboard.

Admin dashboard should provide:

- User Management
- Trainer Management
- Trainee Management
- Course Management
- News Management
- Announcement Management
- Competency/Category Management
- Platform statistics
- Content moderation/management

---

# 13. Admin User Management

Admin must be able to:

- View users
- Search users
- Filter by role
- View user profiles
- Manage user status where supported
- View trainers
- View trainees

Admin should NOT be able to expose passwords or authentication secrets.

Use Supabase Auth appropriately.

---

# 14. Admin Course Management

Admin must be able to:

- View all courses
- View course details
- View trainer/owner
- View course status
- Approve/publish courses where approval workflow exists
- Unpublish courses
- Archive courses
- Remove inappropriate content
- View learning materials

Admin should have broader permissions than Trainers.

Trainer:
→ manages own courses

Admin:
→ manages all courses

---

# 15. News & Announcements — CRITICAL

Admins currently cannot publish news/announcements.

Implement a complete News & Announcement Management system.

Admin must be able to:

- Create news
- Create announcement
- Edit news
- Edit announcement
- Save draft
- Publish
- Unpublish
- Delete
- Archive
- View published content
- Preview before publishing

---

# 16. News/Announcement Fields

Create an appropriate form containing:

- Title
- Content/body
- Short summary
- Category
- Featured image if supported
- Target audience
- Publication status
- Publish date
- Expiry date (optional)
- Created by
- Created timestamp
- Updated timestamp

Target audience can include:

- All Users
- Trainees
- Trainers
- Admins

---

# 17. News Publishing Workflow

Admin:

Login
↓
Admin Dashboard
↓
News & Announcements
↓
Create
↓
Enter Content
↓
Save Draft
↓
Preview
↓
Publish
↓
Visible on platform

Published announcements should appear in appropriate places such as:

- Trainee dashboard
- Trainer dashboard
- News/Announcements page
- Notification/announcement section if already implemented

Respect target audience.

---

# 18. Database Requirements

Inspect the current Supabase database before creating anything.

Reuse existing tables.

If required, implement tables similar to:

### profiles
- id
- role
- name
- contact information
- created_at
- updated_at

### trainer_profiles
- id
- user_id
- organization
- designation
- experience
- qualifications
- certifications
- skills
- expertise
- training_experience
- competencies
- created_at
- updated_at

### courses
- id
- trainer_id
- title
- short_description
- description
- category
- difficulty
- duration
- objectives
- prerequisites
- status
- created_at
- updated_at

### modules
- id
- course_id
- title
- description
- order_index
- created_at

### learning_materials
- id
- course_id
- module_id
- title
- description
- material_type
- file_url
- external_url
- status
- created_at
- updated_at

### competencies
- id
- name
- description
- category
- created_at

### course_competencies
- course_id
- competency_id
- level

### announcements
- id
- title
- summary
- content
- category
- target_audience
- status
- publish_at
- expires_at
- created_by
- created_at
- updated_at

**IMPORTANT:**
Do not blindly create these tables if equivalent tables already exist.

Inspect the current schema first.

---

# 19. API Requirements

Inspect `/openapi.json` and existing API routes before implementing new endpoints.

Reuse existing APIs wherever possible.

Required functionality should have working API support for:

### Trainer
- GET trainer profile
- PUT trainer profile
- POST course
- GET own courses
- GET course
- PUT course
- DELETE course
- POST module
- PUT module
- DELETE module
- POST learning material
- GET learning materials
- PUT learning material
- DELETE learning material
- Publish course

### Admin
- GET users
- GET courses
- Manage courses
- POST announcement
- GET announcements
- PUT announcement
- DELETE announcement
- Publish announcement

Use the existing API conventions and response schemas.

---

# 20. Authentication & Authorization

Security is mandatory.

Every protected API endpoint must verify:

1. User is authenticated.
2. User has the required role.
3. Trainer owns the resource when ownership applies.

Examples:

Trainer A MUST NOT be able to edit Trainer B's course.

Trainee MUST NOT be able to call trainer/admin APIs successfully.

Trainer MUST NOT be able to publish admin announcements.

Admin can manage platform-level content.

Never trust role information supplied directly by the frontend.

Use backend/database role verification.

---

# 21. Supabase RLS

Review existing Row Level Security policies.

Ensure policies support:

### Trainers
- Read/update own trainer profile
- Create own courses
- Update own courses
- Delete own courses where allowed
- Manage own learning materials

### Trainees
- Read published courses
- Read published learning materials
- Read announcements targeted to them

### Admins
- Full management permissions for platform content

Avoid disabling RLS as a shortcut.

---

# 22. Frontend Requirements

Inspect the current frontend architecture before implementing.

Do NOT create duplicate dashboards.

Add missing functionality to the current application.

Trainer UI should clearly expose:

**Trainer Dashboard**
- Profile
- Competencies
- Courses
- Create Course
- Materials
- Participants

Admin UI should clearly expose:

**Admin Dashboard**
- Users
- Courses
- News
- Announcements
- Competencies
- Platform Management

Use existing:
- CSS
- Components
- Navigation
- Modal system
- Forms
- Notifications
- Loading states
- Error handling

Maintain visual consistency.

---

# 23. UX Requirements

Every form must have:

- Validation
- Loading state
- Success feedback
- Error feedback
- Cancel option
- Save/Submit button
- Clear required fields

After successful creation:

Example:

"Course created successfully."

After publishing:

"Course published successfully."

After announcement publishing:

"Announcement published successfully."

Do not silently fail.

---

# 24. Empty States

Provide useful empty states.

Example:

"My Courses"

"No courses yet. Create your first course."

"My Learning Materials"

"No learning materials have been added yet."

"Announcements"

"No announcements available."

---

# 25. Error Handling

Fix the current problem where UI appears to provide functionality but actions do not actually work.

For every CRUD operation verify:

Frontend
↓
API request
↓
Authentication
↓
Authorization
↓
Database
↓
API response
↓
Frontend state update
↓
UI confirmation

Log meaningful errors during development.

Do NOT hide backend errors.

---

# 26. End-to-End Acceptance Tests

Antigravity MUST test these scenarios after implementation.

## Trainer Test

1. Login as Trainer.
2. Open Trainer Dashboard.
3. Complete trainer profile.
4. Add experience.
5. Add skills.
6. Add competencies.
7. Create course.
8. Save draft.
9. Edit course.
10. Create module.
11. Upload/add learning material.
12. Associate material with module.
13. Map competencies.
14. Publish course.
15. Verify course appears for Trainee.
16. Verify another Trainer cannot edit it.

## Admin Test

1. Login as Admin.
2. Open Admin Dashboard.
3. Open News/Announcements.
4. Create announcement.
5. Save draft.
6. Edit announcement.
7. Preview.
8. Publish.
9. Verify it appears to intended users.
10. Edit published announcement.
11. Unpublish it.
12. Verify it disappears from public/user-facing announcement views.

## Security Test

Verify:

- Trainee cannot access Trainer APIs.
- Trainee cannot create courses.
- Trainee cannot publish announcements.
- Trainer cannot access Admin APIs.
- Trainer cannot create announcements.
- Trainer cannot modify another trainer's course.
- Admin can manage all courses and announcements.
- Unauthenticated users cannot access protected endpoints.

---

# 27. Existing API Compatibility

Before changing backend code:

1. Inspect `/openapi.json`.
2. Inspect existing `/api/v1` routes.
3. Inspect current schemas.
4. Inspect existing Supabase tables.
5. Inspect current RLS policies.
6. Inspect frontend API service functions.
7. Identify what already exists but is not connected to the UI.

The previous implementation already contains API functionality such as Course/Module schemas.

**Reuse existing implementation instead of duplicating it.**

---

# 28. Debugging Strategy

If a button currently does nothing:

Trace it completely.

Example:

Create Course button
→ frontend event
→ form submission
→ API function
→ HTTP request
→ auth token
→ backend endpoint
→ role verification
→ database operation
→ response
→ frontend state refresh

Identify the exact failure instead of replacing the entire feature.

---

# 29. Definition of Done

The implementation is NOT complete until:

### Trainer

- [ ] Trainer profile works
- [ ] Experience can be entered
- [ ] Skills can be entered
- [ ] Competencies can be entered
- [ ] Trainer dashboard works
- [ ] Course creation works
- [ ] Course editing works
- [ ] Course deletion/archive works
- [ ] Course publishing works
- [ ] Module creation works
- [ ] Learning-material upload/addition works
- [ ] Learning-material management works
- [ ] Competency mapping works
- [ ] Trainer can see enrolled trainees/statistics where supported

### Admin

- [ ] Admin dashboard works
- [ ] User management works
- [ ] Course management works
- [ ] News creation works
- [ ] Announcement creation works
- [ ] Draft functionality works
- [ ] Editing works
- [ ] Publishing works
- [ ] Unpublishing works
- [ ] Deletion/archive works
- [ ] Target audience works

### Security

- [ ] RBAC enforced backend-side
- [ ] RLS verified
- [ ] Resource ownership enforced
- [ ] No unauthorized CRUD operations
- [ ] No authentication secrets exposed

### Integration

- [ ] Existing trainee functionality still works
- [ ] Existing authentication still works
- [ ] Existing Supabase integration still works
- [ ] Existing APIs are not unnecessarily duplicated
- [ ] No broken routes
- [ ] No console errors
- [ ] No API 401/403/404/500 errors for valid operations

---

# 30. Final Instruction to Antigravity

**Do not stop after generating UI.**

This task is considered successful ONLY when the functionality works end-to-end against the real backend/database.

Do not create fake/mock/local-only course creation or announcement functionality.

Do not use hardcoded success messages without completing the database operation.

Do not bypass authentication or RLS.

Do not replace working trainee functionality.

First inspect the existing architecture and identify missing/broken connections. Then implement the minimum required backend/database/frontend changes.

After implementation, run/build/test the application and verify the complete Trainer and Admin workflows described above.

Finally provide a concise implementation report containing:

1. Files changed
2. Database changes
3. API endpoints added/modified
4. Frontend features added/fixed
5. RLS/security changes
6. Tests performed
7. Any remaining issues

**Priority order:**

1. Trainer course creation
2. Trainer course management
3. Trainer learning-material management
4. Trainer profile + competency mapping
5. Admin news/announcement creation
6. Admin publishing workflow
7. Admin course/user management
8. Security/RLS verification
9. UI/UX polish
10. Final end-to-end testing