# Backend notes

This folder contains the FastAPI backend scaffold for Part 2.

Current scope:

- App entrypoint: `app/main.py`
- Static frontend serving at `/` from `backend/static/site` when present
- Placeholder root page fallback at `/` when static assets are not present
- Health check route at `/health`
- Placeholder API smoke route at `/api/ping`
- Auth routes:
  - `GET /api/auth/session`
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
- Board routes:
  - `GET /api/board`
  - `PATCH /api/columns/{column_key}`
  - `POST /api/cards`
  - `PATCH /api/cards/{card_id}`
  - `DELETE /api/cards/{card_id}`
  - `POST /api/cards/{card_id}/move`
- AI route:
  - `POST /api/ai/smoke` (authenticated OpenRouter connectivity check)
  - `POST /api/ai/chat` (structured assistant message + proposed board updates contract)
- Database bootstrap:
  - `app/db.py` defines schema + idempotent initialization
  - board persistence helpers are in `app/db.py`
  - startup initialization creates SQLite DB if missing
  - default DB path is `backend/data/pm.db` (override `PM_DB_PATH`)
- Unit/integration tests in `tests/`
- Dependency and test config in `pyproject.toml` (managed by `uv`)