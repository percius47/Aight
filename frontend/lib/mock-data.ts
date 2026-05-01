import type { BillingSnapshot, OperatorNode, TelemetryEvent } from "./types";

export const fallbackOperators: OperatorNode[] = [
  {
    operator_address: "0x0a1a...4090",
    tunnel_url: "https://node-4090.trycloudflare.com",
    model: "llama3",
    hourly_rate_wei: 10000000000000000,
    latency_ms: 42,
    tokens_per_second: 62.4,
    active: true,
  },
  {
    operator_address: "0xbeef...m3mx",
    tunnel_url: "https://m3-ultra.trycloudflare.com",
    model: "codellama",
    hourly_rate_wei: 8000000000000000,
    latency_ms: 58,
    tokens_per_second: 38.9,
    active: true,
  },
  {
    operator_address: "0xfeed...a600",
    tunnel_url: "https://a6000-lab.trycloudflare.com",
    model: "deepseek-coder",
    hourly_rate_wei: 13000000000000000,
    latency_ms: 35,
    tokens_per_second: 78.1,
    active: true,
  },
];

export const fallbackTelemetry: TelemetryEvent[] = [
  {
    event: "token",
    api_key_id: "local-demo",
    operator_address: "0x0a1a...4090",
    escrow_id: 1,
    token: "fn",
    tokens: 1,
  },
  {
    event: "token",
    api_key_id: "local-demo",
    operator_address: "0x0a1a...4090",
    escrow_id: 1,
    token: " main",
    tokens: 2,
  },
  {
    event: "completion",
    api_key_id: "local-demo",
    operator_address: "0x0a1a...4090",
    escrow_id: 1,
    tokens: 128,
  },
];

export const billingSnapshot: BillingSnapshot = {
  escrowId: 1,
  remainingHours: 21.7,
  hourlyRateEth: "0.010",
  operatorShare: "90%",
};
