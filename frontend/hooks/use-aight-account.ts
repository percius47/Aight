"use client";

import { useCallback, useEffect, useState } from "react";

import { gatewayUrl } from "@/lib/config";
import type { AccountRole, AightAccount, AuthSession } from "@/lib/types";

const storageKey = "aight.account-session.v1";
const sessionEventName = "aight-account-session";

type StoredSession = {
  token: string;
  account: AightAccount;
};

export function useAightAccount() {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    function syncSession(): void {
      const rawSession = window.localStorage.getItem(storageKey);
      setSession(rawSession ? (JSON.parse(rawSession) as StoredSession) : null);
    }

    syncSession();
    window.addEventListener("storage", syncSession);
    window.addEventListener(sessionEventName, syncSession);

    return () => {
      window.removeEventListener("storage", syncSession);
      window.removeEventListener(sessionEventName, syncSession);
    };
  }, []);

  const persistSession = useCallback((nextSession: StoredSession | null) => {
    setSession(nextSession);
    if (nextSession) {
      window.localStorage.setItem(storageKey, JSON.stringify(nextSession));
    } else {
      window.localStorage.removeItem(storageKey);
    }
    window.dispatchEvent(new Event(sessionEventName));
  }, []);

  const authenticate = useCallback(
    async (mode: "login" | "signup", username: string, password: string, role: AccountRole, walletAddress?: string) => {
      setLoading(true);
      try {
        const response = await fetch(`${gatewayUrl}/auth/${mode}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            mode === "signup"
              ? { username, password, role, wallet_address: walletAddress || null }
              : { username, password },
          ),
        });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        const payload = (await response.json()) as AuthSession;
        persistSession(payload);
      } finally {
        setLoading(false);
      }
    },
    [persistSession],
  );

  const logout = useCallback(async () => {
    if (session?.token) {
      await fetch(`${gatewayUrl}/auth/logout`, {
        method: "POST",
        headers: { authorization: `Bearer ${session.token}` },
      }).catch(() => undefined);
    }
    persistSession(null);
  }, [persistSession, session?.token]);

  return {
    account: session?.account ?? null,
    authenticate,
    loading,
    logout,
    token: session?.token ?? null,
  };
}
