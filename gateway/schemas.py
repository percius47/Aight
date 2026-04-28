from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, HttpUrl


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: str | list[dict[str, Any]]


class ChatCompletionRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    temperature: float | None = Field(default=None, ge=0)
    max_tokens: int | None = Field(default=None, gt=0)
    stream: bool = False


class RegisterOperatorRequest(BaseModel):
    operator_address: str
    tunnel_url: HttpUrl
    model: str = "llama3"
    hourly_rate_wei: int = Field(gt=0)
    latency_ms: int = Field(default=0, ge=0)
    tokens_per_second: float = Field(default=0, ge=0)


class OperatorHeartbeatRequest(BaseModel):
    latency_ms: int = Field(default=0, ge=0)
    tokens_per_second: float = Field(default=0, ge=0)
    active: bool = True


class OperatorStatus(BaseModel):
    operator_address: str
    tunnel_url: str
    model: str
    hourly_rate_wei: int
    latency_ms: int
    tokens_per_second: float
    active: bool


class IssueApiKeyRequest(BaseModel):
    escrow_id: int = Field(gt=0)
    user_address: str
    operator_address: str
    duration_hours: int = Field(gt=0)


class IssueApiKeyResponse(BaseModel):
    api_key: str
    escrow_id: int
    operator_address: str


class TelemetryEvent(BaseModel):
    event: Literal["token", "completion", "error"]
    api_key_id: str
    operator_address: str
    escrow_id: int
    token: str | None = None
    tokens: int = 0
