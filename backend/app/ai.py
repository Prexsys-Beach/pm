from __future__ import annotations

import json
from typing import Any

import httpx

OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODEL = "openai/gpt-oss-120b"
SMOKE_PROMPT = "What is 2+2? Respond with only the number."
STRUCTURED_CHAT_SYSTEM_PROMPT = (
    "You are an assistant helping manage a kanban board. "
    "You will receive a JSON object containing the current board, recent chat history, and a new user prompt. "
    "Respond with JSON only and no markdown. "
    'Required response shape: {"assistantMessage":"string","proposedUpdates":[...]} where proposedUpdates is optional. '
    "If proposedUpdates is present, each entry must be one of: "
    '{"action":"rename_column","columnKey":"col-...","title":"..."}, '
    '{"action":"create_card","columnKey":"col-...","title":"...","details":"..."}, '
    '{"action":"update_card","cardId":123,"title":"...","details":"..."}, '
    '{"action":"delete_card","cardId":123}, '
    '{"action":"move_card","cardId":123,"targetColumnKey":"col-...","targetPosition":1}. '
    "Use only card IDs and column keys from the provided board. "
    "If no board change is needed, return an empty proposedUpdates array."
)
SUPPORTED_UPDATE_ACTIONS = {
    "rename_column",
    "create_card",
    "update_card",
    "delete_card",
    "move_card",
}


class AIConfigError(Exception):
    pass


class AIRequestError(Exception):
    pass


def run_openrouter_board_chat(
    api_key: str | None,
    *,
    board: dict[str, Any],
    user_prompt: str,
    chat_history: list[dict[str, str]],
    transport: httpx.BaseTransport | None = None,
) -> dict[str, Any]:
    if not api_key:
        raise AIConfigError("OPENROUTER_API_KEY is not configured.")

    cleaned_prompt = user_prompt.strip()
    if not cleaned_prompt:
        raise AIRequestError("Prompt cannot be empty.")

    payload = {
        "model": OPENROUTER_MODEL,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": STRUCTURED_CHAT_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "board": board,
                        "chatHistory": chat_history,
                        "prompt": cleaned_prompt,
                    }
                ),
            },
        ],
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    response_body = _execute_openrouter_request(payload=payload, headers=headers, transport=transport)
    assistant_content = _extract_first_message_content(response_body).strip()
    if not assistant_content:
        raise AIRequestError("OpenRouter response did not include an assistant message.")

    return _parse_and_validate_structured_chat_response(assistant_content, board)


def run_openrouter_smoke_test(
    api_key: str | None,
    *,
    transport: httpx.BaseTransport | None = None,
) -> dict[str, str]:
    if not api_key:
        raise AIConfigError("OPENROUTER_API_KEY is not configured.")

    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [{"role": "user", "content": SMOKE_PROMPT}],
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    body = _execute_openrouter_request(payload=payload, headers=headers, transport=transport)
    answer = _extract_first_message_content(body)
    if not answer:
        raise AIRequestError("OpenRouter response did not include an assistant message.")

    return {
        "model": OPENROUTER_MODEL,
        "prompt": SMOKE_PROMPT,
        "response": answer.strip(),
    }


def _execute_openrouter_request(
    *,
    payload: dict[str, Any],
    headers: dict[str, str],
    transport: httpx.BaseTransport | None,
) -> dict[str, Any]:
    try:
        with httpx.Client(timeout=20.0, transport=transport) as client:
            response = client.post(
                OPENROUTER_CHAT_COMPLETIONS_URL,
                json=payload,
                headers=headers,
            )
    except httpx.TimeoutException as error:
        raise AIRequestError("OpenRouter request timed out.") from error
    except httpx.HTTPError as error:
        raise AIRequestError("OpenRouter request failed before receiving a response.") from error

    if response.status_code != 200:
        raise AIRequestError(f"OpenRouter returned status {response.status_code}.")

    try:
        body = response.json()
    except ValueError as error:
        raise AIRequestError("OpenRouter returned invalid JSON.") from error

    if not isinstance(body, dict):
        raise AIRequestError("OpenRouter returned an unexpected response shape.")
    return body


def _extract_first_message_content(body: dict[str, Any]) -> str:
    choices = body.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""

    message = choices[0].get("message")
    if not isinstance(message, dict):
        return ""

    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(parts)
    return ""


def _parse_and_validate_structured_chat_response(
    assistant_content: str,
    board: dict[str, Any],
) -> dict[str, Any]:
    structured_text = _unwrap_code_fence_if_present(assistant_content)
    try:
        parsed = json.loads(structured_text)
    except json.JSONDecodeError as error:
        raise AIRequestError("OpenRouter returned invalid structured JSON.") from error

    if not isinstance(parsed, dict):
        raise AIRequestError("Structured response must be a JSON object.")

    assistant_message = parsed.get("assistantMessage")
    if not isinstance(assistant_message, str) or not assistant_message.strip():
        raise AIRequestError("Structured response requires a non-empty assistantMessage.")

    raw_updates = parsed.get("proposedUpdates", [])
    if raw_updates is None:
        raw_updates = []
    if not isinstance(raw_updates, list):
        raise AIRequestError("proposedUpdates must be an array when provided.")

    valid_column_keys, valid_card_ids = _collect_board_constraints(board)
    validated_updates = [
        _validate_update_instruction(item, valid_column_keys=valid_column_keys, valid_card_ids=valid_card_ids)
        for item in raw_updates
    ]

    return {
        "assistantMessage": assistant_message.strip(),
        "proposedUpdates": validated_updates,
    }


def _unwrap_code_fence_if_present(content: str) -> str:
    text = content.strip()
    if not text.startswith("```"):
        return text

    lines = text.splitlines()
    if len(lines) < 3:
        return text

    if lines[-1].strip() != "```":
        return text
    return "\n".join(lines[1:-1]).strip()


def _collect_board_constraints(board: dict[str, Any]) -> tuple[set[str], set[int]]:
    columns = board.get("columns")
    if not isinstance(columns, list):
        raise AIRequestError("Board payload is missing columns.")

    column_keys: set[str] = set()
    card_ids: set[int] = set()
    for column in columns:
        if not isinstance(column, dict):
            continue
        column_key = column.get("key")
        if isinstance(column_key, str):
            column_keys.add(column_key)
        cards = column.get("cards")
        if not isinstance(cards, list):
            continue
        for card in cards:
            if not isinstance(card, dict):
                continue
            card_id = card.get("id")
            if isinstance(card_id, int):
                card_ids.add(card_id)
    return column_keys, card_ids


def _validate_update_instruction(
    instruction: Any,
    *,
    valid_column_keys: set[str],
    valid_card_ids: set[int],
) -> dict[str, Any]:
    if not isinstance(instruction, dict):
        raise AIRequestError("Each proposed update must be an object.")

    action = instruction.get("action")
    if action not in SUPPORTED_UPDATE_ACTIONS:
        raise AIRequestError("Each proposed update must use a supported action.")

    if action == "rename_column":
        column_key = _require_column_key(instruction, "columnKey", valid_column_keys)
        title = _require_non_empty_string(instruction, "title")
        return {"action": action, "columnKey": column_key, "title": title}

    if action == "create_card":
        column_key = _require_column_key(instruction, "columnKey", valid_column_keys)
        title = _require_non_empty_string(instruction, "title")
        details = instruction.get("details", "")
        if not isinstance(details, str):
            raise AIRequestError("create_card.details must be a string when provided.")
        return {
            "action": action,
            "columnKey": column_key,
            "title": title,
            "details": details.strip(),
        }

    if action == "update_card":
        card_id = _require_card_id(instruction, valid_card_ids)
        has_title = "title" in instruction
        has_details = "details" in instruction
        if not has_title and not has_details:
            raise AIRequestError("update_card requires at least one of title or details.")
        payload: dict[str, Any] = {"action": action, "cardId": card_id}
        if has_title:
            payload["title"] = _require_non_empty_string(instruction, "title")
        if has_details:
            details = instruction.get("details")
            if not isinstance(details, str):
                raise AIRequestError("update_card.details must be a string when provided.")
            payload["details"] = details.strip()
        return payload

    if action == "delete_card":
        card_id = _require_card_id(instruction, valid_card_ids)
        return {"action": action, "cardId": card_id}

    card_id = _require_card_id(instruction, valid_card_ids)
    target_column_key = _require_column_key(instruction, "targetColumnKey", valid_column_keys)
    target_position = instruction.get("targetPosition")
    if target_position is not None and (not isinstance(target_position, int) or target_position < 1):
        raise AIRequestError("move_card.targetPosition must be an integer greater than or equal to 1.")
    return {
        "action": action,
        "cardId": card_id,
        "targetColumnKey": target_column_key,
        "targetPosition": target_position,
    }


def _require_non_empty_string(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise AIRequestError(f"{key} must be a non-empty string.")
    return value.strip()


def _require_column_key(payload: dict[str, Any], key: str, valid_column_keys: set[str]) -> str:
    column_key = payload.get(key)
    if not isinstance(column_key, str) or column_key not in valid_column_keys:
        raise AIRequestError(f"{key} must reference an existing column key.")
    return column_key


def _require_card_id(payload: dict[str, Any], valid_card_ids: set[int]) -> int:
    card_id = payload.get("cardId")
    if not isinstance(card_id, int) or card_id not in valid_card_ids:
        raise AIRequestError("cardId must reference an existing card.")
    return card_id
