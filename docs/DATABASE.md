# Database approach (Part 5 proposal)

This document proposes the SQLite schema and lifecycle for the MVP and is intended for sign-off before Part 6 endpoint persistence wiring.

## Goals

- Support multiple users in schema design, even though MVP login is fixed to one dummy account.
- Enforce exactly one board per user.
- Keep columns fixed-count for MVP while allowing rename-only behavior.
- Persist cards in ordered columns.
- Persist chat history with hard cap of 20 messages per user.
- Keep payload exchange with frontend and AI simple and deterministic.

## SQLite file location

- Default path: `backend/data/pm.db`
- Override via environment variable: `PM_DB_PATH`

## Schema

### users

- `id INTEGER PRIMARY KEY`
- `username TEXT UNIQUE NOT NULL`
- `password_hint TEXT NOT NULL` (MVP-only marker for fixed credentials behavior)
- `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`

### boards

- `id INTEGER PRIMARY KEY`
- `user_id INTEGER UNIQUE NOT NULL` (enforces one board per user)
- `title TEXT NOT NULL DEFAULT 'Kanban Board'`
- `created_at`, `updated_at`
- FK `user_id -> users(id)` with `ON DELETE CASCADE`

### columns_meta

- `id INTEGER PRIMARY KEY`
- `board_id INTEGER NOT NULL`
- `column_key TEXT NOT NULL` (stable key, for example `col-backlog`)
- `title TEXT NOT NULL` (renameable)
- `position INTEGER NOT NULL` (1..5 order)
- `created_at`, `updated_at`
- FK `board_id -> boards(id)` with `ON DELETE CASCADE`
- `UNIQUE(board_id, column_key)`
- `UNIQUE(board_id, position)`

### cards

- `id INTEGER PRIMARY KEY`
- `board_id INTEGER NOT NULL`
- `column_id INTEGER NOT NULL`
- `title TEXT NOT NULL`
- `details TEXT NOT NULL`
- `position INTEGER NOT NULL` (ordering within column)
- `created_at`, `updated_at`
- FK `board_id -> boards(id)` with `ON DELETE CASCADE`
- FK `column_id -> columns_meta(id)` with `ON DELETE CASCADE`
- Unique index `cards(column_id, position)`

### chat_messages

- `id INTEGER PRIMARY KEY`
- `user_id INTEGER NOT NULL`
- `role TEXT NOT NULL CHECK(role IN ('user','assistant','system'))`
- `content TEXT NOT NULL`
- `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- FK `user_id -> users(id)` with `ON DELETE CASCADE`
- Index on `(user_id, created_at, id)`
- Trigger trims to latest 20 rows per user after each insert

## Bootstrap and initialization

`app.db.initialize_database()` performs:

1. Resolve DB path and create parent folder.
2. Apply schema DDL with `CREATE TABLE IF NOT EXISTS`.
3. Seed default MVP user (`user`) and board if missing.
4. Seed fixed 5 columns for default board if missing.

Behavior is idempotent and safe to run on each application startup.

## JSON shape for board payload exchange

This is the canonical JSON representation for frontend and AI prompts/responses:

```json
{
  "boardId": 1,
  "userId": 1,
  "title": "Kanban Board",
  "columns": [
    {
      "key": "col-backlog",
      "title": "Backlog",
      "position": 1,
      "cards": [
        {
          "id": 101,
          "title": "Align roadmap themes",
          "details": "Draft quarterly themes with impact statements and metrics.",
          "position": 1
        }
      ]
    }
  ]
}
```

Notes:

- `key` is stable and non-user-editable.
- `title` is user-editable for columns.
- Column count is fixed at 5 in MVP.
- Card order is represented with `position` and serialized in order.

## Migration posture

For MVP:

- Keep schema in code (`app/db.py`) with idempotent bootstrap.
- Do not introduce migration framework yet.
- Any schema change in later phases must include:
  - explicit migration/transition step
  - backward-compatible read path or one-time data update
  - tests validating old-to-new behavior
