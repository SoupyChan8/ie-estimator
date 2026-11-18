import { API_URL } from "../config";

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
    } catch {
      /* ignore */
    }
  },
};

type Listener = (code: string) => void;
const listeners = new Set<Listener>();
/** Lets the auth layer react when the server says the session or studio unlock has expired. */
export function onAuthError(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function api<T>(action: string, payload?: unknown): Promise<T> {
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
  return data as T;
}
