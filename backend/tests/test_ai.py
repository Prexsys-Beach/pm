import json

import httpx
import pytest

from app.ai import AIConfigError, AIRequestError, run_openrouter_board_chat, run_openrouter_smoke_test


def _sample_board() -> dict:
    return {
        "boardId": 1,
        "userId": 1,
        "title": "Kanban Board",
        "columns": [
            {
                "key": "col-backlog",
                "title": "Backlog",
                "position": 1,
                "cards": [{"id": 101, "title": "A", "details": "a", "position": 1}],
            },
            {
                "key": "col-done",
                "title": "Done",
                "position": 2,
                "cards": [{"id": 202, "title": "B", "details": "b", "position": 1}],
            },
        ],
    }


def test_run_openrouter_smoke_test_rejects_missing_key() -> None:
    with pytest.raises(AIConfigError, match="OPENROUTER_API_KEY is not configured."):
        run_openrouter_smoke_test(None)


def test_run_openrouter_smoke_test_parses_success_response() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer test-key"
        payload = request.read().decode("utf-8")
        assert "2+2" in payload
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": "4",
                        }
                    }
                ]
            },
        )

    transport = httpx.MockTransport(handler)
    result = run_openrouter_smoke_test("test-key", transport=transport)

    assert result["response"] == "4"
    assert result["model"] == "openai/gpt-oss-120b"


def test_run_openrouter_smoke_test_handles_non_200() -> None:
    transport = httpx.MockTransport(lambda _req: httpx.Response(429, text="rate limit"))

    with pytest.raises(AIRequestError, match="OpenRouter returned status 429."):
        run_openrouter_smoke_test("test-key", transport=transport)


def test_run_openrouter_smoke_test_handles_invalid_payload() -> None:
    transport = httpx.MockTransport(lambda _req: httpx.Response(200, json={"choices": []}))

    with pytest.raises(AIRequestError, match="did not include an assistant message"):
        run_openrouter_smoke_test("test-key", transport=transport)


def test_run_openrouter_smoke_test_handles_timeout() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("timed out", request=request)

    transport = httpx.MockTransport(handler)
    with pytest.raises(AIRequestError, match="timed out"):
        run_openrouter_smoke_test("test-key", transport=transport)


def test_run_openrouter_board_chat_sends_board_prompt_and_history() -> None:
    board = _sample_board()
    history = [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "hi"},
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.read().decode("utf-8"))
        user_message = payload["messages"][1]["content"]
        context = json.loads(user_message)
        assert context["board"]["boardId"] == 1
        assert context["chatHistory"] == history
        assert context["prompt"] == "Move work forward"
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": (
                                '{"assistantMessage":"Great idea.","proposedUpdates":'
                                '[{"action":"move_card","cardId":101,"targetColumnKey":"col-done","targetPosition":1}]}'
                            )
                        }
                    }
                ]
            },
        )

    result = run_openrouter_board_chat(
        "test-key",
        board=board,
        user_prompt="Move work forward",
        chat_history=history,
        transport=httpx.MockTransport(handler),
    )
    assert result == {
        "assistantMessage": "Great idea.",
        "proposedUpdates": [
            {
                "action": "move_card",
                "cardId": 101,
                "targetColumnKey": "col-done",
                "targetPosition": 1,
            }
        ],
    }


@pytest.mark.parametrize(
    "payload",
    [
        '{"assistantMessage":"ok","proposedUpdates":[{"action":"rename_column","columnKey":"col-backlog","title":"Ideas"}]}',
        '{"assistantMessage":"ok","proposedUpdates":[{"action":"create_card","columnKey":"col-backlog","title":"New task","details":"desc"}]}',
        '{"assistantMessage":"ok","proposedUpdates":[{"action":"update_card","cardId":101,"title":"Updated title","details":"Updated details"}]}',
        '{"assistantMessage":"ok","proposedUpdates":[{"action":"delete_card","cardId":101}]}',
        '{"assistantMessage":"ok","proposedUpdates":[{"action":"move_card","cardId":101,"targetColumnKey":"col-done","targetPosition":1}]}',
    ],
)
def test_run_openrouter_board_chat_accepts_supported_update_actions(payload: str) -> None:
    transport = httpx.MockTransport(
        lambda _req: httpx.Response(200, json={"choices": [{"message": {"content": payload}}]})
    )

    result = run_openrouter_board_chat(
        "test-key",
        board=_sample_board(),
        user_prompt="Please propose changes.",
        chat_history=[],
        transport=transport,
    )
    assert result["assistantMessage"] == "ok"
    assert len(result["proposedUpdates"]) == 1


@pytest.mark.parametrize(
    ("payload", "expected_error"),
    [
        ("not json", "invalid structured JSON"),
        ('{"proposedUpdates":[]}', "requires a non-empty assistantMessage"),
        ('{"assistantMessage":"ok","proposedUpdates":"bad"}', "must be an array"),
        (
            '{"assistantMessage":"ok","proposedUpdates":[{"action":"create_card","columnKey":"missing","title":"x"}]}',
            "must reference an existing column key",
        ),
        (
            '{"assistantMessage":"ok","proposedUpdates":[{"action":"delete_card","cardId":999}]}',
            "must reference an existing card",
        ),
        (
            '{"assistantMessage":"ok","proposedUpdates":[{"action":"update_card","cardId":101}]}',
            "requires at least one of title or details",
        ),
    ],
)
def test_run_openrouter_board_chat_rejects_invalid_structured_output(
    payload: str,
    expected_error: str,
) -> None:
    transport = httpx.MockTransport(
        lambda _req: httpx.Response(200, json={"choices": [{"message": {"content": payload}}]})
    )

    with pytest.raises(AIRequestError, match=expected_error):
        run_openrouter_board_chat(
            "test-key",
            board=_sample_board(),
            user_prompt="Propose updates",
            chat_history=[],
            transport=transport,
        )
