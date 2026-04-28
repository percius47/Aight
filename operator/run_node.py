from __future__ import annotations

import argparse
import asyncio
import shutil
import subprocess
import time
from collections.abc import Sequence
from dataclasses import dataclass

import httpx


@dataclass(frozen=True, slots=True)
class OperatorConfig:
    operator_address: str
    gateway_url: str
    ollama_url: str
    model: str
    hourly_rate_wei: int
    heartbeat_interval: int
    tunnel_url: str | None


async def main() -> None:
    config = parse_args()
    await ensure_ollama_ready(config.ollama_url, config.model)

    tunnel_process: subprocess.Popen[str] | None = None
    tunnel_url = config.tunnel_url
    if tunnel_url is None:
        tunnel_process, tunnel_url = await start_cloudflare_tunnel(config.ollama_url)

    try:
        await register_operator(config, tunnel_url)
        await heartbeat_loop(config)
    finally:
        if tunnel_process is not None:
            tunnel_process.terminate()


def parse_args() -> OperatorConfig:
    parser = argparse.ArgumentParser(description="Run an Aight operator node against local Ollama.")
    parser.add_argument("--operator-address", required=True, help="Wallet address staked in AightRegistry.")
    parser.add_argument("--gateway-url", default="http://localhost:8787", help="Aight Gateway base URL.")
    parser.add_argument("--ollama-url", default="http://127.0.0.1:11434", help="Local Ollama base URL.")
    parser.add_argument("--model", default="llama3", help="Ollama model to serve.")
    parser.add_argument("--hourly-rate-wei", type=int, required=True, help="Advertised hourly rate in wei.")
    parser.add_argument("--heartbeat-interval", type=int, default=20, help="Seconds between gateway heartbeats.")
    parser.add_argument("--tunnel-url", default=None, help="Existing tunnel URL; skips cloudflared startup when set.")
    args = parser.parse_args()

    return OperatorConfig(
        operator_address=args.operator_address,
        gateway_url=args.gateway_url.rstrip("/"),
        ollama_url=args.ollama_url.rstrip("/"),
        model=args.model,
        hourly_rate_wei=args.hourly_rate_wei,
        heartbeat_interval=args.heartbeat_interval,
        tunnel_url=args.tunnel_url.rstrip("/") if args.tunnel_url else None,
    )


async def ensure_ollama_ready(ollama_url: str, model: str) -> None:
    async with httpx.AsyncClient(timeout=5) as client:
        response = await client.get(f"{ollama_url}/api/tags")
        response.raise_for_status()
        models = response.json().get("models", [])

    available_models = {entry.get("name", "").split(":")[0] for entry in models}
    if model.split(":")[0] not in available_models:
        raise RuntimeError(f"Ollama is running, but model '{model}' is not installed. Run: ollama pull {model}")


async def start_cloudflare_tunnel(ollama_url: str) -> tuple[subprocess.Popen[str], str]:
    if shutil.which("cloudflared") is None:
        raise RuntimeError("cloudflared is not installed. Install it or pass --tunnel-url.")

    process = subprocess.Popen(
        ["cloudflared", "tunnel", "--url", ollama_url],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    tunnel_url = await wait_for_tunnel_url(process)
    return process, tunnel_url


async def wait_for_tunnel_url(process: subprocess.Popen[str]) -> str:
    started_at = time.monotonic()
    while time.monotonic() - started_at < 45:
        if process.stdout is None:
            break
        line = await asyncio.to_thread(process.stdout.readline)
        if "trycloudflare.com" in line:
            for token in line.split():
                if token.startswith("https://") and "trycloudflare.com" in token:
                    return token.rstrip()
        if process.poll() is not None:
            break

    raise RuntimeError("cloudflared did not produce a tunnel URL within 45 seconds")


async def register_operator(config: OperatorConfig, tunnel_url: str) -> None:
    payload = {
        "operator_address": config.operator_address,
        "tunnel_url": tunnel_url,
        "model": config.model,
        "hourly_rate_wei": config.hourly_rate_wei,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(f"{config.gateway_url}/admin/operators", json=payload)
        response.raise_for_status()


async def heartbeat_loop(config: OperatorConfig) -> None:
    async with httpx.AsyncClient(timeout=10) as client:
        while True:
            latency_ms = await measure_ollama_latency_ms(client, config.ollama_url)
            payload = {
                "latency_ms": latency_ms,
                "tokens_per_second": 0,
                "active": True,
            }
            response = await client.post(
                f"{config.gateway_url}/admin/operators/{config.operator_address}/heartbeat",
                json=payload,
            )
            response.raise_for_status()
            await asyncio.sleep(config.heartbeat_interval)


async def measure_ollama_latency_ms(client: httpx.AsyncClient, ollama_url: str) -> int:
    started_at = time.perf_counter()
    response = await client.get(f"{ollama_url}/api/tags")
    response.raise_for_status()
    return int((time.perf_counter() - started_at) * 1000)


def run(argv: Sequence[str] | None = None) -> None:
    if argv is not None:
        raise RuntimeError("run() does not accept argv; use the command line parser directly")
    asyncio.run(main())


if __name__ == "__main__":
    run()
