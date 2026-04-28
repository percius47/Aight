# Aight Operator

Local operator client for serving an Ollama model through the Aight Gateway.

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Install prerequisites:

- Ollama running on `http://127.0.0.1:11434`.
- The selected model installed, for example `ollama pull llama3`.
- `cloudflared` installed, unless you pass an existing `--tunnel-url`.

## Run

```powershell
python run_node.py --operator-address 0xYourOperator --hourly-rate-wei 10000000000000000
```

For local development without starting Cloudflare Tunnel:

```powershell
python run_node.py --operator-address 0xYourOperator --hourly-rate-wei 10000000000000000 --tunnel-url http://127.0.0.1:11434
```

The client checks Ollama, registers the operator with the gateway, and sends recurring heartbeat updates with measured local latency.
