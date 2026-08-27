# CAPACITY CONNECT — backend container image.
#
# Python 3.11 is the target runtime. The code is written for 3.10+ syntax
# (PEP 604 `X | None` inside SQLAlchemy `Mapped[...]` annotations, which SQLAlchemy
# evaluates at class-creation time), so do not drop below 3.10.

FROM python:3.11-slim AS base

# - PYTHONDONTWRITEBYTECODE: no .pyc clutter in the image layer
# - PYTHONUNBUFFERED: logs reach the orchestrator immediately instead of sitting
#   in a block buffer, which matters for readiness debugging
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# asyncpg and uvicorn[standard] ship manylinux wheels, so no compiler is needed.
# curl is only here for the HEALTHCHECK below.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

# Dependencies first, so an application-only edit reuses this cached layer.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# The `app` package must sit directly under the working directory: the process CWD is
# /srv, so `app.main:app` resolves and pydantic-settings finds /srv/.env if mounted.
COPY app/ ./app/

# Carried into the image so the schema can be applied from inside the container:
#   docker compose exec api psql "$DATABASE_URL" -f migrations/20260824_initial_schema.sql
COPY migrations/ ./migrations/

# Drop privileges. Done after COPY so the files stay root-owned and read-only to the
# service account — the app never needs to write to its own source tree.
RUN useradd --create-home --shell /usr/sbin/nologin appuser
USER appuser

EXPOSE 8000

# /health is liveness only (no I/O). /health/ready is the one that touches Postgres and
# returns 503 when it is unreachable — point your orchestrator's readiness probe there,
# and keep this container-level check on the cheap endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/health || exit 1

# No --reload: that is development-only and app/main.py already gates it on ENV.
# Raise --workers via the orchestrator (or set it here) once you have the CPU for it;
# each worker holds its own SQLAlchemy pool of DB_POOL_SIZE connections, so multiply
# workers × DB_POOL_SIZE and check it against your Postgres connection limit.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
