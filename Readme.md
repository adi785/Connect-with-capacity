# Capacity Connect

Capacity Connect is a corporate training and learning management platform for organizing courses, assessments, competency development, and performance tracking.

## Features

- Supabase authentication with role-based access for trainees, trainers, and administrators
- Course and subject management
- Trainee and trainer dashboards
- Assessments, feedback, competency mapping, and notifications
- Profile management and employee identifiers
- Supabase Storage integration for lecture resources, certificates, and profile photos
- FastAPI health, readiness, OpenAPI, and ReDoc endpoints
- Rate limiting, CORS configuration, gzip compression, and production safety checks

## Technology

- **Backend:** Python 3.11, FastAPI, SQLAlchemy 2 async, PostgreSQL/asyncpg
- **Frontend:** Static HTML, CSS, and JavaScript dashboards
- **Authentication and storage:** Supabase Auth and Supabase Storage
- **Deployment:** Docker or Vercel
- **Testing:** pytest with an isolated local database by default

## Project structure

```text
app/                 FastAPI application, routers, services, schemas, and database code
api/                 Vercel Python entrypoint
frontend/             Authentication pages, homepage, and role-based dashboards
migrations/          PostgreSQL schema, seed data, policies, and indexes
scripts/              Local serving utilities
tests/                Backend test suite
docs/                 Product requirements and system design
```

## Prerequisites

- Python 3.10+ (Python 3.11 is the target runtime)
- Node.js/npm for the project scripts
- PostgreSQL, or a Supabase project for a hosted database

## Local setup

1. Clone the repository and enter it:

   ```bash
   git clone https://github.com/adi785/Connect-with-capacity.git
   cd Connect-with-capacity
   ```

2. Create and activate a virtual environment:

   ```bash
   python -m venv .venv
   source .venv/bin/activate
   ```

3. Install backend dependencies:

   ```bash
   pip install -r requirements.txt
   ```

4. Copy `.env.example` to `.env` and configure the database, CORS origins, and Supabase settings. For local development, `AUTH_MODE=dev` may be used; use Supabase JWT verification in shared or production environments.

5. Apply the SQL files in `migrations/` to your PostgreSQL/Supabase database in order.

## Running locally

Start the API and frontend in separate terminals:

```bash
npm run backend
npm run frontend
```

The frontend is available at <http://localhost:3000>. The API is available at <http://127.0.0.1:8000>, with interactive documentation at <http://127.0.0.1:8000/docs> and ReDoc at <http://127.0.0.1:8000/redoc>.

A combined local server is also available:

```bash
npm run serve
```

Useful endpoints include `/health` for liveness and `/health/ready` for database readiness.

## Testing

Run the backend test suite with:

```bash
npm test
```

By default, tests use an isolated local async SQLite database. Set `TEST_DATABASE_URL` only when an explicitly configured test database is required.

## Docker

Build and run the backend container:

```bash
docker build -t capacity-connect-api .
docker run --env-file .env -p 8000:8000 capacity-connect-api
```

The container exposes port `8000` and uses `/health` as its liveness check.

## Vercel deployment

`vercel.json` configures the FastAPI entrypoint under `api/` and serves the static frontend from `frontend/`. Configure the environment variables from `.env.example` in the Vercel project settings before deploying.

## Documentation

- [Product requirements](docs/PRD.md)
- [System design](docs/system-design.md)
- [Environment variable reference](.env.example)

## Licensing

This repository uses separate licenses by component:

- **Backend and repository infrastructure:** [Apache License 2.0](LICENSE)
- **Frontend:** [MIT License](frontend/LICENSE)

These licenses apply only to the component identified above. Third-party dependencies remain subject to their own licenses.