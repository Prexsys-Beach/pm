# Code review

Date: 2026-10-06. Scope: the entire repo at commit `a4309d7` (backend, frontend, Docker, scripts, tests, docs). This is the second review. It replaces the first, which covered `2c28307`.

Each finding says how it was confirmed:

- **Verified**: shown by running the code or tests.
- **From code**: the code path is clear from reading it, but was not run.
- **Likely**: inferred from reading the code; it needs a reproduction before fixing.

Per AGENTS.md, prove the root cause with evidence before changing any code.

## Summary

All of the first review's High and Medium findings are fixed, each with a test or check that reproduced the failure first. Since this review was written, N1, M6 and N6 have also been fixed (see the status table). The current state:

- 51 backend tests (87% coverage), 23 frontend unit tests and 8 isolated Docker E2E tests all pass.
- Lint and `npm run typecheck` are clean.
- The real `backend/data/pm.db` is untouched by every test suite.

The main things left:

- **N6 (Medium, now fixed):** app startup put the demo cards back on a board the user had emptied. This was found while investigating startup database writes.
- **A small set of Low items and documentation updates.**

There are no High findings.

## Status of the first review's findings

| ID | Finding | Status |
|---|---|---|
| H1 | Hard-coded session secret | Fixed. `SESSION_SECRET` is read from the environment, with a per-process random fallback. Tests are in `test_session_secret.py`. |
| H2 | AI confirmations showed IDs | Fixed. Titles are shown instead. |
| M1 | Failed saves looked successful | Fixed for the card editor and the new card form. A failed column rename keeps the typed draft. |
| M2 | Chat history not restored | Fixed by `GET /api/ai/chat`, which is loaded with the board. |
| M3 | Drag moved a card into the adjacent column | Fixed. There were two causes: the pointer was computed from the overlay's rect, and the sideways-drift fallback overrode it. A Playwright test covers it. |
| M4 | Blank prompt returned 502 | Fixed. It now returns 422 before any OpenRouter call. |
| M5 | Raw JSON parse errors shown to users | Fixed by the `readErrorMessage` helper. |
| M6 | `tsc --noEmit` fails on test files | Fixed after this review. The reference is now `vitest/globals`, and a new `npm run typecheck` exits 0 (it reported 115 errors before the fix). |
| L1 to L12, D1 to D6 | Low items and docs | **Open** unless noted below. |

## Status of this review's findings

| ID | Finding | Status |
|---|---|---|
| N1 | Chat-history failure logs the user out | Fixed after this review. `AuthGate` shows the board with "Chat history could not be loaded." For both a 500 response and a network failure, a test reproduced the sign-out before the fix. A board-load failure still signs the user out, which is unchanged and still to be decided. |
| N2 to N5 | Low items | Open. |
| N6 | Startup restored demo cards on an emptied board | Fixed. Demo cards are seeded only when setup creates the board. A backend test reproduced the 8 restored cards before the fix. |
| N7 | Every startup rewrites the database file | Open. Found by the investigation below. |

## New findings

### Medium

**N1 (fixed). A chat-history failure logs the user out and hides the board.** `frontend/src/components/AuthGate.tsx:24-56` (from code)
`loadBoard` now fetches `/api/ai/chat` after `/api/board`, inside the same `try`. If only the chat request fails (for example, a transient 500 or a proxy error), the `catch` clears the board and sets `isAuthenticated` to `false`. The user ends up on the sign-in form even though their session is valid. The same `catch` already did this for board-load failures before the M2 change, so the underlying pattern predates it.
Action: add a unit test where `/api/ai/chat` returns 500 and assert that the board still renders with an error message. Then let a chat-history failure fall back to an empty history plus a visible error, without signing the user out. Separately, decide whether a board-load failure should sign the user out at all, since the session itself is still valid.

### Low

**N2. Drop position can be wrong if the page scrolls during a drag.** `frontend/src/components/KanbanBoard.tsx:92-97` (likely)
`getPointerPosition` adds `event.delta` to the activator's viewport coordinates. On drag end, dnd-kit passes `scrollAdjustedTranslate` as the delta (`@dnd-kit/core` `core.esm.js:3139`). That value includes scroll since the drag started, so if the window auto-scrolls mid-drag, the computed pointer is off by that amount. Columns sit side by side, so column choice is mostly unaffected, but the position within the column (`targetPosition`) can be wrong. The rect-based code before M3 had the same behavior.
Action: reproduce it with a Playwright drag that triggers auto-scroll (tall column, drag to the bottom edge). If confirmed, compute the pointer from the start coordinates plus the raw mouse movement, or subtract the window scroll change.

**N3. Proposals for deleted cards can still be confirmed.** `frontend/src/components/AiChatSidebar.tsx:44-47, 172-185` (from code)
After H2, a proposal whose card has since been removed shows "(no longer on the board)", but Confirm stays enabled. Confirming returns 404, shows the board error and leaves the proposal pending.
Action: disable Confirm (Reject stays available) when the referenced card is missing.

**N4. Drag regression test covers rightward drift only.** `frontend/tests/kanban.spec.ts:213-257` (verified)
The new M3 test drifts right, toward Done. The same logic applies to leftward drift, but that path isn't tested.
Action: optionally add a mirrored test that drifts toward the left edge of a middle column.

**N5. The new session behavior isn't documented.** (verified)
Without `SESSION_SECRET`, every restart (including `scripts\start.cmd`) signs the user out. Neither `CLAUDE.md` nor `README.md` mentions `SESSION_SECRET`, and there is no `.env.example`.
Action: document `SESSION_SECRET` next to `OPENROUTER_API_KEY` in `CLAUDE.md` and `README.md`. Optionally add a `.env.example` with empty values. Never commit real values.

## Startup database writes (investigation)

Starting the normal `pm-mvp-app` container changed the real `pm.db` checksum (`c7551c0d...` to `321cd327...`) before a verification run.

**Evidence that startup made the change:**
- The container started at 21:32:05 (local time) with `backend/data` mounted, and `pm.db` was modified at 21:32:06.
- The container logs show no HTTP requests.
- The file header records SQLite 3046001, the SQLite version in the `pm-app` image (local Python uses 3.50.4).

The `c7551c0d...` file itself was not kept, so the before-and-after comparison was reproduced by replaying startup on scratch copies of the current file, inside the same image.

**What startup runs:** importing `app.main` runs `create_app()`, which calls `initialize_database()`. That executes:
- `CREATE TABLE/INDEX/TRIGGER IF NOT EXISTS` (no-ops on an existing database)
- `INSERT OR IGNORE` for the default user, the board and the 5 columns
- `SELECT COUNT(*)` of the board's cards
- `COMMIT`

`total_changes` is 0: no user, board, column, card or chat row is inserted, updated or deleted.

**What still changes on disk:** exactly 5 bytes:
- The header change counter and its "version valid for" copy (offsets 27 and 95).
- Three `sqlite_sequence` counters: `users` 43 to 44, `boards` 43 to 44, `columns_meta` 215 to 220.

On `AUTOINCREMENT` tables, SQLite allocates the next ID before resolving the uniqueness conflict, so every ignored seed insert still advances the counter.

### Medium

**N6 (fixed). Startup restores the demo cards on a board the user has emptied.** `backend/app/db.py:446-469` (verified on a copy)
`_seed_default_user_and_board` inserts `DEFAULT_CARDS` whenever the board has zero cards. On a scratch copy, deleting every card and then running startup brought back the 8 demo cards ("Align roadmap themes", and so on). A user who clears their board gets demo data back after the next restart (`scripts\start.cmd`, or a container recreate). This is user-visible data change on startup, and it is not documented in `docs/DATABASE.md`, which lists seeding only the user, board and columns.
Action: seed the demo cards only when the board itself is created. For example, insert them only if the `INSERT OR IGNORE INTO boards` actually inserted a row (`cursor.rowcount == 1`). Add a backend test that empties the board, re-runs `initialize_database`, and asserts the board stays empty.

### Low

**N7. Every startup or import rewrites the database file.** `backend/app/db.py:410-444` (verified)
The ignored seed inserts advance the `sqlite_sequence` counters and the header change counter on every start. This is harmless to data: the counters only affect the IDs of future users, boards or columns, and the MVP never creates any. But the file checksum changes every time the app starts, so checksum-based "real database unchanged" checks are only meaningful if they are taken after the app has started.
Action: optionally check for the user, board and columns before inserting (or use plain `INTEGER PRIMARY KEY` without `AUTOINCREMENT` for these seed-only tables), so an already-initialized database is not written at all. At minimum, note this behavior in `docs/DATABASE.md`.

## Still open from the first review

**L1. Dead and duplicated move-position logic.** (verified)
`deriveMoveTargetPosition` in `lib/kanban.ts` is only used by its tests, while the board uses `deriveTargetPositionFromPointer`. `KanbanBoard.tsx` also still has the no-op `movingDownward ? overIndex : overIndex`.
Action: keep one tested helper and delete the other.

**L2. The prompt is cleared even when the AI request fails.** `AiChatSidebar.tsx:89-90` (from code)
Action: have `onSubmitPrompt` return success, and clear the textarea only on success. This mirrors the M1 fix.

**L3. SQLite connections are not closed explicitly.** `backend/app/db.py` (from code)
Action: wrap the connections with `contextlib.closing`.

**L4. Concurrent position writes can raise an unhandled `IntegrityError` (500).** `backend/app/db.py` (likely)
Action: use `BEGIN IMMEDIATE`, or map the error to 409.

**L5. AI validation accepts booleans as integers.** `backend/app/ai.py:298, 324` (from code)
Action: also reject `bool`.

**L6. Titles, details and prompts have no length limits.** `backend/app/main.py` payload models (from code)
Action: add `max_length` to the Pydantic fields.

**L7. The 20 s OpenRouter timeout may be tight.** `backend/app/ai.py:123` (likely)
Action: raise it if timeouts are seen in use.

**L8. Importing `app.main` initializes the database at the default path.** (verified, mitigated)
`backend/tests/conftest.py` redirects the path for tests.
Action: acceptable. Optionally move initialization into a lifespan handler.

**L9. Drag-and-drop has no keyboard support.** (from code)
Action: add `KeyboardSensor`.

**L10. Overlapping mutations can apply a stale board.** (likely)
Action: ignore out-of-order responses, or block mutations while one is saving.

**L11. Docker image hygiene.** (from code)
The container runs as root and `uv` is unpinned.
Action: add a non-root `USER` and pin `uv`.

**L12. Stray root `package.json`, `package-lock.json` and `node_modules`.** (verified)
Action: delete them unless they are used intentionally.

## Documentation

**D1.** `README.md` describes only Parts 2 to 4. It should also cover `SESSION_SECRET`, `OPENROUTER_API_KEY` and `test:e2e` (which needs Docker).

**D2.** `frontend/AGENTS.md` is stale: it says state is in-memory only and never mentions `AiChatSidebar` or `lib/api.ts`.

**D3.** `backend/AGENTS.md` says "scaffold for Part 2" and doesn't list `GET /api/ai/chat`.

**D4.** `HELLO_HTML` in `backend/app/main.py` still mentions "Part 3".

**D5.** `docs/DATABASE.md` is still headed "Part 5 proposal".

**D6.** The `docs/PLAN.md` final acceptance checklist is still unchecked.

**D7 (new).** `CLAUDE.md` doesn't mention `GET /api/ai/chat` or `SESSION_SECRET` (see N5).

Action: one docs pass covering D1 to D7, keeping the README minimal per AGENTS.md.

## What is in good shape

- **Test-first fixes:** every fix from the first review has a test that failed before the change. The M3 cause was confirmed with temporary logging before the fix.
- **Isolated testing:** E2E runs against the real Docker image with a throwaway database, and backend tests never touch the default database. The real database's checksum was unchanged across every run.
- **Safe AI flow:** proposals are validated against the live board, shown by title, and applied only on confirmation, through the normal endpoints.
- **Simple backend:** parameterized SQL scoped by user, with predictable 401, 404, 422 and 502 error mapping.

## Action plan (suggested order)

1. N1, M6 and N6: done.
2. N5, N7 (doc note) and D1 to D7: docs pass, including `SESSION_SECRET`. Then tick the PLAN final acceptance.
3. L2 and N3: small sidebar fixes to keep the prompt on failure and disable Confirm for missing cards.
4. L1: consolidate the move-position helper.
5. N2: reproduce the scroll-during-drag offset, then fix it if confirmed.
6. Remaining Low items as time allows. L3, L5 and L6 are cheap. N7 (avoid the writes), L4, L7, L9, L10 and L11 are optional for the MVP.

After each step, run the backend tests, lint, `npm run typecheck`, the unit tests and `npm run test:e2e`, and confirm that the `backend/data/pm.db` checksum is unchanged. Because of N7, take the "before" checksum after the app has started, or stop the app container during verification.
