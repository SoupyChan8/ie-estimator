import { useEffect, useState } from "react";

/**
 * Unsaved Studio edits kept on this device only (localStorage), so an accidental close doesn't lose them.
 * Nothing here goes to the cloud; the copy is removed as soon as the edit is saved or cancelled.
 */
export type DeviceDraft<T> = { at: number; label: string; value: T };

const PREFIX = "ie-studio-draft:";

export function readDeviceDraft<T>(key: string): DeviceDraft<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    const d = raw ? (JSON.parse(raw) as DeviceDraft<T>) : null;
    return d && d.value != null ? d : null;
  } catch {
    return null;
  }
}
function writeDeviceDraft<T>(key: string, value: T, label: string) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), label, value }));
  } catch {
    /* storage full or blocked */
  }
}
export function clearDeviceDraft(key: string) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/**
 * Keeps `value` on the device while `dirty`, and forgets it when the edit is saved or cancelled.
 * A copy left by an earlier visit comes back as `pending` until it's restored or discarded; starting
 * a new edit replaces it.
 */
export function useDeviceDraft<T>(key: string | null, value: T, dirty: boolean, label = "") {
  const [pending, setPending] = useState<DeviceDraft<T> | null>(() => (key ? readDeviceDraft<T>(key) : null));
  const [pendingKey, setPendingKey] = useState(key);
  if (pendingKey !== key) {
    setPendingKey(key);
    setPending(key ? readDeviceDraft<T>(key) : null);
  }

  useEffect(() => {
    if (!key) return;
    if (dirty) {
      const t = window.setTimeout(() => writeDeviceDraft(key, value, label), 300);
      return () => window.clearTimeout(t);
    }
    if (!pending) clearDeviceDraft(key);
  }, [key, value, dirty, label, pending]);

  // once a new edit starts, the old copy has been replaced
  useEffect(() => {
    if (dirty && pending) setPending(null);
  }, [dirty, pending]);

  return {
    pending,
    restore: (): T | null => {
      const v = pending?.value ?? null;
      setPending(null);
      return v;
    },
    discard: () => {
      if (key) clearDeviceDraft(key);
      setPending(null);
    },
  };
}
