from __future__ import annotations

import secrets
import hashlib
import json
from dataclasses import asdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from .schemas import (
    AccountRequest,
    AccountResponse,
    AuthSessionResponse,
    ClaimRigRequest,
    ClaimRigResponse,
    CreatePairingCodeRequest,
    CreatePairingCodeResponse,
    DemoEscrowRequest,
    DemoEscrowResponse,
    IssueApiKeyRequest,
    LoginRequest,
    OperatorHeartbeatRequest,
    OperatorStatus,
    RegisterOperatorRequest,
    RigHeartbeatRequest,
    RigStatus,
    RigStatusResponse,
)


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


@dataclass(slots=True)
class AccountRecord:
    username: str
    password_hash: str
    role: str
    wallet_address: str | None
    created_at: datetime


@dataclass(slots=True)
class SessionRecord:
    token: str
    username: str
    expires_at: datetime


@dataclass(slots=True)
class PairingSession:
    pairing_code: str
    operator_address: str
    rig_name: str
    expires_at: datetime
    claimed: bool = False


@dataclass(slots=True)
class RigRecord:
    rig_id: str
    rig_token: str
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
    error_message: str | None
    created_at: datetime
    last_heartbeat_at: datetime


class GatewayState:
    def __init__(self) -> None:
        self._operators: dict[str, OperatorRecord] = {}
        self._api_keys: dict[str, ApiKeyRecord] = {}
        self._pairing_sessions: dict[str, PairingSession] = {}
        self._rigs: dict[str, RigRecord] = {}
        self._accounts: dict[str, AccountRecord] = {}
        self._sessions: dict[str, SessionRecord] = {}
        self._next_demo_escrow_id = 1
        self._state_path = Path(__file__).resolve().parent / ".data" / "gateway-state.json"
        self._load()

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
        self._persist()
        return self.to_status(record)

    def list_operators(self) -> list[OperatorStatus]:
        return [self.to_status(record) for record in self._operators.values() if record.active]

    def record_heartbeat(self, operator_address: str, payload: OperatorHeartbeatRequest) -> OperatorStatus:
        record = self.get_operator(operator_address)
        record.latency_ms = payload.latency_ms
        record.tokens_per_second = payload.tokens_per_second
        record.active = payload.active
        self._persist()
        return self.to_status(record)

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
        self._persist()
        return record

    def create_account(self, payload: AccountRequest) -> AuthSessionResponse:
        username = payload.username.strip().lower()
        if username in self._accounts:
            raise ValueError("account already exists")

        account = AccountRecord(
            username=username,
            password_hash=self._hash_password(payload.password),
            role=payload.role,
            wallet_address=payload.wallet_address.lower() if payload.wallet_address else None,
            created_at=datetime.now(UTC),
        )
        self._accounts[username] = account
        session = self._create_session(username)
        self._persist()
        return AuthSessionResponse(token=session.token, account=self.to_account_response(account))

    def login(self, payload: LoginRequest) -> AuthSessionResponse:
        username = payload.username.strip().lower()
        account = self._accounts.get(username)
        if account is None or not self._verify_password(payload.password, account.password_hash):
            raise PermissionError("invalid username or password")

        session = self._create_session(username)
        self._persist()
        return AuthSessionResponse(token=session.token, account=self.to_account_response(account))

    def get_account_for_token(self, token: str) -> AccountResponse:
        session = self._sessions.get(token)
        if session is None or session.expires_at <= datetime.now(UTC):
            raise PermissionError("invalid or expired account session")

        account = self._accounts.get(session.username)
        if account is None:
            raise PermissionError("account does not exist")
        return self.to_account_response(account)

    def logout(self, token: str) -> None:
        self._sessions.pop(token, None)
        self._persist()

    def create_demo_escrow(self, payload: DemoEscrowRequest) -> DemoEscrowResponse:
        operator = self.get_operator(payload.operator_address)
        escrow_id = self._next_demo_escrow_id
        self._next_demo_escrow_id += 1
        self._persist()
        return DemoEscrowResponse(
            escrow_id=escrow_id,
            buyer_address=payload.buyer_address.lower(),
            operator_address=operator.operator_address,
            duration_hours=payload.duration_hours,
            amount_wei=operator.hourly_rate_wei * payload.duration_hours,
        )

    def create_pairing_code(self, payload: CreatePairingCodeRequest) -> CreatePairingCodeResponse:
        pairing_code = f"AIGHT-{secrets.randbelow(1_000_000):06d}"
        normalized_operator = payload.operator_address.lower()
        expires_at = datetime.now(UTC) + timedelta(minutes=payload.ttl_minutes)
        session = PairingSession(
            pairing_code=pairing_code,
            operator_address=normalized_operator,
            rig_name=payload.rig_name,
            expires_at=expires_at,
        )
        self._pairing_sessions[pairing_code] = session
        self._persist()
        return CreatePairingCodeResponse(
            pairing_code=pairing_code,
            operator_address=normalized_operator,
            rig_name=payload.rig_name,
            expires_at=expires_at,
        )

    def claim_rig(self, payload: ClaimRigRequest) -> ClaimRigResponse:
        session = self._pairing_sessions.get(payload.pairing_code.upper())
        if session is None or session.claimed or session.expires_at <= datetime.now(UTC):
            raise PermissionError("invalid or expired pairing code")

        rig_id = secrets.token_hex(8)
        rig_token = f"rig_{secrets.token_urlsafe(32)}"
        now = datetime.now(UTC)
        record = RigRecord(
            rig_id=rig_id,
            rig_token=rig_token,
            operator_address=session.operator_address,
            rig_name=payload.rig_name or session.rig_name,
            status="installing",
            model=payload.model,
            tunnel_url=payload.tunnel_url,
            hourly_rate_wei=payload.hourly_rate_wei,
            latency_ms=0,
            tokens_per_second=0,
            current_load=0,
            hardware_summary=payload.hardware_summary,
            limits=payload.limits,
            error_message=None,
            created_at=now,
            last_heartbeat_at=now,
        )
        session.claimed = True
        self._rigs[rig_id] = record
        if payload.tunnel_url:
            self._operators[session.operator_address] = OperatorRecord(
                operator_address=session.operator_address,
                tunnel_url=payload.tunnel_url.rstrip("/"),
                model=payload.model,
                hourly_rate_wei=payload.hourly_rate_wei,
                latency_ms=0,
                tokens_per_second=0,
                active=True,
            )
        self._persist()
        return ClaimRigResponse(rig_id=rig_id, rig_token=rig_token, operator_address=session.operator_address)

    def record_rig_heartbeat(self, rig_id: str, rig_token: str, payload: RigHeartbeatRequest) -> RigStatusResponse:
        record = self._rigs.get(rig_id)
        if record is None:
            raise KeyError("rig not registered")
        if not secrets.compare_digest(record.rig_token, rig_token):
            raise PermissionError("invalid rig token")

        record.status = payload.status
        record.latency_ms = payload.latency_ms
        record.tokens_per_second = payload.tokens_per_second
        record.current_load = payload.current_load
        record.model = payload.model or record.model
        record.tunnel_url = payload.tunnel_url or record.tunnel_url
        record.hardware_summary = payload.hardware_summary or record.hardware_summary
        record.limits = payload.limits or record.limits
        record.error_message = payload.error_message
        record.last_heartbeat_at = datetime.now(UTC)
        operator = self._operators.get(record.operator_address)
        if operator is not None:
            operator.latency_ms = payload.latency_ms
            operator.tokens_per_second = payload.tokens_per_second
            operator.model = payload.model or operator.model
            operator.tunnel_url = payload.tunnel_url or operator.tunnel_url
            operator.active = payload.status not in ("halted", "offline", "error")
        self._persist()
        return self.to_rig_status(record)

    def list_rigs(self, operator_address: str | None = None) -> list[RigStatusResponse]:
        normalized_operator = operator_address.lower() if operator_address else None
        rigs = [
            record
            for record in self._rigs.values()
            if normalized_operator is None or record.operator_address == normalized_operator
        ]
        return [self.to_rig_status(record) for record in rigs]

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

    def _create_session(self, username: str) -> SessionRecord:
        token = f"acct_{secrets.token_urlsafe(32)}"
        session = SessionRecord(
            token=token,
            username=username,
            expires_at=datetime.now(UTC) + timedelta(days=7),
        )
        self._sessions[token] = session
        return session

    @staticmethod
    def _hash_password(password: str) -> str:
        salt = secrets.token_hex(16)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000).hex()
        return f"{salt}:{digest}"

    @staticmethod
    def _verify_password(password: str, password_hash: str) -> bool:
        salt, expected_digest = password_hash.split(":", 1)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000).hex()
        return secrets.compare_digest(digest, expected_digest)

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

    @staticmethod
    def to_account_response(record: AccountRecord) -> AccountResponse:
        return AccountResponse(
            username=record.username,
            role=record.role,  # type: ignore[arg-type]
            wallet_address=record.wallet_address,
        )

    @staticmethod
    def to_rig_status(record: RigRecord) -> RigStatusResponse:
        status: RigStatus = record.status
        if status not in ("halted", "error") and datetime.now(UTC) - record.last_heartbeat_at > timedelta(minutes=2):
            status = "offline"

        return RigStatusResponse(
            rig_id=record.rig_id,
            operator_address=record.operator_address,
            rig_name=record.rig_name,
            status=status,
            model=record.model,
            tunnel_url=record.tunnel_url,
            hourly_rate_wei=record.hourly_rate_wei,
            latency_ms=record.latency_ms,
            tokens_per_second=record.tokens_per_second,
            current_load=record.current_load,
            hardware_summary=record.hardware_summary,
            limits=record.limits,
            error_message=record.error_message,
            created_at=record.created_at,
            last_heartbeat_at=record.last_heartbeat_at,
        )

    def _persist(self) -> None:
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "operators": {key: asdict(value) for key, value in self._operators.items()},
            "api_keys": {key: self._serialize_record(value) for key, value in self._api_keys.items()},
            "pairing_sessions": {key: self._serialize_record(value) for key, value in self._pairing_sessions.items()},
            "rigs": {key: self._serialize_record(value) for key, value in self._rigs.items()},
            "accounts": {key: self._serialize_record(value) for key, value in self._accounts.items()},
            "sessions": {key: self._serialize_record(value) for key, value in self._sessions.items()},
            "next_demo_escrow_id": self._next_demo_escrow_id,
        }
        self._state_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def _load(self) -> None:
        if not self._state_path.exists():
            return

        payload = json.loads(self._state_path.read_text(encoding="utf-8"))
        self._operators = {
            key: OperatorRecord(**value) for key, value in payload.get("operators", {}).items()
        }
        self._api_keys = {
            key: ApiKeyRecord(**self._deserialize_datetimes(value, {"expires_at"}))
            for key, value in payload.get("api_keys", {}).items()
        }
        self._pairing_sessions = {
            key: PairingSession(**self._deserialize_datetimes(value, {"expires_at"}))
            for key, value in payload.get("pairing_sessions", {}).items()
        }
        self._rigs = {
            key: RigRecord(**self._deserialize_datetimes(value, {"created_at", "last_heartbeat_at"}))
            for key, value in payload.get("rigs", {}).items()
        }
        self._accounts = {
            key: AccountRecord(**self._deserialize_datetimes(value, {"created_at"}))
            for key, value in payload.get("accounts", {}).items()
        }
        self._sessions = {
            key: SessionRecord(**self._deserialize_datetimes(value, {"expires_at"}))
            for key, value in payload.get("sessions", {}).items()
        }
        self._next_demo_escrow_id = int(payload.get("next_demo_escrow_id", 1))

    @staticmethod
    def _serialize_record(record: object) -> dict[str, Any]:
        payload = asdict(record)
        for key, value in payload.items():
            if isinstance(value, datetime):
                payload[key] = value.isoformat()
        return payload

    @staticmethod
    def _deserialize_datetimes(payload: dict[str, Any], keys: set[str]) -> dict[str, Any]:
        result = dict(payload)
        for key in keys:
            if isinstance(result.get(key), str):
                result[key] = datetime.fromisoformat(result[key])
        return result


gateway_state = GatewayState()
