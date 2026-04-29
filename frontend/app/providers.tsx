"use client";

import "@rainbow-me/rainbowkit/styles.css";

import { getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { baseSepolia } from "viem/chains";
import { WagmiProvider } from "wagmi";

import { walletConnectProjectId } from "@/lib/config";

const wagmiConfig = getDefaultConfig({
  appName: "Aight",
  projectId: walletConnectProjectId || "aight-local",
  chains: [baseSepolia],
  ssr: true,
});

export function Providers({ children }: Readonly<{ children: React.ReactNode }>) {
  const [queryClient] = useState(() => new QueryClient());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider initialChain={baseSepolia} modalSize="compact">
          {mounted ? children : null}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
