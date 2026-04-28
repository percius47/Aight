"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { baseSepolia } from "viem/chains";

import { hasPrivyAppId, privyAppId } from "@/lib/config";

export function Providers({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!hasPrivyAppId) {
    return children;
  }

  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#00FF9D",
          logo: undefined,
        },
        defaultChain: baseSepolia,
        supportedChains: [baseSepolia],
        loginMethods: ["wallet", "email"],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
