"use client";

import { motion } from "framer-motion";

import type { TelemetryEvent } from "@/lib/types";

type TokenFlowProps = {
  connected: boolean;
  events: TelemetryEvent[];
};

const nodes = ["Host Node", "Aight Gateway", "Cursor User"];

export function TokenFlow({ connected, events }: TokenFlowProps) {
  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-[#00FF9D]/20 bg-black p-6">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(0,255,157,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,157,0.08)_1px,transparent_1px)] bg-[size:42px_42px]" />
      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-[#00FF9D]">Token flow</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Inference packet route</h2>
          </div>
          <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs text-zinc-300">
            {connected ? "WebSocket live" : "Demo telemetry"}
          </span>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {nodes.map((node) => (
            <div className="rounded-3xl border border-zinc-800 bg-zinc-950/80 p-5" key={node}>
              <div className="h-2 w-2 rounded-full bg-[#00FF9D] shadow-[0_0_20px_#00FF9D]" />
              <p className="mt-6 text-sm uppercase tracking-[0.22em] text-zinc-400">{node}</p>
            </div>
          ))}
        </div>

        <div className="relative mt-8 h-24 overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950/70">
          {[0, 1, 2, 3, 4].map((packet) => (
            <motion.div
              animate={{ x: ["-10%", "110%"], opacity: [0, 1, 1, 0] }}
              className="absolute top-1/2 h-2 w-24 rounded-full bg-[#00FF9D] shadow-[0_0_24px_#00FF9D]"
              initial={false}
              key={packet}
              transition={{
                duration: 3.5,
                repeat: Infinity,
                delay: packet * 0.55,
                ease: "linear",
              }}
            />
          ))}
        </div>

        <div className="mt-6 grid gap-2">
          {events.slice(0, 5).map((event, index) => (
            <div
              className="flex items-center justify-between rounded-2xl border border-zinc-900 bg-zinc-950/80 px-4 py-3 text-xs"
              key={`${event.api_key_id}-${event.tokens}-${index}`}
            >
              <span className="uppercase tracking-[0.2em] text-zinc-500">{event.event}</span>
              <span className="text-zinc-300">{event.token ?? `${event.tokens} tokens`}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
