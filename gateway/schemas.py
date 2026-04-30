from __future__ import annotations

from datetime import datetime
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


AccountRole = Literal["operator", "buyer"]
RigStatus = Literal["installing", "idle", "busy", "halted", "offline", "error"]


class AccountRequest(BaseModel):
    username: str = Field(min_length=3, max_length=40)
    password: str = Field(min_length=6, max_length=120)
    role: AccountRole
    wallet_address: str | None = None


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=40)
    password: str = Field(min_length=6, max_length=120)


class AccountResponse(BaseModel):
    username: str
    role: AccountRole
    wallet_address: str | None


class AuthSessionResponse(BaseModel):
    token: str
    account: AccountResponse


class CreatePairingCodeRequest(BaseModel):
    operator_address: str
    rig_name: str = Field(default="Aight Rig", min_length=1, max_length=80)
    model: str = "gemma3:1b"
    hourly_rate_wei: int = Field(default=1000, gt=0)
    ttl_minutes: int = Field(default=10, ge=1, le=60)


class CreatePairingCodeResponse(BaseModel):
    pairing_code: str
    operator_address: str
    rig_name: str
    model: str
    hourly_rate_wei: int
    expires_at: datetime


class ClaimRigRequest(BaseModel):
    pairing_code: str
    rig_name: str = Field(default="Aight Rig", min_length=1, max_length=80)
    model: str
    tunnel_url: str | None = None
    hourly_rate_wei: int = Field(gt=0)
    device_fingerprint: str = Field(min_length=12, max_length=128)
    hardware_summary: dict[str, Any] = Field(default_factory=dict)
    limits: dict[str, Any] = Field(default_factory=dict)


class ClaimRigResponse(BaseModel):
    rig_id: str
    rig_identity: str
    ens_name: str
    rig_token: str
    operator_address: str


class RigHeartbeatRequest(BaseModel):
    status: RigStatus = "idle"
    latency_ms: int = Field(default=0, ge=0)
    tokens_per_second: float = Field(default=0, ge=0)
    current_load: float = Field(default=0, ge=0, le=1)
    model: str | None = None
    tunnel_url: str | None = None
    hardware_summary: dict[str, Any] = Field(default_factory=dict)
    limits: dict[str, Any] = Field(default_factory=dict)
    error_message: str | None = None


class RigStatusResponse(BaseModel):
    rig_id: str
    rig_identity: str
    ens_name: str
    operator_address: str
    rig_name: str
    status: RigStatus
    model: str
    tunnel_url: str | None
    hourly_rate_wei: int
    latency_ms: int
    tokens_per_second: float
    current_load: float
    hardware_summary: dict[str, Any]
    limits: dict[str, Any]
    assignment: dict[str, Any] | None
    expected_earnings_wei: int
    device_fingerprint: str
    error_message: str | None
    created_at: datetime
    last_heartbeat_at: datetime
    halted_at: datetime | None


class HaltRigRequest(BaseModel):
    operator_address: str


class DeleteRigRequest(BaseModel):
    operator_address: str


class IssueApiKeyRequest(BaseModel):
    escrow_id: int = Field(gt=0)
    user_address: str
    operator_address: str
    rig_id: str | None = None
    duration_hours: int = Field(gt=0)


class IssueApiKeyResponse(BaseModel):
    api_key: str
    escrow_id: int
    operator_address: str


class BuyerRentalResponse(BaseModel):
    rental_id: str
    buyer_username: str | None
    buyer_address: str
    api_key: str
    escrow_id: int
    operator_address: str
    rig_id: str | None
    rig_identity: str
    rig_name: str
    model: str
    duration_hours: int
    amount_wei: int
    status: Literal["allocated", "terminated", "expired"]
    created_at: datetime
    expires_at: datetime
    terminated_at: datetime | None
    termination_reason: str | None
    used_hours: int
    refund_wei: int
    operator_payout_wei: int
    slash_wei: int


class DemoEscrowRequest(BaseModel):
    buyer_address: str
    operator_address: str
    rig_id: str | None = None
    duration_hours: int = Field(default=1, gt=0)


class DemoEscrowResponse(BaseModel):
    escrow_id: int
    buyer_address: str
    operator_address: str
    rig_id: str | None
    rig_identity: str | None
    duration_hours: int
    amount_wei: int


class TelemetryEvent(BaseModel):
    event: Literal["token", "completion", "error"]
    api_key_id: str
    operator_address: str
    escrow_id: int
    token: str | None = None
    tokens: int = 0
