export type RateUnit = "sqft" | "rft" | "nos" | "lumpsum";
export type Tier = "standard" | "premium" | "luxury";

export type CatalogCategory = { id: number; name: string; sortOrder: number };

export type CatalogItem = {
  id: number;
  categoryId: number;
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
  clientPhone: string;
  clientEmail: string;
  designerName: string;
  lineItems: LineItem[];
  clientSignature: string;
  designerSignature: string;
  signedAt: string;
};

const REF_AREA: Record<number, number> = { 1: 450, 2: 750, 3: 1100, 4: 1600 };

const TIERS: Record<Tier, { label: string; tagline: string; materials: string[] }> = {
  standard: {
    label: "Standard",
    tagline: "Smart, durable and beautifully finished",
    materials: ["BWP anti-termite ply", "Sunmica laminate, inside & out", "Soft-close hinges & channels", "Gypsum ceiling with warm LED"],
  },
  premium: {
    label: "Premium",
    tagline: "Richer finishes and branded hardware",
    materials: ["BWP anti-termite ply", "Acrylic / high-gloss & textured laminates", "Hettich soft-close hardware", "Profile & cove lighting"],
  },
  luxury: {
    label: "Luxury",
    tagline: "Bespoke, crafted, statement-making",
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

function buildLineItems(catalog: Catalog, quantities: Record<number, number>, tier: Tier): LineItem[] {
  const catName = new Map(catalog.categories.map((c) => [c.id, c.name]));
  const catOrder = new Map(catalog.categories.map((c) => [c.id, c.sortOrder]));
  return catalog.items
    .filter((i) => quantities[i.id] != null && quantities[i.id] > 0)
    .sort((a, b) => (catOrder.get(a.categoryId) ?? 0) - (catOrder.get(b.categoryId) ?? 0) || a.sortOrder - b.sortOrder)
    .map((i) => {
      const qty = quantities[i.id];
      const rate = rateFor(i, tier);
      return {
        itemId: i.id,
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
  buildLineItems,
  groupByCategory,
  total,
  formatINR,
  formatNumber,
  formatDate,
};
