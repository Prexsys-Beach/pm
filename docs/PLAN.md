# Project implementation plan

This document is the execution checklist for the MVP. It is designed to be completed in order, with explicit tests and objective success criteria at each stage.

## Confirmed decisions

- [x] MVP release gate: full end-to-end validation in Docker plus targeted unit/integration tests by layer.
- [x] AI-proposed board updates require user confirmation before applying.
- [x] Sign-in persistence uses backend-managed HTTP-only session cookie.
- [x] Board columns remain fixed-count and rename-only (no add/remove columns for MVP).
- [x] Persist last 20 chat messages per user.

## Quality rules used throughout

- Keep scope tightly aligned to MVP requirements in [AGENTS.md](../AGENTS.md).
- Prefer simple, explicit solutions over abstractions.
- Do not add optional features unless required for an accepted checklist item.
- Each phase must pass its listed tests before moving to next phase.
- After each major change, run the smallest meaningful test set first, then Docker end-to-end checks at milestones.

---

## Part 1: Plan and baseline documentation

### Implementation checklist

- [x] Enrich this plan with implementation substeps, tests, and success criteria.
- [x] Document the current frontend baseline in `frontend/AGENTS.md`.
- [x] User reviews and approves this plan before coding starts.

### Tests

- [x] Documentation review only (no code execution required).

### Success criteria

- Plan clearly defines concrete deliverables, validation, and done criteria for Parts 2-10.
- Frontend baseline document is accurate to current code and test setup.
- User approval is explicit.

---

## Part 2: Scaffolding (Docker, backend skeleton, scripts)

### Implementation checklist

- [x] Create `backend/` FastAPI skeleton with:
  - [x] app entrypoint
  - [x] `/health` route
  - [x] placeholder API route for smoke validation
- [x] Add Dockerfile and container runtime configuration:
  - [x] Install Python dependencies with `uv`
  - [x] Include frontend build artifacts placeholder strategy
- [x] Add cross-platform scripts in `scripts/`:
  - [x] Windows start script
  - [x] Windows stop script
  - [x] macOS/Linux start script
  - [x] macOS/Linux stop script
- [x] Serve temporary static hello page at `/` via FastAPI.

### Tests

- [x] Backend unit smoke: app imports and route registration.
- [x] API smoke: `/health` and placeholder endpoint return expected payload.
- [x] Docker build succeeds from clean context.
- [x] Script durability checks:
  - [x] Start script brings service up from stopped state.
  - [x] Re-running start script is safe or fails clearly.
  - [x] Stop script shuts service down cleanly.
  - [x] Start/stop loop passes at least 3 consecutive cycles.

### Success criteria

- App runs locally in container and serves static hello page + API.
- Scripts are reliable and documented.
- No manual setup beyond environment variables and scripts.

---

## Part 3: Serve frontend from backend

### Implementation checklist

- [x] Build Next.js frontend statically from `frontend/`.
- [x] Configure FastAPI static serving so board renders at `/`.
- [x] Ensure API routes remain available under dedicated prefix (for example `/api`).
- [x] Keep existing UI behavior and styling intact.

### Tests

- [x] Existing frontend unit tests pass.
- [x] Existing frontend e2e tests pass against integrated app path.
- [x] Integration test: backend serves static files and API in one process/container.
- [x] Durability: restart container and confirm board still serves.

### Success criteria

- Hitting `/` in container shows current Kanban demo.
- Static assets resolve correctly.
- No regression in baseline frontend behavior.

---

## Part 4: Fake user sign-in flow

### Implementation checklist

- [x] Add backend login endpoint validating `user` / `password`.
- [x] Issue HTTP-only session cookie on success.
- [x] Add logout endpoint clearing session.
- [x] Add frontend login page/flow.
- [x] Guard board route for authenticated access.

### Tests

- [x] Backend auth unit/integration tests:
  - [x] valid credentials succeed
  - [x] invalid credentials rejected with clear status
  - [x] logout clears session
- [x] Frontend tests for login/logout behavior.
- [x] Integration tests for route protection and cookie persistence on refresh.
- [x] Durability: restart app and verify expected post-restart auth behavior is deterministic.

### Success criteria

- Unauthenticated user cannot use board.
- Authenticated user can reach board until logout/session end.
- Behavior matches MVP fake-auth requirement exactly.

---

## Part 5: Database model and sign-off

### Implementation checklist

- [x] Propose SQLite schema covering:
  - [x] users
  - [x] one board per user
  - [x] fixed columns (rename-only metadata)
  - [x] cards
  - [x] chat messages (capped to last 20 per user)
- [x] Define JSON representation for board payload exchange.
- [x] Document schema and lifecycle in `docs/` (creation, initialization, migration posture).
- [ ] Get user approval before implementing full persistence logic.

### Tests

- [x] Schema DDL validation in local SQLite.
- [x] DB bootstrap test creates DB/tables if missing.
- [x] Idempotency test: repeated bootstrap does not corrupt data.

### Success criteria

- Schema supports current MVP features and known future multi-user expansion.
- Documented approach is approved before backend feature expansion.

---

## Part 6: Backend Kanban API and persistence

### Implementation checklist

- [x] Implement authenticated API endpoints for:
  - [x] read board
  - [x] rename fixed columns
  - [x] create/edit/delete cards
  - [x] move cards across columns
- [x] Persist board updates in SQLite.
- [x] Enforce column constraints (fixed count, rename-only).
- [x] Ensure DB auto-creation on first run.
- [x] Add explicit error responses for invalid input and auth failure.

### Tests

- [x] Backend unit tests for service logic (move/rename/create/edit/delete semantics).
- [x] Backend integration tests for endpoints + auth checks.
- [x] Persistence tests across application restart.
- [x] Negative tests for invalid IDs/payloads/session.
- [x] Durability test: repeated sequential updates maintain valid board state.

### Success criteria

- API fully supports MVP board operations.
- Data persists and reloads correctly.
- Failure paths are predictable and explicit.

---

## Part 7: Frontend + backend integration

### Implementation checklist

- [x] Replace in-memory frontend board state with API-backed loading and mutation.
- [x] Keep drag/drop and card editing UX equivalent to current baseline.
- [x] Add loading and error handling states for network operations.
- [x] Keep board state synchronized after every mutation.

### Tests

- [x] Frontend integration tests with mocked and real backend paths.
- [x] E2E tests for full board lifecycle (load, rename, add, edit, move, delete).
- [x] Failure scenario tests (server errors, timeout, malformed response).
- [x] Durability: restart app and verify persisted board rehydrates correctly.

### Success criteria

- Board is backend-authoritative and persistent.
- User interactions remain smooth and predictable.
- Existing and new tests pass.

---

## Part 8: AI connectivity through OpenRouter

### Implementation checklist

- [x] Add backend AI client integration for OpenRouter.
- [x] Read `OPENROUTER_API_KEY` from environment.
- [x] Configure model to `openai/gpt-oss-120b`.
- [x] Add a narrow connectivity execution path (for example `"2+2"` prompt route/test helper).

### Tests

- [x] Unit tests for request construction and response parsing (mocked HTTP).
- [x] Error-path tests (missing key, timeout, non-200 response).
- [x] Optional live smoke check gated by available key.

### Success criteria

- Backend can successfully call OpenRouter in controlled path.
- Failures are surfaced with explicit actionable errors.

---

## Part 9: Structured AI board mutation contract

### Implementation checklist

- [x] Send AI request containing:
  - [x] current board JSON
  - [x] user prompt
  - [x] recent chat history (last 20 messages)
- [x] Enforce structured response contract:
  - [x] assistant message
  - [x] optional board update instructions
- [x] Validate structured output before applying updates.
- [x] Persist conversation history with cap enforcement.

### Tests

- [x] Contract tests for valid and invalid structured outputs.
- [x] Mutation tests for each supported action from AI output.
- [x] Safety tests: invalid/partial output never mutates board.
- [x] History cap tests to guarantee max-20 retention behavior.

### Success criteria

- AI responses are deterministic in shape.
- Board mutation path is safe, validated, and auditable.
- Chat history persistence and trimming work as designed.

---

## Part 10: Sidebar AI chat UI with confirmation flow

### Implementation checklist

- [ ] Add sidebar AI chat interface to frontend.
- [ ] Show conversation thread and pending AI-proposed board changes.
- [ ] Require explicit user confirm/reject for each AI-proposed update.
- [ ] On confirm, apply update and refresh board state immediately.

### Tests

- [ ] Component tests for sidebar rendering and interaction.
- [ ] Integration tests for submit -> AI response -> confirm/reject flow.
- [ ] E2E tests for end-to-end board update through AI proposal confirmation.
- [ ] Durability tests for repeated chat/mutation cycles and refresh behavior.

### Success criteria

- AI chat is usable and visually integrated.
- No board change is applied without user confirmation.
- Confirmed changes persist and become visible immediately.

---

## Final acceptance checklist

- [ ] All phase success criteria are met.
- [ ] Targeted unit/integration tests pass across frontend and backend.
- [ ] Dockerized end-to-end workflow passes from clean start:
  - [ ] start scripts
  - [ ] login flow
  - [ ] board CRUD + drag/drop persistence
  - [ ] AI chat + confirmation-based board update
  - [ ] stop scripts
- [ ] Core docs are updated and accurate for setup/run/test workflows.