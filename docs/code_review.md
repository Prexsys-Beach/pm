# Code review

Date: 2026-10-06. Scope: the entire repo at commit `2c28307` (backend, frontend, Docker, scripts, tests, docs).

Each finding says how it was confirmed:

- **Verified**: shown by running the code or tests.
- **From code**: the code path is clear from reading it, but was not run.
- **Likely**: inferred from reading the code; it needs a reproduction before fixing.

Per AGENTS.md, prove the root cause with evidence before changing any code.

## Summary

The codebase is small, readable and matches the MVP plan. The backend is authoritative, the AI flow never applies changes without the user's confirmation, and backend tests cover 87%. The most important issues are:

- a session secret that is hard-coded in the repo
- a few frontend paths where a failed save looks like it succeeded
- AI change confirmations that show raw IDs instead of card and column names
- persisted chat history that is never shown after a page reload
- a drag-and-drop heuristic that can move a card into the wrong column

There are no critical defects for a local, single-user MVP.

## Findings

### High

**H1. The session signing secret is hard-coded.** `backend/app/main.py:101` (verified)
`secret_key="pm-mvp-dev-session-secret"` is committed to the repo, so anyone can forge a valid `pm_session` cookie. This is acceptable for the local demo, but it blocks the multi-user future the schema is designed for.
Action: read `SESSION_SECRET` from the environment. If it is missing, fall back to a random value generated per process, so sessions reset on restart rather than being forgeable.

**H2. AI confirmations show IDs, not content.** `frontend/src/components/AiChatSidebar.tsx:38-59` (from code)
Pending updates are shown as "Delete card #12" or "Move card #7 to col-review". The user cannot tell what they are confirming without matching IDs by hand. This weakens the confirm-before-apply safeguard. It matters most because card titles and details, which the user writes, are sent to the model, so text in a card could steer the model's proposals.
Action: pass the current board to the sidebar, and show card titles and column titles in `describeUpdate`.

### Medium

**M1. Failed saves look successful in the UI.** (from code)
`withPersistence` returns `false` on failure (`KanbanBoard.tsx:256-278`), but `handleAddCard`, `handleUpdateCard` and `handleRenameColumn` throw that result away. The result:

- `KanbanCard.saveCard` (`KanbanCard.tsx:41-53`) closes the editor and drops the edits.
- `NewCardForm.handleSubmit` (`NewCardForm.tsx:13-20`) clears and closes the form.
- `KanbanColumn` keeps showing the unsaved title draft as if it were the column's title.

The error banner does appear, but the user's input is lost or misrepresented.
Action: return the boolean from these handlers. Only close or reset the UI on `true`, and reset the column draft to `column.title` on `false`.

**M2. Persisted chat history is never loaded.** `backend/app/main.py:233`, `frontend/src/components/KanbanBoard.tsx:230` (from code)
The backend stores the last 20 messages, but there is no `GET` chat endpoint and `chatHistory` starts empty. After a refresh, the sidebar is empty until the next prompt, when the history suddenly reappears.
Action: add `GET /api/ai/chat` that returns `get_recent_chat_messages_for_user`, and load it when the board mounts. Add a backend test and extend the e2e refresh test to cover it.

**M3. Drag-and-drop can move a card into the adjacent column.** `frontend/src/components/KanbanBoard.tsx:127-156, 476-485` (likely)
When the pointer resolves to the source column, `resolveColumnKeyFromHorizontalDelta` still overrides the target if the horizontal drift is at least half of `shiftStep`. `shiftStep` is `max(0.6 * columnWidth, 120)`. With a column about 200 px wide, a reorder within a column that drifts about 60 to 100 px sideways is sent to the neighboring column, even though the pointer never left the source column.
Action: reproduce it with a Playwright mouse-coordinate test first. Then only apply the delta fallback when `pointerColumnKey` is null.

**M4. An empty AI prompt returns 502 Bad Gateway.** `backend/app/ai.py:53-55`, `backend/app/main.py:249` (from code)
A blank prompt raises `AIRequestError`, which maps to 502 and blames OpenRouter for a client input error. The `AIChatPayload` model accepts empty strings.
Action: validate the prompt in the route (or add `min_length=1` with stripping) and return 422. Add a test.

**M5. Errors that are not JSON produce raw parse errors in the UI.** `KanbanBoard.tsx:261-263, 350-352`, `AuthGate.tsx:31-33, 89-91` (verified)
On a non-OK response, the code calls `response.json()` unconditionally. A 500 response or an HTML page (such as a proxy error) shows the user a message like `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`. This exact message was seen in the earlier failed e2e run.
Action: guard the parse with a try/catch, and fall back to `defaultError` when the body isn't JSON.

**M6. Type checking fails on the test files.** `frontend/src/test/vitest.d.ts` (verified)
`npx tsc --noEmit` reports about 60 errors (`Cannot find name 'describe'`, and so on), because the reference is `types="vitest"` rather than `types="vitest/globals"`, and `globals: true` is set. `next build` does not catch this. The editor and any future type-check step will.
Action: change the reference to `vitest/globals`, then add `"typecheck": "tsc --noEmit"` to `package.json` and run it in CI or before commits.

### Low

**L1. Dead and duplicated move-position logic.** `frontend/src/lib/kanban.ts:103-149`, `KanbanBoard.tsx:158-223` (verified)
`deriveMoveTargetPosition` is only used by its unit tests. The board uses its own `deriveTargetPositionFromPointer`, so the unit tests cover code that never runs. `KanbanBoard.tsx:186` also contains `movingDownward ? overIndex : overIndex`, a no-op ternary.
Action: pick one implementation, put it in `lib/kanban.ts` with unit tests, and delete the other.

**L2. A cleared prompt is lost when the AI call fails.** `AiChatSidebar.tsx:79-80` (from code)
`handleSubmitPrompt` catches errors itself, so the sidebar always clears the textarea, even after a failure.
Action: have `onSubmitPrompt` return success, and only clear on success.

**L3. SQLite connections are not closed explicitly.** `backend/app/db.py` (every `with sqlite3.connect(...)`) (from code)
`sqlite3.Connection`'s context manager commits or rolls back but does not close. CPython closes the connection when it is garbage collected, so this is benign today. It is fragile under other runtimes or when connections live longer.
Action: wrap the connections in `contextlib.closing(...)` or a small `_connect()` helper that does both.

**L4. Constraint violations surface as 500.** `backend/app/db.py:288-295, 609-631` (likely)
Card positions are read and then written in a deferred transaction. Two concurrent creates or moves in the same column could hit the unique `(column_id, position)` index and raise an `IntegrityError` that isn't handled. This is unlikely with a single user.
Action: use `BEGIN IMMEDIATE` for the mutation functions, or map `sqlite3.IntegrityError` to 409.

**L5. AI validation accepts booleans as integers.** `backend/app/ai.py:298, 324` (from code)
`isinstance(True, int)` is `True`, so `cardId: true` passes validation when card 1 exists, and `targetPosition: true` passes as 1.
Action: also reject `bool` (`type(value) is int`).

**L6. Request fields have no size limits.** `backend/app/main.py:50-76` (from code)
Titles, details and prompts are unbounded. A large prompt is sent to OpenRouter as is, along with the full board.
Action: add `max_length` to the Pydantic fields (for example, title 200, details 2000, prompt 4000).

**L7. The OpenRouter timeout may be short.** `backend/app/ai.py:123` (likely)
20 s is tight for a 120B model with a full board and 20 messages of history. A timeout surfaces as a 502.
Action: make it 60 s, or configurable via the environment, if timeouts show up in use.

**L8. Importing the app writes to the database.** `backend/app/main.py:273` (verified)
The module-level `app = create_app()` initializes the database at import time. This is why `backend/tests/conftest.py` had to redirect `PM_DB_PATH`.
Action: acceptable as is. If it causes more surprises, move initialization into a FastAPI lifespan handler.

**L9. Drag-and-drop has no keyboard support.** `KanbanBoard.tsx:237-244` (from code)
Only the mouse and touch sensors are registered, so cards cannot be moved with the keyboard.
Action: add dnd-kit's `KeyboardSensor` with `sortableKeyboardCoordinates`.

**L10. Overlapping mutations can apply stale boards.** `KanbanBoard.tsx:256-278` (likely)
Each response replaces the board. If two requests overlap (for example, confirming an AI update during a drag save), the slower response wins and can briefly show an outdated board.
Action: ignore responses from requests older than the latest one, or disable mutations while `isSaving`.

**L11. Docker image hygiene.** `Dockerfile` (from code)
The container runs as root, and `pip install uv` is unpinned.
Action: pin `uv` (or copy it from the `ghcr.io/astral-sh/uv` image) and add a non-root `USER`.

**L12. Stray root Node package.** `package.json`, `package-lock.json` and `node_modules/` at the repo root (verified)
These hold only `@playwright/test@^1.63`, while `frontend/` uses `^1.58`. Nothing references the root package.
Action: delete them unless they are used intentionally.

### Documentation

**D1.** `README.md` describes only Parts 2 to 4. It should cover running the app, the AI key and `test:e2e` (Docker).

**D2.** `frontend/AGENTS.md` says "State is in-memory only (resets on refresh)" and lists stale structure and tests. It never mentions `AiChatSidebar`.

**D3.** `backend/AGENTS.md` still opens with "FastAPI backend scaffold for Part 2".

**D4.** `HELLO_HTML` (`backend/app/main.py:36`) says it "will be replaced by the frontend build in Part 3".

**D5.** The `docs/DATABASE.md` heading still reads "Part 5 proposal".

**D6.** The `docs/PLAN.md` final acceptance checklist is unchecked, even though the Docker e2e flow now passes.

Action: update these in one docs pass. Keep the README minimal, per AGENTS.md.

## What is in good shape

- **Clear layering:** routes in `main.py`, persistence in `db.py`, the AI client in `ai.py`. All queries are parameterized and scoped by user.
- **Validated AI output:** responses are checked against the live board (column keys and card IDs), and invalid output never causes a mutation.
- **Sound position-shifting:** `POSITION_SHIFT_MARKER` correctly avoids unique-index collisions, and the tests cover it.
- **Isolated tests:** the test setups never touch the real database. E2E runs against the real Docker image with a throwaway database.

## Action plan (suggested order)

1. H1: move the session secret to the environment.
2. M1 and L2: keep the user's input when a save fails.
3. H2: show titles in AI confirmations.
4. M4 and M5: fix the empty-prompt status and harden error parsing.
5. M6: fix the Vitest types and add a `typecheck` script.
6. M2: add the chat history endpoint and load it on mount.
7. M3: reproduce the drag bug, then fix it. Fold in L1 (one position helper, tested).
8. D1 to D6: docs pass, then tick the PLAN final acceptance.
9. Low items as time allows: L3, L5 and L6 are small and cheap. L4, L7, L9, L10 and L11 are optional for the MVP.

After each step, run the backend tests, lint, the unit tests and `npm run test:e2e`, and confirm that the `backend/data/pm.db` checksum is unchanged.
