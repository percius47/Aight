export type OperatorNode = {
  operator_address: string;
  tunnel_url: string;
  model: string;
  hourly_rate_wei: number;
  latency_ms: number;
  tokens_per_second: number;
  active: boolean;
};

export type TelemetryEvent = {
  event: "token" | "completion" | "error";
  api_key_id: string;
  operator_address: string;
  escrow_id: number;
  token?: string | null;
  tokens: number;
};

export type BillingSnapshot = {
  escrowId: number;
  remainingHours: number;
  hourlyRateEth: string;
  operatorShare: string;
};
