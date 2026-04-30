from __future__ import annotations

import argparse
import asyncio
import json
import os
import platform
import shutil
import time
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import httpx

CONFIG_DIR = Path.home() / ".aight"
RIG_CONFIG_PATH = CONFIG_DIR / "rig.json"
DEVICE_CONFIG_PATH = CONFIG_DIR / "rig-device.json"


@dataclass(frozen=True, slots=True)
class BootstrapConfig:
    pairing_code: str
    gateway_url: str
    ollama_url: str
    model: str
    hourly_rate_wei: int
    rig_name: str
    gpu_limit: str
    heartbeat_interval: int
    tunnel_url: str | None
    pull_model: bool
    dry_run: bool


@dataclass(frozen=True, slots=True)
class RigCredentials:
    rig_id: str
    rig_identity: str
    ens_name: str
    rig_token: str
    operator_address: str


async def main() -> None:
    config = parse_args()
    hardware_summary = collect_hardware_summary()
    device_fingerprint = get_device_fingerprint(config.model, hardware_summary)
    limits = {"gpu_limit": config.gpu_limit}

    if config.dry_run:
        print(
            json.dumps(
                {"device_fingerprint": device_fingerprint, "hardware": hardware_summary, "limits": limits, "model": config.model},
                indent=2,
            )
        )
        return

    await ensure_ollama_ready(config.ollama_url)
    if config.pull_model:
        await ensure_model_installed(config.model)

    credentials = await claim_rig(config, hardware_summary, limits, device_fingerprint)
    save_rig_credentials(credentials)
    print(f"Rig paired as {credentials.ens_name} for operator {credentials.operator_address}")

    await heartbeat_loop(config, credentials, hardware_summary, limits)


def parse_args() -> BootstrapConfig:
    parser = argparse.ArgumentParser(description="Bootstrap an Aight operator rig.")
    parser.add_argument("--pair", required=True, help="Short pairing code from the Aight Operator Console.")
    parser.add_argument("--gateway-url", default=os.getenv("AIGHT_GATEWAY_URL", "http://localhost:8787"))
    parser.add_argument("--ollama-url", default=os.getenv("OLLAMA_URL", "http://127.0.0.1:11434"))
    parser.add_argument("--model", default=os.getenv("AIGHT_MODEL", "llama3"))
    parser.add_argument("--hourly-rate-wei", type=int, default=int(os.getenv("AIGHT_HOURLY_RATE_WEI", "1000")))
    parser.add_argument("--rig-name", default=platform.node() or "Aight Rig")
    parser.add_argument("--gpu-limit", default="auto")
    parser.add_argument("--heartbeat-interval", type=int, default=20)
    parser.add_argument("--tunnel-url", default=None)
    parser.add_argument("--no-pull", action="store_true", help="Skip `ollama pull`; fail later if model is unavailable.")
    parser.add_argument("--dry-run", action="store_true", help="Print detected rig configuration without claiming a code.")
    args = parser.parse_args()

    return BootstrapConfig(
        pairing_code=args.pair.upper(),
        gateway_url=args.gateway_url.rstrip("/"),
        ollama_url=args.ollama_url.rstrip("/"),
        model=args.model,
        hourly_rate_wei=args.hourly_rate_wei,
        rig_name=args.rig_name,
        gpu_limit=args.gpu_limit,
        heartbeat_interval=args.heartbeat_interval,
        tunnel_url=args.tunnel_url.rstrip("/") if args.tunnel_url else args.ollama_url.rstrip("/"),
        pull_model=not args.no_pull,
        dry_run=args.dry_run,
    )


def collect_hardware_summary() -> dict[str, Any]:
    return {
        "hostname": platform.node(),
        "os": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor() or "unknown",
        "cpu_count": os.cpu_count() or 0,
        "python": platform.python_version(),
    }


async def ensure_ollama_ready(ollama_url: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{ollama_url}/api/tags")
            response.raise_for_status()
    except httpx.HTTPError as exc:
        install_hint = "Install Ollama from https://ollama.com/download, then run: ollama serve"
        raise RuntimeError(
            f"Ollama is not reachable at {ollama_url}. {install_hint}"
        ) from exc


async def ensure_model_installed(model: str) -> None:
    if shutil.which("ollama") is None:
        raise RuntimeError("The `ollama` command is not on PATH. Install Ollama or run with --no-pull.")

    process = await asyncio.create_subprocess_exec(
        "ollama",
        "pull",
        model,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    if process.stdout is not None:
        async for raw_line in process.stdout:
            print(raw_line.decode(errors="replace").rstrip())

    exit_code = await process.wait()
    if exit_code != 0:
        raise RuntimeError(f"`ollama pull {model}` failed with exit code {exit_code}")


async def claim_rig(
    config: BootstrapConfig,
    hardware_summary: dict[str, Any],
    limits: dict[str, Any],
    device_fingerprint: str,
) -> RigCredentials:
    payload = {
        "pairing_code": config.pairing_code,
        "rig_name": config.rig_name,
        "model": config.model,
        "tunnel_url": config.tunnel_url,
        "hourly_rate_wei": config.hourly_rate_wei,
        "device_fingerprint": device_fingerprint,
        "hardware_summary": hardware_summary,
        "limits": limits,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(f"{config.gateway_url}/operator/rigs/claim", json=payload)
        if response.status_code >= 400:
            raise RuntimeError(format_gateway_error(response))
        body = response.json()

    return RigCredentials(
        rig_id=body["rig_id"],
        rig_identity=body["rig_identity"],
        ens_name=body["ens_name"],
        rig_token=body["rig_token"],
        operator_address=body["operator_address"],
    )


def format_gateway_error(response: httpx.Response) -> str:
    detail = response.text
    try:
        payload = response.json()
        if isinstance(payload, dict) and payload.get("detail"):
            detail = str(payload["detail"])
    except ValueError:
        pass

    if response.status_code == 401 and "already has a live paired rig" in detail:
        return (
            "Pairing rejected: this machine is already paired and live for this operator. "
            "Halt the existing rig in the Operator Console before pairing this machine again."
        )

    if response.status_code == 401 and "invalid or expired pairing code" in detail:
        return "Pairing rejected: the pairing code is invalid, expired, or already used. Generate a fresh code in the Operator Console."

    return f"Gateway rejected rig pairing ({response.status_code}): {detail}"


def save_rig_credentials(credentials: RigCredentials) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    RIG_CONFIG_PATH.write_text(json.dumps(asdict(credentials), indent=2), encoding="utf-8")


def get_device_fingerprint(model: str, hardware_summary: dict[str, Any]) -> str:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if DEVICE_CONFIG_PATH.exists():
        device_config = json.loads(DEVICE_CONFIG_PATH.read_text(encoding="utf-8"))
    else:
        device_config = {"install_id": str(uuid.uuid4())}
        DEVICE_CONFIG_PATH.write_text(json.dumps(device_config, indent=2), encoding="utf-8")

    fingerprint_source = {
        "install_id": device_config["install_id"],
        "hostname": hardware_summary.get("hostname"),
        "machine": hardware_summary.get("machine"),
        "cpu_count": hardware_summary.get("cpu_count"),
        "model": model,
    }
    return uuid.uuid5(uuid.NAMESPACE_URL, json.dumps(fingerprint_source, sort_keys=True)).hex


async def heartbeat_loop(
    config: BootstrapConfig,
    credentials: RigCredentials,
    hardware_summary: dict[str, Any],
    limits: dict[str, Any],
) -> None:
    async with httpx.AsyncClient(timeout=10) as client:
        while True:
            latency_ms = await measure_ollama_latency_ms(client, config.ollama_url)
            payload = {
                "status": "idle",
                "latency_ms": latency_ms,
                "tokens_per_second": 0,
                "current_load": 0,
                "model": config.model,
                "tunnel_url": config.tunnel_url,
                "hardware_summary": hardware_summary,
                "limits": limits,
            }
            response = await client.post(
                f"{config.gateway_url}/operator/rigs/{credentials.rig_id}/heartbeat",
                headers={"x-aight-rig-token": credentials.rig_token},
                json=payload,
            )
            response.raise_for_status()
            print(f"heartbeat status=idle latency_ms={latency_ms}")
            await asyncio.sleep(config.heartbeat_interval)


async def measure_ollama_latency_ms(client: httpx.AsyncClient, ollama_url: str) -> int:
    started_at = time.perf_counter()
    response = await client.get(f"{ollama_url}/api/tags")
    response.raise_for_status()
    return int((time.perf_counter() - started_at) * 1000)


if __name__ == "__main__":
    asyncio.run(main())
