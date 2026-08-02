# Serves the backend component scaffolded by the python-fastapi stack pack (composed at backend/).
# Build from the repository root so this file, the component, and .dockerignore share one context:
#   docker build -f docker/backend.Dockerfile -t backend:$(git rev-parse HEAD) .
# Two stages: a builder that resolves the locked dependency graph into a virtual environment, and a
# runtime that copies that environment plus the application and drops to an unprivileged user.

# --- builder -----------------------------------------------------------------------------------
FROM python:3.11-slim-bookworm AS builder

# UV_PROJECT_ENVIRONMENT puts the virtual environment at a fixed path the runtime stage can copy
# wholesale. UV_COMPILE_BYTECODE pays the .pyc cost once here instead of on every container start.
# UV_LINK_MODE=copy silences the hardlink warning that appears when the cache and the target sit on
# different filesystems, which is the normal case inside a build stage.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# Pinned so the resolver itself is part of the reviewed change. Bump this line deliberately.
ARG UV_VERSION=0.5.14
RUN pip install --no-cache-dir "uv==${UV_VERSION}"

WORKDIR /src

# Manifests first: this layer changes only when a dependency changes, so an application edit reuses
# the cached install. uv sync --frozen fails rather than re-resolving when uv.lock disagrees with
# pyproject.toml, which is the same guarantee the component's own EEP-DLV-02 check enforces.
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/app ./app

# --- runtime -----------------------------------------------------------------------------------
FROM python:3.11-slim-bookworm AS runtime

# curl is the healthcheck client and the only package added to the runtime image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app

ENV PATH="/opt/venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app
COPY --from=builder --chown=10001:10001 /opt/venv /opt/venv
COPY --from=builder --chown=10001:10001 /src/app ./app

USER 10001:10001
EXPOSE 8000

# app/api/routes/health.py serves GET /health and is the readiness contract for this image.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
