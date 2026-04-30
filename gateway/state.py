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
    DeleteRigRequest,
    HaltRigRequest,
    BuyerRentalResponse,
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
    rig_id: str | None
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
class RentalRecord:
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
    status: str
    created_at: datetime
    expires_at: datetime
    terminated_at: datetime | None = None
    termination_reason: str | None = None
    used_hours: int = 0
    refund_wei: int = 0
    operator_payout_wei: int = 0
    slash_wei: int = 0


@dataclass(slots=True)
class PairingSession:
    pairing_code: str
    operator_address: str
    rig_name: str
    expires_at: datetime
    model: str = "gemma3:1b"
    hourly_rate_wei: int = 1000
    claimed: bool = False


@dataclass(slots=True)
class RigRecord:
    rig_id: str
    rig_token: str
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
    halted_at: datetime | None = None


class GatewayState:
    def __init__(self) -> None:
        self._operators: dict[str, OperatorRecord] = {}
        self._api_keys: dict[str, ApiKeyRecord] = {}
        self._pairing_sessions: dict[str, PairingSession] = {}
        self._rigs: dict[str, RigRecord] = {}
        self._accounts: dict[str, AccountRecord] = {}
        self._sessions: dict[str, SessionRecord] = {}
        self._rentals: dict[str, RentalRecord] = {}
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

    def issue_api_key(self, payload: IssueApiKeyRequest, buyer_username: str | None = None) -> ApiKeyRecord:
        normalized_operator = payload.operator_address.lower()
        if normalized_operator not in self._operators:
            raise KeyError("operator not registered")

        rig = self._select_rig_for_rental(
            operator_address=normalized_operator,
            rig_id=payload.rig_id,
            escrow_id=payload.escrow_id,
        )
        if rig is None:
            raise KeyError("rig not available for this escrow")

        secret = f"aight_{secrets.token_urlsafe(32)}"
        expires_at = datetime.now(UTC) + timedelta(hours=payload.duration_hours)
        record = ApiKeyRecord(
            key_id=secrets.token_hex(8),
            secret=secret,
            escrow_id=payload.escrow_id,
            user_address=payload.user_address.lower(),
            operator_address=normalized_operator,
            rig_id=rig.rig_id,
            expires_at=expires_at,
        )
        self._api_keys[secret] = record
        rig.status = "busy"
        if rig.assignment is None:
            rig.assignment = {
                "escrow_id": payload.escrow_id,
                "buyer_address": payload.user_address.lower(),
                "duration_hours": payload.duration_hours,
                "status": "running",
                "expected_earnings_wei": int(rig.hourly_rate_wei * payload.duration_hours * 0.9),
            }
        else:
            rig.assignment["status"] = "running"
        rig.expected_earnings_wei = int(rig.assignment.get("expected_earnings_wei", 0))
        rental_id = secrets.token_hex(8)
        amount_wei = rig.hourly_rate_wei * payload.duration_hours
        self._rentals[rental_id] = RentalRecord(
            rental_id=rental_id,
            buyer_username=buyer_username,
            buyer_address=payload.user_address.lower(),
            api_key=secret,
            escrow_id=payload.escrow_id,
            operator_address=normalized_operator,
            rig_id=rig.rig_id,
            rig_identity=rig.rig_identity,
            rig_name=rig.rig_name,
            model=rig.model,
            duration_hours=payload.duration_hours,
            amount_wei=amount_wei,
            status="allocated",
            created_at=datetime.now(UTC),
            expires_at=expires_at,
            used_hours=0,
            refund_wei=0,
            operator_payout_wei=0,
            slash_wei=0,
        )
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
        assigned_rig: RigRecord | None = None
        assignment = {
            "escrow_id": escrow_id,
            "buyer_address": payload.buyer_address.lower(),
            "duration_hours": payload.duration_hours,
            "status": "reserved",
            "expected_earnings_wei": int(operator.hourly_rate_wei * payload.duration_hours * 0.9),
        }
        assigned_rig = self._select_rig_for_rental(operator_address=operator.operator_address, rig_id=payload.rig_id)
        if assigned_rig is None:
            raise KeyError("no idle rig available for this operator")
        assigned_rig.assignment = assignment
        assigned_rig.expected_earnings_wei = assignment["expected_earnings_wei"]
        self._persist()
        return DemoEscrowResponse(
            escrow_id=escrow_id,
            buyer_address=payload.buyer_address.lower(),
            operator_address=operator.operator_address,
            rig_id=assigned_rig.rig_id if assigned_rig else None,
            rig_identity=assigned_rig.rig_identity if assigned_rig else None,
            duration_hours=payload.duration_hours,
            amount_wei=operator.hourly_rate_wei * payload.duration_hours,
        )

    def _select_rig_for_rental(
        self,
        *,
        operator_address: str,
        rig_id: str | None = None,
        escrow_id: int | None = None,
    ) -> RigRecord | None:
        if rig_id is not None:
            rig = self._rigs.get(rig_id)
            if rig is None or rig.operator_address != operator_address:
                return None
            if escrow_id is None:
                return rig if self.effective_rig_status(rig) == "idle" else None
            status = self.effective_rig_status(rig)
            if status in ("halted", "offline", "error"):
                return None
            if rig.assignment is None and status == "idle":
                return rig
            if rig.assignment is not None and int(rig.assignment.get("escrow_id", 0)) == escrow_id:
                return rig
            return None

        if escrow_id is not None:
            for rig in self._rigs.values():
                if (
                    rig.operator_address == operator_address
                    and rig.assignment is not None
                    and int(rig.assignment.get("escrow_id", 0)) == escrow_id
                ):
                    return rig

        for rig in self._rigs.values():
            if rig.operator_address == operator_address and self.effective_rig_status(rig) == "idle":
                return rig
        return None

    def create_pairing_code(self, payload: CreatePairingCodeRequest) -> CreatePairingCodeResponse:
        pairing_code = f"AIGHT-{secrets.randbelow(1_000_000):06d}"
        normalized_operator = payload.operator_address.lower()
        expires_at = datetime.now(UTC) + timedelta(minutes=payload.ttl_minutes)
        session = PairingSession(
            pairing_code=pairing_code,
            operator_address=normalized_operator,
            rig_name=payload.rig_name,
            model=payload.model,
            hourly_rate_wei=payload.hourly_rate_wei,
            expires_at=expires_at,
        )
        self._pairing_sessions[pairing_code] = session
        self._persist()
        return CreatePairingCodeResponse(
            pairing_code=pairing_code,
            operator_address=normalized_operator,
            rig_name=payload.rig_name,
            model=payload.model,
            hourly_rate_wei=payload.hourly_rate_wei,
            expires_at=expires_at,
        )

    def claim_rig(self, payload: ClaimRigRequest) -> ClaimRigResponse:
        session = self._pairing_sessions.get(payload.pairing_code.upper())
        if session is None or session.claimed or session.expires_at <= datetime.now(UTC):
            raise PermissionError("invalid or expired pairing code")
        for rig in self._rigs.values():
            if (
                rig.operator_address == session.operator_address
                and rig.device_fingerprint == payload.device_fingerprint
                and rig.status not in ("halted", "offline", "error")
            ):
                raise PermissionError("this device already has a live paired rig; halt it before pairing again")

        rig_id = secrets.token_hex(8)
        rig_identity = self._build_rig_identity(payload.rig_name, payload.model, rig_id)
        rig_token = f"rig_{secrets.token_urlsafe(32)}"
        now = datetime.now(UTC)
        record = RigRecord(
            rig_id=rig_id,
            rig_token=rig_token,
            rig_identity=rig_identity,
            ens_name=rig_identity,
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
            assignment=None,
            expected_earnings_wei=0,
            device_fingerprint=payload.device_fingerprint,
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
        return ClaimRigResponse(
            rig_id=rig_id,
            rig_identity=rig_identity,
            ens_name=rig_identity,
            rig_token=rig_token,
            operator_address=session.operator_address,
        )

    def record_rig_heartbeat(self, rig_id: str, rig_token: str, payload: RigHeartbeatRequest) -> RigStatusResponse:
        record = self._rigs.get(rig_id)
        if record is None:
            raise KeyError("rig not registered")
        if not secrets.compare_digest(record.rig_token, rig_token):
            raise PermissionError("invalid rig token")
        if record.status == "halted":
            return self.to_rig_status(record)

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

    def halt_rig(self, rig_id: str, payload: HaltRigRequest) -> RigStatusResponse:
        record = self._rigs.get(rig_id)
        if record is None:
            raise KeyError("rig not registered")
        if record.operator_address != payload.operator_address.lower():
            raise PermissionError("operator does not own this rig")

        record.status = "halted"
        record.halted_at = datetime.now(UTC)
        self._terminate_rentals_for_rig(record, reason="operator_halted")
        record.assignment = None
        record.expected_earnings_wei = 0
        if not any(
            rig.operator_address == record.operator_address and rig.status not in ("halted", "offline", "error")
            for rig in self._rigs.values()
        ):
            operator = self._operators.get(record.operator_address)
            if operator is not None:
                operator.active = False
        self._persist()
        return self.to_rig_status(record)

    def delete_rig(self, rig_id: str, payload: DeleteRigRequest) -> None:
        record = self._rigs.get(rig_id)
        if record is None:
            raise KeyError("rig not registered")
        if record.operator_address != payload.operator_address.lower():
            raise PermissionError("operator does not own this rig")

        status = self.effective_rig_status(record)
        if status not in ("halted", "offline", "error"):
            raise PermissionError("only halted, offline, or error rigs can be deleted")

        del self._rigs[rig_id]
        if not any(
            rig.operator_address == record.operator_address and self.effective_rig_status(rig) not in ("halted", "offline", "error")
            for rig in self._rigs.values()
        ):
            operator = self._operators.get(record.operator_address)
            if operator is not None:
                operator.active = False
        self._persist()

    def list_rigs(self, operator_address: str | None = None) -> list[RigStatusResponse]:
        normalized_operator = operator_address.lower() if operator_address else None
        rigs = [
            record
            for record in self._rigs.values()
            if normalized_operator is None or record.operator_address == normalized_operator
        ]
        return [self.to_rig_status(record) for record in rigs]

    def list_buyer_rentals(
        self,
        *,
        buyer_username: str | None = None,
        buyer_address: str | None = None,
    ) -> list[BuyerRentalResponse]:
        normalized_address = buyer_address.lower() if buyer_address else None
        rentals = [
            record
            for record in self._rentals.values()
            if (
                (buyer_username is not None and record.buyer_username == buyer_username)
                or (normalized_address is not None and record.buyer_address == normalized_address)
            )
        ]
        rentals.sort(key=lambda record: record.created_at, reverse=True)
        return [self.to_rental_response(record) for record in rentals]

    def _rental_for_api_key(self, api_key: str) -> RentalRecord | None:
        return next((record for record in self._rentals.values() if record.api_key == api_key), None)

    def _terminate_rentals_for_rig(self, rig: RigRecord, reason: str) -> None:
        now = datetime.now(UTC)
        for rental in self._rentals.values():
            if rental.rig_id != rig.rig_id or rental.status != "allocated":
                continue

            api_key = self._api_keys.get(rental.api_key)
            if api_key is not None:
                api_key.active = False

            elapsed_hours = int((now - rental.created_at).total_seconds() // 3600)
            used_hours = min(rental.duration_hours, max(0, elapsed_hours))
            consumed_wei = min(rental.amount_wei, used_hours * rig.hourly_rate_wei)
            rental.status = "terminated"
            rental.terminated_at = now
            rental.termination_reason = reason
            rental.used_hours = used_hours
            rental.operator_payout_wei = int(consumed_wei * 0.9)
            rental.refund_wei = max(0, rental.amount_wei - consumed_wei)
            rental.slash_wei = max(1, rental.amount_wei // 10) if rental.refund_wei > 0 else 0

    def validate_api_key(self, secret: str) -> ApiKeyRecord:
        record = self._api_keys.get(secret)
        if record is None or not record.active or record.expires_at <= datetime.now(UTC):
            raise PermissionError("invalid or expired AIGHT_API_KEY")
        rental = self._rental_for_api_key(secret)
        if rental is None or rental.status != "allocated":
            raise PermissionError("AIGHT_API_KEY is no longer allocated to an active rig")
        if record.rig_id is None or rental.rig_id != record.rig_id:
            raise PermissionError("AIGHT_API_KEY is not bound to an active rig instance")
        rig = self._rigs.get(record.rig_id)
        if rig is None or self.effective_rig_status(rig) in ("halted", "offline", "error"):
            raise PermissionError("AIGHT_API_KEY rig instance is not active")
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
        status = GatewayState.effective_rig_status(record)

        return RigStatusResponse(
            rig_id=record.rig_id,
            rig_identity=record.rig_identity,
            ens_name=record.ens_name,
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
            assignment=record.assignment,
            expected_earnings_wei=record.expected_earnings_wei,
            device_fingerprint=record.device_fingerprint,
            error_message=record.error_message,
            created_at=record.created_at,
            last_heartbeat_at=record.last_heartbeat_at,
            halted_at=record.halted_at,
        )

    @staticmethod
    def effective_rig_status(record: RigRecord) -> RigStatus:
        if record.status not in ("halted", "error") and datetime.now(UTC) - record.last_heartbeat_at > timedelta(minutes=2):
            return "offline"
        if record.assignment is not None and record.status not in ("halted", "offline", "error"):
            return "busy"
        return record.status

    @staticmethod
    def to_rental_response(record: RentalRecord) -> BuyerRentalResponse:
        status = "expired" if record.status == "allocated" and record.expires_at <= datetime.now(UTC) else record.status
        return BuyerRentalResponse(
            rental_id=record.rental_id,
            buyer_username=record.buyer_username,
            buyer_address=record.buyer_address,
            api_key=record.api_key,
            escrow_id=record.escrow_id,
            operator_address=record.operator_address,
            rig_id=record.rig_id,
            rig_identity=record.rig_identity,
            rig_name=record.rig_name,
            model=record.model,
            duration_hours=record.duration_hours,
            amount_wei=record.amount_wei,
            status=status,  # type: ignore[arg-type]
            created_at=record.created_at,
            expires_at=record.expires_at,
            terminated_at=record.terminated_at,
            termination_reason=record.termination_reason,
            used_hours=record.used_hours,
            refund_wei=record.refund_wei,
            operator_payout_wei=record.operator_payout_wei,
            slash_wei=record.slash_wei,
        )

    @staticmethod
    def _build_rig_identity(rig_name: str, model: str, rig_id: str) -> str:
        slug = f"{rig_name}-{model}".lower()
        slug = "".join(character if character.isalnum() else "-" for character in slug)
        slug = "-".join(part for part in slug.split("-") if part)[:36] or "rig"
        return f"{slug}-{rig_id[:6]}.rig.aight.eth"

    def _persist(self) -> None:
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "operators": {key: asdict(value) for key, value in self._operators.items()},
            "api_keys": {key: self._serialize_record(value) for key, value in self._api_keys.items()},
            "pairing_sessions": {key: self._serialize_record(value) for key, value in self._pairing_sessions.items()},
            "rigs": {key: self._serialize_record(value) for key, value in self._rigs.items()},
            "accounts": {key: self._serialize_record(value) for key, value in self._accounts.items()},
            "sessions": {key: self._serialize_record(value) for key, value in self._sessions.items()},
            "rentals": {key: self._serialize_record(value) for key, value in self._rentals.items()},
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
            key: ApiKeyRecord(**self._with_api_key_defaults(self._deserialize_datetimes(value, {"expires_at"})))
            for key, value in payload.get("api_keys", {}).items()
        }
        self._pairing_sessions = {
            key: PairingSession(**self._with_pairing_defaults(self._deserialize_datetimes(value, {"expires_at"})))
            for key, value in payload.get("pairing_sessions", {}).items()
        }
        self._rigs = {
            key: RigRecord(
                **self._with_rig_defaults(
                    self._deserialize_datetimes(value, {"created_at", "last_heartbeat_at", "halted_at"})
                )
            )
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
        self._rentals = {
            key: RentalRecord(
                **self._with_rental_defaults(
                    self._deserialize_datetimes(value, {"created_at", "expires_at", "terminated_at"})
                )
            )
            for key, value in payload.get("rentals", {}).items()
        }
        self._next_demo_escrow_id = int(payload.get("next_demo_escrow_id", 1))
        if self._backfill_rentals_from_api_keys():
            self._persist()

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

    @staticmethod
    def _with_pairing_defaults(payload: dict[str, Any]) -> dict[str, Any]:
        result = dict(payload)
        result.setdefault("model", "gemma3:1b")
        result.setdefault("hourly_rate_wei", 1000)
        return result

    @staticmethod
    def _with_api_key_defaults(payload: dict[str, Any]) -> dict[str, Any]:
        result = dict(payload)
        result.setdefault("rig_id", None)
        return result

    @staticmethod
    def _with_rig_defaults(payload: dict[str, Any]) -> dict[str, Any]:
        result = dict(payload)
        rig_id = str(result.get("rig_id", secrets.token_hex(8)))
        result.setdefault("rig_identity", GatewayState._build_rig_identity(str(result.get("rig_name", "rig")), str(result.get("model", "gemma3:1b")), rig_id))
        result.setdefault("ens_name", result["rig_identity"])
        result.setdefault("assignment", None)
        result.setdefault("expected_earnings_wei", 0)
        result.setdefault("device_fingerprint", f"legacy-{rig_id}")
        result.setdefault("halted_at", None)
        return result

    @staticmethod
    def _with_rental_defaults(payload: dict[str, Any]) -> dict[str, Any]:
        result = dict(payload)
        result.setdefault("rental_id", secrets.token_hex(8))
        result.setdefault("buyer_username", None)
        result.setdefault("rig_id", None)
        result.setdefault("rig_identity", "")
        result.setdefault("rig_name", "Aight Rig")
        result.setdefault("model", "gemma3:1b")
        result.setdefault("amount_wei", 0)
        result.setdefault("status", "allocated")
        result.setdefault("terminated_at", None)
        result.setdefault("termination_reason", None)
        result.setdefault("used_hours", 0)
        result.setdefault("refund_wei", 0)
        result.setdefault("operator_payout_wei", 0)
        result.setdefault("slash_wei", 0)
        return result

    def _backfill_rentals_from_api_keys(self) -> bool:
        added = False
        existing_api_keys = {record.api_key for record in self._rentals.values()}
        for secret, api_key in self._api_keys.items():
            if secret in existing_api_keys:
                continue

            rig = self._select_rig_for_rental(
                operator_address=api_key.operator_address,
                escrow_id=api_key.escrow_id,
            )
            if rig is None:
                rig = next(
                    (record for record in self._rigs.values() if record.operator_address == api_key.operator_address),
                    None,
                )
            buyer_username = next(
                (
                    account.username
                    for account in self._accounts.values()
                    if account.wallet_address == api_key.user_address
                ),
                None,
            )
            operator = self._operators.get(api_key.operator_address)
            hourly_rate_wei = rig.hourly_rate_wei if rig else operator.hourly_rate_wei if operator else 0
            duration_hours = max(1, int((api_key.expires_at - datetime.now(UTC)).total_seconds() // 3600) + 1)
            rental_id = secrets.token_hex(8)
            self._rentals[rental_id] = RentalRecord(
                rental_id=rental_id,
                buyer_username=buyer_username,
                buyer_address=api_key.user_address,
                api_key=secret,
                escrow_id=api_key.escrow_id,
                operator_address=api_key.operator_address,
                rig_id=rig.rig_id if rig else None,
                rig_identity=rig.rig_identity if rig else "",
                rig_name=rig.rig_name if rig else "Aight Rig",
                model=rig.model if rig else operator.model if operator else "gemma3:1b",
                duration_hours=duration_hours,
                amount_wei=hourly_rate_wei * duration_hours,
                status="allocated",
                created_at=datetime.now(UTC),
                expires_at=api_key.expires_at,
            )
            api_key.rig_id = rig.rig_id if rig else api_key.rig_id
            added = True
        return added


gateway_state = GatewayState()
