from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from web3 import Web3
from web3.contract import Contract

from .settings import settings
from .state import ApiKeyRecord

REGISTRY_ABI: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "operators",
        "stateMutability": "view",
        "inputs": [{"name": "operator", "type": "address"}],
        "outputs": [
            {"name": "hourlyRateWei", "type": "uint96"},
            {"name": "stakeWei", "type": "uint96"},
            {"name": "lastHeartbeat", "type": "uint64"},
            {"name": "endpointHash", "type": "bytes32"},
            {"name": "modelHash", "type": "bytes32"},
            {"name": "hardwareHash", "type": "bytes32"},
            {"name": "active", "type": "bool"},
        ],
    },
    {
        "type": "function",
        "name": "escrows",
        "stateMutability": "view",
        "inputs": [{"name": "escrowId", "type": "uint256"}],
        "outputs": [
            {"name": "user", "type": "address"},
            {"name": "operator", "type": "address"},
            {"name": "hourlyRateWei", "type": "uint96"},
            {"name": "startedAt", "type": "uint64"},
            {"name": "lastReleaseAt", "type": "uint64"},
            {"name": "durationHours", "type": "uint64"},
            {"name": "releasedHours", "type": "uint64"},
            {"name": "remainingWei", "type": "uint128"},
            {"name": "slashed", "type": "bool"},
        ],
    },
    {
        "type": "function",
        "name": "releaseHourlyPayment",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "escrowId", "type": "uint256"}],
        "outputs": [],
    },
]


@dataclass(frozen=True, slots=True)
class OnChainOperator:
    hourly_rate_wei: int
    stake_wei: int
    last_heartbeat: int
    active: bool


@dataclass(frozen=True, slots=True)
class OnChainEscrow:
    user: str
    operator: str
    hourly_rate_wei: int
    last_release_at: int
    duration_hours: int
    released_hours: int
    remaining_wei: int
    slashed: bool


class RegistryClient:
    def __init__(self, registry_address: str | None, rpc_url: str) -> None:
        self.registry_address = registry_address
        self.rpc_url = rpc_url
        self._contract: Contract | None = None

    @property
    def enabled(self) -> bool:
        return bool(self.registry_address)

    def validate_api_key_record(self, record: ApiKeyRecord) -> None:
        if not self.enabled:
            return

        escrow = self.get_escrow(record.escrow_id)
        operator = self.get_operator(record.operator_address)
        if escrow.user.lower() != record.user_address.lower():
            raise PermissionError("api key user does not match escrow")
        if escrow.operator.lower() != record.operator_address.lower():
            raise PermissionError("api key operator does not match escrow")
        if escrow.slashed or escrow.remaining_wei == 0 or escrow.released_hours >= escrow.duration_hours:
            raise PermissionError("escrow is no longer active")
        if not operator.active:
            raise PermissionError("operator is inactive on-chain")

    def get_operator(self, operator_address: str) -> OnChainOperator:
        contract = self._get_contract()
        checksum_operator = Web3.to_checksum_address(operator_address)
        result = contract.functions.operators(checksum_operator).call()
        return OnChainOperator(
            hourly_rate_wei=int(result[0]),
            stake_wei=int(result[1]),
            last_heartbeat=int(result[2]),
            active=bool(result[6]),
        )

    def get_escrow(self, escrow_id: int) -> OnChainEscrow:
        contract = self._get_contract()
        result = contract.functions.escrows(escrow_id).call()
        return OnChainEscrow(
            user=str(result[0]),
            operator=str(result[1]),
            hourly_rate_wei=int(result[2]),
            last_release_at=int(result[4]),
            duration_hours=int(result[5]),
            released_hours=int(result[6]),
            remaining_wei=int(result[7]),
            slashed=bool(result[8]),
        )

    def release_hourly_payment(self, escrow_id: int, private_key: str) -> str:
        contract = self._get_contract()
        web3 = self._get_web3()
        account = web3.eth.account.from_key(private_key)
        transaction = contract.functions.releaseHourlyPayment(escrow_id).build_transaction(
            {
                "from": account.address,
                "nonce": web3.eth.get_transaction_count(account.address),
                "chainId": web3.eth.chain_id,
            }
        )
        signed = web3.eth.account.sign_transaction(transaction, private_key)
        raw_transaction = getattr(signed, "rawTransaction", None) or getattr(signed, "raw_transaction")
        tx_hash = web3.eth.send_raw_transaction(raw_transaction)
        return tx_hash.hex()

    def _get_contract(self) -> Contract:
        if not self.registry_address:
            raise RuntimeError("AIGHT_REGISTRY_ADDRESS is not configured")
        if self._contract is None:
            web3 = self._get_web3()
            registry_address = Web3.to_checksum_address(self.registry_address)
            self._contract = web3.eth.contract(address=registry_address, abi=REGISTRY_ABI)
        return self._contract

    def _get_web3(self) -> Web3:
        return Web3(Web3.HTTPProvider(self.rpc_url))


registry_client = RegistryClient(settings.registry_address, settings.base_sepolia_rpc_url)
