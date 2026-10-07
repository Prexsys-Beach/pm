# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Project requirements, coding standards, and color scheme live in `AGENTS.md` (root), with per-area notes in `backend/AGENTS.md`, `frontend/AGENTS.md`, and `scripts/AGENTS.md`. The phased execution checklist is `docs/PLAN.md` (review before starting work); the schema and board JSON contract are in `docs/DATABASE.md`. Key standards: keep it simple, no over-engineering or extra features, no emojis ever, minimal README, and prove root cause with evidence before fixing.

## Commands

Run the app (Docker, serves everything at http://localhost:8000, login `user` / `password`):

```
scripts\start.cmd     # Windows (also start.ps1)
./scripts/start.sh    # macOS/Linux
scripts\stop.cmd / ./scripts/stop.sh
```

Backend (from `backend/`, managed with `uv`):

```
uv sync --group dev
uv run pytest                                   # coverage enforced: --cov-fail-under=80
uv run pytest tests/test_board_api.py::test_name
uv run uvicorn app.main:app --reload            # local dev on :8000
```

Frontend (from `frontend/`):

```
npm run lint
npm run test:unit                               # Vitest (src/**/*.test.ts[x])
npx vitest run src/lib/kanban.test.ts -t "name"
npm run test:e2e                                # Playwright against `next dev` on :3000
npm run test:e2e:docker                         # Playwright against the running container on :8000
npm run build                                   # static export to frontend/out/
```

The Playwright e2e specs call `/api/*`, so `test:e2e:docker` (with the container running) is the meaningful full-stack run.

## Architecture

- **Single container, single process.** The Dockerfile builds the Next.js app as a static export (`output: "export"` in `next.config.ts`), copies `frontend/out/` to `backend/static/site/`, and FastAPI mounts it at `/` via `StaticFiles`. All API routes are under `/api`. If the static dir is missing, `/` returns a placeholder HTML page. No Next.js server runs in production, so no SSR, server actions, or API routes on the frontend.
- **Backend (`backend/app/`)**: `main.py` has a `create_app(static_site_dir, db_path, enable_db_init)` factory that defines all routes inline; tests build isolated apps with a temp `db_path` and `TestClient`. `db.py` holds the schema DDL, idempotent bootstrap (seeds user `user`, one board, 5 fixed columns), and all persistence functions (`*_for_user`) using raw `sqlite3`. `ai.py` calls OpenRouter with `httpx` (model `openai/gpt-oss-120b`); tests mock it with `httpx.MockTransport`.
- **Auth**: Starlette `SessionMiddleware` with an HTTP-only `pm_session` cookie; credentials are hardcoded in `main.py`. Routes call `_require_authenticated_username(request)` and then scope all DB access by username.
- **Board model**: columns are fixed-count (5) and rename-only, identified by a stable `column_key` (e.g. `col-backlog`); cards have integer IDs and a `position` within their column. Moves/reorders shift positions inside a transaction (see `POSITION_SHIFT_MARKER` in `db.py`, which works around the unique `(column_id, position)` index). The canonical board JSON is documented in `docs/DATABASE.md` and is what the frontend renders and the AI receives.
- **AI flow (confirm-before-apply)**: `POST /api/ai/chat` sends the board JSON, last 20 chat messages, and the prompt to OpenRouter, then validates the structured reply `{assistantMessage, proposedUpdates[]}` against the current board (actions: `rename_column`, `create_card`, `update_card`, `delete_card`, `move_card`). The backend never applies AI updates itself. The frontend (`AiChatSidebar.tsx` / `KanbanBoard.tsx`) queues proposals and, on user confirmation, calls the regular board endpoints (`/api/columns/*`, `/api/cards*`) for that one update. Chat history is capped at 20 per user by a SQLite trigger.
- **Frontend state**: the backend is authoritative. `AuthGate.tsx` checks the session and loads `/api/board`; `KanbanBoard.tsx` orchestrates dnd-kit drag-and-drop and replaces local state with the board returned by each mutation.

## Gotchas

- SQLite DB defaults to `backend/data/pm.db` (override with `PM_DB_PATH`); `docker-compose.yml` mounts `./backend/data` so data survives restarts.
- AI routes read `OPENROUTER_API_KEY` from the process environment. `docker-compose.yml` loads it from the root `.env` (required to exist); when running uvicorn outside Docker, export it yourself or `/api/ai/*` returns 503.
- Drag-and-drop e2e tests use explicit mouse-coordinate moves rather than `locator.dragTo(...)`, which is unreliable with dnd-kit.
