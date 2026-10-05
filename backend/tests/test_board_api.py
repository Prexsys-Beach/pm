from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


def _create_client(db_path: Path) -> TestClient:
    app = create_app(
        static_site_dir=Path("missing-static-site"),
        db_path=str(db_path),
        enable_db_init=True,
    )
    return TestClient(app)


def _login(client: TestClient) -> None:
    response = client.post(
        "/api/auth/login",
        json={"username": "user", "password": "password"},
    )
    assert response.status_code == 200


def _get_card_id_by_title(board_payload: dict, title: str) -> int:
    for column in board_payload["columns"]:
        for card in column["cards"]:
            if card["title"] == title:
                return card["id"]
    raise AssertionError(f"Card with title '{title}' not found.")


def test_board_requires_authentication(tmp_path: Path) -> None:
    client = _create_client(tmp_path / "board-auth.db")
    response = client.get("/api/board")
    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication required."}


def test_get_board_returns_seeded_columns(tmp_path: Path) -> None:
    client = _create_client(tmp_path / "board-seeded.db")
    _login(client)

    response = client.get("/api/board")
    assert response.status_code == 200
    payload = response.json()
    assert payload["title"] == "Kanban Board"
    assert len(payload["columns"]) == 5
    assert [column["key"] for column in payload["columns"]] == [
        "col-backlog",
        "col-discovery",
        "col-progress",
        "col-review",
        "col-done",
    ]


def test_card_crud_move_and_delete_flow(tmp_path: Path) -> None:
    client = _create_client(tmp_path / "board-crud.db")
    _login(client)

    create_response = client.post(
        "/api/cards",
        json={"columnKey": "col-backlog", "title": "API card", "details": "initial"},
    )
    assert create_response.status_code == 200
    created_board = create_response.json()
    card_id = _get_card_id_by_title(created_board, "API card")

    update_response = client.patch(
        f"/api/cards/{card_id}",
        json={"title": "API card updated", "details": "updated"},
    )
    assert update_response.status_code == 200

    move_response = client.post(
        f"/api/cards/{card_id}/move",
        json={"targetColumnKey": "col-review", "targetPosition": 1},
    )
    assert move_response.status_code == 200
    moved_board = move_response.json()
    review_column = next(
        column for column in moved_board["columns"] if column["key"] == "col-review"
    )
    assert review_column["cards"][0]["title"] == "API card updated"

    delete_response = client.delete(f"/api/cards/{card_id}")
    assert delete_response.status_code == 200
    deleted_board = delete_response.json()
    titles = [
        card["title"] for column in deleted_board["columns"] for card in column["cards"]
    ]
    assert "API card updated" not in titles


def test_invalid_payload_and_missing_entities(tmp_path: Path) -> None:
    client = _create_client(tmp_path / "board-invalid.db")
    _login(client)

    rename_response = client.patch("/api/columns/col-backlog", json={"title": "   "})
    assert rename_response.status_code == 422
    assert rename_response.json() == {"detail": "Column title cannot be empty."}

    create_response = client.post(
        "/api/cards",
        json={"columnKey": "missing-column", "title": "Card", "details": ""},
    )
    assert create_response.status_code == 404
    assert create_response.json() == {"detail": "Column not found."}

    move_response = client.post(
        "/api/cards/9999/move",
        json={"targetColumnKey": "col-review", "targetPosition": 1},
    )
    assert move_response.status_code == 404
    assert move_response.json() == {"detail": "Card not found."}


def test_board_state_persists_across_app_restart(tmp_path: Path) -> None:
    db_path = tmp_path / "board-restart.db"

    client_a = _create_client(db_path)
    _login(client_a)
    create_response = client_a.post(
        "/api/cards",
        json={"columnKey": "col-progress", "title": "Persist me", "details": "saved"},
    )
    assert create_response.status_code == 200

    client_b = _create_client(db_path)
    _login(client_b)
    board_response = client_b.get("/api/board")
    assert board_response.status_code == 200
    titles = [
        card["title"] for column in board_response.json()["columns"] for card in column["cards"]
    ]
    assert "Persist me" in titles
