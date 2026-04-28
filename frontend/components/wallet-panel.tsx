"use client";

import { useLogin, usePrivy } from "@privy-io/react-auth";

import { hasPrivyAppId } from "@/lib/config";

export function WalletPanel() {
  if (!hasPrivyAppId) {
    return <DemoWalletPanel />;
  }

  return <ConnectedWalletPanel />;
}

function ConnectedWalletPanel() {
  const { authenticated, logout, ready, user } = usePrivy();
  const { login } = useLogin();

  const walletAddress = user?.wallet?.address;

  return (
    <div className="rounded-3xl border border-[#00FF9D]/20 bg-zinc-950/80 p-5 shadow-[0_0_60px_rgba(0,255,157,0.08)]">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-[#00FF9D]">Base Sepolia</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Operator + buyer console</h2>
        </div>
        <div className="h-3 w-3 rounded-full bg-[#00FF9D] shadow-[0_0_18px_#00FF9D]" />
      </div>

      <p className="mt-5 text-sm leading-6 text-zinc-400">
        Connect a wallet to stake, reserve inference hours, and bind an escrow to an AIGHT_API_KEY.
      </p>

      <button
        className="mt-6 w-full rounded-2xl border border-[#00FF9D]/40 bg-[#00FF9D] px-4 py-3 text-sm font-bold uppercase tracking-[0.2em] text-black transition hover:bg-[#7affc8] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!ready}
        onClick={() => (authenticated ? void logout() : login())}
        type="button"
      >
        {authenticated ? "Disconnect wallet" : "Connect wallet"}
      </button>

      <div className="mt-4 rounded-2xl border border-zinc-800 bg-black/40 p-4 text-xs text-zinc-500">
        {walletAddress ? <span className="text-zinc-200">{walletAddress}</span> : "No wallet connected"}
      </div>
    </div>
  );
}

function DemoWalletPanel() {
  return (
    <div className="rounded-3xl border border-[#00FF9D]/20 bg-zinc-950/80 p-5 shadow-[0_0_60px_rgba(0,255,157,0.08)]">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-[#00FF9D]">Base Sepolia</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Operator + buyer console</h2>
        </div>
        <div className="h-3 w-3 rounded-full bg-zinc-700" />
      </div>

      <p className="mt-5 text-sm leading-6 text-zinc-400">
        Add `NEXT_PUBLIC_PRIVY_APP_ID` to enable wallet login, staking, and escrow actions.
      </p>

      <div className="mt-6 rounded-2xl border border-zinc-800 bg-black/40 px-4 py-3 text-sm uppercase tracking-[0.2em] text-zinc-500">
        Demo mode
      </div>
    </div>
  );
}
