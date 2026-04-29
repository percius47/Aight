"use client";

import { parseEventLogs } from "viem";
import { useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";

import { gatewayUrl, registryAddress } from "@/lib/config";
import type { DemoEscrow, IssuedApiKey, OperatorRig } from "@/lib/types";

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

export function BuyerConsole() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [rigs, setRigs] = useState<OperatorRig[]>([]);
  const [selectedRigId, setSelectedRigId] = useState("");
  const [durationHours, setDurationHours] = useState(1);
  const [apiKey, setApiKey] = useState<IssuedApiKey | null>(null);
  const [agentResponse, setAgentResponse] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadRigs(): Promise<void> {
      const response = await fetch(`${gatewayUrl}/operator/rigs`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as OperatorRig[];
      setRigs(payload);
      setSelectedRigId((current) => current || payload[0]?.rig_id || "");
    }

    void loadRigs();
    const interval = window.setInterval(() => void loadRigs(), 5000);
    return () => window.clearInterval(interval);
  }, []);

  const selectedRig = useMemo(() => rigs.find((rig) => rig.rig_id === selectedRigId) ?? null, [rigs, selectedRigId]);
  const amountWei = selectedRig ? selectedRig.hourly_rate_wei * durationHours : 0;

  async function issueKeyFromEscrow(escrowId: number, operatorAddress: string): Promise<IssuedApiKey> {
    if (!address) {
      throw new Error("Connect buyer wallet first.");
    }
    const response = await fetch(`${gatewayUrl}/admin/api-keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        escrow_id: escrowId,
        user_address: address,
        operator_address: operatorAddress,
        duration_hours: durationHours,
      }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return (await response.json()) as IssuedApiKey;
  }

  async function createDemoEscrowAndKey(): Promise<void> {
    if (!address || !selectedRig) {
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
          buyer_address: address,
          operator_address: selectedRig.operator_address,
          duration_hours: durationHours,
        }),
      });
      if (!escrowResponse.ok) {
        throw new Error(await escrowResponse.text());
      }
      const escrow = (await escrowResponse.json()) as DemoEscrow;
      setApiKey(await issueKeyFromEscrow(escrow.escrow_id, escrow.operator_address));
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
      setApiKey(await issueKeyFromEscrow(escrowId, selectedRig.operator_address));
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
    <section className="rounded-4xl border border-cyan-400/20 bg-zinc-950/75 p-5 shadow-[0_0_60px_rgba(0,120,255,0.08)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-cyan-300">Buyer Workbench</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Choose rig, stake, receive API key</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
            Use demo escrow for a live local walkthrough, or Base Sepolia escrow when the operator wallet is staked
            on-chain in `AightRegistry`.
          </p>
        </div>
        <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">
          {isConnected ? "Wallet connected" : "Connect buyer wallet"}
        </span>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_0.5fr_0.8fr]">
        <label className="grid gap-2 text-xs uppercase tracking-[0.22em] text-zinc-500">
          Paired rig
          <select
            className="rounded-2xl border border-zinc-800 bg-black/50 px-4 py-3 text-sm normal-case tracking-normal text-zinc-100 outline-none focus:border-cyan-300/60"
            onChange={(event) => setSelectedRigId(event.target.value)}
            value={selectedRigId}
          >
            {rigs.map((rig) => (
              <option key={rig.rig_id} value={rig.rig_id}>
                {rig.rig_name} · {rig.model} · {rig.operator_address}
              </option>
            ))}
          </select>
        </label>

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

        <div className="rounded-2xl border border-zinc-800 bg-black/40 p-4">
          <p className="text-[0.65rem] uppercase tracking-[0.25em] text-zinc-600">Escrow amount</p>
          <p className="mt-2 break-all text-sm font-semibold text-zinc-100">{amountWei} wei</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button className="rounded-2xl bg-cyan-300 px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.14em] text-black disabled:bg-zinc-700 disabled:text-zinc-400" disabled={busy || !selectedRig || !isConnected} onClick={() => void createDemoEscrowAndKey()} type="button">
          Demo stake + key
        </button>
        <button className="rounded-2xl border border-cyan-300/40 px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.14em] text-cyan-200 disabled:border-zinc-700 disabled:text-zinc-600" disabled={busy || !selectedRig || !isConnected} onClick={() => void createOnChainEscrowAndKey()} type="button">
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
  );
}
