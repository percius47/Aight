# Aight Gateway

FastAPI proxy for OpenAI-compatible chat completions routed through operator-hosted Ollama endpoints with LiteLLM.

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

## Run

```powershell
uvicorn gateway.main:app --reload --port 8787
```

If `AIGHT_REGISTRY_ADDRESS` is set, every API key request is checked against the on-chain `AightRegistry` escrow and operator state. Leave it blank for local dummy-operator development.

## Production Docker

Build from the repository root so the `gateway` package is copied correctly:

```bash
docker build -t aight-gateway -f gateway/Dockerfile .
```

Run with a persistent data mount for account, rig, rental, and API-key state:

```bash
docker run -d \
  --name aight-gateway \
  --restart unless-stopped \
  --env-file gateway/.env.production \
  -v /opt/aight/data:/data \
  -p 127.0.0.1:8787:8787 \
  aight-gateway
```

Production variables:

```text
AIGHT_GATEWAY_ENV=production
AIGHT_REGISTRY_ADDRESS=<Base Sepolia registry address>
AIGHT_BASE_SEPOLIA_RPC_URL=<Base Sepolia RPC URL>
AIGHT_ALLOWED_ORIGINS=https://your-vercel-app.vercel.app,https://your-custom-domain.com
AIGHT_STATE_PATH=/data/gateway-state.json
```

## Local Dummy Flow

Register the built-in dummy operator:

```powershell
Invoke-RestMethod -Method Post http://localhost:8787/admin/operators -ContentType "application/json" -Body '{"operator_address":"0x0a1a","tunnel_url":"http://localhost:8787/dummy/v1","model":"openai/llama3","hourly_rate_wei":10000000000000000}'
```

Issue an API key for a funded escrow:

```powershell
Invoke-RestMethod -Method Post http://localhost:8787/admin/api-keys -ContentType "application/json" -Body '{"escrow_id":1,"user_address":"0xb0b","operator_address":"0x0a1a","duration_hours":24}'
```

Use the returned key against the OpenAI-compatible endpoint:

```powershell
Invoke-RestMethod -Method Post http://localhost:8787/v1/chat/completions -Headers @{Authorization="Bearer AIGHT_API_KEY"} -ContentType "application/json" -Body '{"model":"openai/llama3","messages":[{"role":"user","content":"hello aight"}]}'
```

Telemetry streams to:

```text
ws://localhost:8787/ws/telemetry
```
