"use client";

import { billingSnapshot } from "@/lib/mock-data";
import { useAightAccount } from "@/hooks/use-aight-account";
import { useGatewayPulse } from "@/hooks/use-gateway";

import { AccountConsole } from "./account-console";
import { BillingCenter } from "./billing-center";
import { BuyerConsole } from "./buyer-console";
import { OperatorGrid } from "./operator-grid";
import { OperatorConsole } from "./operator-console";
import { TokenFlow } from "./token-flow";
import { WalletPanel } from "./wallet-panel";

export function PulseDashboard() {
  const { connected, events, operators } = useGatewayPulse();
  const { account } = useAightAccount();

  if (!account) {
    return (
      <main className="relative min-h-screen overflow-hidden bg-[#0A0A0A] px-5 py-6 text-zinc-100 md:px-8 lg:px-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(0,255,157,0.18),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(0,120,255,0.12),transparent_24%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.03),transparent)]" />
        <div className="relative mx-auto max-w-4xl">
          <AccountConsole />
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0A0A0A] px-5 py-6 text-zinc-100 md:px-8 lg:px-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(0,255,157,0.18),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(0,120,255,0.12),transparent_24%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.03),transparent)]" />

      <div className="relative mx-auto max-w-7xl">
        {account.role === "operator" ? (
          <>
            <OperatorConsole />
            <div className="mt-6 grid gap-6">
              <TokenFlow connected={connected} events={events} />
              <OperatorGrid operators={operators} />
            </div>
          </>
        ) : (
          <>
            <BuyerConsole />
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
          </>
        )}
      </div>
    </main>
  );
}
