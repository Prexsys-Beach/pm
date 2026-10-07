import json
from base64 import b64encode
from pathlib import Path

from fastapi.testclient import TestClient
from itsdangerous import TimestampSigner
from pytest import MonkeyPatch

from app.main import create_app

PREVIOUSLY_HARDCODED_SECRET = "pm-mvp-dev-session-secret"


def _forge_session_cookie(secret: str) -> str:
    # Mirrors starlette.middleware.sessions.SessionMiddleware cookie encoding.
    payload = b64encode(json.dumps({"user": "user"}).encode("utf-8"))
    return TimestampSigner(secret).sign(payload).decode("utf-8")


def _create_client(db_path: Path) -> TestClient:
    return TestClient(create_app(static_site_dir=Path("missing-static-site"), db_path=str(db_path)))


def test_cookie_signed_with_previously_hardcoded_secret_is_rejected(
    monkeypatch: MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("SESSION_SECRET", raising=False)
    client = _create_client(tmp_path / "forged.db")
    client.cookies.set("pm_session", _forge_session_cookie(PREVIOUSLY_HARDCODED_SECRET))

    assert client.get("/api/board").status_code == 401


def test_session_secret_is_loaded_from_environment(monkeypatch: MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("SESSION_SECRET", "test-only-session-secret")
    client = _create_client(tmp_path / "env-secret.db")
    client.cookies.set("pm_session", _forge_session_cookie("test-only-session-secret"))

    assert client.get("/api/board").status_code == 200


def test_generated_fallback_secret_differs_per_app(monkeypatch: MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("SESSION_SECRET", raising=False)
    db_path = tmp_path / "fallback.db"
    client_a = _create_client(db_path)
    login = client_a.post("/api/auth/login", json={"username": "user", "password": "password"})
    assert login.status_code == 200
    assert client_a.get("/api/board").status_code == 200

    client_b = _create_client(db_path)
    client_b.cookies.set("pm_session", client_a.cookies["pm_session"])
    assert client_b.get("/api/board").status_code == 401
