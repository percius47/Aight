"use client";

import { billingSnapshot } from "@/lib/mock-data";
import { useGatewayPulse } from "@/hooks/use-gateway";

import { BillingCenter } from "./billing-center";
import { OperatorGrid } from "./operator-grid";
import { TokenFlow } from "./token-flow";
import { WalletPanel } from "./wallet-panel";

export function PulseDashboard() {
  const { aggregate, connected, events, operators } = useGatewayPulse();

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0A0A0A] px-5 py-6 text-zinc-100 md:px-8 lg:px-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(0,255,157,0.18),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(0,120,255,0.12),transparent_24%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.03),transparent)]" />

      <div className="relative mx-auto max-w-7xl">
        <header className="grid gap-6 rounded-[2rem] border border-zinc-800 bg-zinc-950/70 p-6 backdrop-blur md:grid-cols-[1.4fr_0.6fr] md:p-8">
          <div>
            <p className="text-xs uppercase tracking-[0.45em] text-[#00FF9D]">Aight Pulse Dashboard</p>
            <h1 className="mt-5 max-w-4xl text-4xl font-bold leading-tight text-white md:text-6xl">
              Your Hardware, Their Intelligence, Our Network.
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-zinc-400 md:text-base">
              A real-time command surface for staked local LLM inference, operator health, prepaid escrow, and live
              token telemetry.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 md:grid-cols-1">
            <HeroMetric label="Nodes" value={aggregate.activeOperators.toString()} />
            <HeroMetric label="Network TPS" value={aggregate.totalTps.toFixed(1)} />
            <HeroMetric label="Avg latency" value={`${aggregate.avgLatency}ms`} />
          </div>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="grid gap-6">
            <TokenFlow connected={connected} events={events} />
            <OperatorGrid operators={operators} />
          </div>
          <aside className="grid content-start gap-6">
            <WalletPanel />
            <BillingCenter billing={billingSnapshot} />
          </aside>
        </div>
      </div>
    </main>
  );
}

function HeroMetric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-3xl border border-zinc-800 bg-black/50 p-4">
      <p className="text-[0.65rem] uppercase tracking-[0.25em] text-zinc-600">{label}</p>
      <p className="mt-3 text-2xl font-bold text-[#00FF9D]">{value}</p>
    </div>
  );
}
