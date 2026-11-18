export type RateUnit = "sqft" | "rft" | "nos" | "lumpsum";
export type Tier = "standard" | "premium" | "luxury";

export type CatalogCategory = { id: number; name: string; sortOrder: number };

export type CatalogItem = {
  id: number;
  categoryId: number;
  /** Set for a nested add-on (e.g. Puja Unit under TV Unit). One level only. */
  parentId: number | null;
  name: string;
  description: string;
  unit: RateUnit;
  rateStandard: number;
  ratePremium: number | null;
  rateLuxury: number | null;
  qtyBhk1: number;
  qtyBhk2: number;
  qtyBhk3: number;
  qtyBhk4: number;
  scalesWithArea: boolean;
  active: boolean;
  sortOrder: number;
};

export type Catalog = { categories: CatalogCategory[]; items: CatalogItem[] };

export type LineItem = {
  itemId: number;
  parentItemId?: number | null;
  categoryName: string;
  name: string;
  description: string;
  unit: RateUnit;
  qty: number;
  rate: number;
  amount: number;
};

export type ContractSummary = {
  id: number;
  quotationNo: string;
  clientName: string;
  siteAddress: string;
  projectScope: string;
  bhk: number;
  carpetArea: number;
  tier: Tier;
  total: number;
  createdAt: string;
  pdfUrl: string;
};

export type ContractFull = ContractSummary & {
  /** Studio edits for the PDF; null means the defaults. */
  pdfOptions?: import("./quotationOptions").QuotationOptions | null;
  /** The studio's default terms version, used when this contract has no edits of its own. */
  defaultOptions?: import("./quotationOptions").QuotationOptions | null;
  clientPhone: string;
  clientEmail: string;
  designerName: string;
  lineItems: LineItem[];
  clientSignature: string;
  designerSignature: string;
  signedAt: string;
};

const REF_AREA: Record<number, number> = { 1: 450, 2: 750, 3: 1100, 4: 1600 };

const TIERS: Record<Tier, { label: string; tag: string; tagline: string; materials: string[] }> = {
  standard: {
    label: "Standard",
    tag: "Value focused",
    tagline: "Functional designs with practical materials and finishes.",
    materials: ["BWP anti-termite ply", "Sunmica laminate, inside & out", "Soft-close hinges & channels", "Gypsum ceiling with warm LED"],
  },
  premium: {
    label: "Premium",
    tag: "Most popular",
    tagline: "Elegant materials, refined details and a premium finish.",
    materials: ["BWP anti-termite ply", "Acrylic / high-gloss & textured laminates", "Hettich soft-close hardware", "Profile & cove lighting"],
  },
  luxury: {
    label: "Luxury",
    tag: "High-end",
    tagline: "Bespoke detailing, upgraded materials and elevated finishes.",
    materials: ["Marine-grade ply", "PU, veneer & fluted finishes", "Blum / Häfele premium hardware", "Designer lighting & stone accents"],
  },
};

const UNIT_LABEL: Record<RateUnit, string> = { sqft: "sq.ft", rft: "r.ft", nos: "nos", lumpsum: "lot" };

function baseQty(item: CatalogItem, bhk: number): number {
  const map: Record<number, number> = { 1: item.qtyBhk1, 2: item.qtyBhk2, 3: item.qtyBhk3, 4: item.qtyBhk4 };
  return map[bhk] ?? 0;
}

function defaultQty(item: CatalogItem, bhk: number, area: number): number {
  let base = baseQty(item, bhk);
  if (base <= 0) base = [item.qtyBhk1, item.qtyBhk2, item.qtyBhk3, item.qtyBhk4].find((q) => q > 0) ?? 1;
  if (item.scalesWithArea && area > 0) {
    const ref = REF_AREA[bhk] ?? 750;
    return Math.max(1, Math.round((base * area) / ref));
  }
  return base;
}

function rateFor(item: CatalogItem, tier: Tier): number {
  if (tier === "premium" && item.ratePremium != null) return item.ratePremium;
  if (tier === "luxury" && item.rateLuxury != null) return item.rateLuxury;
  return item.rateStandard;
}

function categoryApplies(items: CatalogItem[], bhk: number): boolean {
  return items.some((i) => i.active && baseQty(i, bhk) > 0);
}

/** Items in display order: each main item followed by its nested add-ons. */
function orderItems(items: CatalogItem[], categories?: CatalogCategory[]): CatalogItem[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const catOrder = new Map((categories ?? []).map((c) => [c.id, c.sortOrder]));
  const key = (i: CatalogItem): [number, number, number, number, number] => {
    const parent = i.parentId != null ? byId.get(i.parentId) : undefined;
    const main = parent ?? i;
    return [catOrder.get(i.categoryId) ?? i.categoryId, main.sortOrder, main.id, parent ? 1 : 0, i.sortOrder * 10000 + i.id];
  };
  return [...items].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let n = 0; n < ka.length; n++) if (ka[n] !== kb[n]) return ka[n] - kb[n];
    return 0;
  });
}

const childrenOf = (items: CatalogItem[], id: number) => items.filter((i) => i.parentId === id);

function buildLineItems(catalog: Catalog, quantities: Record<number, number>, tier: Tier): LineItem[] {
  const catName = new Map(catalog.categories.map((c) => [c.id, c.name]));
  return orderItems(catalog.items, catalog.categories)
    .filter((i) => quantities[i.id] != null && quantities[i.id] > 0)
    .map((i) => {
      const qty = quantities[i.id];
      const rate = rateFor(i, tier);
      return {
        itemId: i.id,
        parentItemId: i.parentId,
        categoryName: catName.get(i.categoryId) ?? "Other",
        name: i.name,
        description: i.description,
        unit: i.unit,
        qty,
        rate,
        amount: Math.round(qty * rate),
      };
    });
}

function groupByCategory(lines: LineItem[]) {
  const groups: { category: string; lines: LineItem[]; subtotal: number }[] = [];
  for (const line of lines) {
    let g = groups.find((x) => x.category === line.categoryName);
    if (!g) {
      g = { category: line.categoryName, lines: [], subtotal: 0 };
      groups.push(g);
    }
    g.lines.push(line);
    g.subtotal += line.amount;
  }
  return groups;
}

const total = (lines: LineItem[]) => lines.reduce((s, l) => s + l.amount, 0);

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const formatINR = (n: number) => `₹${inr.format(Math.round(n))}`;
const formatNumber = (n: number) => inr.format(Math.round(n * 100) / 100);

function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
}

export const estimate = {
  REF_AREA,
  TIERS,
  UNIT_LABEL,
  baseQty,
  defaultQty,
  rateFor,
  categoryApplies,
  orderItems,
  childrenOf,
  buildLineItems,
  groupByCategory,
  total,
  formatINR,
  formatNumber,
  formatDate,
};

export type VersionKind = "ratebook" | "terms";

export type VersionInfo = {
  id: number;
  kind: VersionKind;
  name: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  summary: string;
  isDefault: boolean;
  /** Rate book: this version is the one currently loaded. */
  isActive?: boolean;
  /** Rate book: the live rate book is a custom (unsaved) edit that started from this version. */
  isBase?: boolean;
  edited?: boolean;
};
