"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";

import { gatewayUrl } from "@/lib/config";
import type { OperatorRig, PairingCode, RigStatus } from "@/lib/types";

const statusStyles: Record<RigStatus, string> = {
  installing: "border-sky-400/40 bg-sky-400/10 text-sky-200",
  idle: "border-[#00FF9D]/40 bg-[#00FF9D]/10 text-[#00FF9D]",
  busy: "border-amber-300/40 bg-amber-300/10 text-amber-200",
  halted: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
  offline: "border-zinc-700 bg-zinc-900 text-zinc-500",
  error: "border-red-400/40 bg-red-400/10 text-red-200",
};

export function OperatorConsole() {
  const { address, isConnected } = useAccount();
  const [pairingCode, setPairingCode] = useState<PairingCode | null>(null);
  const [rigs, setRigs] = useState<OperatorRig[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRigs = useCallback(async () => {
    if (!address) {
      setRigs([]);
      return;
    }

    try {
      const response = await fetch(`${gatewayUrl}/operator/rigs?operator_address=${address}`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as OperatorRig[];
      setRigs(payload);
    } catch {
      setError("Gateway is not reachable yet.");
    }
  }, [address]);

  useEffect(() => {
    void loadRigs();
    const interval = window.setInterval(() => void loadRigs(), 5000);
    return () => window.clearInterval(interval);
  }, [loadRigs]);

  const setupCommands = useMemo(() => {
    const code = pairingCode?.pairing_code ?? "AIGHT-123456";
    return {
      windows: `powershell -ExecutionPolicy Bypass -NoProfile -Command "iwr -UseBasicParsing https://raw.githubusercontent.com/percius47/Aight/main/operator/install.ps1 -OutFile $env:TEMP\\aight-install.ps1; & $env:TEMP\\aight-install.ps1 -Pair ${code} -Model gemma3:1b"`,
      mac: `curl -fsSL https://raw.githubusercontent.com/percius47/Aight/main/operator/install.sh | bash -s -- ${code} gemma3:1b`,
    };
  }, [pairingCode]);

  async function createPairingCode(): Promise<void> {
    if (!address) {
      setError("Connect a wallet before creating a rig pairing code.");
      return;
    }

    setIsCreating(true);
    setError(null);
    try {
      const response = await fetch(`${gatewayUrl}/operator/pairing-codes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operator_address: address,
          rig_name: "Demo Rig",
          ttl_minutes: 10,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const payload = (await response.json()) as PairingCode;
      setPairingCode(payload);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Unable to create pairing code.");
    } finally {
      setIsCreating(false);
    }
  }

  async function copyCommand(label: string, command: string): Promise<void> {
    await navigator.clipboard.writeText(command);
    setCopiedCommand(label);
    window.setTimeout(() => setCopiedCommand(null), 1600);
  }

  return (
    <section className="relative overflow-hidden rounded-4xl border border-[#00FF9D]/20 bg-zinc-950/80 p-5 shadow-[0_0_60px_rgba(0,255,157,0.08)]">
      <div className="absolute right-0 top-0 h-48 w-48 rounded-full bg-[#00FF9D]/10 blur-3xl" />
      <div className="relative grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-[#00FF9D]">Operator Console</p>
          <h2 className="mt-3 text-2xl font-semibold text-white">Pair a Mac or Windows demo rig</h2>
          <p className="mt-4 text-sm leading-6 text-zinc-400">
            Generate a one-time pairing code from this wallet, run the installer on a rig, then watch the agent report
            status without exposing any wallet private key.
          </p>

          <div className="mt-6 grid gap-3 text-sm">
            {["Connect wallet", "Stake as operator", "Generate pairing code", "Run rig command", "Watch heartbeat"].map(
              (item, index) => (
                <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-black/40 p-3" key={item}>
                  <span className="grid h-7 w-7 place-items-center rounded-full border border-[#00FF9D]/30 text-xs text-[#00FF9D]">
                    {index + 1}
                  </span>
                  <span className="text-zinc-300">{item}</span>
                </div>
              ),
            )}
          </div>

          <button
            className="mt-6 rounded-2xl bg-[#00FF9D] px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.16em] text-black disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
            disabled={!isConnected || isCreating}
            onClick={() => void createPairingCode()}
            type="button"
          >
            {isCreating ? "Creating..." : "Create pairing code"}
          </button>

          {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
        </div>

        <div className="grid gap-4">
          <div className="rounded-3xl border border-zinc-800 bg-black/50 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Pairing code</p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span className="font-mono text-3xl font-bold text-white">{pairingCode?.pairing_code ?? "Not generated"}</span>
              <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">
                {pairingCode ? `Expires ${formatTime(pairingCode.expires_at)}` : "10 min TTL"}
              </span>
            </div>
          </div>

          <CommandCard
            command={setupCommands.windows}
            copied={copiedCommand === "windows"}
            label="Windows PowerShell"
            onCopy={() => void copyCommand("windows", setupCommands.windows)}
          />
          <CommandCard
            command={setupCommands.mac}
            copied={copiedCommand === "mac"}
            label="macOS/Linux Bash"
            onCopy={() => void copyCommand("mac", setupCommands.mac)}
          />
        </div>
      </div>

      <div className="relative mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rigs.length > 0 ? (
          rigs.map((rig) => <RigCard key={rig.rig_id} rig={rig} />)
        ) : (
          <div className="rounded-3xl border border-dashed border-zinc-800 bg-black/30 p-5 text-sm text-zinc-500">
            No rigs paired for this wallet yet.
          </div>
        )}
      </div>
    </section>
  );
}

function CommandCard({
  command,
  copied,
  label,
  onCopy,
}: Readonly<{ command: string; copied: boolean; label: string; onCopy: () => void }>) {
  return (
    <div className="rounded-3xl border border-zinc-800 bg-black/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">{label}</p>
        <button className="rounded-full border border-[#00FF9D]/30 px-3 py-1 text-xs text-[#00FF9D]" onClick={onCopy} type="button">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-3 break-all rounded-2xl bg-zinc-950 p-3 font-mono text-xs leading-5 text-zinc-300">{command}</p>
    </div>
  );
}

function RigCard({ rig }: Readonly<{ rig: OperatorRig }>) {
  return (
    <article className="rounded-3xl border border-zinc-800 bg-black/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{rig.rig_name}</p>
          <p className="mt-1 font-mono text-xs text-zinc-500">{rig.rig_id}</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.16em] ${statusStyles[rig.status]}`}>
          {rig.status}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
        <Metric label="Model" value={rig.model} />
        <Metric label="Latency" value={`${rig.latency_ms}ms`} />
        <Metric label="TPS" value={rig.tokens_per_second.toFixed(1)} />
      </div>

      <div className="mt-4 rounded-2xl border border-zinc-900 bg-zinc-950 p-3 text-xs leading-5 text-zinc-500">
        <p>Load: {Math.round(rig.current_load * 100)}%</p>
        <p>Last heartbeat: {formatTime(rig.last_heartbeat_at)}</p>
        <p className="break-all">Host: {String(rig.hardware_summary.hostname ?? "unknown")}</p>
      </div>
    </article>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-3">
      <p className="text-[0.65rem] uppercase tracking-[0.25em] text-zinc-600">{label}</p>
      <p className="mt-2 truncate text-sm font-semibold text-zinc-100">{value}</p>
    </div>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(
    new Date(value),
  );
}
