from __future__ import annotations

import argparse
import asyncio
import json
import os
import platform
import re
import shutil
import time
import uuid
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Any

import httpx

CONFIG_DIR = Path.home() / ".aight"
RIG_CONFIG_PATH = CONFIG_DIR / "rig.json"
DEVICE_CONFIG_PATH = CONFIG_DIR / "rig-device.json"
DEFAULT_GATEWAY_URL = "https://aight.sbs"


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
    tunnel_mode: str
    cloudflared_bin: str
    ollama_bin: str
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
        await ensure_model_installed(config.model, config.ollama_bin)
    await ensure_model_runs(config.ollama_url, config.model)

    cloudflare_tunnel: asyncio.subprocess.Process | None = None
    try:
        if config.tunnel_mode == "cloudflare" and not config.tunnel_url:
            tunnel_url, cloudflare_tunnel = await start_cloudflare_tunnel(config)
            config = replace(config, tunnel_url=tunnel_url)

        credentials = await claim_rig(config, hardware_summary, limits, device_fingerprint)
        save_rig_credentials(credentials)
        print(f"Rig paired as {credentials.ens_name} for operator {credentials.operator_address}")

        await heartbeat_loop(config, credentials, hardware_summary, limits)
    finally:
        if cloudflare_tunnel is not None and cloudflare_tunnel.returncode is None:
            cloudflare_tunnel.terminate()
            try:
                await asyncio.wait_for(cloudflare_tunnel.wait(), timeout=5)
            except TimeoutError:
                cloudflare_tunnel.kill()


def parse_args() -> BootstrapConfig:
    parser = argparse.ArgumentParser(description="Bootstrap an Aight operator rig.")
    parser.add_argument("--pair", required=True, help="Short pairing code from the Aight Operator Console.")
    parser.add_argument("--gateway-url", default=os.getenv("AIGHT_GATEWAY_URL", DEFAULT_GATEWAY_URL))
    parser.add_argument("--ollama-url", default=os.getenv("OLLAMA_URL", "http://127.0.0.1:11434"))
    parser.add_argument("--model", default=os.getenv("AIGHT_MODEL", "llama3"))
    parser.add_argument("--hourly-rate-wei", type=int, default=int(os.getenv("AIGHT_HOURLY_RATE_WEI", "1000")))
    parser.add_argument("--rig-name", default=platform.node() or "Aight Rig")
    parser.add_argument("--gpu-limit", default="auto")
    parser.add_argument("--heartbeat-interval", type=int, default=20)
    parser.add_argument("--tunnel-url", default=None)
    parser.add_argument(
        "--tunnel-mode",
        choices=("local", "cloudflare"),
        default=os.getenv("AIGHT_TUNNEL_MODE", "cloudflare"),
        help="Use `cloudflare` to create a Cloudflare Quick Tunnel for local Ollama.",
    )
    parser.add_argument("--cloudflared-bin", default=os.getenv("AIGHT_CLOUDFLARED_BIN", "cloudflared"))
    parser.add_argument("--ollama-bin", default=os.getenv("AIGHT_OLLAMA_BIN", "ollama"))
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
        tunnel_url=args.tunnel_url.rstrip("/") if args.tunnel_url else None if args.tunnel_mode == "cloudflare" else args.ollama_url.rstrip("/"),
        tunnel_mode=args.tunnel_mode,
        cloudflared_bin=args.cloudflared_bin,
        ollama_bin=args.ollama_bin,
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


async def ensure_model_installed(model: str, ollama_bin: str) -> None:
    resolved_ollama = resolve_executable(ollama_bin)
    if resolved_ollama is None:
        raise RuntimeError("The `ollama` command is not on PATH. Run the Aight install script to install Ollama.")

    output_lines: list[str] = []
    process = await asyncio.create_subprocess_exec(
        resolved_ollama,
        "pull",
        model,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    if process.stdout is not None:
        async for raw_line in process.stdout:
            line = raw_line.decode(errors="replace").rstrip()
            output_lines.append(line)
            print(line)

    exit_code = await process.wait()
    if exit_code != 0:
        detail = "\n".join(line for line in output_lines if line).strip()
        raise RuntimeError(f"`ollama pull {model}` failed with exit code {exit_code}: {detail}")


async def ensure_model_runs(ollama_url: str, model: str) -> None:
    print(f"Testing Ollama model `{model}` on this rig...")
    payload = {
        "model": model,
        "prompt": "Reply with OK.",
        "stream": False,
        "options": {"num_predict": 1},
    }
    async with httpx.AsyncClient(timeout=120) as client:
        try:
            response = await client.post(f"{ollama_url}/api/generate", json=payload)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise RuntimeError(f"Ollama could not run `{model}`: {format_ollama_error(exc.response)}") from exc
        except httpx.HTTPError as exc:
            raise RuntimeError(f"Ollama could not run `{model}`: {exc}") from exc

    print(f"Ollama model `{model}` loaded successfully.")


def format_ollama_error(response: httpx.Response) -> str:
    try:
        payload = response.json()
        if isinstance(payload, dict) and payload.get("error"):
            return str(payload["error"])
    except ValueError:
        pass
    return response.text.strip() or f"HTTP {response.status_code}"


async def start_cloudflare_tunnel(config: BootstrapConfig) -> tuple[str, asyncio.subprocess.Process]:
    cloudflared = resolve_cloudflared(config.cloudflared_bin)
    print(f"Starting Cloudflare Quick Tunnel for {config.ollama_url}...")
    process = await asyncio.create_subprocess_exec(
        cloudflared,
        "tunnel",
        "--url",
        config.ollama_url,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    if process.stdout is None:
        process.kill()
        raise RuntimeError("Could not read cloudflared tunnel output.")

    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        timeout_seconds = max(1, deadline - time.monotonic())
        try:
            raw_line = await asyncio.wait_for(process.stdout.readline(), timeout=timeout_seconds)
        except TimeoutError:
            break
        if not raw_line:
            break
        line = raw_line.decode(errors="replace").strip()
        if line:
            print(f"cloudflared: {line}")
        match = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line)
        if match:
            tunnel_url = match.group(0).rstrip("/")
            print(f"Cloudflare Quick Tunnel ready: {tunnel_url}")
            return tunnel_url, process

    process.terminate()
    try:
        await asyncio.wait_for(process.wait(), timeout=5)
    except TimeoutError:
        process.kill()
    raise RuntimeError(
        "Cloudflare Quick Tunnel did not become ready. Install cloudflared or provide --tunnel-url manually."
    )


def resolve_cloudflared(cloudflared_bin: str) -> str:
    resolved = resolve_executable(cloudflared_bin)
    if resolved is not None:
        return resolved
    local_bin = Path(__file__).resolve().parent / "bin" / ("cloudflared.exe" if platform.system() == "Windows" else "cloudflared")
    if local_bin.exists():
        return str(local_bin)
    raise RuntimeError(
        "cloudflared is required for --tunnel-mode cloudflare. Install it or run the Aight installer script."
    )


def resolve_executable(command_or_path: str) -> str | None:
    configured_path = Path(command_or_path).expanduser()
    if configured_path.exists():
        return str(configured_path)
    return shutil.which(command_or_path)


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
