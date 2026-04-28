from __future__ import annotations

import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from schemas import ChatCompletionRequest
from telemetry import encode_sse

dummy_router = APIRouter(prefix="/dummy", tags=["dummy-operator"])


@dummy_router.post("/v1/chat/completions")
async def dummy_chat_completions(payload: ChatCompletionRequest) -> Any:
    content = "Aight dummy operator is online."
    if payload.messages:
        latest_message = payload.messages[-1]
        if isinstance(latest_message.content, str):
            content = f"Aight dummy operator received: {latest_message.content}"

    response_id = f"chatcmpl-{uuid.uuid4().hex}"
    if payload.stream:
        return StreamingResponse(
            encode_sse(dummy_stream(response_id, payload.model, content)),
            media_type="text/event-stream",
        )

    return {
        "id": response_id,
        "object": "chat.completion",
        "created": int(time.time()),
        "model": payload.model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": sum(len(str(message.content).split()) for message in payload.messages),
            "completion_tokens": len(content.split()),
            "total_tokens": sum(len(str(message.content).split()) for message in payload.messages) + len(content.split()),
        },
    }


async def dummy_stream(response_id: str, model: str, content: str) -> AsyncIterator[dict[str, Any]]:
    for token in content.split():
        yield {
            "id": response_id,
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "delta": {"content": f"{token} "},
                    "finish_reason": None,
                }
            ],
        }

    yield {
        "id": response_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "delta": {},
                "finish_reason": "stop",
            }
        ],
    }
