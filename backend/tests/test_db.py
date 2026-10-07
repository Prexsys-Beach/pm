import sqlite3
from pathlib import Path

import pytest

from app.db import (
    DEFAULT_CARDS,
    DEFAULT_COLUMNS,
    add_chat_message_for_user,
    create_card_for_user,
    get_recent_chat_messages_for_user,
    get_board_for_user,
    initialize_database,
    move_card_for_user,
    ValidationError,
)


def test_initialize_database_creates_db_file_and_tables(tmp_path: Path) -> None:
    db_path = tmp_path / "pm-test.db"

    created_path = initialize_database(str(db_path))
    assert created_path == db_path
    assert db_path.exists()

    with sqlite3.connect(db_path) as connection:
        table_names = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }

        assert "users" in table_names
        assert "boards" in table_names
        assert "columns_meta" in table_names
        assert "cards" in table_names
        assert "chat_messages" in table_names


def test_initialize_database_is_idempotent_and_preserves_seed_data(tmp_path: Path) -> None:
    db_path = tmp_path / "pm-idempotent.db"

    initialize_database(str(db_path))
    initialize_database(str(db_path))

    with sqlite3.connect(db_path) as connection:
        users_count = connection.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        boards_count = connection.execute("SELECT COUNT(*) FROM boards").fetchone()[0]
        columns_count = connection.execute("SELECT COUNT(*) FROM columns_meta").fetchone()[0]

        assert users_count == 1
        assert boards_count == 1
        assert columns_count == len(DEFAULT_COLUMNS)


def test_new_database_is_seeded_with_demo_cards(tmp_path: Path) -> None:
    db_path = tmp_path / "pm-fresh.db"
    initialize_database(str(db_path))

    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM cards").fetchone()[0] == len(DEFAULT_CARDS)


def test_restart_does_not_restore_demo_cards_on_an_emptied_board(tmp_path: Path) -> None:
    db_path = tmp_path / "pm-emptied.db"
    initialize_database(str(db_path))
    with sqlite3.connect(db_path) as connection:
        connection.execute("DELETE FROM cards")

    initialize_database(str(db_path))

    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM cards").fetchone()[0] == 0


def test_chat_message_trigger_caps_messages_at_twenty(tmp_path: Path) -> None:
    db_path = tmp_path / "pm-chat-cap.db"
    initialize_database(str(db_path))

    with sqlite3.connect(db_path) as connection:
        user_id = connection.execute(
            "SELECT id FROM users WHERE username = ?",
            ("user",),
        ).fetchone()[0]

        for index in range(25):
            connection.execute(
                """
                INSERT INTO chat_messages (user_id, role, content)
                VALUES (?, 'user', ?)
                """,
                (user_id, f"message-{index}"),
            )
        connection.commit()

        total_messages = connection.execute(
            "SELECT COUNT(*) FROM chat_messages WHERE user_id = ?",
            (user_id,),
        ).fetchone()[0]
        oldest_message = connection.execute(
            """
            SELECT content
            FROM chat_messages
            WHERE user_id = ?
            ORDER BY id ASC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()[0]
        newest_message = connection.execute(
            """
            SELECT content
            FROM chat_messages
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()[0]

        assert total_messages == 20
        assert oldest_message == "message-5"
        assert newest_message == "message-24"


def test_sequential_card_moves_keep_column_positions_contiguous(tmp_path: Path) -> None:
    db_path = tmp_path / "pm-sequential-ops.db"
    initialize_database(str(db_path))

    for index in range(6):
        create_card_for_user(
            username="user",
            column_key="col-backlog",
            title=f"task-{index}",
            details="",
            configured_path=str(db_path),
        )

    board = get_board_for_user("user", str(db_path))
    card_lookup = {
        card["title"]: card["id"] for column in board["columns"] for card in column["cards"]
    }

    move_card_for_user("user", card_lookup["task-0"], "col-review", 1, str(db_path))
    move_card_for_user("user", card_lookup["task-1"], "col-review", 1, str(db_path))
    move_card_for_user("user", card_lookup["task-2"], "col-done", None, str(db_path))
    move_card_for_user("user", card_lookup["task-3"], "col-backlog", 1, str(db_path))
    move_card_for_user("user", card_lookup["task-4"], "col-backlog", 2, str(db_path))
    move_card_for_user("user", card_lookup["task-5"], "col-discovery", 1, str(db_path))

    final_board = get_board_for_user("user", str(db_path))
    for column in final_board["columns"]:
        positions = [card["position"] for card in column["cards"]]
        assert positions == list(range(1, len(positions) + 1))


def test_chat_history_helpers_return_recent_messages_in_chronological_order(tmp_path: Path) -> None:
    db_path = tmp_path / "pm-chat-history.db"
    initialize_database(str(db_path))

    add_chat_message_for_user("user", "user", "hello", str(db_path))
    add_chat_message_for_user("user", "assistant", "hi there", str(db_path))
    add_chat_message_for_user("user", "user", "next", str(db_path))

    recent = get_recent_chat_messages_for_user("user", str(db_path), limit=2)
    assert recent == [
        {"role": "assistant", "content": "hi there"},
        {"role": "user", "content": "next"},
    ]


def test_chat_history_helpers_validate_role_and_content(tmp_path: Path) -> None:
    db_path = tmp_path / "pm-chat-validation.db"
    initialize_database(str(db_path))

    with pytest.raises(ValidationError, match="Role must be user, assistant, or system."):
        add_chat_message_for_user("user", "bad-role", "test", str(db_path))

    with pytest.raises(ValidationError, match="cannot be empty"):
        add_chat_message_for_user("user", "user", "   ", str(db_path))
