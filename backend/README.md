# Backend scaffold

This backend is a FastAPI scaffold for the PM MVP.

When `backend/static/site` is present (as in Docker builds), FastAPI serves the static frontend from `/`.
Without that directory, `/` serves a placeholder HTML page for backend-only local smoke runs.

Auth endpoints:

- `GET /api/auth/session`
- `POST /api/auth/login`
- `POST /api/auth/logout`

Board endpoints (authenticated):

- `GET /api/board`
- `PATCH /api/columns/{column_key}` with body `{ "title": "..." }`
- `POST /api/cards` with body `{ "columnKey": "...", "title": "...", "details": "..." }`
- `PATCH /api/cards/{card_id}` with body `{ "title": "...", "details": "..." }` (partial allowed)
- `DELETE /api/cards/{card_id}`
- `POST /api/cards/{card_id}/move` with body `{ "targetColumnKey": "...", "targetPosition": 1 }`

AI smoke endpoint (authenticated):

- `POST /api/ai/smoke`
  - Sends a fixed `"2+2"` prompt to OpenRouter using model `openai/gpt-oss-120b`
  - Requires `OPENROUTER_API_KEY` to be set in the backend process environment

AI structured chat endpoint (authenticated):

- `POST /api/ai/chat` with body `{ "prompt": "..." }`
  - Sends current board JSON, user prompt, and recent persisted chat history to OpenRouter
  - Validates structured JSON response with:
    - `assistantMessage` (required string)
    - `proposedUpdates` (optional array of validated board update instructions)
  - Persists user and assistant chat messages with max-20 retention

Database bootstrap:

- Initialized automatically at application startup.
- Default SQLite path: `backend/data/pm.db`
- Optional override: `PM_DB_PATH`

## Run locally with uv

```bash
uv sync --group dev
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Run tests with coverage

```bash
uv run pytest
```
