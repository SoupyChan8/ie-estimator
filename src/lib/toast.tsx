import { useSyncExternalStore } from "react";

type Toast = { id: number; tone: "default" | "success" | "error"; title: string; description?: string };
let items: Toast[] = [];
let counter = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

function show(tone: Toast["tone"], title: string, description?: string) {
  const id = ++counter;
  items = [...items, { id, tone, title, description }];
  emit();
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, tone === "error" ? 6000 : 3500);
}

export const toast = Object.assign((t: string, d?: string) => show("default", t, d), {
  success: (t: string, d?: string) => show("success", t, d),
  error: (t: string, d?: string) => show("error", t, d),
});

export function Toaster() {
  const list = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => items,
  );
  return (
    <div className="toaster" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <strong>{t.title}</strong>
          {t.description && <span>{t.description}</span>}
        </div>
      ))}
    </div>
  );
}
