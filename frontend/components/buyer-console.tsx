"use client";

import { parseEventLogs } from "viem";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";

import { useAightAccount } from "@/hooks/use-aight-account";
import { gatewayUrl, registryAddress } from "@/lib/config";
import type { BuyerRentalResponse, IssuedApiKey, OperatorRig, RentedRig } from "@/lib/types";

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

const baseSepoliaTxUrl = (hash: string) => `https://sepolia.basescan.org/tx/${hash}`;

export function BuyerConsole() {
  const { address } = useAccount();
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
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [purchaseConfirmOpen, setPurchaseConfirmOpen] = useState(false);
  const [testingToolsOpen, setTestingToolsOpen] = useState(false);
  const [latestEscrowReceipt, setLatestEscrowReceipt] = useState<{
    amountWei: number;
    escrowId: number;
    operatorAddress: string;
    txHash: string;
  } | null>(null);

  const buyerAddress = address ?? normalizeAddress(demoWalletAddress);

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

  async function issueKeyFromEscrow(escrowId: number, operatorAddress: string, escrowTxHash: string): Promise<IssuedApiKey> {
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
        escrow_tx_hash: escrowTxHash,
      }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return (await response.json()) as IssuedApiKey;
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
      const issuedKey = await issueKeyFromEscrow(escrowId, selectedRig.operator_address, hash);
      setApiKey(issuedKey);
      setLatestEscrowReceipt({
        amountWei,
        escrowId,
        operatorAddress: selectedRig.operator_address,
        txHash: hash,
      });
      await loadRentals();
      await loadRigs();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not create on-chain escrow.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPurchase(): Promise<void> {
    setPurchaseConfirmOpen(false);
    await createOnChainEscrowAndKey();
  }

  async function deleteRental(rental: RentedRig): Promise<void> {
    if (!token && !buyerAddress) {
      setError("Connect a buyer wallet or login first.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const query = buyerAddress ? `?buyer_address=${encodeURIComponent(buyerAddress)}` : "";
      const headers = token ? { authorization: `Bearer ${token}` } : undefined;
      const response = await fetch(`${gatewayUrl}/buyer/rentals/${rental.rentalId}${query}`, {
        method: "DELETE",
        headers,
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      await loadRentals();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not delete rental.");
    } finally {
      setBusy(false);
    }
  }

  async function copyKey(key: string): Promise<void> {
    await navigator.clipboard.writeText(key);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((currentKey) => (currentKey === key ? null : currentKey)), 1600);
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
      await loadRentals();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Inference test failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6">
      <BuyerTestingTools
        demoWalletAddress={demoWalletAddress}
        isOpen={testingToolsOpen}
        onDemoWalletChange={setDemoWalletAddress}
        onToggle={() => setTestingToolsOpen((current) => !current)}
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
              <button
                className="rounded-2xl bg-cyan-300 px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.14em] text-black disabled:bg-zinc-700 disabled:text-zinc-400"
                disabled={busy || !address}
                onClick={() => setPurchaseConfirmOpen(true)}
                type="button"
              >
                Base Sepolia stake + key
              </button>
            </div>

            {apiKey ? (
              <div className="mt-5 rounded-3xl border border-[#00FF9D]/20 bg-black/50 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[#00FF9D]">AIGHT API key</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <p className="min-w-0 flex-1 break-all rounded-2xl border border-[#00FF9D]/20 bg-[#00FF9D]/5 p-3 font-mono text-sm text-zinc-100">
                    {apiKey.api_key}
                  </p>
                  <IconButton
                    active={copiedKey === apiKey.api_key}
                    label={copiedKey === apiKey.api_key ? "API key copied" : "Copy API key"}
                    onClick={() => void copyKey(apiKey.api_key)}
                    tone="copy"
                  >
                    <CopyIcon />
                  </IconButton>
                  <button className="rounded-2xl border border-[#00FF9D]/40 px-4 py-3 font-mono text-xs font-bold uppercase tracking-[0.14em] text-[#00FF9D] disabled:border-zinc-700 disabled:text-zinc-600" disabled={busy} onClick={() => void testApiKey()} type="button">
                    Test agent call
                  </button>
                </div>
                {latestEscrowReceipt?.escrowId === apiKey.escrow_id ? (
                  <TxReceiptCard
                    amountWei={latestEscrowReceipt.amountWei}
                    label="Escrow receipt"
                    primary={`Escrow #${latestEscrowReceipt.escrowId}`}
                    secondary={`Operator ${shortAddress(latestEscrowReceipt.operatorAddress)}`}
                    txHash={latestEscrowReceipt.txHash}
                  />
                ) : null}
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

      {selectedRig && purchaseConfirmOpen ? (
        <PurchaseConfirmModal
          amountWei={amountWei}
          busy={busy}
          durationHours={durationHours}
          onCancel={() => setPurchaseConfirmOpen(false)}
          onConfirm={() => void confirmPurchase()}
          rig={selectedRig}
        />
      ) : null}

      <RentedRigsSection
        copiedKey={copiedKey}
        busy={busy}
        onCopy={(key) => void copyKey(key)}
        onDelete={(rental) => void deleteRental(rental)}
        rentals={rentedRigs}
      />
    </div>
  );
}

function BuyerTestingTools({
  demoWalletAddress,
  isOpen,
  onDemoWalletChange,
  onToggle,
  walletConnected,
}: Readonly<{
  demoWalletAddress: string;
  isOpen: boolean;
  onDemoWalletChange: (value: string) => void;
  onToggle: () => void;
  walletConnected: boolean;
}>) {
  const [isLocalhost, setIsLocalhost] = useState(false);

  useEffect(() => {
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    setIsLocalhost(localHosts.has(window.location.hostname));
  }, []);

  if (!isLocalhost) {
    return null;
  }

  return (
    <section className="flex justify-end">
      <div className="w-full max-w-2xl rounded-3xl border border-zinc-800 bg-black/35 p-3">
        <button
          className="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left font-mono text-xs font-bold uppercase tracking-[0.16em] text-zinc-400 transition hover:text-cyan-200"
          onClick={onToggle}
          type="button"
        >
          <span>Testing tools</span>
          <span>{isOpen ? "Hide" : "Show"}</span>
        </button>

        {isOpen && !walletConnected ? (
          <label className="mt-3 grid gap-2 px-3 pb-3 text-xs uppercase tracking-[0.22em] text-zinc-500">
            Demo wallet override
            <input
              className="rounded-2xl border border-zinc-800 bg-black/50 px-4 py-3 text-sm normal-case tracking-normal text-zinc-100 outline-none focus:border-cyan-300/60"
              onChange={(event) => onDemoWalletChange(event.target.value)}
              placeholder="Paste buyer public address if MetaMask does not connect"
              value={demoWalletAddress}
            />
          </label>
        ) : null}

        {isOpen && walletConnected ? (
          <p className="px-3 pb-3 text-xs leading-5 text-zinc-500">
            Demo wallet override is hidden while a real wallet is connected.
          </p>
        ) : null}
      </div>
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

function PurchaseConfirmModal({
  amountWei,
  busy,
  durationHours,
  onCancel,
  onConfirm,
  rig,
}: Readonly<{
  amountWei: number;
  busy: boolean;
  durationHours: number;
  onCancel: () => void;
  onConfirm: () => void;
  rig: OperatorRig;
}>) {
  return (
    <div className="fixed inset-0 z-60 grid place-items-center bg-black/80 px-4 backdrop-blur">
      <section className="w-full max-w-2xl rounded-4xl border border-cyan-300/30 bg-zinc-950 p-5 shadow-[0_0_80px_rgba(0,120,255,0.22)]">
        <p className="text-xs uppercase tracking-[0.35em] text-cyan-300">Confirm purchase</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">Purchase LLM inference</h2>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          You are purchasing inference on this rig for {durationHours} hour{durationHours === 1 ? "" : "s"}.
          Once confirmed, the on-chain stake and key generation action cannot be reversed.
        </p>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <Metric label="Rig" value={rig.rig_name} />
          <Metric label="Model" value={rig.model} />
          <Metric label="Rig ID" value={rig.rig_identity} />
          <Metric label="Escrow amount" value={`${amountWei} wei`} />
        </div>

        <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm leading-6 text-amber-100">
          Confirm that you understand this will allocate the selected rig and generate an API key for this rental.
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button className="rounded-2xl border border-zinc-700 px-5 py-3 text-sm text-zinc-300" disabled={busy} onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="rounded-2xl bg-cyan-300 px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.14em] text-black disabled:bg-zinc-700 disabled:text-zinc-400" disabled={busy} onClick={onConfirm} type="button">
            {busy ? "Working..." : "Confirm on-chain stake"}
          </button>
        </div>
      </section>
    </div>
  );
}

function RentedRigsSection({
  busy,
  copiedKey,
  onCopy,
  onDelete,
  rentals,
}: Readonly<{
  busy: boolean;
  copiedKey: string | null;
  onCopy: (key: string) => void;
  onDelete: (rental: RentedRig) => void;
  rentals: RentedRig[];
}>) {
  return (
    <section className="rounded-4xl border border-zinc-800 bg-zinc-950/75 p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="mt-2 text-2xl font-semibold text-white">Your rentals</p>
        <span className="rounded-full border border-cyan-300/30 px-3 py-1 text-xs text-cyan-200">
          {rentals.filter((rental) => rental.status === "allocated").length}{" "}
          allocated
        </span>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {rentals.length > 0 ? (
          rentals.map((rental) => (
            <article
              className="rounded-3xl border border-zinc-800 bg-black/50 p-4"
              key={`${rental.escrowId}-${rental.apiKey}`}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-white">
                  {rental.rigName}
                </p>
                {rental.status !== "allocated" ? (
                  <IconButton
                    disabled={busy}
                    label="Delete inactive rental"
                    onClick={() => onDelete(rental)}
                    tone="delete"
                  >
                    <TrashIcon />
                  </IconButton>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="break-all font-mono text-xs text-zinc-500">
                  {rental.rigIdentity}
                </p>
                <span
                  className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.16em] ${rentalStatusStyle(rental.status)}`}
                >
                  {rentalStatusLabel(rental.status)}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <Metric label="Escrow" value={`#${rental.escrowId}`} />
                <Metric label="Hours" value={rental.durationHours.toString()} />
                <Metric label="Paid" value={`${rental.amountWei} wei`} />
              </div>
              {rental.escrowTxHash ? (
                <TxReceiptCard
                  amountWei={rental.amountWei}
                  label="Rental stake receipt"
                  primary={`Escrow #${rental.escrowId}`}
                  secondary={`Operator ${shortAddress(rental.operatorAddress)}`}
                  txHash={rental.escrowTxHash}
                />
              ) : null}
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Metric label="Operator 90%" value={`${rental.operatorPayoutWei || Math.floor(rental.amountWei * 0.9)} wei`} />
                <Metric label="Treasury 10%" value={`${Math.max(0, rental.amountWei - (rental.operatorPayoutWei || Math.floor(rental.amountWei * 0.9)))} wei`} />
              </div>
              <div className="mt-4 rounded-3xl border border-cyan-300/15 bg-cyan-300/5 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-[0.24em] text-cyan-200">Live usage</p>
                  <p className="text-xs text-zinc-500">
                    {rental.lastUsedAt ? `Last used ${formatTime(rental.lastUsedAt)}` : "No calls yet"}
                  </p>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <Metric label="Calls" value={rental.completionCount.toString()} />
                  <Metric label="Tokens" value={rental.totalTokens.toString()} />
                  <Metric label="Prompt / output" value={`${rental.promptTokens}/${rental.completionTokens}`} />
                </div>
              </div>
              {rental.status === "terminated" ? (
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Metric label="Used" value={`${rental.usedHours} h`} />
                  <Metric label="Refund" value={`${rental.refundWei} wei`} />
                  <Metric
                    label="Operator payout"
                    value={`${rental.operatorPayoutWei} wei`}
                  />
                  <Metric label="Slash" value={`${rental.slashWei} wei`} />
                </div>
              ) : null}
              {rental.terminationReason ? (
                <p className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-3 text-xs text-amber-100">
                  Terminated because: {rental.terminationReason}
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <p
                  className={`min-w-0 flex-1 break-all rounded-2xl border p-3 font-mono text-xs ${
                    rental.status === "allocated"
                      ? "border-[#00FF9D]/20 bg-[#00FF9D]/5 text-[#00FF9D]"
                      : "border-zinc-700 bg-zinc-900/60 text-zinc-500"
                  }`}
                >
                  {rental.apiKey}
                </p>
                <IconButton
                  active={copiedKey === rental.apiKey}
                  label={
                    copiedKey === rental.apiKey
                      ? "API key copied"
                      : "Copy API key"
                  }
                  onClick={() => onCopy(rental.apiKey)}
                  tone="copy"
                >
                  <CopyIcon />
                </IconButton>
              </div>
              {rental.status !== "allocated" ? (
                <p className="mt-2 text-xs text-zinc-500">
                  This key is invalid and will not route inference.
                </p>
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

function TxReceiptCard({
  amountWei,
  label,
  primary,
  secondary,
  txHash,
}: Readonly<{ amountWei: number; label: string; primary: string; secondary: string; txHash: string }>) {
  return (
    <div className="mt-4 rounded-3xl border border-cyan-300/20 bg-cyan-300/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-cyan-200">{label}</p>
          <p className="mt-2 text-sm font-semibold text-white">{primary}</p>
          <p className="mt-1 text-xs text-zinc-500">{secondary}</p>
        </div>
        <a
          className="rounded-2xl border border-cyan-300/40 px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.14em] text-cyan-200 transition hover:bg-cyan-300/10"
          href={baseSepoliaTxUrl(txHash)}
          rel="noreferrer"
          target="_blank"
        >
          View on BaseScan
        </a>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Metric label="Amount" value={`${amountWei} wei`} />
        <Metric label="Tx hash" value={txHash} />
      </div>
    </div>
  );
}

function IconButton({
  active = false,
  children,
  disabled = false,
  label,
  onClick,
  tone,
}: Readonly<{
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  tone: "copy" | "delete";
}>) {
  const toneClass =
    tone === "delete"
      ? "text-zinc-400 hover:border-red-300/50 hover:text-red-200"
      : active
        ? "border-[#00FF9D]/50 text-[#00FF9D]"
        : "text-zinc-300 hover:border-[#00FF9D]/50 hover:text-[#00FF9D]";

  return (
    <button
      aria-label={label}
      className={`grid size-11 place-items-center rounded-2xl border border-zinc-700 bg-black/30 transition disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path d="M8 8V5.8C8 4.8 8.8 4 9.8 4h8.4c1 0 1.8.8 1.8 1.8v8.4c0 1-.8 1.8-1.8 1.8H16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M4 9.8C4 8.8 4.8 8 5.8 8h8.4c1 0 1.8.8 1.8 1.8v8.4c0 1-.8 1.8-1.8 1.8H5.8c-1 0-1.8-.8-1.8-1.8V9.8Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path d="M5 7h14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M9 7V5.8C9 4.8 9.8 4 10.8 4h2.4c1 0 1.8.8 1.8 1.8V7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M7 7l.8 12.2c.1 1 1 1.8 2 1.8h4.4c1 0 1.9-.8 2-1.8L17 7" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M10.5 11v5M13.5 11v5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
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

function shortAddress(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function toRentedRig(payload: BuyerRentalResponse): RentedRig {
  return {
    apiKey: payload.api_key,
    amountWei: payload.amount_wei,
    completionCount: payload.completion_count ?? 0,
    completionTokens: payload.completion_tokens ?? 0,
    durationHours: payload.duration_hours,
    escrowId: payload.escrow_id,
    escrowTxHash: payload.escrow_tx_hash ?? null,
    expiresAt: payload.expires_at,
    lastUsedAt: payload.last_used_at ?? null,
    model: payload.model,
    operatorAddress: payload.operator_address,
    operatorPayoutWei: payload.operator_payout_wei,
    promptTokens: payload.prompt_tokens ?? 0,
    refundWei: payload.refund_wei,
    rentalId: payload.rental_id,
    rentedAt: payload.created_at,
    rigId: payload.rig_id,
    rigIdentity: payload.rig_identity,
    rigName: payload.rig_name,
    slashWei: payload.slash_wei,
    status: payload.status,
    terminatedAt: payload.terminated_at,
    terminationReason: payload.termination_reason,
    totalTokens: payload.total_tokens ?? 0,
    usedHours: payload.used_hours,
  };
}
