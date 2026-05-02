"use client";

import { useAightAccount } from "@/hooks/use-aight-account";

import { AccountConsole } from "./account-console";
import { BuyerConsole } from "./buyer-console";
import { OperatorRigConsole } from "./operator-rig-console";

export function PulseDashboard() {
  const { account } = useAightAccount();

  if (!account) {
    return (
      <main className="relative min-h-[calc(100vh-81px)] overflow-hidden bg-[#0A0A0A] px-5 py-6 text-zinc-100 md:px-8 lg:px-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(0,255,157,0.18),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(0,120,255,0.12),transparent_24%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.03),transparent)]" />
        <div className="relative mx-auto max-w-7xl">
          <AccountConsole />
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-[calc(100vh-81px)] overflow-hidden bg-[#0A0A0A] px-5 py-6 text-zinc-100 md:px-8 lg:px-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(0,255,157,0.18),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(0,120,255,0.12),transparent_24%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.03),transparent)]" />

      <div className="relative mx-auto max-w-7xl">
        {account.role === "operator" ? (
          <OperatorRigConsole />
        ) : (
          <BuyerConsole />
        )}
      </div>
    </main>
  );
}
