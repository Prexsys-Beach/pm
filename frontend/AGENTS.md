# Frontend implementation baseline

This document describes the current frontend-only Kanban implementation in `frontend/` and serves as the baseline for backend integration work.

## Scope currently implemented

- Single-page Kanban board rendered at `/`.
- Login gate at `/` requiring dummy credentials before board display.
- Five fixed columns shown in UI.
- Column titles are editable inline.
- Cards can be:
  - added within a column
  - deleted
  - moved/reordered via drag and drop
- State is in-memory only (resets on refresh).
- Authentication integration is present for dummy login/logout session flow.
- Board data is backend-authoritative via API after login.

## Tech stack and tooling

- Framework: Next.js 16 (App Router) + React 19 + TypeScript
- Styling: Tailwind CSS 4 + CSS variables in `src/app/globals.css`
- Drag and drop: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`
- Unit/component tests: Vitest + Testing Library (jsdom)
- End-to-end tests: Playwright (Chromium)

## Current app structure

- App entry:
  - `src/app/page.tsx`: renders `AuthGate`
  - `src/app/layout.tsx`: metadata, fonts, root layout
  - `src/app/globals.css`: color tokens and base styles
- Core components:
  - `src/components/KanbanBoard.tsx`: top-level board state and dnd orchestration
    with backend persistence calls
  - `src/components/AuthGate.tsx`: login/session gate and logout control
  - `src/components/KanbanColumn.tsx`: droppable column with inline title editing
  - `src/components/KanbanCard.tsx`: sortable card with delete action
  - `src/components/NewCardForm.tsx`: add-card form with local open/close state
  - `src/components/KanbanCardPreview.tsx`: drag overlay preview
- Domain logic:
  - `src/lib/kanban.ts`: board types, seed data, `moveCard`, ID generation

## Data and state model

- Board model:
  - `columns: Column[]` where each column stores ordered `cardIds`
  - `cards: Record<string, Card>` card map by id
- `initialData` in `src/lib/kanban.ts` seeds five columns and sample cards.
- Drag behavior:
  - Same-column reorder
  - Cross-column insert before target card
  - Drop on column container appends to column end

## Tests currently present

- Unit/domain tests:
  - `src/lib/kanban.test.ts` tests `moveCard` behavior
- Component tests:
  - `src/components/KanbanBoard.test.tsx` tests rendering, renaming, add/remove card
- E2E tests:
  - `tests/kanban.spec.ts` tests load, add card, and drag card between columns

## Known baseline constraints for upcoming integration

- Board persistence API integration is active (`/api/board`, `/api/columns/*`, `/api/cards*`).
- UI state rehydrates from backend on login and persists across app restart.
- `createId` is local utility and not suitable as authoritative server identifier generation once backend persistence is introduced.
- Existing tests assume immediate local state updates; some tests will need adaptation when asynchronous API calls are introduced.

## Guidance for planned migration

- Preserve existing visual behavior while moving state authority to backend APIs.
- Keep fixed-count column model and rename-only behavior for MVP.
- Introduce loading/error states without changing primary interaction patterns.
- Expand tests incrementally:
  - keep fast unit/component coverage
  - add frontend-backend integration checks
  - maintain reliable Playwright smoke coverage on core interactions
