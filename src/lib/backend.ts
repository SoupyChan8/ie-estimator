/**
 * Supabase backend. Implements the same actions the app used to send to Google Apps Script, so the screens
 * don't change: api("saveItem", …) etc. end up here when VITE_SUPABASE_URL / VITE_SUPABASE_KEY are set.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Catalog, CatalogCategory, CatalogItem, ContractFull, ContractSummary, LineItem, VersionInfo } from "./estimate";
import type { QuotationOptions } from "./quotationOptions";

const URL_ = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const KEY = (import.meta.env.VITE_SUPABASE_KEY as string | undefined) ?? "";
export const usingSupabase = Boolean(URL_ && KEY);
export const AUTH_STORAGE_KEY = "ie-sb-auth";

let client: SupabaseClient | null = null;
const sb = (): SupabaseClient => {
  if (!client) {
    client = createClient(URL_, KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: AUTH_STORAGE_KEY },
    });
  }
  return client;
};

export class BackendError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

const STUDIO_KEY = "ie-studio-until";
const STUDIO_MINUTES = 30;
const UNITS = ["sqft", "rft", "nos", "lumpsum"] as const;
const TIERS = ["standard", "premium", "luxury"] as const;

/* ───────────── helpers ───────────── */

const n = (v: unknown) => (v === "" || v === null || v === undefined ? 0 : Number(v));
const nOrNull = (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v));
const str = (v: unknown, max = 1000) => String(v ?? "").trim().slice(0, max);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function check<T>(res: { data: T; error: { message: string; code?: string } | null }): NonNullable<T> | any {
  if (res.error) {
    const msg = res.error.message || "Something went wrong.";
    if (/JWT|not authenticated|Auth session missing/i.test(msg)) throw new BackendError("Please sign in again.", "auth");
    throw new BackendError(msg);
  }
  return res.data;
}

async function currentUser() {
  const { data } = await sb().auth.getSession();
  const user = data.session?.user;
  if (!user) throw new BackendError("Please sign in again.", "auth");
  return user;
}

async function displayName(email: string): Promise<string> {
  const row = check(await sb().from("settings").select("value").eq("key", `name:${email.toLowerCase()}`).maybeSingle());
  if (row?.value) return String(row.value);
  const local = email.split("@")[0].replace(/[._-]+/g, " ");
  return local.charAt(0).toUpperCase() + local.slice(1);
}

async function getSetting(key: string): Promise<string | null> {
  const row = check(await sb().from("settings").select("value").eq("key", key).maybeSingle());
  return row?.value ?? null;
}
async function setSetting(key: string, value: string | null) {
  if (value === null) check(await sb().from("settings").delete().eq("key", key));
  else check(await sb().from("settings").upsert({ key, value }));
}

/* ───────────── auth ───────────── */

async function login(p: { email: string; password: string }) {
  const email = str(p.email, 200).toLowerCase();
  const { data, error } = await sb().auth.signInWithPassword({ email, password: String(p.password ?? "") });
  if (error || !data.user) throw new BackendError("Wrong email or password.");
  return { token: "supabase", email, name: await displayName(email) };
}

async function me() {
  const user = await currentUser();
  const email = String(user.email ?? "");
  let studioUntil = 0;
  try {
    studioUntil = Number(localStorage.getItem(STUDIO_KEY) || 0);
  } catch {
    /* storage blocked */
  }
  return { email, name: await displayName(email), studioUntil };
}

async function logout() {
  try {
    localStorage.removeItem(STUDIO_KEY);
  } catch {
    /* ignore */
  }
  await sb().auth.signOut();
  return { ok: true };
}

async function unlockStudio(p: { password: string }) {
  const user = await currentUser();
  const { error } = await sb().auth.signInWithPassword({ email: String(user.email), password: String(p.password ?? "") });
  if (error) throw new BackendError("Wrong password.");
  const studioUntil = Date.now() + STUDIO_MINUTES * 60_000;
  try {
    localStorage.setItem(STUDIO_KEY, String(studioUntil));
  } catch {
    /* ignore */
  }
  return { studioUntil };
}

async function changePassword(p: { currentPassword: string; newPassword: string }) {
  const user = await currentUser();
  const next = String(p.newPassword ?? "");
  if (next.length < 8) throw new BackendError("Use at least 8 characters.");
  const { error } = await sb().auth.signInWithPassword({ email: String(user.email), password: String(p.currentPassword ?? "") });
  if (error) throw new BackendError("Your current password is wrong.");
  const res = await sb().auth.updateUser({ password: next });
  if (res.error) throw new BackendError(res.error.message);
  return { ok: true };
}

/* ───────────── rate book ───────────── */

type ItemRow = {
  id: number; category_id: number; parent_id: number | null; name: string; description: string; unit: string;
  rate_standard: number; rate_premium: number | null; rate_luxury: number | null;
  qty_bhk1: number; qty_bhk2: number; qty_bhk3: number; qty_bhk4: number;
  scales_with_area: boolean; active: boolean; sort_order: number;
};

const toItem = (r: ItemRow): CatalogItem => ({
  id: Number(r.id), categoryId: Number(r.category_id), parentId: nOrNull(r.parent_id), name: String(r.name),
  description: String(r.description ?? ""), unit: (UNITS as readonly string[]).includes(r.unit) ? (r.unit as CatalogItem["unit"]) : "sqft",
  rateStandard: n(r.rate_standard), ratePremium: nOrNull(r.rate_premium), rateLuxury: nOrNull(r.rate_luxury),
  qtyBhk1: n(r.qty_bhk1), qtyBhk2: n(r.qty_bhk2), qtyBhk3: n(r.qty_bhk3), qtyBhk4: n(r.qty_bhk4),
  scalesWithArea: Boolean(r.scales_with_area), active: r.active !== false, sortOrder: n(r.sort_order),
});

async function catalog(): Promise<Catalog> {
  const [cats, items] = await Promise.all([
    sb().from("categories").select("*"),
    sb().from("items").select("*"),
  ]);
  const categories: CatalogCategory[] = (check(cats) as { id: number; name: string; sort_order: number }[])
    .map((c) => ({ id: Number(c.id), name: String(c.name), sortOrder: n(c.sort_order) }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const list = (check(items) as ItemRow[]).map(toItem).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  return { categories, items: list };
}

async function saveCategory(p: { id?: number; name: string }) {
  const name = str(p.name, 120);
  if (!name) throw new BackendError("Category name is required.");
  if (p.id) {
    check(await sb().from("categories").update({ name }).eq("id", p.id));
    return { id: Number(p.id) };
  }
  const last = check(await sb().from("categories").select("sort_order").order("sort_order", { ascending: false }).limit(1));
  const sort = (last[0]?.sort_order ?? 0) + 1;
  const row = check(await sb().from("categories").insert({ name, sort_order: sort }).select("id").single());
  return { id: Number(row.id) };
}

async function deleteCategory(p: { id: number }) {
  check(await sb().from("categories").delete().eq("id", p.id)); // items go with it (cascade)
  return { ok: true };
}

async function saveItem(p: Record<string, unknown>) {
  const name = str(p.name, 300);
  if (!name) throw new BackendError("Item name is required.");
  const id = p.id ? Number(p.id) : null;
  let categoryId = Number(p.categoryId);
  const parentId = p.parentId === null || p.parentId === undefined || p.parentId === "" ? null : Number(p.parentId);
  if (parentId !== null) {
    const parent = check(await sb().from("items").select("id, parent_id, category_id").eq("id", parentId).maybeSingle());
    if (!parent) throw new BackendError("The main item it is nested under no longer exists.");
    if (parent.parent_id !== null) throw new BackendError("Add-ons can only be nested one level deep.");
    if (id && id === parentId) throw new BackendError("An item cannot be nested under itself.");
    if (id) {
      const kids = check(await sb().from("items").select("id").eq("parent_id", id).limit(1));
      if (kids.length) throw new BackendError("This item has its own add-ons, so it cannot be nested under another item.");
    }
    categoryId = Number(parent.category_id);
  }
  const rate = (v: unknown) => (v === null || v === undefined || v === "" ? null : Math.max(0, n(v)));
  const row = {
    category_id: categoryId, parent_id: parentId, name, description: str(p.description, 1000),
    unit: (UNITS as readonly string[]).includes(String(p.unit)) ? String(p.unit) : "sqft",
    rate_standard: Math.max(0, n(p.rateStandard)), rate_premium: rate(p.ratePremium), rate_luxury: rate(p.rateLuxury),
    qty_bhk1: n(p.qtyBhk1), qty_bhk2: n(p.qtyBhk2), qty_bhk3: n(p.qtyBhk3), qty_bhk4: n(p.qtyBhk4),
    scales_with_area: Boolean(p.scalesWithArea), active: p.active === undefined ? true : Boolean(p.active),
  };
  if (id) {
    check(await sb().from("items").update(row).eq("id", id));
    // add-ons follow their main item into a new category
    check(await sb().from("items").update({ category_id: categoryId }).eq("parent_id", id));
    return { id };
  }
  const last = check(
    await sb().from("items").select("sort_order").eq("category_id", categoryId).order("sort_order", { ascending: false }).limit(1),
  );
  const created = check(await sb().from("items").insert({ ...row, sort_order: (last[0]?.sort_order ?? 0) + 1 }).select("id").single());
  return { id: Number(created.id) };
}

async function deleteItem(p: { id: number }) {
  check(await sb().from("items").delete().eq("id", p.id)); // its add-ons go with it (cascade)
  return { ok: true };
}

/* ───────────── versions ───────────── */

type VersionRow = {
  id: number; kind: "ratebook" | "terms"; name: string; created_at: string; updated_at: string; created_by: string;
  summary: string; hash: string | null; data?: unknown;
};

const isBackupName = (name: string) => /^(Backup before|Custom rates before)/.test(name);

/** Key-order-independent JSON. */
function canon(x: unknown): string {
  if (Array.isArray(x)) return "[" + x.map(canon).join(",") + "]";
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canon(o[k])).join(",") + "}";
  }
  return JSON.stringify(x === undefined ? null : x);
}

const normItem = (i: CatalogItem): CatalogItem => ({
  id: Number(i.id), categoryId: Number(i.categoryId), parentId: nOrNull(i.parentId), name: String(i.name),
  description: String(i.description ?? ""), unit: (UNITS as readonly string[]).includes(i.unit) ? i.unit : "sqft",
  rateStandard: n(i.rateStandard), ratePremium: nOrNull(i.ratePremium), rateLuxury: nOrNull(i.rateLuxury),
  qtyBhk1: n(i.qtyBhk1), qtyBhk2: n(i.qtyBhk2), qtyBhk3: n(i.qtyBhk3), qtyBhk4: n(i.qtyBhk4),
  scalesWithArea: Boolean(i.scalesWithArea), active: i.active !== false, sortOrder: n(i.sortOrder),
});

/** Fingerprint of a rate book's content (row order doesn't matter). */
async function rateBookHash(c: Catalog | null | undefined): Promise<string> {
  if (!c) return "";
  const byId = (a: { id: number }, b: { id: number }) => a.id - b.id;
  const text = canon({
    categories: (c.categories ?? []).map((x) => ({ id: Number(x.id), name: String(x.name), sortOrder: n(x.sortOrder) })).sort(byId),
    items: (c.items ?? []).map(normItem).sort(byId),
  });
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function rateBookSummary(c: Catalog) {
  const mains = c.items.filter((i) => i.parentId === null).length;
  return `${c.categories.length} categories · ${mains} items · ${c.items.length - mains} add-ons`;
}

function termsSummary(t: QuotationOptions) {
  const pct = t.payments.reduce((s, p) => s + n(p.pct), 0);
  return `${t.included.length} included · ${t.notIncluded.length} not included · ${t.payments.length} payment stages (${pct}%) · ${t.timeline.length} phases`;
}

function cleanTerms(o: Partial<QuotationOptions> | null | undefined): QuotationOptions {
  const src = o ?? {};
  const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  const list = (arr: unknown) => (Array.isArray(arr) ? arr : []).map((x) => text(x, 300)).filter(Boolean).slice(0, 20);
  return {
    included: list(src.included),
    notIncluded: list(src.notIncluded),
    payments: (Array.isArray(src.payments) ? src.payments : [])
      .slice(0, 10)
      .map((x) => ({ pct: Math.max(0, Math.min(100, n(x.pct))), title: text(x.title, 80), sub: text(x.sub, 160) }))
      .filter((x) => x.title || x.pct),
    timeline: (Array.isArray(src.timeline) ? src.timeline : [])
      .slice(0, 8)
      .map((x) => ({ title: text(x.title, 60), sub: text(x.sub, 40) }))
      .filter((x) => x.title),
  };
}

/** Which saved rate book the live one is identical to (matchId), and which one it was last loaded from (baseId). */
async function rateBookMatch(rows: VersionRow[], live: Catalog) {
  const activeId = Number((await getSetting("active_ratebook_version")) || 0) || null;
  const liveHash = await rateBookHash(live);
  const rank = (v: VersionRow) => (v.id === activeId ? 0 : isBackupName(v.name) ? 2 : 1);
  const books = rows.filter((v) => v.kind === "ratebook").sort((a, b) => rank(a) - rank(b) || b.id - a.id);
  let matchId: number | null = null;
  for (const v of books) {
    let h = v.hash ?? "";
    if (!h) {
      // versions brought over from Google Sheets: work the fingerprint out once and store it
      const full = check(await sb().from("versions").select("data").eq("id", v.id).single());
      h = await rateBookHash(full.data as Catalog);
      check(await sb().from("versions").update({ hash: h }).eq("id", v.id));
    }
    if (!matchId && h === liveHash) matchId = v.id;
  }
  if (matchId && matchId !== activeId) await setSetting("active_ratebook_version", String(matchId));
  return { matchId, baseId: matchId ?? activeId };
}

async function listVersions(p: { kind?: "ratebook" | "terms" }, live?: Catalog): Promise<VersionInfo[]> {
  let q = sb().from("versions").select("id, kind, name, created_at, updated_at, created_by, summary, hash");
  if (p.kind) q = q.eq("kind", p.kind);
  const rows = (check(await q) as VersionRow[]).map((r) => ({ ...r, id: Number(r.id) }));
  const defaultTerms = await getSetting("default_terms_version");
  const match = !p.kind || p.kind === "ratebook" ? await rateBookMatch(rows, live ?? (await catalog())) : null;
  return rows
    .map((v) => {
      const out: VersionInfo = {
        id: v.id, kind: v.kind, name: v.name, createdAt: v.created_at, updatedAt: v.updated_at || v.created_at,
        createdBy: v.created_by ?? "", summary: v.summary ?? "",
        isDefault: v.kind === "terms" && defaultTerms === String(v.id),
      };
      if (v.kind === "ratebook" && match) {
        out.isActive = match.matchId === v.id;
        out.isBase = !match.matchId && match.baseId === v.id;
        out.edited = out.isBase;
      }
      return out;
    })
    .sort((a, b) => b.id - a.id);
}

async function getVersion(p: { id: number }) {
  const v = check(await sb().from("versions").select("*").eq("id", p.id).maybeSingle()) as VersionRow | null;
  if (!v) throw new BackendError("Version not found.");
  const defaultTerms = await getSetting("default_terms_version");
  return {
    id: Number(v.id), kind: v.kind, name: v.name, createdAt: v.created_at, updatedAt: v.updated_at, createdBy: v.created_by,
    summary: v.summary, isDefault: v.kind === "terms" && defaultTerms === String(v.id), data: v.data,
  };
}

async function saveVersion(p: { id?: number; kind?: string; name?: string; data?: unknown; snapshot?: boolean; backup?: boolean }) {
  const user = await currentUser();
  const name = str(p.name, 80);
  const now = new Date().toISOString();
  if (p.id) {
    const old = check(await sb().from("versions").select("id, kind, name").eq("id", p.id).maybeSingle());
    if (!old) throw new BackendError("Version not found.");
    const upd: Record<string, unknown> = { name: name || old.name, updated_at: now };
    if (old.kind === "terms" && p.data) {
      const t = cleanTerms(p.data as QuotationOptions);
      Object.assign(upd, { data: t, summary: termsSummary(t) });
    }
    if (old.kind === "ratebook" && p.snapshot) {
      const c = await catalog();
      Object.assign(upd, { data: c, summary: rateBookSummary(c), hash: await rateBookHash(c) });
      await setSetting("active_ratebook_version", String(p.id));
    }
    check(await sb().from("versions").update(upd).eq("id", p.id));
    return { id: Number(p.id) };
  }
  const kind = p.kind === "ratebook" || p.kind === "terms" ? p.kind : null;
  if (!kind) throw new BackendError("Unknown version type.");
  if (!name) throw new BackendError("Give the version a name.");
  let row: Record<string, unknown>;
  if (kind === "ratebook") {
    const c = await catalog();
    row = { kind, name, data: c, summary: rateBookSummary(c), hash: await rateBookHash(c) };
  } else {
    const t = cleanTerms(p.data as QuotationOptions);
    row = { kind, name, data: t, summary: termsSummary(t), hash: null };
  }
  const created = check(
    await sb().from("versions").insert({ ...row, created_by: user.email ?? "", created_at: now, updated_at: now }).select("id").single(),
  );
  // a fresh snapshot is identical to the live rate book, so it's the one in use (automatic backups aren't)
  if (kind === "ratebook" && !p.backup) await setSetting("active_ratebook_version", String(created.id));
  return { id: Number(created.id) };
}

async function deleteVersion(p: { id: number }) {
  check(await sb().from("versions").delete().eq("id", p.id));
  if ((await getSetting("default_terms_version")) === String(p.id)) await setSetting("default_terms_version", null);
  if ((await getSetting("active_ratebook_version")) === String(p.id)) await setSetting("active_ratebook_version", null);
  return { ok: true };
}

/** Switches the live rate book to a saved one; unsaved custom rates are kept as a backup version first. */
async function restoreRateBook(p: { id: number }) {
  const target = await getVersion(p);
  if (target.kind !== "ratebook" || !target.data) throw new BackendError("That is not a rate book version.");
  const rows = check(await sb().from("versions").select("id, kind, name, created_at, updated_at, created_by, summary, hash").eq("kind", "ratebook")) as VersionRow[];
  const match = await rateBookMatch(rows.map((r) => ({ ...r, id: Number(r.id) })), await catalog());
  const backup = match.matchId
    ? null
    : await saveVersion({ kind: "ratebook", backup: true, name: `Custom rates before switching to "${target.name}"` });
  check(await sb().rpc("replace_rate_book", { book: target.data }));
  await setSetting("active_ratebook_version", String(target.id));
  return { ok: true, backupId: backup ? backup.id : null };
}

async function setDefaultTerms(p: { id: number | null }) {
  if (p.id !== null && p.id !== undefined) {
    const v = await getVersion({ id: Number(p.id) });
    if (v.kind !== "terms") throw new BackendError("That is not a terms version.");
  }
  await setSetting("default_terms_version", p.id === null || p.id === undefined ? null : String(p.id));
  return { ok: true };
}

/* ───────────── contracts ───────────── */

type ContractRow = {
  id: number; quotation_no: string; created_at: string; client_name: string; client_phone: string; client_email: string;
  site_address: string; project_scope: string; bhk: number; carpet_area: number; tier: string; total: number;
  designer_name: string; line_items: LineItem[]; client_signature: string; designer_signature: string;
  pdf_path: string; pdf_url: string; pdf_options: QuotationOptions | null;
};
const SUMMARY_COLS = "id, quotation_no, created_at, client_name, site_address, project_scope, bhk, carpet_area, tier, total, pdf_path, pdf_url";

const toSummary = (c: Partial<ContractRow>): ContractSummary => ({
  id: Number(c.id), quotationNo: String(c.quotation_no ?? ""), clientName: String(c.client_name ?? ""),
  siteAddress: String(c.site_address ?? ""), projectScope: String(c.project_scope ?? ""), bhk: n(c.bhk),
  carpetArea: n(c.carpet_area), tier: (c.tier ?? "standard") as ContractSummary["tier"], total: n(c.total),
  createdAt: String(c.created_at ?? ""), pdfUrl: c.pdf_path ? "stored" : String(c.pdf_url ?? ""),
});

async function saveContract(p: Record<string, unknown>) {
  const user = await currentUser();
  const clientName = str(p.clientName, 200);
  if (!clientName) throw new BackendError("Client name is required.");
  if (!(TIERS as readonly string[]).includes(String(p.tier))) throw new BackendError("Invalid tier.");
  const bhk = Number(p.bhk);
  if (!(bhk >= 1 && bhk <= 4)) throw new BackendError("Invalid BHK.");
  const lines: LineItem[] = (Array.isArray(p.lineItems) ? (p.lineItems as LineItem[]) : []).slice(0, 300).map((l) => {
    const qty = Math.max(0, n(l.qty));
    const rate = Math.max(0, n(l.rate));
    return {
      itemId: Number(l.itemId), parentItemId: l.parentItemId === null || l.parentItemId === undefined ? null : Number(l.parentItemId),
      categoryName: str(l.categoryName, 200), name: str(l.name, 300), description: str(l.description, 1000),
      unit: (UNITS as readonly string[]).includes(l.unit) ? l.unit : "sqft", qty, rate, amount: Math.round(qty * rate),
      ...(l.listRate != null && Number(l.listRate) !== rate ? { listRate: Math.max(0, n(l.listRate)) } : {}),
    };
  });
  if (!lines.length) throw new BackendError("No items selected.");
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const sig = (v: unknown) => (typeof v === "string" && v.startsWith("data:image/") && v.length < 1_500_000 ? v : "");
  const row = check(
    await sb()
      .from("contracts")
      .insert({
        client_name: clientName, client_phone: str(p.clientPhone, 50), client_email: str(p.clientEmail, 200),
        site_address: str(p.siteAddress, 500), project_scope: str(p.projectScope, 500), bhk, carpet_area: n(p.carpetArea),
        tier: p.tier, total, designer_name: str(p.designerName, 200), created_by: user.email ?? "", line_items: lines,
        client_signature: sig(p.clientSignature), designer_signature: sig(p.designerSignature),
      })
      .select("id, quotation_no")
      .single(),
  );
  return { id: Number(row.id), quotationNo: String(row.quotation_no), total };
}

async function listContracts() {
  const rows = check(await sb().from("contracts").select(SUMMARY_COLS).order("id", { ascending: false }));
  return (rows as Partial<ContractRow>[]).map(toSummary);
}

async function pdfLink(path: string) {
  const res = await sb().storage.from("quotations").createSignedUrl(path, 60 * 60 * 24 * 7);
  return res.data?.signedUrl ?? "";
}

async function getContract(p: { id: number }): Promise<ContractFull> {
  const c = check(await sb().from("contracts").select("*").eq("id", p.id).maybeSingle()) as ContractRow | null;
  if (!c) throw new BackendError("Contract not found.");
  const defaultId = await getSetting("default_terms_version");
  let defaultOptions: QuotationOptions | null = null;
  if (defaultId) {
    const v = check(await sb().from("versions").select("data").eq("id", Number(defaultId)).maybeSingle());
    defaultOptions = (v?.data as QuotationOptions) ?? null;
  }
  const summary = toSummary(c);
  return {
    ...summary,
    pdfUrl: c.pdf_path ? await pdfLink(c.pdf_path) : String(c.pdf_url ?? ""),
    clientPhone: c.client_phone ?? "", clientEmail: c.client_email ?? "", designerName: c.designer_name ?? "",
    lineItems: Array.isArray(c.line_items) ? c.line_items : [],
    clientSignature: c.client_signature ?? "", designerSignature: c.designer_signature ?? "",
    signedAt: c.created_at, pdfOptions: c.pdf_options ?? null, defaultOptions,
  };
}

async function saveContractOptions(p: { id: number; options: QuotationOptions }) {
  const clean = {
    ...cleanTerms(p.options),
    showSignatures: !(p.options && p.options.showSignatures === false),
    validity: str(p.options?.validity, 40) || "15 Days",
  };
  const cur = check(await sb().from("contracts").select("quotation_no").eq("id", p.id).maybeSingle());
  if (!cur) throw new BackendError("Contract not found.");
  const wanted = str(p.options?.quotationNo, 40);
  const upd: Record<string, unknown> = { pdf_options: clean };
  if (wanted && wanted !== cur.quotation_no) upd.quotation_no = wanted;
  const res = await sb().from("contracts").update(upd).eq("id", p.id);
  if (res.error) {
    if (/duplicate|unique/i.test(res.error.message)) throw new BackendError(`Quotation number ${wanted} is already used by another contract.`);
    throw new BackendError(res.error.message);
  }
  return { options: clean, quotationNo: (upd.quotation_no as string) ?? cur.quotation_no };
}

async function savePdf(p: { contractId: number; filename: string; blob?: Blob; base64?: string }) {
  const c = check(await sb().from("contracts").select("quotation_no, pdf_path").eq("id", p.contractId).maybeSingle());
  if (!c) throw new BackendError("Contract not found.");
  const blob =
    p.blob ??
    new Blob([Uint8Array.from(atob(String(p.base64 ?? "")), (ch) => ch.charCodeAt(0))], { type: "application/pdf" });
  const path = `${String(c.quotation_no).replace(/[^\w-]/g, "_")}.pdf`;
  // quotation renumbered since the last save: drop the old file
  if (c.pdf_path && c.pdf_path !== path) await sb().storage.from("quotations").remove([c.pdf_path]);
  const up = await sb().storage.from("quotations").upload(path, blob, { upsert: true, contentType: "application/pdf" });
  if (up.error) throw new BackendError(up.error.message);
  check(await sb().from("contracts").update({ pdf_path: path }).eq("id", p.contractId));
  return { url: await pdfLink(path) };
}

async function deleteContract(p: { id: number }) {
  const c = check(await sb().from("contracts").select("pdf_path").eq("id", p.id).maybeSingle());
  if (c?.pdf_path) await sb().storage.from("quotations").remove([c.pdf_path]);
  check(await sb().from("contracts").delete().eq("id", p.id));
  return { ok: true };
}

/* ───────────── dispatcher ───────────── */

async function rateBookState() {
  const c = await catalog();
  return { catalog: c, versions: await listVersions({ kind: "ratebook" }, c) };
}

const withState =
  <P>(fn: (p: P) => Promise<object>) =>
  async (p: P) => {
    const res = await fn(p);
    return { ...res, state: await rateBookState() };
  };

/* eslint-disable @typescript-eslint/no-explicit-any */
const ACTIONS: Record<string, (p: any) => Promise<unknown>> = {
  login, me, logout, unlockStudio, changePassword,
  catalog, rateBookState,
  saveCategory: withState(saveCategory), deleteCategory: withState(deleteCategory),
  saveItem: withState(saveItem), deleteItem: withState(deleteItem),
  listVersions: (p) => listVersions(p ?? {}), getVersion,
  saveVersion: withState(saveVersion), deleteVersion: withState(deleteVersion),
  restoreRateBook: withState(restoreRateBook), setDefaultTerms,
  saveContract, listContracts, getContract, saveContractOptions, savePdf, deleteContract,
};

export async function callSupabase(action: string, payload: unknown): Promise<unknown> {
  const fn = ACTIONS[action];
  if (!fn) throw new BackendError("Unknown action: " + action);
  if (action !== "login") await currentUser(); // everything else needs a signed-in staff account
  return fn(payload ?? {});
}
