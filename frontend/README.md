# Aight Frontend

Next.js Pulse dashboard for wallet-connected inference buyers and operators.

## Setup

```powershell
npm install
Copy-Item .env.example .env.local
```

Set `NEXT_PUBLIC_PRIVY_APP_ID` to a Privy app ID for real wallet login. Without it, the UI shell still builds for local development.

## Run

```powershell
npm run dev
```

The dashboard reads active operators from `NEXT_PUBLIC_AIGHT_GATEWAY_URL`, listens for token telemetry over WebSocket, and falls back to demo data when the gateway is offline.
