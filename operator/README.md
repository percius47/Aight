# Aight Operator

Local operator client for serving an Ollama model through the Aight Gateway.

## One-command pairing

```powershell
powershell -ExecutionPolicy Bypass -NoProfile -Command "iwr -UseBasicParsing https://raw.githubusercontent.com/percius47/Aight/main/operator/install.ps1 -OutFile $env:TEMP\aight-install.ps1; & $env:TEMP\aight-install.ps1 -Pair AIGHT-123456 -Model gemma3:1b"
```

```bash
curl -fsSL https://raw.githubusercontent.com/percius47/Aight/main/operator/install.sh | bash -s -- AIGHT-123456 gemma3:1b
```

The installer checks prerequisites one by one, installs Ollama and `cloudflared` when missing, starts Ollama locally, downloads the Aight operator client, verifies the selected model actually runs on the rig, opens a Cloudflare Quick Tunnel, and pairs the rig with the hosted Aight Gateway.

## Local development

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python bootstrap.py --pair AIGHT-123456 --model gemma3:1b --gateway-url http://localhost:8787 --tunnel-mode local
```
