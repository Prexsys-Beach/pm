import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware import Middleware
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware
from fastapi.staticfiles import StaticFiles
from app.ai import AIConfigError, AIRequestError, run_openrouter_board_chat, run_openrouter_smoke_test
from app.db import (
    NotFoundError,
    ValidationError,
    add_chat_message_for_user,
    create_card_for_user,
    get_recent_chat_messages_for_user,
    delete_card_for_user,
    get_board_for_user,
    initialize_database,
    move_card_for_user,
    rename_column_for_user,
    update_card_for_user,
)

HELLO_HTML = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PM MVP</title>
  </head>
  <body>
    <main>
      <h1>PM MVP backend is running</h1>
      <p>This placeholder page will be replaced by the frontend build in Part 3.</p>
    </main>
  </body>
</html>
"""

DUMMY_USERNAME = "user"
DUMMY_PASSWORD = "password"


def _default_static_site_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "static" / "site"


class LoginPayload(BaseModel):
    username: str
    password: str


class RenameColumnPayload(BaseModel):
    title: str


class CreateCardPayload(BaseModel):
    columnKey: str
    title: str
    details: str = ""


class UpdateCardPayload(BaseModel):
    title: str | None = None
    details: str | None = None


class MoveCardPayload(BaseModel):
    targetColumnKey: str
    targetPosition: int | None = None


class AIChatPayload(BaseModel):
    prompt: str


def _is_authenticated(request: Request) -> bool:
    return request.session.get("user") == DUMMY_USERNAME


def _require_authenticated_username(request: Request) -> str:
    username = request.session.get("user")
    if username != DUMMY_USERNAME:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )
    return username


def create_app(
    static_site_dir: Path | None = None,
    db_path: str | None = None,
    enable_db_init: bool = True,
) -> FastAPI:
    middleware = [
        Middleware(
            SessionMiddleware,
            secret_key="pm-mvp-dev-session-secret",
            same_site="lax",
            https_only=False,
            session_cookie="pm_session",
        )
    ]
    app = FastAPI(title="PM MVP Backend", version="0.1.0", middleware=middleware)

    if enable_db_init:
        initialize_database(db_path)

    @app.get("/health")
    def read_health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/ping")
    def read_ping() -> dict[str, str]:
        return {"message": "pong"}

    @app.get("/api/auth/session")
    def read_session(request: Request) -> dict[str, Any]:
        authenticated = _is_authenticated(request)
        return {
            "authenticated": authenticated,
            "username": DUMMY_USERNAME if authenticated else None,
        }

    @app.post("/api/auth/login")
    def login(payload: LoginPayload, request: Request) -> JSONResponse:
        if payload.username != DUMMY_USERNAME or payload.password != DUMMY_PASSWORD:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password.",
            )
        request.session["user"] = DUMMY_USERNAME
        return JSONResponse({"authenticated": True, "username": DUMMY_USERNAME})

    @app.post("/api/auth/logout")
    def logout(request: Request) -> dict[str, bool]:
        request.session.clear()
        return {"authenticated": False}

    @app.get("/api/board")
    def read_board(request: Request) -> dict[str, Any]:
        username = _require_authenticated_username(request)
        return get_board_for_user(username, db_path)

    @app.patch("/api/columns/{column_key}")
    def rename_column(
        column_key: str,
        payload: RenameColumnPayload,
        request: Request,
    ) -> dict[str, Any]:
        username = _require_authenticated_username(request)
        try:
            return rename_column_for_user(
                username=username,
                column_key=column_key,
                title=payload.title,
                configured_path=db_path,
            )
        except NotFoundError as error:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
        except ValidationError as error:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error

    @app.post("/api/cards")
    def create_card(payload: CreateCardPayload, request: Request) -> dict[str, Any]:
        username = _require_authenticated_username(request)
        try:
            return create_card_for_user(
                username=username,
                column_key=payload.columnKey,
                title=payload.title,
                details=payload.details,
                configured_path=db_path,
            )
        except NotFoundError as error:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
        except ValidationError as error:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error

    @app.patch("/api/cards/{card_id}")
    def update_card(card_id: int, payload: UpdateCardPayload, request: Request) -> dict[str, Any]:
        username = _require_authenticated_username(request)
        try:
            return update_card_for_user(
                username=username,
                card_id=card_id,
                title=payload.title,
                details=payload.details,
                configured_path=db_path,
            )
        except NotFoundError as error:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
        except ValidationError as error:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error

    @app.delete("/api/cards/{card_id}")
    def delete_card(card_id: int, request: Request) -> dict[str, Any]:
        username = _require_authenticated_username(request)
        try:
            return delete_card_for_user(username=username, card_id=card_id, configured_path=db_path)
        except NotFoundError as error:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error

    @app.post("/api/cards/{card_id}/move")
    def move_card(card_id: int, payload: MoveCardPayload, request: Request) -> dict[str, Any]:
        username = _require_authenticated_username(request)
        try:
            return move_card_for_user(
                username=username,
                card_id=card_id,
                target_column_key=payload.targetColumnKey,
                target_position=payload.targetPosition,
                configured_path=db_path,
            )
        except NotFoundError as error:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
        except ValidationError as error:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error

    @app.post("/api/ai/smoke")
    def ai_smoke_test(request: Request) -> dict[str, str]:
        _require_authenticated_username(request)
        try:
            return run_openrouter_smoke_test(os.getenv("OPENROUTER_API_KEY"))
        except AIConfigError as error:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error
        except AIRequestError as error:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)) from error

    @app.post("/api/ai/chat")
    def ai_chat(payload: AIChatPayload, request: Request) -> dict[str, Any]:
        username = _require_authenticated_username(request)
        board = get_board_for_user(username, db_path)
        chat_history = get_recent_chat_messages_for_user(username, db_path)
        try:
            result = run_openrouter_board_chat(
                os.getenv("OPENROUTER_API_KEY"),
                board=board,
                user_prompt=payload.prompt,
                chat_history=chat_history,
            )
            add_chat_message_for_user(username, "user", payload.prompt, db_path)
            add_chat_message_for_user(username, "assistant", result["assistantMessage"], db_path)
        except AIConfigError as error:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error
        except AIRequestError as error:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)) from error

        return {
            "assistantMessage": result["assistantMessage"],
            "proposedUpdates": result["proposedUpdates"],
            "chatHistory": get_recent_chat_messages_for_user(username, db_path),
        }

    resolved_static_dir = static_site_dir or _default_static_site_dir()
    if resolved_static_dir.exists():
        app.mount(
            "/",
            StaticFiles(directory=str(resolved_static_dir), html=True),
            name="frontend",
        )
    else:
        @app.get("/", response_class=HTMLResponse)
        def read_root() -> str:
            return HELLO_HTML

    return app


app = create_app()
