"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Image from "next/image";

import fullLogo from "@/Aight_FullLogo_wText.png";
import { useAightAccount } from "@/hooks/use-aight-account";

export function AppTopbar() {
  const { account, logout } = useAightAccount();

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-black/80 px-4 py-3 text-zinc-100 shadow-[0_18px_60px_rgba(0,0,0,0.42)] backdrop-blur-xl md:px-8 lg:px-10">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="relative h-16 w-37 sm:h-18 sm:w-42">
            <Image
              alt="AIGHT"
              className="object-contain object-left"
              fill
              priority
              sizes="(max-width: 640px) 148px, 168px"
              src={fullLogo}
            />
          </div>
          <div className="hidden h-8 w-px bg-linear-to-b from-transparent via-white/20 to-transparent md:block" />
          <p className="hidden max-w-xs text-xs uppercase tracking-[0.24em] text-zinc-500 lg:block">
            Local inference marketplace
          </p>
        </div>

        {account ? (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-3">
            <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/3 px-3 py-2">
              <div className="grid min-w-0 gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-sm font-semibold text-white">{account.username}</p>
                  <span className="rounded-full border border-[#00FF9D]/30 px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.18em] text-[#00FF9D]">
                    {account.role}
                  </span>
                </div>
                <TopbarWalletButton />
              </div>
              <button
                className="rounded-xl border border-zinc-700 px-3 py-2 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-zinc-300 transition hover:border-red-300/50 hover:text-red-200"
                onClick={() => void logout()}
                type="button"
              >
                Logout
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}

function TopbarWalletButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
        const ready = mounted;

        if (!ready || !account || !chain) {
          return (
            <button
              aria-label="Connect wallet"
              className="rounded-xl bg-[#00FF9D] px-3 py-2 font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-black shadow-[0_0_26px_rgba(0,255,157,0.18)] transition hover:-translate-y-0.5 hover:bg-[#7DFFC9] disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
              disabled={!ready}
              onClick={openConnectModal}
              type="button"
            >
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                <span>Connect wallet</span>
                <span className="text-[0.58rem] opacity-70">Disconnected</span>
              </span>
            </button>
          );
        }

        const status = chain.unsupported ? "Wrong network" : (chain.name ?? "Connected");
        const onClick = chain.unsupported ? openChainModal : openAccountModal;

        return (
          <button
            aria-label="Open wallet account menu"
            className="rounded-xl bg-[#00FF9D] px-3 py-2 font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-black shadow-[0_0_26px_rgba(0,255,157,0.18)] transition hover:-translate-y-0.5 hover:bg-[#7DFFC9] disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
            onClick={onClick}
            type="button"
          >
            <span className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${chain.unsupported ? "bg-red-500" : "bg-black"}`} />
              <span>{account.displayName}</span>
              <span className="text-[0.58rem] opacity-70">{status}</span>
            </span>
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
