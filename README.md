# PM MVP

This repository contains the PM MVP in phases. Part 2 scaffolds a FastAPI backend, container runtime, and platform start/stop scripts.
Part 3 serves the statically built frontend Kanban board at `/` from FastAPI.
Part 4 adds dummy sign-in via backend session cookie.

## Local run (Docker)

Windows:

```bat
scripts\start.cmd
```

macOS/Linux:

```bash
./scripts/start.sh
```

Then open:

- `http://localhost:8000/` (sign in with `user` / `password`)
- `http://localhost:8000/health`
- `http://localhost:8000/api/ping`

Notes:

- Board data persists in SQLite at `backend/data/pm.db`.
- Docker compose mounts `./backend/data` into the container so board changes survive stop/start cycles.
- For AI smoke testing in Part 8, set `OPENROUTER_API_KEY` in the backend runtime environment.

Stop:

Windows:

```bat
scripts\stop.cmd
```

macOS/Linux:

```bash
./scripts/stop.sh
```

## Backend tests with coverage

```bash
cd backend
uv sync --group dev
uv run pytest
```
