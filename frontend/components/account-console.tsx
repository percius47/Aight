"use client";

import Image from "next/image";
import type { FormEvent } from "react";
import { useState } from "react";
import { useAccount } from "wagmi";

import brandMark from "@/Aight_Logo.png";
import { useAightAccount } from "@/hooks/use-aight-account";
import type { AccountRole } from "@/lib/types";

const authModes = ["login", "signup"] as const;
const accountRoles: AccountRole[] = ["buyer", "operator"];
const platformPoints = [
  "Buyers get API keys routed to live operator rigs.",
  "Operators pair local Ollama hardware and earn from rentals.",
  "Escrow-backed allocation keeps compute, wallets, and usage aligned.",
];

export function AccountConsole() {
  const { address } = useAccount();
  const { account, authenticate, loading, logout } = useAightAccount();
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [role, setRole] = useState<AccountRole>("operator");
  const [username, setUsername] = useState("operator-demo");
  const [password, setPassword] = useState("aight-demo");
  const [error, setError] = useState<string | null>(null);

  async function submit(event?: FormEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault();
    setError(null);
    try {
      await authenticate(mode, username, password, role, address);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Authentication failed.");
    }
  }

  return (
    <section className="relative overflow-hidden rounded-4xl border border-[#00FF9D]/25 bg-zinc-950/45 p-4 shadow-[0_0_90px_rgba(0,255,157,0.12)] backdrop-blur-2xl md:p-6">
      <MovingGridBackground />
      <div className="absolute inset-x-10 top-0 h-px bg-linear-to-r from-transparent via-[#00FF9D]/70 to-transparent" />
      <div className="relative grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-stretch">
        <div className="relative overflow-hidden rounded-4xl border border-white/10 bg-black/30 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] md:p-8">
          <div className="absolute -left-24 -top-24 h-64 w-64 rounded-full bg-[#00FF9D]/10 blur-3xl" />
          <div className="relative">
            <div className="flex items-center gap-4">
              <div className="relative h-20 w-20 overflow-hidden rounded-3xl border border-[#00FF9D]/25 bg-black/50 shadow-[0_0_40px_rgba(0,255,157,0.16)]">
                <Image alt="Aight network mark" className="object-cover" fill priority sizes="80px" src={brandMark} />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-[#00FF9D]">Decentralized local inference</p>
                <p className="mt-2 text-sm text-zinc-400">API access to operator-run LLM rigs.</p>
              </div>
            </div>

            <h1 className="mt-8 max-w-2xl text-4xl font-semibold leading-tight text-white md:text-5xl">
              Rent live local LLM rigs. Host yours and earn.
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-7 text-zinc-300 md:text-base">
              Aight connects buyers to operator-run Ollama rigs through API keys, wallet-backed escrow, and real-time
              rig allocation.
            </p>

            <div className="mt-8 grid gap-3">
              {platformPoints.map((point, index) => (
                <div key={point} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                  <span className="grid h-8 w-8 place-items-center rounded-xl border border-[#00FF9D]/25 bg-[#00FF9D]/10 text-xs font-bold text-[#00FF9D]">
                    0{index + 1}
                  </span>
                  <p className="text-sm leading-6 text-zinc-300">{point}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-4xl border border-[#00FF9D]/25 bg-black/45 p-5 shadow-[0_0_70px_rgba(0,255,157,0.14),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-zinc-500">Aight access</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Enter the compute market</h2>
              <p className="mt-3 max-w-md text-sm leading-6 text-zinc-400">
                Sign in to rent inference as a buyer or pair your own machine as an operator.
              </p>
            </div>
            {account ? (
              <button className="rounded-2xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300" onClick={() => void logout()} type="button">
                Log out
              </button>
            ) : null}
          </div>

          {account ? (
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <Metric label="Account" value={account.username} />
              <Metric label="Role" value={account.role} />
              <Metric label="Wallet" value={account.wallet_address ?? address ?? "not linked"} />
            </div>
          ) : (
            <form className="mt-6 grid gap-5" onSubmit={(event) => void submit(event)}>
              <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/5 p-1" role="tablist" aria-label="Authentication mode">
                {authModes.map((item) => (
                  <button
                    aria-selected={mode === item}
                    className={`rounded-xl px-4 py-3 text-sm font-bold uppercase tracking-[0.16em] transition ${
                      mode === item
                        ? "bg-[#00FF9D] text-black shadow-[0_0_28px_rgba(0,255,157,0.22)]"
                        : "text-zinc-500 hover:text-zinc-200"
                    }`}
                    key={item}
                    onClick={() => setMode(item)}
                    role="tab"
                    type="button"
                  >
                    {item}
                  </button>
                ))}
              </div>

              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Account type</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {accountRoles.map((item) => (
                    <button
                      className={`rounded-2xl border px-4 py-3 text-sm font-semibold capitalize transition ${
                        role === item
                          ? "border-[#00FF9D]/50 bg-[#00FF9D]/10 text-[#00FF9D]"
                          : "border-zinc-800 bg-black/35 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                      }`}
                      key={item}
                      onClick={() => setRole(item)}
                      type="button"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-4">
                <Input label="Username" onChange={setUsername} type="text" value={username} />
                <Input label="Password" onChange={setPassword} type="password" value={password} />
              </div>

              <button
                className="rounded-2xl bg-[#00FF9D] px-5 py-4 font-mono text-sm font-bold uppercase tracking-[0.16em] text-black shadow-[0_0_32px_rgba(0,255,157,0.22)] transition hover:bg-[#7DFFC9] disabled:bg-zinc-700 disabled:text-zinc-400"
                disabled={loading}
                type="submit"
              >
                {loading ? "Working..." : mode === "signup" ? "Create account" : "Log in"}
              </button>
            </form>
          )}

          {error ? <p className="mt-4 rounded-2xl border border-red-400/25 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}

function MovingGridBackground() {
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full opacity-55" preserveAspectRatio="none">
      <defs>
        <pattern height="48" id="aight-grid" patternUnits="userSpaceOnUse" width="48">
          <path d="M 48 0 L 0 0 0 48" fill="none" stroke="rgba(0,255,157,0.16)" strokeWidth="1" />
        </pattern>
        <radialGradient id="aight-grid-glow" cx="50%" cy="35%" r="65%">
          <stop offset="0%" stopColor="rgba(0,255,157,0.24)" />
          <stop offset="58%" stopColor="rgba(0,255,157,0.05)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
      </defs>
      <g>
        <animateTransform attributeName="transform" dur="18s" from="0 0" repeatCount="indefinite" to="48 48" type="translate" />
        <rect fill="url(#aight-grid)" height="140%" width="140%" x="-20%" y="-20%" />
      </g>
      <rect fill="url(#aight-grid-glow)" height="100%" width="100%" />
    </svg>
  );
}

function Input({
  label,
  onChange,
  type,
  value,
}: Readonly<{ label: string; onChange: (value: string) => void; type: string; value: string }>) {
  return (
    <label className="grid gap-2 text-xs uppercase tracking-[0.22em] text-zinc-500">
      {label}
      <input
        className="rounded-2xl border border-zinc-800 bg-black/50 px-4 py-3 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-[#00FF9D]/60 focus:shadow-[0_0_24px_rgba(0,255,157,0.12)]"
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-black/40 p-4">
      <p className="text-[0.65rem] uppercase tracking-[0.25em] text-zinc-600">{label}</p>
      <p className="mt-2 break-all text-sm font-semibold text-zinc-100">{value}</p>
    </div>
  );
}
