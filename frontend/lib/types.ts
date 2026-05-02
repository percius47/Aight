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
  rig_identity: string;
  ens_name: string;
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
  assignment: Record<string, unknown> | null;
  expected_earnings_wei: number;
  device_fingerprint: string;
  error_message: string | null;
  created_at: string;
  last_heartbeat_at: string;
  halted_at: string | null;
};

export type PairingCode = {
  pairing_code: string;
  operator_address: string;
  rig_name: string;
  model: string;
  hourly_rate_wei: number;
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
  rig_id: string | null;
  rig_identity: string | null;
  duration_hours: number;
  amount_wei: number;
};

export type IssuedApiKey = {
  api_key: string;
  escrow_id: number;
  operator_address: string;
};

export type RentedRig = {
  apiKey: string;
  amountWei: number;
  completionCount: number;
  completionTokens: number;
  durationHours: number;
  escrowId: number;
  escrowTxHash: string | null;
  expiresAt: string;
  lastUsedAt: string | null;
  model: string;
  operatorAddress: string;
  operatorPayoutWei: number;
  promptTokens: number;
  refundWei: number;
  rentedAt: string;
  rentalId: string;
  rigId: string | null;
  rigIdentity: string;
  rigName: string;
  slashWei: number;
  status: "allocated" | "terminated" | "expired";
  terminatedAt: string | null;
  terminationReason: string | null;
  totalTokens: number;
  usedHours: number;
};

export type BuyerRentalResponse = {
  rental_id: string;
  buyer_username: string | null;
  buyer_address: string;
  api_key: string;
  escrow_id: number;
  operator_address: string;
  rig_id: string | null;
  rig_identity: string;
  rig_name: string;
  model: string;
  duration_hours: number;
  amount_wei: number;
  escrow_tx_hash: string | null;
  status: "allocated" | "terminated" | "expired";
  created_at: string;
  expires_at: string;
  terminated_at: string | null;
  termination_reason: string | null;
  used_hours: number;
  refund_wei: number;
  operator_payout_wei: number;
  slash_wei: number;
  completion_count: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  last_used_at: string | null;
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
