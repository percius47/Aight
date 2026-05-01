import type { Metadata } from "next";
import { IBM_Plex_Mono } from "next/font/google";

import { Providers } from "./providers";
import "./globals.css";

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Aight Pulse",
  description: "Live dashboard for decentralized local LLM inference.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${mono.variable} min-h-screen bg-[#0A0A0A] font-mono text-zinc-100 antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
