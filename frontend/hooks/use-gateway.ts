"use client";

import { useEffect, useMemo, useState } from "react";

import { gatewayUrl } from "@/lib/config";
import { fallbackOperators, fallbackTelemetry } from "@/lib/mock-data";
import type { OperatorNode, TelemetryEvent } from "@/lib/types";

export function useGatewayPulse() {
  const [operators, setOperators] = useState<OperatorNode[]>(fallbackOperators);
  const [events, setEvents] = useState<TelemetryEvent[]>(fallbackTelemetry);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadOperators(): Promise<void> {
      try {
        const response = await fetch(`${gatewayUrl}/operators`, { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as OperatorNode[];
        if (!cancelled && payload.length > 0) {
          setOperators(payload);
        }
      } catch {
        setOperators(fallbackOperators);
      }
    }

    void loadOperators();
    const interval = window.setInterval(() => void loadOperators(), 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const url = new URL(gatewayUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws/telemetry";

    const socket = new WebSocket(url);
    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onerror = () => setConnected(false);
    socket.onmessage = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as TelemetryEvent;
      setEvents((currentEvents) => [event, ...currentEvents].slice(0, 24));
    };

    return () => socket.close();
  }, []);

  const aggregate = useMemo(() => {
    const activeOperators = operators.filter((operator) => operator.active);
    const totalTps = activeOperators.reduce((sum, operator) => sum + operator.tokens_per_second, 0);
    const avgLatency =
      activeOperators.length > 0
        ? Math.round(activeOperators.reduce((sum, operator) => sum + operator.latency_ms, 0) / activeOperators.length)
        : 0;

    return {
      activeOperators: activeOperators.length,
      totalTps,
      avgLatency,
    };
  }, [operators]);

  return {
    aggregate,
    connected,
    events,
    operators,
  };
}
