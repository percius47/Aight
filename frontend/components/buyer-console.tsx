"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { parseEventLogs } from "viem";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, usePublicClient, useWriteContract } from "wagmi";

import { useAightAccount } from "@/hooks/use-aight-account";
import { gatewayUrl, registryAddress } from "@/lib/config";
import type { BuyerRentalResponse, DemoEscrow, IssuedApiKey, OperatorRig, RentedRig } from "@/lib/types";

const registryAbi = [
  {
    type: "function",
    name: "stakeUserDeposit",
    stateMutability: "payable",
    inputs: [
      { name: "operatorAddress", type: "address" },
      { name: "durationHours", type: "uint64" },
    ],
    outputs: [{ name: "escrowId", type: "uint256" }],
  },
  {
    type: "event",
    name: "UserEscrowCreated",
    inputs: [
      { indexed: true, name: "escrowId", type: "uint256" },
      { indexed: true, name: "user", type: "address" },
      { indexed: true, name: "operator", type: "address" },
      { indexed: false, name: "amountWei", type: "uint256" },
      { indexed: false, name: "durationHours", type: "uint256" },
    ],
  },
] as const;

const baseSepoliaChainId = 84532;

export function BuyerConsole() {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { token } = useAightAccount();
  const [rigs, setRigs] = useState<OperatorRig[]>([]);
  const [selectedRig, setSelectedRig] = useState<OperatorRig | null>(null);
  const [durationHours, setDurationHours] = useState(1);
  const [apiKey, setApiKey] = useState<IssuedApiKey | null>(null);
  const [rentedRigs, setRentedRigs] = useState<RentedRig[]>([]);
  const [demoWalletAddress, setDemoWalletAddress] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [agentResponse, setAgentResponse] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buyerAddress = address ?? normalizeAddress(demoWalletAddress);
  const isBaseSepolia = chainId === baseSepoliaChainId;
  const walletReady = Boolean(buyerAddress);

  async function loadRigs(): Promise<void> {
    const response = await fetch(`${gatewayUrl}/operator/rigs`, { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as OperatorRig[];
    setRigs(payload);
  }

  const loadRentals = useCallback(async (): Promise<void> => {
    if (!token && !buyerAddress) {
      setRentedRigs([]);
      return;
    }

    const query = buyerAddress ? `?buyer_address=${encodeURIComponent(buyerAddress)}` : "";
    const headers = token ? { authorization: `Bearer ${token}` } : undefined;
    const response = await fetch(`${gatewayUrl}/buyer/rentals${query}`, {
      cache: "no-store",
      headers,
    });
    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as BuyerRentalResponse[];
    setRentedRigs(payload.map(toRentedRig));
  }, [buyerAddress, token]);

  useEffect(() => {
    void loadRigs();
    const interval = window.setInterval(() => void loadRigs(), 5000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    void loadRentals();
    const interval = window.setInterval(() => void loadRentals(), 5000);
    return () => window.clearInterval(interval);
  }, [loadRentals]);

  const liveRigs = useMemo(() => rigs.filter((rig) => rig.status === "idle" && !rig.assignment), [rigs]);
  const filteredLiveRigs = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return liveRigs;
    }

    return liveRigs.filter((rig) => {
      const searchable = [
        rig.rig_name,
        rig.rig_identity,
        rig.ens_name,
        rig.model,
        rig.operator_address,
        String(rig.hardware_summary.hostname ?? ""),
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(normalizedQuery);
    });
  }, [liveRigs, searchQuery]);
  const amountWei = selectedRig ? selectedRig.hourly_rate_wei * durationHours : 0;

  async function issueKeyFromEscrow(escrowId: number, operatorAddress: string): Promise<IssuedApiKey> {
    if (!buyerAddress) {
      throw new Error("Connect buyer wallet first.");
    }
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${gatewayUrl}/admin/api-keys`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        escrow_id: escrowId,
        user_address: buyerAddress,
        operator_address: operatorAddress,
        rig_id: selectedRig?.rig_id,
        duration_hours: durationHours,
      }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return (await response.json()) as IssuedApiKey;
  }

  async function createDemoEscrowAndKey(): Promise<void> {
    if (!buyerAddress || !selectedRig) {
      setError("Connect a buyer wallet and select a paired rig first.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const escrowResponse = await fetch(`${gatewayUrl}/buyer/demo-escrows`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          buyer_address: buyerAddress,
          operator_address: selectedRig.operator_address,
          rig_id: selectedRig.rig_id,
          duration_hours: durationHours,
        }),
      });
      if (!escrowResponse.ok) {
        throw new Error(await escrowResponse.text());
      }
      const escrow = (await escrowResponse.json()) as DemoEscrow;
      const issuedKey = await issueKeyFromEscrow(escrow.escrow_id, escrow.operator_address);
      setApiKey(issuedKey);
      await loadRentals();
      await loadRigs();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not create demo escrow.");
    } finally {
      setBusy(false);
    }
  }

  async function createOnChainEscrowAndKey(): Promise<void> {
    if (!address || !selectedRig || !publicClient) {
      setError("Connect a buyer wallet and select a paired rig first.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: registryAddress as `0x${string}`,
        abi: registryAbi,
        functionName: "stakeUserDeposit",
        args: [selectedRig.operator_address as `0x${string}`, BigInt(durationHours)],
        value: BigInt(amountWei),
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const logs = parseEventLogs({
        abi: registryAbi,
        eventName: "UserEscrowCreated",
        logs: receipt.logs,
      });
      const escrowId = Number(logs[0]?.args.escrowId);
      if (!escrowId) {
        throw new Error("Escrow transaction succeeded, but escrow id was not found in logs.");
      }
      const issuedKey = await issueKeyFromEscrow(escrowId, selectedRig.operator_address);
      setApiKey(issuedKey);
      await loadRentals();
      await loadRigs();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not create on-chain escrow.");
    } finally {
      setBusy(false);
    }
  }

  async function testApiKey(): Promise<void> {
    if (!apiKey) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey.api_key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: selectedRig?.model ?? "gemma3:1b",
          messages: [{ role: "user", content: "You are Aight. Reply with one sentence confirming this inference route works." }],
          max_tokens: 80,
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const payload = await response.json();
      setAgentResponse(payload.choices?.[0]?.message?.content ?? JSON.stringify(payload));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Inference test failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6">
      <BuyerWalletConsole
        buyerAddress={buyerAddress}
        chainId={chainId}
        demoWalletAddress={demoWalletAddress}
        isBaseSepolia={isBaseSepolia}
        onDemoWalletChange={setDemoWalletAddress}
        walletConnected={Boolean(address)}
      />

      <LiveRigMarketplace
        availableRigCount={liveRigs.length}
        onSearchChange={setSearchQuery}
        onSelectRig={(rig) => {
          setSelectedRig(rig);
          setApiKey(null);
          setAgentResponse("");
        }}
        rigs={filteredLiveRigs}
        searchQuery={searchQuery}
        selectedRigId={selectedRig?.rig_id}
      />

      {selectedRig ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur">
          <section className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-4xl border border-cyan-400/30 bg-zinc-950 p-5 shadow-[0_0_80px_rgba(0,120,255,0.18)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-cyan-300">Rent rig</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">{selectedRig.rig_name}</h2>
                <p className="mt-2 break-all text-xs text-zinc-500">{selectedRig.rig_identity}</p>
              </div>
              <button className="rounded-2xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300" onClick={() => setSelectedRig(null)} type="button">
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <label className="grid gap-2 text-xs uppercase tracking-[0.22em] text-zinc-500">
                Hours
                <input
                  className="rounded-2xl border border-zinc-800 bg-black/50 px-4 py-3 text-sm normal-case tracking-normal text-zinc-100 outline-none focus:border-cyan-300/60"
                  min={1}
                  onChange={(event) => setDurationHours(Number(event.target.value))}
                  type="number"
                  value={durationHours}
                />
              </label>
              <Metric label="Hourly rate" value={`${selectedRig.hourly_rate_wei} wei`} />
              <Metric label="Escrow amount" value={`${amountWei} wei`} />
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button className="rounded-2xl bg-cyan-300 px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.14em] text-black disabled:bg-zinc-700 disabled:text-zinc-400" disabled={busy || !walletReady} onClick={() => void createDemoEscrowAndKey()} type="button">
                Demo stake + key
              </button>
              <button className="rounded-2xl border border-cyan-300/40 px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.14em] text-cyan-200 disabled:border-zinc-700 disabled:text-zinc-600" disabled={busy || !address} onClick={() => void createOnChainEscrowAndKey()} type="button">
                Base Sepolia stake + key
              </button>
              <button className="rounded-2xl border border-[#00FF9D]/40 px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.14em] text-[#00FF9D] disabled:border-zinc-700 disabled:text-zinc-600" disabled={busy || !apiKey} onClick={() => void testApiKey()} type="button">
                Test agent call
              </button>
            </div>

            {apiKey ? (
              <div className="mt-5 rounded-3xl border border-[#00FF9D]/20 bg-black/50 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[#00FF9D]">AIGHT API key</p>
                <p className="mt-3 break-all font-mono text-sm text-zinc-100">{apiKey.api_key}</p>
              </div>
            ) : null}

            {agentResponse ? (
              <div className="mt-4 rounded-3xl border border-zinc-800 bg-black/50 p-4 text-sm leading-6 text-zinc-300">
                {agentResponse}
              </div>
            ) : null}

            {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
          </section>
        </div>
      ) : null}

      <RentedRigsSection rentals={rentedRigs} />
    </div>
  );
}

function BuyerWalletConsole({
  buyerAddress,
  chainId,
  demoWalletAddress,
  isBaseSepolia,
  onDemoWalletChange,
  walletConnected,
}: Readonly<{
  buyerAddress: string | undefined;
  chainId: number;
  demoWalletAddress: string;
  isBaseSepolia: boolean;
  onDemoWalletChange: (value: string) => void;
  walletConnected: boolean;
}>) {
  return (
    <section className="rounded-4xl border border-cyan-400/20 bg-zinc-950/80 p-5 shadow-[0_0_60px_rgba(0,120,255,0.08)]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-cyan-300">Buyer Console</p>
          <h1 className="mt-2 text-2xl font-semibold text-white">Connect and rent live inference</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
            Connect a buyer wallet first, or paste a local demo address for Cursor browser testing.
          </p>
        </div>
        <div className="[&_button]:rounded-2xl! [&_button]:bg-cyan-300! [&_button]:px-4! [&_button]:py-3! [&_button]:font-mono! [&_button]:text-sm! [&_button]:font-bold! [&_button]:uppercase! [&_button]:tracking-[0.16em]! [&_button]:text-black!">
          <ConnectButton chainStatus="icon" showBalance={false} />
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <Metric label="Wallet" value={buyerAddress ?? "Not connected"} />
        <Metric label="Network" value={isBaseSepolia ? "Base Sepolia ready" : `Chain ${chainId || "disconnected"}`} />
        <Metric label="Registry" value={registryAddress} />
      </div>

      {!walletConnected ? (
        <label className="mt-5 grid gap-2 text-xs uppercase tracking-[0.22em] text-zinc-500">
          Demo wallet override
          <input
            className="rounded-2xl border border-zinc-800 bg-black/50 px-4 py-3 text-sm normal-case tracking-normal text-zinc-100 outline-none focus:border-cyan-300/60"
            onChange={(event) => onDemoWalletChange(event.target.value)}
            placeholder="Paste buyer public address if MetaMask does not connect"
            value={demoWalletAddress}
          />
        </label>
      ) : null}
    </section>
  );
}

function LiveRigMarketplace({
  availableRigCount,
  onSearchChange,
  onSelectRig,
  rigs,
  searchQuery,
  selectedRigId,
}: Readonly<{
  availableRigCount: number;
  onSearchChange: (value: string) => void;
  onSelectRig: (rig: OperatorRig) => void;
  rigs: OperatorRig[];
  searchQuery: string;
  selectedRigId: string | undefined;
}>) {
  return (
    <section className="rounded-4xl border border-cyan-400/20 bg-zinc-950/75 p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Live rigs</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Marketplace inventory</h2>
          <p className="mt-2 text-sm text-zinc-400">Search by model, rig name, ENS rig ID, host, or operator wallet.</p>
        </div>
        <span className="rounded-full border border-cyan-300/30 px-3 py-1 text-xs text-cyan-200">{availableRigCount} available</span>
      </div>

      <label className="mt-5 grid gap-2 text-xs uppercase tracking-[0.22em] text-zinc-500">
        Search marketplace
        <input
          className="rounded-2xl border border-zinc-800 bg-black/50 px-4 py-3 text-sm normal-case tracking-normal text-zinc-100 outline-none focus:border-cyan-300/60"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Try gemma3, Legion, .rig.aight.eth, or 0x..."
          value={searchQuery}
        />
      </label>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rigs.length > 0 ? (
          rigs.map((rig) => (
            <RigMarketCard
              key={rig.rig_id}
              onSelect={() => onSelectRig(rig)}
              rig={rig}
              selected={selectedRigId === rig.rig_id}
            />
          ))
        ) : (
          <div className="rounded-3xl border border-dashed border-zinc-800 bg-black/30 p-5 text-sm text-zinc-500">
            No available rigs match this search.
          </div>
        )}
      </div>
    </section>
  );
}

function RigMarketCard({ onSelect, rig, selected }: Readonly<{ onSelect: () => void; rig: OperatorRig; selected: boolean }>) {
  return (
    <button
      className={`rounded-3xl border bg-black/50 p-4 text-left transition hover:border-cyan-300/50 ${
        selected ? "border-cyan-300/60" : "border-zinc-800"
      }`}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{rig.rig_name}</p>
          <p className="mt-1 break-all font-mono text-xs text-zinc-500">{rig.ens_name || rig.rig_identity}</p>
        </div>
        <span className="rounded-full border border-[#00FF9D]/30 px-3 py-1 text-xs uppercase tracking-[0.16em] text-[#00FF9D]">
          Available
        </span>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3">
        <Metric label="Model" value={rig.model} />
        <Metric label="Latency" value={`${rig.latency_ms}ms`} />
        <Metric label="Rate" value={`${rig.hourly_rate_wei} wei/h`} />
      </div>
      <p className="mt-4 text-xs leading-5 text-zinc-500">Host: {String(rig.hardware_summary.hostname ?? "unknown")}</p>
    </button>
  );
}

function RentedRigsSection({ rentals }: Readonly<{ rentals: RentedRig[] }>) {
  return (
    <section className="rounded-4xl border border-zinc-800 bg-zinc-950/75 p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Rented rigs</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Generated inference keys</h2>
        </div>
        <span className="rounded-full border border-cyan-300/30 px-3 py-1 text-xs text-cyan-200">
          {rentals.filter((rental) => rental.status === "allocated").length} allocated
        </span>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {rentals.length > 0 ? (
          rentals.map((rental) => (
            <article className="rounded-3xl border border-zinc-800 bg-black/50 p-4" key={`${rental.escrowId}-${rental.apiKey}`}>
              <p className="text-sm font-semibold text-white">{rental.rigName}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="break-all font-mono text-xs text-zinc-500">{rental.rigIdentity}</p>
                <span className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.16em] ${rentalStatusStyle(rental.status)}`}>
                  {rentalStatusLabel(rental.status)}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <Metric label="Escrow" value={`#${rental.escrowId}`} />
                <Metric label="Hours" value={rental.durationHours.toString()} />
                <Metric label="Paid" value={`${rental.amountWei} wei`} />
              </div>
              {rental.status === "terminated" ? (
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Metric label="Used" value={`${rental.usedHours} h`} />
                  <Metric label="Refund" value={`${rental.refundWei} wei`} />
                  <Metric label="Operator payout" value={`${rental.operatorPayoutWei} wei`} />
                  <Metric label="Slash" value={`${rental.slashWei} wei`} />
                </div>
              ) : null}
              {rental.terminationReason ? (
                <p className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-3 text-xs text-amber-100">
                  Terminated because: {rental.terminationReason}
                </p>
              ) : null}
              <p className={`mt-4 break-all rounded-2xl border p-3 font-mono text-xs ${
                rental.status === "allocated"
                  ? "border-[#00FF9D]/20 bg-[#00FF9D]/5 text-[#00FF9D]"
                  : "border-zinc-700 bg-zinc-900/60 text-zinc-500"
              }`}>
                {rental.apiKey}
              </p>
              {rental.status !== "allocated" ? (
                <p className="mt-2 text-xs text-zinc-500">This key is invalid and will not route inference.</p>
              ) : null}
            </article>
          ))
        ) : (
          <div className="rounded-3xl border border-dashed border-zinc-800 bg-black/30 p-5 text-sm text-zinc-500">
            No rented rigs yet. Select a live rig to generate an API key.
          </div>
        )}
      </div>
    </section>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-black/40 p-3">
      <p className="text-[0.65rem] uppercase tracking-[0.25em] text-zinc-600">{label}</p>
      <p className="mt-2 break-all text-sm font-semibold text-zinc-100">{value}</p>
    </div>
  );
}

function normalizeAddress(value: string): `0x${string}` | undefined {
  const trimmed = value.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed) ? (trimmed.toLowerCase() as `0x${string}`) : undefined;
}

function rentalStatusLabel(status: RentedRig["status"]): string {
  if (status === "allocated") {
    return "Allocated";
  }
  if (status === "terminated") {
    return "Terminated";
  }
  return "Expired";
}

function rentalStatusStyle(status: RentedRig["status"]): string {
  if (status === "allocated") {
    return "border-cyan-300/30 text-cyan-200";
  }
  if (status === "terminated") {
    return "border-amber-300/40 bg-amber-300/10 text-amber-200";
  }
  return "border-zinc-700 bg-zinc-900 text-zinc-500";
}

function toRentedRig(payload: BuyerRentalResponse): RentedRig {
  return {
    apiKey: payload.api_key,
    amountWei: payload.amount_wei,
    durationHours: payload.duration_hours,
    escrowId: payload.escrow_id,
    expiresAt: payload.expires_at,
    model: payload.model,
    operatorAddress: payload.operator_address,
    operatorPayoutWei: payload.operator_payout_wei,
    refundWei: payload.refund_wei,
    rentedAt: payload.created_at,
    rigId: payload.rig_id,
    rigIdentity: payload.rig_identity,
    rigName: payload.rig_name,
    slashWei: payload.slash_wei,
    status: payload.status,
    terminatedAt: payload.terminated_at,
    terminationReason: payload.termination_reason,
    usedHours: payload.used_hours,
  };
}
