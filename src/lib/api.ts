import { API_URL } from "../config";
import { AUTH_STORAGE_KEY, callSupabase, usingSupabase } from "./backend";

export class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

const TOKEN_KEY = "ie-token";

export const tokenStore = {
  get(): string {
    try {
      // With Supabase, the signed-in session lives under its own key.
      if (usingSupabase) return localStorage.getItem(AUTH_STORAGE_KEY) ? "supabase" : "";
      return localStorage.getItem(TOKEN_KEY) ?? "";
    } catch {
      return "";
    }
  },
  set(t: string) {
    try {
      localStorage.setItem(TOKEN_KEY, t);
    } catch {
      /* ignore */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      if (usingSupabase) localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  },
};

/** Fresh rate book + rate book versions, sent back by every rate book change. */
export type RateBookState = { catalog: import("./estimate").Catalog; versions: import("./estimate").VersionInfo[] };
const stateListeners = new Set<(s: RateBookState) => void>();
export function onRateBookState(fn: (s: RateBookState) => void) {
  stateListeners.add(fn);
  return () => {
    stateListeners.delete(fn);
  };
}

type Listener = (code: string) => void;
const listeners = new Set<Listener>();
/** Lets the auth layer react when the server says the session or studio unlock has expired. */
export function onAuthError(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function api<T>(action: string, payload?: unknown): Promise<T> {
  if (usingSupabase) {
    let out: unknown;
    try {
      out = await callSupabase(action, payload);
    } catch (e) {
      const err = e as { message?: string; code?: string };
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      const msg = offline || /Failed to fetch|NetworkError|Load failed/i.test(err.message ?? "")
        ? "No internet connection. Check the Wi-Fi and try again."
        : err.message || "Something went wrong.";
      if (err.code) listeners.forEach((l) => l(err.code as string));
      throw new ApiError(msg, err.code);
    }
    const st = (out as { state?: RateBookState } | null)?.state;
    if (st && st.catalog) stateListeners.forEach((l) => l(st));
    return out as T;
  }
  if (!API_URL) throw new ApiError("The app isn't connected to its Google Sheet yet (API_URL is empty).");
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      // text/plain avoids a CORS preflight, which Apps Script can't answer.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, payload, token: tokenStore.get() }),
      redirect: "follow",
    });
  } catch {
    throw new ApiError("No internet connection. Check the Wi-Fi and try again.");
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ApiError(`The server sent an unexpected reply (${res.status}).`);
  }
  const d = data as { error?: string; code?: string };
  if (d && d.error) {
    if (d.code) listeners.forEach((l) => l(d.code as string));
    throw new ApiError(d.error, d.code);
  }
  const st = (data as { state?: RateBookState }).state;
  if (st && st.catalog) stateListeners.forEach((l) => l(st));
  return data as T;
}
