import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, onAuthError, tokenStore } from "./api";
import type { Catalog } from "./estimate";

type User = { email: string; name: string };
type Status = "loading" | "signedOut" | "signedIn";

type SessionValue = {
  status: Status;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  catalog: Catalog | null;
  catalogError: string;
  reloadCatalog: () => Promise<void>;
  studioOpen: boolean;
  unlockStudio: (password: string) => Promise<void>;
  lockStudio: () => void;
};

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(tokenStore.get() ? "loading" : "signedOut");
  const [user, setUser] = useState<User | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [studioUntil, setStudioUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  const signOutLocal = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setCatalog(null);
    setStudioUntil(0);
    setStatus("signedOut");
  }, []);

  const reloadCatalog = useCallback(async () => {
    setCatalogError("");
    try {
      setCatalog(await api<Catalog>("catalog"));
    } catch (e) {
      setCatalogError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const off = onAuthError((code) => {
      if (code === "auth") signOutLocal();
      if (code === "studio") setStudioUntil(0);
    });
    return () => {
      off();
    };
  }, [signOutLocal]);

  useEffect(() => {
    if (!tokenStore.get()) return;
    api<{ email: string; name: string; studioUntil: number }>("me")
      .then((me) => {
        setUser({ email: me.email, name: me.name });
        setStudioUntil(me.studioUntil || 0);
        setStatus("signedIn");
        void reloadCatalog();
      })
      .catch((e) => {
        if ((e as { code?: string }).code === "auth") signOutLocal();
        else {
          // Offline or server hiccup: keep the session, show the app, let catalog retry.
          setStatus("signedIn");
          setCatalogError((e as Error).message);
        }
      });
  }, [reloadCatalog, signOutLocal]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api<{ token: string; email: string; name: string }>("login", { email, password });
    tokenStore.set(res.token);
    setUser({ email: res.email, name: res.name });
    setStatus("signedIn");
    void reloadCatalog();
  };

  const logout = async () => {
    try {
      await api("logout");
    } catch {
      /* sign out locally regardless */
    }
    signOutLocal();
  };

  const unlockStudio = async (password: string) => {
    const res = await api<{ studioUntil: number }>("unlockStudio", { password });
    setStudioUntil(res.studioUntil);
    setNow(Date.now());
  };

  return (
    <Ctx.Provider
      value={{
        status,
        user,
        login,
        logout,
        catalog,
        catalogError,
        reloadCatalog,
        studioOpen: studioUntil > now,
        unlockStudio,
        lockStudio: () => setStudioUntil(0),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
