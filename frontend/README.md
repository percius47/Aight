# Aight Frontend

Next.js Pulse dashboard for wallet-connected inference buyers and operators.

## Setup

```powershell
npm install
Copy-Item .env.example .env.local
```

Set these values in `.env.local`:

```text
NEXT_PUBLIC_AIGHT_GATEWAY_URL=http://localhost:8787
NEXT_PUBLIC_AIGHT_REGISTRY_ADDRESS=0x9E67068538294A3E1b1AECAF987a8252e2e4771E
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_walletconnect_project_id
```

## Run

```powershell
npm run dev
```

The dashboard reads active operators from `NEXT_PUBLIC_AIGHT_GATEWAY_URL`, connects wallets through RainbowKit on Base Sepolia, listens for token telemetry over WebSocket, and falls back to demo data when the gateway is offline.
