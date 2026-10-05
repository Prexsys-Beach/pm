from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any

DEFAULT_DB_PATH = Path(__file__).resolve().parents[1] / "data" / "pm.db"

SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hint TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS boards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT 'Kanban Board',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS columns_meta (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL,
    column_key TEXT NOT NULL,
    title TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
    UNIQUE (board_id, column_key),
    UNIQUE (board_id, position)
);

CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL,
    column_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    details TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
    FOREIGN KEY (column_id) REFERENCES columns_meta(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_column_position
ON cards(column_id, position);

CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_user_created_id
ON chat_messages(user_id, created_at, id);

CREATE TRIGGER IF NOT EXISTS trg_chat_messages_cap_20
AFTER INSERT ON chat_messages
BEGIN
    DELETE FROM chat_messages
    WHERE id IN (
        SELECT id
        FROM chat_messages
        WHERE user_id = NEW.user_id
        ORDER BY created_at DESC, id DESC
        LIMIT -1 OFFSET 20
    );
END;
"""

DEFAULT_COLUMNS: list[tuple[str, str, int]] = [
    ("col-backlog", "Backlog", 1),
    ("col-discovery", "Discovery", 2),
    ("col-progress", "In Progress", 3),
    ("col-review", "Review", 4),
    ("col-done", "Done", 5),
]
POSITION_SHIFT_MARKER = 1_000_000
DEFAULT_CARDS: list[tuple[str, str, str, int]] = [
    (
        "col-backlog",
        "Align roadmap themes",
        "Draft quarterly themes with impact statements and metrics.",
        1,
    ),
    (
        "col-backlog",
        "Gather customer signals",
        "Review support tags, sales notes, and churn feedback.",
        2,
    ),
    (
        "col-discovery",
        "Prototype analytics view",
        "Sketch initial dashboard layout and key drill-downs.",
        1,
    ),
    (
        "col-progress",
        "Refine status language",
        "Standardize column labels and tone across the board.",
        1,
    ),
    (
        "col-progress",
        "Design card layout",
        "Add hierarchy and spacing for scanning dense lists.",
        2,
    ),
    (
        "col-review",
        "QA micro-interactions",
        "Verify hover, focus, and loading states.",
        1,
    ),
    (
        "col-done",
        "Ship marketing page",
        "Final copy approved and asset pack delivered.",
        1,
    ),
    (
        "col-done",
        "Close onboarding sprint",
        "Document release notes and share internally.",
        2,
    ),
]


class DatabaseError(Exception):
    pass


class NotFoundError(DatabaseError):
    pass


class ValidationError(DatabaseError):
    pass


def resolve_database_path(configured_path: str | None = None) -> Path:
    env_path = configured_path or os.getenv("PM_DB_PATH")
    if env_path:
        return Path(env_path).expanduser().resolve()
    return DEFAULT_DB_PATH


def initialize_database(configured_path: str | None = None) -> Path:
    db_path = resolve_database_path(configured_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(db_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON;")
        connection.executescript(SCHEMA_SQL)
        _seed_default_user_and_board(connection)
        connection.commit()

    return db_path


def get_board_for_user(username: str, configured_path: str | None = None) -> dict[str, Any]:
    db_path = resolve_database_path(configured_path)
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        _enable_foreign_keys(connection)
        user_id, board_id, board_title = _resolve_user_board(connection, username)
        return _build_board_payload(connection, user_id=user_id, board_id=board_id, board_title=board_title)


def get_recent_chat_messages_for_user(
    username: str,
    configured_path: str | None = None,
    *,
    limit: int = 20,
) -> list[dict[str, str]]:
    if limit < 1:
        raise ValidationError("History limit must be at least 1.")

    db_path = resolve_database_path(configured_path)
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        _enable_foreign_keys(connection)
        user_id = _resolve_user_id(connection, username)
        rows = connection.execute(
            """
            SELECT role, content
            FROM chat_messages
            WHERE user_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            """,
            (user_id, limit),
        ).fetchall()
        rows.reverse()
        return [{"role": row["role"], "content": row["content"]} for row in rows]


def add_chat_message_for_user(
    username: str,
    role: str,
    content: str,
    configured_path: str | None = None,
) -> None:
    if role not in {"user", "assistant", "system"}:
        raise ValidationError("Role must be user, assistant, or system.")

    cleaned_content = content.strip()
    if not cleaned_content:
        raise ValidationError("Chat message content cannot be empty.")

    db_path = resolve_database_path(configured_path)
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        _enable_foreign_keys(connection)
        user_id = _resolve_user_id(connection, username)
        connection.execute(
            """
            INSERT INTO chat_messages (user_id, role, content)
            VALUES (?, ?, ?)
            """,
            (user_id, role, cleaned_content),
        )
        connection.commit()


def rename_column_for_user(
    username: str,
    column_key: str,
    title: str,
    configured_path: str | None = None,
) -> dict[str, Any]:
    cleaned_title = title.strip()
    if not cleaned_title:
        raise ValidationError("Column title cannot be empty.")

    db_path = resolve_database_path(configured_path)
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        _enable_foreign_keys(connection)
        user_id, board_id, board_title = _resolve_user_board(connection, username)
        updated_rows = connection.execute(
            """
            UPDATE columns_meta
            SET title = ?, updated_at = CURRENT_TIMESTAMP
            WHERE board_id = ? AND column_key = ?
            """,
            (cleaned_title, board_id, column_key),
        ).rowcount
        if updated_rows == 0:
            raise NotFoundError("Column not found.")
        connection.commit()
        return _build_board_payload(connection, user_id=user_id, board_id=board_id, board_title=board_title)


def create_card_for_user(
    username: str,
    column_key: str,
    title: str,
    details: str,
    configured_path: str | None = None,
) -> dict[str, Any]:
    cleaned_title = title.strip()
    cleaned_details = details.strip()
    if not cleaned_title:
        raise ValidationError("Card title cannot be empty.")

    db_path = resolve_database_path(configured_path)
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        _enable_foreign_keys(connection)
        user_id, board_id, board_title = _resolve_user_board(connection, username)
        column_id = _resolve_column_id(connection, board_id, column_key)
        next_position = _next_card_position(connection, column_id)
        connection.execute(
            """
            INSERT INTO cards (board_id, column_id, title, details, position)
            VALUES (?, ?, ?, ?, ?)
            """,
            (board_id, column_id, cleaned_title, cleaned_details or "No details yet.", next_position),
        )
        connection.commit()
        return _build_board_payload(connection, user_id=user_id, board_id=board_id, board_title=board_title)


def update_card_for_user(
    username: str,
    card_id: int,
    title: str | None,
    details: str | None,
    configured_path: str | None = None,
) -> dict[str, Any]:
    if title is None and details is None:
        raise ValidationError("At least one card field must be provided.")

    db_path = resolve_database_path(configured_path)
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        _enable_foreign_keys(connection)
        user_id, board_id, board_title = _resolve_user_board(connection, username)
        card = _resolve_card(connection, board_id, card_id)

        next_title = card["title"] if title is None else title.strip()
        next_details = card["details"] if details is None else details.strip()
        if not next_title:
            raise ValidationError("Card title cannot be empty.")

        connection.execute(
            """
            UPDATE cards
            SET title = ?, details = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (next_title, next_details or "No details yet.", card_id),
        )
        connection.commit()
        return _build_board_payload(connection, user_id=user_id, board_id=board_id, board_title=board_title)


def delete_card_for_user(
    username: str,
    card_id: int,
    configured_path: str | None = None,
) -> dict[str, Any]:
    db_path = resolve_database_path(configured_path)
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        _enable_foreign_keys(connection)
        user_id, board_id, board_title = _resolve_user_board(connection, username)
        card = _resolve_card(connection, board_id, card_id)
        connection.execute("DELETE FROM cards WHERE id = ?", (card_id,))
        _close_card_gap(connection, column_id=card["column_id"], previous_position=card["position"])
        connection.commit()
        return _build_board_payload(connection, user_id=user_id, board_id=board_id, board_title=board_title)


def move_card_for_user(
    username: str,
    card_id: int,
    target_column_key: str,
    target_position: int | None,
    configured_path: str | None = None,
) -> dict[str, Any]:
    db_path = resolve_database_path(configured_path)
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        _enable_foreign_keys(connection)
        user_id, board_id, board_title = _resolve_user_board(connection, username)
        card = _resolve_card(connection, board_id, card_id)
        destination_column_id = _resolve_column_id(connection, board_id, target_column_key)

        source_column_id = card["column_id"]
        source_position = card["position"]

        if source_column_id == destination_column_id:
            destination_count = _column_card_count(connection, destination_column_id)
            destination_position = _normalize_target_position(target_position, destination_count)
            if destination_position != source_position:
                _reorder_within_column(
                    connection,
                    card_id=card_id,
                    column_id=source_column_id,
                    source_position=source_position,
                    destination_position=destination_position,
                )
        else:
            destination_count = _column_card_count(connection, destination_column_id)
            destination_position = _normalize_target_position(target_position, destination_count + 1)
            connection.execute(
                """
                UPDATE cards
                SET position = 0, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (card_id,),
            )
            _close_card_gap(connection, column_id=source_column_id, previous_position=source_position)
            _open_card_slot(connection, column_id=destination_column_id, target_position=destination_position)
            connection.execute(
                """
                UPDATE cards
                SET column_id = ?, position = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (destination_column_id, destination_position, card_id),
            )

        connection.commit()
        return _build_board_payload(connection, user_id=user_id, board_id=board_id, board_title=board_title)


def _enable_foreign_keys(connection: sqlite3.Connection) -> None:
    connection.execute("PRAGMA foreign_keys = ON;")


def _seed_default_user_and_board(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        INSERT OR IGNORE INTO users (username, password_hint)
        VALUES (?, ?)
        """,
        ("user", "password"),
    )

    user_id = connection.execute(
        "SELECT id FROM users WHERE username = ?",
        ("user",),
    ).fetchone()[0]

    connection.execute(
        """
        INSERT OR IGNORE INTO boards (user_id, title)
        VALUES (?, ?)
        """,
        (user_id, "Kanban Board"),
    )

    board_id = connection.execute(
        "SELECT id FROM boards WHERE user_id = ?",
        (user_id,),
    ).fetchone()[0]

    for column_key, title, position in DEFAULT_COLUMNS:
        connection.execute(
            """
            INSERT OR IGNORE INTO columns_meta (board_id, column_key, title, position)
            VALUES (?, ?, ?, ?)
            """,
            (board_id, column_key, title, position),
        )

    cards_count = connection.execute(
        "SELECT COUNT(*) FROM cards WHERE board_id = ?",
        (board_id,),
    ).fetchone()[0]
    if cards_count == 0:
        column_ids = {
            row[1]: row[0]
            for row in connection.execute(
                """
                SELECT id, column_key
                FROM columns_meta
                WHERE board_id = ?
                """,
                (board_id,),
            ).fetchall()
        }
        for column_key, title, details, position in DEFAULT_CARDS:
            connection.execute(
                """
                INSERT INTO cards (board_id, column_id, title, details, position)
                VALUES (?, ?, ?, ?, ?)
                """,
                (board_id, column_ids[column_key], title, details, position),
            )


def _resolve_user_id(connection: sqlite3.Connection, username: str) -> int:
    user = connection.execute(
        "SELECT id FROM users WHERE username = ?",
        (username,),
    ).fetchone()
    if user is None:
        raise NotFoundError("User not found.")
    return user["id"]


def _resolve_user_board(connection: sqlite3.Connection, username: str) -> tuple[int, int, str]:
    user_id = _resolve_user_id(connection, username)
    board = connection.execute(
        "SELECT id, title FROM boards WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    if board is None:
        raise NotFoundError("Board not found.")
    return user_id, board["id"], board["title"]


def _resolve_column_id(connection: sqlite3.Connection, board_id: int, column_key: str) -> int:
    column = connection.execute(
        """
        SELECT id
        FROM columns_meta
        WHERE board_id = ? AND column_key = ?
        """,
        (board_id, column_key),
    ).fetchone()
    if column is None:
        raise NotFoundError("Column not found.")
    return column["id"]


def _resolve_card(connection: sqlite3.Connection, board_id: int, card_id: int) -> sqlite3.Row:
    card = connection.execute(
        """
        SELECT id, column_id, title, details, position
        FROM cards
        WHERE id = ? AND board_id = ?
        """,
        (card_id, board_id),
    ).fetchone()
    if card is None:
        raise NotFoundError("Card not found.")
    return card


def _next_card_position(connection: sqlite3.Connection, column_id: int) -> int:
    current_max = connection.execute(
        "SELECT COALESCE(MAX(position), 0) FROM cards WHERE column_id = ?",
        (column_id,),
    ).fetchone()[0]
    return current_max + 1


def _column_card_count(connection: sqlite3.Connection, column_id: int) -> int:
    return connection.execute(
        "SELECT COUNT(*) FROM cards WHERE column_id = ?",
        (column_id,),
    ).fetchone()[0]


def _normalize_target_position(target_position: int | None, max_position: int) -> int:
    if target_position is None:
        return max_position
    if target_position < 1:
        raise ValidationError("Position must be at least 1.")
    if target_position > max_position:
        return max_position
    return target_position


def _close_card_gap(connection: sqlite3.Connection, column_id: int, previous_position: int) -> None:
    _shift_positions(
        connection=connection,
        column_id=column_id,
        where_clause="position > ?",
        where_args=(previous_position,),
        delta=-1,
    )


def _open_card_slot(connection: sqlite3.Connection, column_id: int, target_position: int) -> None:
    _shift_positions(
        connection=connection,
        column_id=column_id,
        where_clause="position >= ?",
        where_args=(target_position,),
        delta=1,
    )


def _reorder_within_column(
    connection: sqlite3.Connection,
    card_id: int,
    column_id: int,
    source_position: int,
    destination_position: int,
) -> None:
    connection.execute(
        """
        UPDATE cards
        SET position = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (card_id,),
    )

    if destination_position < source_position:
        _shift_positions(
            connection=connection,
            column_id=column_id,
            where_clause="position >= ? AND position < ?",
            where_args=(destination_position, source_position),
            delta=1,
        )
    else:
        _shift_positions(
            connection=connection,
            column_id=column_id,
            where_clause="position <= ? AND position > ?",
            where_args=(destination_position, source_position),
            delta=-1,
        )

    connection.execute(
        """
        UPDATE cards
        SET position = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (destination_position, card_id),
    )


def _shift_positions(
    connection: sqlite3.Connection,
    column_id: int,
    where_clause: str,
    where_args: tuple[Any, ...],
    delta: int,
) -> None:
    connection.execute(
        f"""
        UPDATE cards
        SET position = position + ?
        WHERE column_id = ? AND {where_clause}
        """,
        (POSITION_SHIFT_MARKER, column_id, *where_args),
    )
    connection.execute(
        f"""
        UPDATE cards
        SET position = position - ? + ?
        WHERE column_id = ? AND position >= ?
        """,
        (POSITION_SHIFT_MARKER, delta, column_id, POSITION_SHIFT_MARKER),
    )


def _build_board_payload(
    connection: sqlite3.Connection,
    user_id: int,
    board_id: int,
    board_title: str,
) -> dict[str, Any]:
    columns_rows = connection.execute(
        """
        SELECT id, column_key, title, position
        FROM columns_meta
        WHERE board_id = ?
        ORDER BY position ASC
        """,
        (board_id,),
    ).fetchall()
    cards_rows = connection.execute(
        """
        SELECT id, column_id, title, details, position
        FROM cards
        WHERE board_id = ?
        ORDER BY position ASC
        """,
        (board_id,),
    ).fetchall()

    cards_by_column: dict[int, list[dict[str, Any]]] = {}
    for row in cards_rows:
        cards_by_column.setdefault(row["column_id"], []).append(
            {
                "id": row["id"],
                "title": row["title"],
                "details": row["details"],
                "position": row["position"],
            }
        )

    columns_payload = []
    for column in columns_rows:
        columns_payload.append(
            {
                "key": column["column_key"],
                "title": column["title"],
                "position": column["position"],
                "cards": cards_by_column.get(column["id"], []),
            }
        )

    return {
        "boardId": board_id,
        "userId": user_id,
        "title": board_title,
        "columns": columns_payload,
    }
