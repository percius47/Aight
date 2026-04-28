import type { OperatorNode } from "@/lib/types";

type OperatorGridProps = {
  operators: OperatorNode[];
};

export function OperatorGrid({ operators }: OperatorGridProps) {
  return (
    <section className="rounded-[2rem] border border-zinc-800 bg-zinc-950/70 p-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Live map</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Active inference hosts</h2>
        </div>
        <span className="rounded-full border border-[#00FF9D]/30 px-3 py-1 text-xs text-[#00FF9D]">
          {operators.length} online
        </span>
      </div>

      <div className="mt-6 grid gap-4">
        {operators.map((operator) => (
          <article
            className="group rounded-3xl border border-zinc-800 bg-black/50 p-4 transition hover:border-[#00FF9D]/50 hover:bg-[#00FF9D]/5"
            key={operator.operator_address}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">{operator.model}</p>
                <p className="mt-1 text-xs text-zinc-500">{operator.operator_address}</p>
              </div>
              <div className="rounded-full bg-[#00FF9D]/10 px-3 py-1 text-xs text-[#00FF9D]">
                {operator.active ? "HEARTBEAT" : "IDLE"}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
              <Metric label="Latency" value={`${operator.latency_ms}ms`} />
              <Metric label="TPS" value={operator.tokens_per_second.toFixed(1)} />
              <Metric label="Rate" value={`${weiToEth(operator.hourly_rate_wei)} ETH/h`} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-3">
      <p className="text-[0.65rem] uppercase tracking-[0.25em] text-zinc-600">{label}</p>
      <p className="mt-2 text-sm font-semibold text-zinc-100">{value}</p>
    </div>
  );
}

function weiToEth(value: number): string {
  return (value / 1e18).toFixed(3);
}
