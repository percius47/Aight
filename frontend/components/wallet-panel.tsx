"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId } from "wagmi";

import { registryAddress } from "@/lib/config";

export function WalletPanel() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

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

      <div className="mt-6 [&_button]:!rounded-2xl [&_button]:!bg-[#00FF9D] [&_button]:!px-4 [&_button]:!py-3 [&_button]:!font-mono [&_button]:!text-sm [&_button]:!font-bold [&_button]:!uppercase [&_button]:!tracking-[0.16em] [&_button]:!text-black">
        <ConnectButton chainStatus="icon" showBalance={false} />
      </div>

      <div className="mt-4 rounded-2xl border border-zinc-800 bg-black/40 p-4 text-xs text-zinc-500">
        {isConnected && address ? <span className="text-zinc-200">{address}</span> : "No wallet connected"}
      </div>

      <div className="mt-3 rounded-2xl border border-zinc-800 bg-black/40 p-4 text-xs leading-5 text-zinc-500">
        <p>Chain ID: {chainId || "disconnected"}</p>
        <p className="mt-1 break-all">Registry: {registryAddress}</p>
      </div>
    </div>
  );
}
