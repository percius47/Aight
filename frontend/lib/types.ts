export type OperatorNode = {
  operator_address: string;
  tunnel_url: string;
  model: string;
  hourly_rate_wei: number;
  latency_ms: number;
  tokens_per_second: number;
  active: boolean;
};

export type RigStatus = "installing" | "idle" | "busy" | "halted" | "offline" | "error";

export type OperatorRig = {
  rig_id: string;
  operator_address: string;
  rig_name: string;
  status: RigStatus;
  model: string;
  tunnel_url: string | null;
  hourly_rate_wei: number;
  latency_ms: number;
  tokens_per_second: number;
  current_load: number;
  hardware_summary: Record<string, unknown>;
  limits: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
  last_heartbeat_at: string;
};

export type PairingCode = {
  pairing_code: string;
  operator_address: string;
  rig_name: string;
  expires_at: string;
};

export type AccountRole = "operator" | "buyer";

export type AightAccount = {
  username: string;
  role: AccountRole;
  wallet_address: string | null;
};

export type AuthSession = {
  token: string;
  account: AightAccount;
};

export type DemoEscrow = {
  escrow_id: number;
  buyer_address: string;
  operator_address: string;
  duration_hours: number;
  amount_wei: number;
};

export type IssuedApiKey = {
  api_key: string;
  escrow_id: number;
  operator_address: string;
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
