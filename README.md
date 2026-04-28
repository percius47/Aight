# Aight

**Your Hardware, Their Intelligence, Our Network.**

Aight is a hackathon-grade DePIN marketplace for local LLM inference. Operators stake native ETH on Base Sepolia, expose an Ollama-backed endpoint, and serve OpenAI-compatible requests through the Aight Gateway. Users lock prepaid inference hours in escrow and receive an `AIGHT_API_KEY` for Cursor, OpenClaw, or any OpenAI-compatible client.

## Architecture

```text
User Client -> Aight Gateway -> Operator Tunnel -> Local Ollama
     |              |                  |
     |              |                  v
     |              |          Operator Hardware
     v              v
Base Sepolia <- Telemetry WebSocket <- Pulse Dashboard
```

## Repository Layout

```text
contracts/   Foundry workspace for AightRegistry staking and escrow
gateway/     FastAPI and LiteLLM OpenAI-compatible proxy
operator/    Local operator CLI workspace
frontend/    Next.js Pulse dashboard workspace
```

## Current MVP Status

- `contracts/` contains the native ETH `AightRegistry` contract, Foundry tests, Base Sepolia config, and deployment script.
- `gateway/` contains the FastAPI proxy scaffold, dummy operator endpoint, API-key issuance flow, LiteLLM routing, and WebSocket telemetry.
- `operator/` and `frontend/` are reserved for the next implementation phases.

## Contracts

```powershell
cd contracts
forge install OpenZeppelin/openzeppelin-contracts foundry-rs/forge-std
Copy-Item .env.example .env
forge test
```

Deploy to Base Sepolia:

```powershell
forge script script/DeployAightRegistry.s.sol:DeployAightRegistry --rpc-url base_sepolia --broadcast --verify
```

## Gateway

```powershell
cd gateway
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn main:app --reload --port 8787
```

The gateway exposes:

- `POST /admin/operators` to register a hackathon operator endpoint.
- `POST /admin/api-keys` to issue an `AIGHT_API_KEY` for a funded escrow.
- `POST /v1/chat/completions` for OpenAI-compatible inference.
- `WS /ws/telemetry` for token flow events.
- `POST /dummy/v1/chat/completions` for local proxy testing.
