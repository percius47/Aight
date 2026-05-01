"use client";

import { useAightAccount } from "@/hooks/use-aight-account";

import { AccountConsole } from "./account-console";
import { BuyerConsole } from "./buyer-console";
import { OperatorRigConsole } from "./operator-rig-console";

export function PulseDashboard() {
  const { account, logout } = useAightAccount();

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
        <SessionBar
          accountName={account.username}
          role={account.role}
          walletAddress={account.wallet_address}
          onLogout={() => void logout()}
        />

        {account.role === "operator" ? (
          <OperatorRigConsole />
        ) : (
          <BuyerConsole />
        )}
      </div>
    </main>
  );
}

function SessionBar({
  accountName,
  onLogout,
  role,
  walletAddress,
}: Readonly<{ accountName: string; onLogout: () => void; role: string; walletAddress: string | null }>) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-zinc-800 bg-black/50 p-4 backdrop-blur">
      <div>
        <p className="text-[0.65rem] uppercase tracking-[0.28em] text-zinc-500">Signed in</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-white">{accountName}</span>
          <span className="rounded-full border border-[#00FF9D]/30 px-3 py-1 text-xs uppercase tracking-[0.16em] text-[#00FF9D]">
            {role}
          </span>
          <span className="break-all text-xs text-zinc-500">{walletAddress ?? "No wallet linked"}</span>
        </div>
      </div>

      <button
        className="rounded-2xl border border-zinc-700 px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.16em] text-zinc-300 transition hover:border-red-300/50 hover:text-red-200"
        onClick={onLogout}
        type="button"
      >
        Log out
      </button>
    </div>
  );
}
