FROM node:22-alpine AS frontend-build

WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN pip install --no-cache-dir uv

COPY backend/pyproject.toml ./backend/pyproject.toml
COPY backend/uv.lock ./backend/uv.lock
RUN uv sync --project backend --frozen --no-dev

COPY backend/ ./backend/
COPY --from=frontend-build /frontend/out/ ./backend/static/site/
WORKDIR /app/backend

EXPOSE 8000

CMD [".venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
