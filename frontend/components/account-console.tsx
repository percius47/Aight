"use client";

import { useState } from "react";
import { useAccount } from "wagmi";

import { useAightAccount } from "@/hooks/use-aight-account";
import type { AccountRole } from "@/lib/types";

export function AccountConsole() {
  const { address } = useAccount();
  const { account, authenticate, loading, logout } = useAightAccount();
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [role, setRole] = useState<AccountRole>("operator");
  const [username, setUsername] = useState("operator-demo");
  const [password, setPassword] = useState("aight-demo");
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setError(null);
    try {
      await authenticate(mode, username, password, role, address);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Authentication failed.");
    }
  }

  return (
    <section className="rounded-4xl border border-zinc-800 bg-zinc-950/75 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-[#00FF9D]">Demo Identity</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Operator and buyer login</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
            Use simple username/password accounts to preserve demo state while MetaMask owns staking and escrow
            signatures.
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
        <div className="mt-5 grid gap-3 lg:grid-cols-[0.8fr_0.8fr_1fr_1fr_auto]">
          <Select label="Mode" onChange={(value) => setMode(value as "login" | "signup")} value={mode} values={["signup", "login"]} />
          <Select label="Role" onChange={(value) => setRole(value as AccountRole)} value={role} values={["operator", "buyer"]} />
          <Input label="Username" onChange={setUsername} type="text" value={username} />
          <Input label="Password" onChange={setPassword} type="password" value={password} />
          <button
            className="self-end rounded-2xl bg-[#00FF9D] px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.14em] text-black disabled:bg-zinc-700 disabled:text-zinc-400"
            disabled={loading}
            onClick={() => void submit()}
            type="button"
          >
            {loading ? "Working..." : mode}
          </button>
        </div>
      )}

      {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
    </section>
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
        className="rounded-2xl border border-zinc-800 bg-black/50 px-4 py-3 text-sm normal-case tracking-normal text-zinc-100 outline-none focus:border-[#00FF9D]/60"
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}

function Select({
  label,
  onChange,
  value,
  values,
}: Readonly<{ label: string; onChange: (value: string) => void; value: string; values: string[] }>) {
  return (
    <label className="grid gap-2 text-xs uppercase tracking-[0.22em] text-zinc-500">
      {label}
      <select
        className="rounded-2xl border border-zinc-800 bg-black/50 px-4 py-3 text-sm normal-case tracking-normal text-zinc-100 outline-none focus:border-[#00FF9D]/60"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {values.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
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
