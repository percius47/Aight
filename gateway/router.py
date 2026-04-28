from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.responses import StreamingResponse
from litellm import acompletion

from schemas import (
    ChatCompletionRequest,
    IssueApiKeyRequest,
    IssueApiKeyResponse,
    OperatorStatus,
    RegisterOperatorRequest,
    TelemetryEvent,
)
from state import ApiKeyRecord, gateway_state
from telemetry import encode_sse, telemetry_hub

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/admin/operators", response_model=OperatorStatus)
async def register_operator(payload: RegisterOperatorRequest) -> OperatorStatus:
    return gateway_state.register_operator(payload)


@router.get("/operators", response_model=list[OperatorStatus])
async def list_operators() -> list[OperatorStatus]:
    return gateway_state.list_operators()


@router.post("/admin/api-keys", response_model=IssueApiKeyResponse)
async def issue_api_key(payload: IssueApiKeyRequest) -> IssueApiKeyResponse:
    try:
        record = gateway_state.issue_api_key(payload)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return IssueApiKeyResponse(
        api_key=record.secret,
        escrow_id=record.escrow_id,
        operator_address=record.operator_address,
    )


@router.post("/v1/chat/completions")
async def chat_completions(
    payload: ChatCompletionRequest,
    authorization: Annotated[str | None, Header()] = None,
    x_aight_api_key: Annotated[str | None, Header(alias="x-aight-api-key")] = None,
) -> Any:
    api_key = extract_api_key(authorization, x_aight_api_key)
    key_record = validate_key_or_401(api_key)
    operator = gateway_state.get_operator(key_record.operator_address)

    messages = [message.model_dump() for message in payload.messages]
    requested_model = payload.model or operator.model
    model = requested_model if "/" in requested_model else f"ollama/{requested_model}"
    completion_args: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "api_base": operator.tunnel_url,
        "api_key": "aight-local",
        "temperature": payload.temperature,
        "max_tokens": payload.max_tokens,
        "stream": payload.stream,
    }
    completion_args = {key: value for key, value in completion_args.items() if value is not None}

    if payload.stream:
        events = stream_litellm_completion(completion_args, key_record)
        return StreamingResponse(encode_sse(events), media_type="text/event-stream")

    response = await acompletion(**completion_args)
    await telemetry_hub.publish(
        TelemetryEvent(
            event="completion",
            api_key_id=key_record.key_id,
            operator_address=key_record.operator_address,
            escrow_id=key_record.escrow_id,
        )
    )
    return response.model_dump() if hasattr(response, "model_dump") else response


@router.websocket("/ws/telemetry")
async def telemetry_socket(websocket: WebSocket) -> None:
    await telemetry_hub.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await telemetry_hub.disconnect(websocket)


def extract_api_key(authorization: str | None, x_aight_api_key: str | None) -> str:
    if x_aight_api_key:
        return x_aight_api_key
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing AIGHT_API_KEY")


def validate_key_or_401(api_key: str) -> ApiKeyRecord:
    try:
        return gateway_state.validate_api_key(api_key)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


async def stream_litellm_completion(completion_args: dict[str, Any], key_record: ApiKeyRecord) -> AsyncIterator[dict[str, Any]]:
    token_count = 0
    try:
        response_stream = await acompletion(**completion_args)
        async for chunk in response_stream:
            token = extract_delta_token(chunk)
            if token:
                token_count += 1
                await telemetry_hub.publish(
                    TelemetryEvent(
                        event="token",
                        api_key_id=key_record.key_id,
                        operator_address=key_record.operator_address,
                        escrow_id=key_record.escrow_id,
                        token=token,
                        tokens=token_count,
                    )
                )
            yield chunk.model_dump() if hasattr(chunk, "model_dump") else chunk
    except Exception as exc:
        await telemetry_hub.publish(
            TelemetryEvent(
                event="error",
                api_key_id=key_record.key_id,
                operator_address=key_record.operator_address,
                escrow_id=key_record.escrow_id,
            )
        )
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


def extract_delta_token(chunk: Any) -> str | None:
    if hasattr(chunk, "choices") and chunk.choices:
        delta = getattr(chunk.choices[0], "delta", None)
        content = getattr(delta, "content", None)
        if isinstance(content, str):
            return content
    if isinstance(chunk, dict):
        choices = chunk.get("choices", [])
        if choices:
            delta = choices[0].get("delta", {})
            content = delta.get("content")
            if isinstance(content, str):
                return content
    return None
