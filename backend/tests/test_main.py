import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient
from pytest import MonkeyPatch

from app.main import create_app
from app.ai import AIRequestError


client = TestClient(
    create_app(static_site_dir=Path("missing-static-site"), enable_db_init=False)
)


def test_health_route_returns_ok() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ping_route_returns_pong() -> None:
    response = client.get("/api/ping")
    assert response.status_code == 200
    assert response.json() == {"message": "pong"}


def test_root_route_returns_placeholder_html() -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "PM MVP backend is running" in response.text


def test_app_serves_static_frontend_when_directory_exists(tmp_path: Path) -> None:
    index_path = tmp_path / "index.html"
    index_path.write_text("<html><body><h1>Kanban Studio</h1></body></html>", encoding="utf-8")

    static_client = TestClient(create_app(static_site_dir=tmp_path, enable_db_init=False))
    root_response = static_client.get("/")
    assert root_response.status_code == 200
    assert "Kanban Studio" in root_response.text

    health_response = static_client.get("/health")
    assert health_response.status_code == 200
    assert health_response.json() == {"status": "ok"}


def test_session_starts_unauthenticated() -> None:
    response = client.get("/api/auth/session")
    assert response.status_code == 200
    assert response.json() == {"authenticated": False, "username": None}


def test_login_rejects_invalid_credentials() -> None:
    response = client.post(
        "/api/auth/login", json={"username": "nope", "password": "wrong"}
    )
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid username or password."}


def test_login_sets_session_and_logout_clears_it() -> None:
    login_response = client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    assert login_response.status_code == 200
    assert login_response.json() == {"authenticated": True, "username": "user"}
    assert "httponly" in login_response.headers["set-cookie"].lower()

    session_response = client.get("/api/auth/session")
    assert session_response.status_code == 200
    assert session_response.json() == {"authenticated": True, "username": "user"}

    logout_response = client.post("/api/auth/logout")
    assert logout_response.status_code == 200
    assert logout_response.json() == {"authenticated": False}

    post_logout_session_response = client.get("/api/auth/session")
    assert post_logout_session_response.status_code == 200
    assert post_logout_session_response.json() == {"authenticated": False, "username": None}


def test_ai_smoke_requires_authentication() -> None:
    response = client.post("/api/ai/smoke")
    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication required."}


def test_ai_smoke_returns_config_error_when_key_missing(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    auth_client = TestClient(
        create_app(static_site_dir=Path("missing-static-site"), enable_db_init=False)
    )
    login_response = auth_client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    assert login_response.status_code == 200

    response = auth_client.post("/api/ai/smoke")
    assert response.status_code == 503
    assert response.json() == {"detail": "OPENROUTER_API_KEY is not configured."}


def test_ai_smoke_returns_smoke_payload(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(
        "app.main.run_openrouter_smoke_test",
        lambda _api_key: {
            "model": "openai/gpt-oss-120b",
            "prompt": "What is 2+2? Respond with only the number.",
            "response": "4",
        },
    )
    auth_client = TestClient(
        create_app(static_site_dir=Path("missing-static-site"), enable_db_init=False)
    )
    login_response = auth_client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    assert login_response.status_code == 200

    response = auth_client.post("/api/ai/smoke")
    assert response.status_code == 200
    assert response.json() == {
        "model": "openai/gpt-oss-120b",
        "prompt": "What is 2+2? Respond with only the number.",
        "response": "4",
    }


def test_ai_smoke_maps_request_errors_to_bad_gateway(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    def raise_request_error(_api_key: str) -> dict[str, str]:
        raise AIRequestError("OpenRouter returned status 429.")

    monkeypatch.setattr("app.main.run_openrouter_smoke_test", raise_request_error)
    auth_client = TestClient(
        create_app(static_site_dir=Path("missing-static-site"), enable_db_init=False)
    )
    login_response = auth_client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    assert login_response.status_code == 200

    response = auth_client.post("/api/ai/smoke")
    assert response.status_code == 502
    assert response.json() == {"detail": "OpenRouter returned status 429."}


def test_ai_chat_requires_authentication() -> None:
    response = client.post("/api/ai/chat", json={"prompt": "Help me prioritize"})
    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication required."}


def test_ai_chat_returns_assistant_message_and_proposed_updates(
    monkeypatch: MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    db_path = tmp_path / "ai-chat-success.db"
    auth_client = TestClient(
        create_app(static_site_dir=Path("missing-static-site"), db_path=str(db_path), enable_db_init=True)
    )

    def fake_board_chat(_api_key: str, *, board: dict, user_prompt: str, chat_history: list[dict]) -> dict:
        assert board["title"] == "Kanban Board"
        assert user_prompt == "Help me prioritize"
        assert isinstance(chat_history, list)
        return {
            "assistantMessage": "I suggest starting with backlog cleanup.",
            "proposedUpdates": [
                {"action": "rename_column", "columnKey": "col-backlog", "title": "Ideas"}
            ],
        }

    monkeypatch.setattr("app.main.run_openrouter_board_chat", fake_board_chat)

    login_response = auth_client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    assert login_response.status_code == 200

    response = auth_client.post("/api/ai/chat", json={"prompt": "Help me prioritize"})
    assert response.status_code == 200
    assert response.json()["assistantMessage"] == "I suggest starting with backlog cleanup."
    assert response.json()["proposedUpdates"] == [
        {"action": "rename_column", "columnKey": "col-backlog", "title": "Ideas"}
    ]
    assert response.json()["chatHistory"][-2:] == [
        {"role": "user", "content": "Help me prioritize"},
        {"role": "assistant", "content": "I suggest starting with backlog cleanup."},
    ]


def test_ai_chat_invalid_structured_output_does_not_mutate_board(
    monkeypatch: MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    db_path = tmp_path / "ai-chat-safe.db"
    auth_client = TestClient(
        create_app(static_site_dir=Path("missing-static-site"), db_path=str(db_path), enable_db_init=True)
    )

    def raise_invalid_structure(_api_key: str, *, board: dict, user_prompt: str, chat_history: list[dict]) -> dict:
        raise AIRequestError("Structured response requires a non-empty assistantMessage.")

    monkeypatch.setattr("app.main.run_openrouter_board_chat", raise_invalid_structure)

    login_response = auth_client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    assert login_response.status_code == 200

    before_board = auth_client.get("/api/board").json()
    response = auth_client.post("/api/ai/chat", json={"prompt": "Do anything"})
    assert response.status_code == 502
    assert response.json() == {"detail": "Structured response requires a non-empty assistantMessage."}

    after_board = auth_client.get("/api/board").json()
    assert after_board == before_board


def test_ai_chat_history_is_trimmed_to_twenty_messages(
    monkeypatch: MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    db_path = tmp_path / "ai-chat-history.db"
    auth_client = TestClient(
        create_app(static_site_dir=Path("missing-static-site"), db_path=str(db_path), enable_db_init=True)
    )

    def fake_board_chat(_api_key: str, *, board: dict, user_prompt: str, chat_history: list[dict]) -> dict:
        return {"assistantMessage": f"echo: {user_prompt}", "proposedUpdates": []}

    monkeypatch.setattr("app.main.run_openrouter_board_chat", fake_board_chat)

    login_response = auth_client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    assert login_response.status_code == 200

    for index in range(12):
        response = auth_client.post("/api/ai/chat", json={"prompt": f"prompt-{index}"})
        assert response.status_code == 200

    with sqlite3.connect(db_path) as connection:
        user_id = connection.execute("SELECT id FROM users WHERE username = ?", ("user",)).fetchone()[0]
        count = connection.execute(
            "SELECT COUNT(*) FROM chat_messages WHERE user_id = ?",
            (user_id,),
        ).fetchone()[0]
        oldest = connection.execute(
            """
            SELECT role, content
            FROM chat_messages
            WHERE user_id = ?
            ORDER BY id ASC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()
        newest = connection.execute(
            """
            SELECT role, content
            FROM chat_messages
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()

    assert count == 20
    assert oldest == ("user", "prompt-2")
    assert newest == ("assistant", "echo: prompt-11")


def test_ai_chat_history_requires_authentication() -> None:
    response = client.get("/api/ai/chat")
    assert response.status_code == 401


def test_ai_chat_history_is_returned_after_reload(
    monkeypatch: MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    db_path = tmp_path / "ai-chat-reload.db"
    auth_client = TestClient(
        create_app(static_site_dir=Path("missing-static-site"), db_path=str(db_path), enable_db_init=True)
    )

    def fake_board_chat(_api_key: str, *, board: dict, user_prompt: str, chat_history: list[dict]) -> dict:
        return {"assistantMessage": f"echo: {user_prompt}", "proposedUpdates": []}

    monkeypatch.setattr("app.main.run_openrouter_board_chat", fake_board_chat)
    auth_client.post("/api/auth/login", json={"username": "user", "password": "password"})

    assert auth_client.get("/api/ai/chat").json() == {"chatHistory": []}
    assert auth_client.post("/api/ai/chat", json={"prompt": "hello"}).status_code == 200

    response = auth_client.get("/api/ai/chat")
    assert response.status_code == 200
    assert response.json() == {
        "chatHistory": [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "echo: hello"},
        ]
    }


def test_ai_chat_rejects_blank_prompt_without_calling_openrouter(
    monkeypatch: MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    db_path = tmp_path / "ai-chat-blank.db"
    auth_client = TestClient(
        create_app(static_site_dir=Path("missing-static-site"), db_path=str(db_path), enable_db_init=True)
    )

    def fail_if_called(*_args: object, **_kwargs: object) -> dict:
        raise AssertionError("OpenRouter must not be called for a blank prompt.")

    monkeypatch.setattr("app.main.run_openrouter_board_chat", fail_if_called)
    auth_client.post("/api/auth/login", json={"username": "user", "password": "password"})

    for prompt in ["", "   \n\t "]:
        response = auth_client.post("/api/ai/chat", json={"prompt": prompt})
        assert response.status_code == 422
        assert response.json() == {"detail": "Prompt cannot be empty."}

    assert auth_client.get("/api/ai/chat").json() == {"chatHistory": []}
