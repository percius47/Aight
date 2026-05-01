from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.responses import StreamingResponse
from litellm import acompletion

from .contract_client import registry_client
from .schemas import (
    AccountRequest,
    AccountResponse,
    AuthSessionResponse,
    BuyerRentalResponse,
    ChatCompletionRequest,
    ClaimRigRequest,
    ClaimRigResponse,
    CreatePairingCodeRequest,
    CreatePairingCodeResponse,
    DemoEscrowRequest,
    DemoEscrowResponse,
    DeleteRigRequest,
    HaltRigRequest,
    IssueApiKeyRequest,
    IssueApiKeyResponse,
    LoginRequest,
    OperatorHeartbeatRequest,
    OperatorStatus,
    RegisterOperatorRequest,
    RigHeartbeatRequest,
    RigStatusResponse,
    TelemetryEvent,
)
from .state import ApiKeyRecord, gateway_state
from .telemetry import encode_sse, telemetry_hub

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/auth/signup", response_model=AuthSessionResponse)
async def signup(payload: AccountRequest) -> AuthSessionResponse:
    try:
        return gateway_state.create_account(payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/auth/login", response_model=AuthSessionResponse)
async def login(payload: LoginRequest) -> AuthSessionResponse:
    try:
        return gateway_state.login(payload)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


@router.get("/auth/me", response_model=AccountResponse)
async def current_account(authorization: Annotated[str | None, Header()] = None) -> AccountResponse:
    token = extract_bearer_token(authorization)
    try:
        return gateway_state.get_account_for_token(token)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


@router.post("/auth/logout")
async def logout(authorization: Annotated[str | None, Header()] = None) -> dict[str, str]:
    token = extract_bearer_token(authorization)
    gateway_state.logout(token)
    return {"status": "ok"}


@router.post("/admin/operators", response_model=OperatorStatus)
async def register_operator(payload: RegisterOperatorRequest) -> OperatorStatus:
    return gateway_state.register_operator(payload)


@router.get("/operators", response_model=list[OperatorStatus])
async def list_operators() -> list[OperatorStatus]:
    return gateway_state.list_operators()


@router.post("/operator/pairing-codes", response_model=CreatePairingCodeResponse)
async def create_pairing_code(payload: CreatePairingCodeRequest) -> CreatePairingCodeResponse:
    return gateway_state.create_pairing_code(payload)


@router.post("/operator/rigs/claim", response_model=ClaimRigResponse)
async def claim_rig(payload: ClaimRigRequest) -> ClaimRigResponse:
    try:
        return gateway_state.claim_rig(payload)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


@router.get("/operator/rigs", response_model=list[RigStatusResponse])
async def list_operator_rigs(operator_address: str | None = None) -> list[RigStatusResponse]:
    return gateway_state.list_rigs(operator_address)


@router.post("/operator/rigs/{rig_id}/halt", response_model=RigStatusResponse)
async def halt_operator_rig(rig_id: str, payload: HaltRigRequest) -> RigStatusResponse:
    try:
        return gateway_state.halt_rig(rig_id, payload)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


@router.delete("/operator/rigs/{rig_id}")
async def delete_operator_rig(rig_id: str, payload: DeleteRigRequest) -> dict[str, str]:
    try:
        gateway_state.delete_rig(rig_id, payload)
        return {"status": "deleted"}
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/operator/rigs/{rig_id}/heartbeat", response_model=RigStatusResponse)
async def record_rig_heartbeat(
    rig_id: str,
    payload: RigHeartbeatRequest,
    x_aight_rig_token: Annotated[str | None, Header(alias="x-aight-rig-token")] = None,
) -> RigStatusResponse:
    if not x_aight_rig_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing rig token")
    try:
        return gateway_state.record_rig_heartbeat(rig_id, x_aight_rig_token, payload)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


@router.post("/admin/operators/{operator_address}/heartbeat", response_model=OperatorStatus)
async def record_operator_heartbeat(operator_address: str, payload: OperatorHeartbeatRequest) -> OperatorStatus:
    try:
        return gateway_state.record_heartbeat(operator_address, payload)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/admin/api-keys", response_model=IssueApiKeyResponse)
async def issue_api_key(
    payload: IssueApiKeyRequest,
    authorization: Annotated[str | None, Header()] = None,
) -> IssueApiKeyResponse:
    buyer_username = None
    if authorization:
        token = extract_bearer_token(authorization)
        try:
            buyer_username = gateway_state.get_account_for_token(token).username
        except PermissionError as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    try:
        record = gateway_state.issue_api_key(payload, buyer_username=buyer_username)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return IssueApiKeyResponse(
        api_key=record.secret,
        escrow_id=record.escrow_id,
        operator_address=record.operator_address,
    )


@router.get("/buyer/rentals", response_model=list[BuyerRentalResponse])
async def list_buyer_rentals(
    buyer_address: str | None = None,
    authorization: Annotated[str | None, Header()] = None,
) -> list[BuyerRentalResponse]:
    buyer_username = None
    if authorization:
        token = extract_bearer_token(authorization)
        try:
            buyer_username = gateway_state.get_account_for_token(token).username
        except PermissionError as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    if buyer_username is None and buyer_address is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing buyer session or address")
    return gateway_state.list_buyer_rentals(buyer_username=buyer_username, buyer_address=buyer_address)


@router.delete("/buyer/rentals/{rental_id}")
async def delete_buyer_rental(
    rental_id: str,
    buyer_address: str | None = None,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, str]:
    buyer_username = None
    if authorization:
        token = extract_bearer_token(authorization)
        try:
            buyer_username = gateway_state.get_account_for_token(token).username
        except PermissionError as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    if buyer_username is None and buyer_address is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing buyer session or address")
    try:
        gateway_state.delete_buyer_rental(
            rental_id,
            buyer_username=buyer_username,
            buyer_address=buyer_address,
        )
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return {"status": "deleted"}


@router.post("/buyer/demo-escrows", response_model=DemoEscrowResponse)
async def create_demo_escrow(payload: DemoEscrowRequest) -> DemoEscrowResponse:
    try:
        return gateway_state.create_demo_escrow(payload)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


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


def extract_bearer_token(authorization: str | None) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing account session")


def validate_key_or_401(api_key: str) -> ApiKeyRecord:
    try:
        record = gateway_state.validate_api_key(api_key)
        registry_client.validate_api_key_record(record)
        return record
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"invalid registry configuration: {exc}") from exc


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
