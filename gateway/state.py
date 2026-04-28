from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from schemas import IssueApiKeyRequest, OperatorStatus, RegisterOperatorRequest


@dataclass(slots=True)
class OperatorRecord:
    operator_address: str
    tunnel_url: str
    model: str
    hourly_rate_wei: int
    latency_ms: int
    tokens_per_second: float
    active: bool = True


@dataclass(slots=True)
class ApiKeyRecord:
    key_id: str
    secret: str
    escrow_id: int
    user_address: str
    operator_address: str
    expires_at: datetime
    active: bool = True


class GatewayState:
    def __init__(self) -> None:
        self._operators: dict[str, OperatorRecord] = {}
        self._api_keys: dict[str, ApiKeyRecord] = {}

    def register_operator(self, payload: RegisterOperatorRequest) -> OperatorStatus:
        normalized_address = payload.operator_address.lower()
        record = OperatorRecord(
            operator_address=normalized_address,
            tunnel_url=str(payload.tunnel_url).rstrip("/"),
            model=payload.model,
            hourly_rate_wei=payload.hourly_rate_wei,
            latency_ms=payload.latency_ms,
            tokens_per_second=payload.tokens_per_second,
        )
        self._operators[normalized_address] = record
        return self.to_status(record)

    def list_operators(self) -> list[OperatorStatus]:
        return [self.to_status(record) for record in self._operators.values() if record.active]

    def issue_api_key(self, payload: IssueApiKeyRequest) -> ApiKeyRecord:
        normalized_operator = payload.operator_address.lower()
        if normalized_operator not in self._operators:
            raise KeyError("operator not registered")

        secret = f"aight_{secrets.token_urlsafe(32)}"
        record = ApiKeyRecord(
            key_id=secrets.token_hex(8),
            secret=secret,
            escrow_id=payload.escrow_id,
            user_address=payload.user_address.lower(),
            operator_address=normalized_operator,
            expires_at=datetime.now(UTC) + timedelta(hours=payload.duration_hours),
        )
        self._api_keys[secret] = record
        return record

    def validate_api_key(self, secret: str) -> ApiKeyRecord:
        record = self._api_keys.get(secret)
        if record is None or not record.active or record.expires_at <= datetime.now(UTC):
            raise PermissionError("invalid or expired AIGHT_API_KEY")
        return record

    def get_operator(self, operator_address: str) -> OperatorRecord:
        record = self._operators.get(operator_address.lower())
        if record is None or not record.active:
            raise KeyError("operator not registered")
        return record

    @staticmethod
    def to_status(record: OperatorRecord) -> OperatorStatus:
        return OperatorStatus(
            operator_address=record.operator_address,
            tunnel_url=record.tunnel_url,
            model=record.model,
            hourly_rate_wei=record.hourly_rate_wei,
            latency_ms=record.latency_ms,
            tokens_per_second=record.tokens_per_second,
            active=record.active,
        )


gateway_state = GatewayState()
