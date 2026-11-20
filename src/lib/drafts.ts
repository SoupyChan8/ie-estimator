import type { Catalog, Tier } from "./estimate";

/** Everything needed to pick an estimate back up. Signatures are never kept: they're signed fresh. */
export type EstimateData = {
  v: 1;
  step: string;
  bhk: number | null;
  areaText: string;
  committedHome: string;
  qty: Record<number, number>;
  tier: Tier;
  agreed: Partial<Record<Tier, Record<number, number>>>;
  details: {
    clientName: string;
    clientPhone: string;
    clientEmail: string;
    siteAddress: string;
    projectScope: string;
    designerName: string;
  };
  /** fingerprint of the rate book's prices when this was saved */
  rateStamp: string;
};

/** The on-iPad auto-save: the estimate plus which cloud draft (if any) it belongs to. */
export type Autosave = EstimateData & { savedAt: number; draftId: number | null; draftKey: string | null; total: number };

export type DraftInfo = {
  id: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  label: string;
  clientName: string;
  bhk: number | null;
  carpetArea: number;
  tier: string;
  total: number;
  data?: EstimateData;
};

const AUTOSAVE_KEY = "ie-estimate-autosave";
const OPEN_KEY = "ie-open-draft";

export function readAutosave(): Autosave | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    const a = raw ? (JSON.parse(raw) as Autosave) : null;
    return a && a.v === 1 && a.bhk != null ? a : null;
  } catch {
    return null;
  }
}
export function writeAutosave(a: Autosave) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(a));
  } catch {
    /* storage full or blocked */
  }
}
export function clearAutosave() {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    /* ignore */
  }
}

/** The Studio hands a draft to the estimator through this key. */
export function requestOpenDraft(id: number) {
  try {
    localStorage.setItem(OPEN_KEY, String(id));
  } catch {
    /* ignore */
  }
}
export function takeOpenDraft(): number | null {
  try {
    const v = Number(localStorage.getItem(OPEN_KEY) || 0);
    localStorage.removeItem(OPEN_KEY);
    return v || null;
  } catch {
    return null;
  }
}

/** What counts as "the estimate's content" when telling whether it's saved as a draft (not the step it's on). */
export function contentKeyOf(d: Pick<EstimateData, "bhk" | "areaText" | "committedHome" | "qty" | "tier" | "agreed" | "details">) {
  return JSON.stringify([d.bhk, d.areaText, d.committedHome, d.qty, d.tier, d.agreed, d.details]);
}
/** True when an auto-save has work that isn't in a cloud draft yet. */
export function autosaveUnsaved(a: Autosave | null) {
  return !!a && a.bhk != null && !(a.draftId != null && a.draftKey === contentKeyOf(a));
}

/** A short fingerprint of the rate book's prices and quantities, to tell when rates changed since a draft. */
export function rateStamp(c: Catalog | null): string {
  if (!c) return "";
  const text = c.items
    .map((i) => [i.id, i.rateStandard, i.ratePremium, i.rateLuxury, i.qtyBhk1, i.qtyBhk2, i.qtyBhk3, i.qtyBhk4, i.unit, i.scalesWithArea ? 1 : 0].join(","))
    .sort()
    .join(";");
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** "just now", "12 min ago", "3 h ago", "2 days ago" */
export function ago(t: number | string): string {
  const ms = Date.now() - (typeof t === "number" ? t : new Date(t).getTime());
  const m = Math.round(ms / 60000);
  if (!(m >= 1)) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
