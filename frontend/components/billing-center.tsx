import type { BillingSnapshot } from "@/lib/types";

type BillingCenterProps = {
  billing: BillingSnapshot;
};

export function BillingCenter({ billing }: BillingCenterProps) {
  return (
    <section className="rounded-[2rem] border border-zinc-800 bg-zinc-950/70 p-5">
      <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Billing center</p>
      <h2 className="mt-2 text-2xl font-semibold text-white">Escrow #{billing.escrowId}</h2>

      <div className="mt-6 rounded-3xl border border-[#00FF9D]/20 bg-[#00FF9D]/5 p-5">
        <p className="text-sm text-zinc-400">Remaining staked hours</p>
        <p className="mt-3 text-5xl font-bold text-[#00FF9D]">{billing.remainingHours.toFixed(1)}</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-zinc-800 bg-black/40 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-zinc-600">Hourly rate</p>
          <p className="mt-2 text-lg text-white">{billing.hourlyRateEth} ETH</p>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-black/40 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-zinc-600">Operator split</p>
          <p className="mt-2 text-lg text-white">{billing.operatorShare}</p>
        </div>
      </div>

      <button
        className="mt-5 w-full rounded-2xl border border-zinc-700 px-4 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-zinc-300 transition hover:border-[#00FF9D] hover:text-[#00FF9D]"
        type="button"
      >
        Release hourly payment
      </button>
    </section>
  );
}
