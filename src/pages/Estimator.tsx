import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Lock, LogOut, Minus, Plus, RotateCcw, X } from "lucide-react";
import { Button, Input, Skeleton } from "../components/ui";
import { BrandMark } from "../components/BrandMark";
import { SignaturePad } from "../components/SignaturePad";
import { useSession } from "../lib/session";
import { api } from "../lib/api";
import { estimate, type Catalog, type CatalogItem, type LineItem, type Tier } from "../lib/estimate";
import { brandAssets } from "../lib/brandAssets";
import { toast } from "../lib/toast";
import styles from "./Estimator.module.css";

type Step = "welcome" | "home" | "scope" | "quantities" | "tier" | "estimate" | "details" | "contract" | "done";

const FLOW: { id: Step; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "scope", label: "Scope" },
  { id: "quantities", label: "Sizes" },
  { id: "tier", label: "Finish" },
  { id: "estimate", label: "Estimate" },
  { id: "details", label: "Details" },
  { id: "contract", label: "Agreement" },
];

const BHK_OPTIONS = [1, 2, 3, 4];
const TIER_ORDER: Tier[] = ["standard", "premium", "luxury"];

type ClientDetails = {
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  siteAddress: string;
  projectScope: string;
  designerName: string;
};

export default function Estimator() {
  const { catalog, catalogError, reloadCatalog, user, logout } = useSession();
  const emptyDetails: ClientDetails = {
    clientName: "",
    clientPhone: "",
    clientEmail: "",
    siteAddress: "",
    projectScope: "",
    designerName: user?.name ?? "",
  };
  const [step, setStep] = useState<Step>("welcome");
  const [bhk, setBhk] = useState<number | null>(null);
  const [areaText, setAreaText] = useState("");
  const [committedHome, setCommittedHome] = useState("");
  const [qty, setQty] = useState<Record<number, number>>({});
  const [tier, setTier] = useState<Tier>("premium");
  const [details, setDetails] = useState<ClientDetails>(emptyDetails);
  const [clientSig, setClientSig] = useState<string | null>(null);
  const [designerSig, setDesignerSig] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ quotationNo: string; total: number } | null>(null);

  const area = Number(areaText) || 0;
  const lines = useMemo(() => (catalog ? estimate.buildLineItems(catalog, qty, tier) : []), [catalog, qty, tier]);
  const total = estimate.total(lines);
  const selectedCount = Object.keys(qty).length;

  const go = (s: Step) => {
    setStep(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resetAll = () => {
    setBhk(null);
    setAreaText("");
    setCommittedHome("");
    setQty({});
    setTier("premium");
    setDetails(emptyDetails);
    setClientSig(null);
    setDesignerSig(null);
    setSaved(null);
    go("welcome");
  };

  const commitHome = () => {
    const key = `${bhk}-${area}`;
    if (committedHome && committedHome !== key) setQty({});
    setCommittedHome(key);
    go("scope");
  };

  const goDetails = () => {
    if (!details.projectScope) {
      setDetails((d) => ({ ...d, projectScope: estimate.groupByCategory(lines).map((g) => g.category).join(", ") }));
    }
    go("details");
  };

  const save = async () => {
    if (!bhk || !clientSig || !designerSig) return;
    setSaving(true);
    try {
      const res = await api<{ id: number; quotationNo: string; total: number }>("saveContract", {
        ...details,
        bhk,
        carpetArea: area,
        tier,
        lineItems: lines,
        clientSignature: clientSig,
        designerSignature: designerSig,
      });
      setSaved({ quotationNo: res.quotationNo, total: res.total });
      go("done");
    } catch (e) {
      toast.error("Couldn't save the agreement", (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (step === "welcome") {
    return (
      <main className={styles.welcome}>
        {brandAssets.cover ? (
          <img src={brandAssets.cover} alt="" className={styles.welcomeImage} />
        ) : (
          <div className={styles.welcomeGlow} aria-hidden />
        )}
        <div className={styles.welcomeShade} aria-hidden />
        <div className={styles.welcomeInner}>
          <BrandMark tone="light" size="lg" />
          <div className={styles.welcomeCenter}>
            <p className={styles.welcomeKicker}>DESIGN &nbsp;|&nbsp; EXECUTE &nbsp;|&nbsp; TRANSFORM</p>
            <h1 className={styles.welcomeTitle}>A home that feels like you</h1>
            <p className={styles.welcomeSub}>
              Tell us about your home and the spaces you'd like to transform — we'll show you an instant estimate.
            </p>
            <Button variant="gold" size="lg" onClick={() => go("home")} disabled={!catalog}>
              {catalog ? "Begin your estimate" : "Loading rate book…"} <ArrowRight size={18} />
            </Button>
            {catalogError && (
              <p className={styles.welcomeError}>
                {catalogError} <button onClick={() => reloadCatalog()}>Try again</button>
              </p>
            )}
          </div>
          <div className={styles.welcomeFoot}>
            <span>{brandAssets.contact.website}</span>
            <div className={styles.footLinks}>
              <Link to="/studio" className={styles.studioLink}>
                <Lock size={12} /> Studio
              </Link>
              <button className={styles.studioLink} onClick={() => logout()}>
                <LogOut size={12} /> Sign out
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const flowIndex = FLOW.findIndex((f) => f.id === step);

  return (
    <main className={styles.app}>
      <header className={styles.header}>
        <button className={styles.brandButton} onClick={resetAll} aria-label="Start over">
          <BrandMark size="sm" />
        </button>
        {step !== "done" && (
          <ol className={styles.steps}>
            {FLOW.map((f, i) => (
              <li
                key={f.id}
                className={`${styles.stepDot} ${i === flowIndex ? styles.stepActive : ""} ${i < flowIndex ? styles.stepDone : ""}`}
              >
                <span className={styles.stepNum}>{i < flowIndex ? <Check size={11} /> : i + 1}</span>
                <span className={styles.stepLabel}>{f.label}</span>
              </li>
            ))}
          </ol>
        )}
      </header>

      <section className={styles.body}>
        {!catalog ? (
          <div className={styles.loading}>
            <Skeleton style={{ height: 48, width: "50%" }} />
            <Skeleton style={{ height: 160 }} />
            <Skeleton style={{ height: 160 }} />
          </div>
        ) : (
          <>
            {step === "home" && <HomeStep bhk={bhk} setBhk={setBhk} areaText={areaText} setAreaText={setAreaText} />}
            {step === "scope" && bhk && <ScopeStep catalog={catalog} bhk={bhk} area={area} qty={qty} setQty={setQty} />}
            {step === "quantities" && <QuantitiesStep catalog={catalog} qty={qty} setQty={setQty} />}
            {step === "tier" && <TierStep tier={tier} setTier={setTier} />}
            {step === "estimate" && (
              <EstimateStep catalog={catalog} qty={qty} tier={tier} setTier={setTier} bhk={bhk ?? 0} area={area} />
            )}
            {step === "details" && <DetailsStep details={details} setDetails={setDetails} />}
            {step === "contract" && bhk && (
              <ContractStep
                details={details}
                bhk={bhk}
                area={area}
                tier={tier}
                lines={lines}
                total={total}
                setClientSig={setClientSig}
                setDesignerSig={setDesignerSig}
              />
            )}
            {step === "done" && saved && (
              <div className={styles.done}>
                <div className={styles.doneSeal}>
                  <Check size={34} />
                </div>
                <p className={styles.kicker}>AGREEMENT SIGNED &amp; SAVED</p>
                <h1 className={styles.title}>Welcome to Interior Editors, {details.clientName.trim()}.</h1>
                <p className={styles.lede}>
                  Quotation <strong>{saved.quotationNo}</strong> · Project value <strong>{estimate.formatINR(saved.total)}</strong>
                </p>
                <p className={styles.muted}>Your detailed quotation will be shared with you shortly. We can't wait to begin.</p>
                <Button size="lg" onClick={resetAll}>
                  <RotateCcw size={16} /> Start a new estimate
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      {catalog && step !== "done" && (
        <footer className={styles.footer}>
          <div className={styles.footerInner}>
            <Button variant="ghost" size="lg" onClick={() => go(flowIndex <= 0 ? "welcome" : FLOW[flowIndex - 1].id)}>
              <ArrowLeft size={18} /> Back
            </Button>
            <div className={styles.footerMeta}>
              {(step === "scope" || step === "quantities") && <span>{selectedCount} items selected</span>}
            </div>
            {step === "home" && (
              <Button size="lg" disabled={!bhk || area < 50} onClick={commitHome}>
                Choose scope <ArrowRight size={18} />
              </Button>
            )}
            {step === "scope" && (
              <Button size="lg" disabled={selectedCount === 0} onClick={() => go("quantities")}>
                Review sizes <ArrowRight size={18} />
              </Button>
            )}
            {step === "quantities" && (
              <Button size="lg" disabled={selectedCount === 0} onClick={() => go("tier")}>
                Choose finish <ArrowRight size={18} />
              </Button>
            )}
            {step === "tier" && (
              <Button variant="gold" size="lg" onClick={() => go("estimate")}>
                See my estimate <ArrowRight size={18} />
              </Button>
            )}
            {step === "estimate" && (
              <Button variant="gold" size="lg" onClick={goDetails}>
                I love it — proceed <ArrowRight size={18} />
              </Button>
            )}
            {step === "details" && (
              <Button size="lg" disabled={!details.clientName.trim()} onClick={() => go("contract")}>
                Review agreement <ArrowRight size={18} />
              </Button>
            )}
            {step === "contract" && (
              <Button variant="gold" size="lg" disabled={!clientSig || !designerSig || saving} onClick={save}>
                {saving ? "Saving…" : "Sign & save to cloud"} <Check size={18} />
              </Button>
            )}
          </div>
        </footer>
      )}
    </main>
  );
}

/* ───────────────────────── Steps ───────────────────────── */

function HomeStep(props: { bhk: number | null; setBhk: (n: number) => void; areaText: string; setAreaText: (s: string) => void }) {
  const { bhk, setBhk, areaText, setAreaText } = props;
  return (
    <div className={styles.stepWrap}>
      <p className={styles.kicker}>01 · YOUR HOME</p>
      <h1 className={styles.title}>Tell us about your home</h1>
      <p className={styles.lede}>We'll suggest sizes for every space based on your home's configuration.</p>

      <div className={styles.fieldLabel}>Configuration</div>
      <div className={styles.bhkGrid}>
        {BHK_OPTIONS.map((n) => (
          <button
            key={n}
            type="button"
            className={`${styles.bhkCard} ${bhk === n ? styles.bhkActive : ""}`}
            onClick={() => {
              setBhk(n);
              if (!areaText) setAreaText(String(estimate.REF_AREA[n]));
            }}
          >
            <span className={styles.bhkNum}>{n}</span>
            <span className={styles.bhkText}>BHK</span>
          </button>
        ))}
      </div>

      <div className={styles.fieldLabel}>Carpet area</div>
      <div className={styles.areaRow}>
        <Input
          className={styles.areaInput}
          inputMode="numeric"
          value={areaText}
          onChange={(e) => setAreaText(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="e.g. 1100"
        />
        <span className={styles.areaUnit}>sq. ft.</span>
      </div>
      {bhk && (
        <div className={styles.areaChips}>
          {[0.8, 1, 1.25, 1.5].map((f) => {
            const v = Math.round((estimate.REF_AREA[bhk] * f) / 50) * 50;
            return (
              <button key={f} type="button" className={styles.chip} onClick={() => setAreaText(String(v))}>
                {v} sq.ft
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScopeStep(props: {
  catalog: Catalog;
  bhk: number;
  area: number;
  qty: Record<number, number>;
  setQty: React.Dispatch<React.SetStateAction<Record<number, number>>>;
}) {
  const { catalog, bhk, area, qty, setQty } = props;
  const [open, setOpen] = useState<number | null>(null);

  const groups = useMemo(
    () =>
      catalog.categories
        .map((c) => ({ category: c, items: catalog.items.filter((i) => i.categoryId === c.id && i.active) }))
        .filter((g) => g.items.length > 0 && estimate.categoryApplies(g.items, bhk)),
    [catalog, bhk],
  );

  const defaultsFor = (items: CatalogItem[]) => items.filter((i) => estimate.baseQty(i, bhk) > 0);

  const toggleItem = (item: CatalogItem) =>
    setQty((q) => {
      const next = { ...q };
      if (next[item.id] != null) delete next[item.id];
      else next[item.id] = estimate.defaultQty(item, bhk, area);
      return next;
    });

  const toggleCategory = (items: CatalogItem[], on: boolean) =>
    setQty((q) => {
      const next = { ...q };
      for (const i of items) delete next[i.id];
      if (on) for (const i of defaultsFor(items)) next[i.id] = estimate.defaultQty(i, bhk, area);
      return next;
    });

  const selectWholeHome = () => {
    const next: Record<number, number> = {};
    for (const g of groups) for (const i of defaultsFor(g.items)) next[i.id] = estimate.defaultQty(i, bhk, area);
    setQty(next);
  };

  return (
    <div className={styles.stepWrap}>
      <p className={styles.kicker}>02 · SCOPE</p>
      <h1 className={styles.title}>Which spaces shall we design?</h1>
      <p className={styles.lede}>Tap a space to see what's included. Select whole spaces or pick individual pieces.</p>
      <div className={styles.scopeActions}>
        <Button variant="outline" onClick={selectWholeHome}>
          Select whole home
        </Button>
        <Button variant="ghost" onClick={() => setQty({})}>
          Clear
        </Button>
      </div>

      <div className={styles.scopeList}>
        {groups.map(({ category, items }) => {
          const picked = items.filter((i) => qty[i.id] != null).length;
          const state = picked === 0 ? "none" : picked === items.length ? "all" : "some";
          const isOpen = open === category.id;
          return (
            <div key={category.id} className={`${styles.scopeCard} ${picked ? styles.scopeCardOn : ""}`}>
              <div className={styles.scopeHead}>
                <button
                  type="button"
                  className={`${styles.tick} ${state !== "none" ? styles.tickOn : ""}`}
                  onClick={() => toggleCategory(items, state === "none")}
                  aria-label={`Select ${category.name}`}
                >
                  {state === "all" && <Check size={16} />}
                  {state === "some" && <Minus size={16} />}
                </button>
                <button type="button" className={styles.scopeTitle} onClick={() => setOpen(isOpen ? null : category.id)}>
                  <span className={styles.scopeName}>{category.name}</span>
                  <span className={styles.scopeCount}>{picked ? `${picked} of ${items.length} selected` : `${items.length} options`}</span>
                  <ChevronDown size={20} className={`${styles.chev} ${isOpen ? styles.chevOpen : ""}`} />
                </button>
              </div>
              {isOpen && (
                <ul className={styles.scopeItems}>
                  {items.map((item) => {
                    const on = qty[item.id] != null;
                    return (
                      <li key={item.id}>
                        <button type="button" className={`${styles.scopeItem} ${on ? styles.scopeItemOn : ""}`} onClick={() => toggleItem(item)}>
                          <span className={`${styles.tick} ${styles.tickSm} ${on ? styles.tickOn : ""}`}>{on && <Check size={13} />}</span>
                          <span className={styles.scopeItemText}>
                            <span className={styles.scopeItemName}>{item.name}</span>
                            {item.description && <span className={styles.scopeItemDesc}>{item.description}</span>}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QuantitiesStep(props: {
  catalog: Catalog;
  qty: Record<number, number>;
  setQty: React.Dispatch<React.SetStateAction<Record<number, number>>>;
}) {
  const { catalog, qty, setQty } = props;
  const groups = catalog.categories
    .map((c) => ({ category: c, items: catalog.items.filter((i) => i.categoryId === c.id && qty[i.id] != null) }))
    .filter((g) => g.items.length > 0);

  const setOne = (id: number, v: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.round(v * 100) / 100) }));
  const remove = (id: number) =>
    setQty((q) => {
      const n = { ...q };
      delete n[id];
      return n;
    });

  return (
    <div className={styles.stepWrap}>
      <p className={styles.kicker}>03 · SIZES</p>
      <h1 className={styles.title}>Fine-tune the sizes</h1>
      <p className={styles.lede}>We've suggested sizes for your home. Adjust anything that doesn't match your space.</p>
      {groups.map(({ category, items }) => (
        <div key={category.id} className={styles.qtyGroup}>
          <h2 className={styles.qtyGroupTitle}>{category.name}</h2>
          {items.map((item) => {
            const v = qty[item.id];
            const step = item.unit === "sqft" ? 5 : 1;
            return (
              <div key={item.id} className={styles.qtyRow}>
                <div className={styles.qtyName}>
                  <span>{item.name}</span>
                  <span className={styles.qtyDesc}>{item.description}</span>
                </div>
                {item.unit === "lumpsum" ? (
                  <span className={styles.qtyIncluded}>Included</span>
                ) : (
                  <div className={styles.stepper}>
                    <button type="button" onClick={() => setOne(item.id, v - step)} aria-label="Decrease">
                      <Minus size={16} />
                    </button>
                    <input
                      inputMode="decimal"
                      value={v}
                      onChange={(e) => setOne(item.id, Number(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
                    />
                    <button type="button" onClick={() => setOne(item.id, v + step)} aria-label="Increase">
                      <Plus size={16} />
                    </button>
                    <span className={styles.qtyUnit}>{estimate.UNIT_LABEL[item.unit]}</span>
                  </div>
                )}
                <button type="button" className={styles.qtyRemove} onClick={() => remove(item.id)} aria-label="Remove">
                  <X size={16} />
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function TierStep({ tier, setTier }: { tier: Tier; setTier: (t: Tier) => void }) {
  return (
    <div className={styles.stepWrap}>
      <p className={styles.kicker}>04 · FINISH</p>
      <h1 className={styles.title}>Choose your finish</h1>
      <p className={styles.lede}>The same design, crafted in three levels of materials and detailing.</p>
      <div className={styles.tierGrid}>
        {TIER_ORDER.map((t, idx) => {
          const meta = estimate.TIERS[t];
          const on = tier === t;
          return (
            <button
              key={t}
              type="button"
              className={`${styles.tierCard} ${on ? styles.tierOn : ""} ${t === "luxury" ? styles.tierLux : ""}`}
              onClick={() => setTier(t)}
            >
              <span className={styles.tierRank}>{"◆".repeat(idx + 1)}</span>
              <span className={styles.tierName}>{meta.label}</span>
              <span className={styles.tierTag}>{meta.tagline}</span>
              <ul className={styles.tierList}>
                {meta.materials.map((m) => (
                  <li key={m}>
                    <Check size={14} /> {m}
                  </li>
                ))}
              </ul>
              <span className={styles.tierSelect}>{on ? "Selected" : "Select"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EstimateStep(props: { catalog: Catalog; qty: Record<number, number>; tier: Tier; setTier: (t: Tier) => void; bhk: number; area: number }) {
  const { catalog, qty, tier, setTier, bhk, area } = props;
  const [open, setOpen] = useState<string | null>(null);
  const lines = estimate.buildLineItems(catalog, qty, tier);
  const groups = estimate.groupByCategory(lines);
  const total = estimate.total(lines);

  return (
    <div className={styles.stepWrap}>
      <p className={styles.kicker}>05 · YOUR ESTIMATE</p>
      <div className={styles.tierSwitch}>
        {TIER_ORDER.map((t) => (
          <button key={t} type="button" className={tier === t ? styles.tierSwitchOn : ""} onClick={() => setTier(t)}>
            {estimate.TIERS[t].label}
          </button>
        ))}
      </div>
      <div className={styles.totalBlock}>
        <span className={styles.totalLabel}>ESTIMATED PROJECT VALUE</span>
        <span className={styles.totalValue}>{estimate.formatINR(total)}</span>
        <span className={styles.totalMeta}>
          {bhk} BHK · {estimate.formatNumber(area)} sq.ft · {estimate.TIERS[tier].label} finish
        </span>
      </div>

      <div className={styles.breakdown}>
        {groups.map((g) => {
          const isOpen = open === g.category;
          return (
            <div key={g.category} className={styles.bdGroup}>
              <button type="button" className={styles.bdHead} onClick={() => setOpen(isOpen ? null : g.category)}>
                <span className={styles.bdName}>{g.category}</span>
                <span className={styles.bdSub}>{g.subtotal === 0 ? "Included" : estimate.formatINR(g.subtotal)}</span>
                <ChevronDown size={18} className={`${styles.chev} ${isOpen ? styles.chevOpen : ""}`} />
              </button>
              {isOpen && (
                <div className={styles.bdRows}>
                  {g.lines.map((l) => (
                    <div key={l.itemId} className={styles.bdRow}>
                      <span className={styles.bdItem}>{l.name}</span>
                      <span className={styles.bdCalc}>
                        {l.unit === "lumpsum" ? "" : `${estimate.formatNumber(l.qty)} ${estimate.UNIT_LABEL[l.unit]} × ${estimate.formatINR(l.rate)}`}
                      </span>
                      <span className={styles.bdAmt}>{l.amount === 0 ? "Included" : estimate.formatINR(l.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className={styles.note}>This is an estimate. Final pricing depends on the final design, material selection and site conditions.</p>
    </div>
  );
}

function DetailsStep({ details, setDetails }: { details: ClientDetails; setDetails: React.Dispatch<React.SetStateAction<ClientDetails>> }) {
  const field = (key: keyof ClientDetails) => ({
    value: details[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDetails((d) => ({ ...d, [key]: e.target.value })),
  });
  return (
    <div className={styles.stepWrap}>
      <p className={styles.kicker}>06 · DETAILS</p>
      <h1 className={styles.title}>Let's make it yours</h1>
      <p className={styles.lede}>A few details for your agreement.</p>
      <div className={styles.form}>
        <label className={styles.formField}>
          <span>Client name *</span>
          <Input {...field("clientName")} placeholder="Mr. Sandip Rath" autoComplete="off" />
        </label>
        <label className={styles.formField}>
          <span>Phone</span>
          <Input {...field("clientPhone")} inputMode="tel" placeholder="+91" autoComplete="off" />
        </label>
        <label className={styles.formField}>
          <span>Email</span>
          <Input {...field("clientEmail")} inputMode="email" placeholder="name@email.com" autoComplete="off" />
        </label>
        <label className={`${styles.formField} ${styles.formWide}`}>
          <span>Site address</span>
          <Input {...field("siteAddress")} placeholder="Flat, building, area" autoComplete="off" />
        </label>
        <label className={`${styles.formField} ${styles.formWide}`}>
          <span>Project scope</span>
          <Input {...field("projectScope")} placeholder="Living Room, Kitchen…" />
        </label>
        <label className={styles.formField}>
          <span>Interior Editors representative</span>
          <Input {...field("designerName")} placeholder="Your name" />
        </label>
      </div>
    </div>
  );
}

function ContractStep(props: {
  details: ClientDetails;
  bhk: number;
  area: number;
  tier: Tier;
  lines: LineItem[];
  total: number;
  setClientSig: (s: string | null) => void;
  setDesignerSig: (s: string | null) => void;
}) {
  const { details, bhk, area, tier, lines, total, setClientSig, setDesignerSig } = props;
  const groups = estimate.groupByCategory(lines);
  return (
    <div className={styles.stepWrap}>
      <article className={styles.contract}>
        <div className={styles.contractTop}>
          <BrandMark size="sm" />
          <span className={styles.contractDate}>{estimate.formatDate(new Date())}</span>
        </div>
        <p className={styles.kicker}>LETTER OF ENGAGEMENT</p>
        <h1 className={styles.contractTitle}>Interior Design &amp; Execution Agreement</h1>
        <p className={styles.contractText}>
          This letter records that <strong>{details.clientName || "the Client"}</strong>
          {details.siteAddress ? (
            <>
              {" "}
              of <strong>{details.siteAddress}</strong>
            </>
          ) : null}{" "}
          engages <strong>Interior Editors</strong> to design and execute the interiors of their {bhk} BHK home of approximately{" "}
          {estimate.formatNumber(area)} sq. ft., in the <strong>{estimate.TIERS[tier].label}</strong> finish, as summarised below.
        </p>

        <div className={styles.contractGrid}>
          {groups.map((g) => (
            <div key={g.category} className={styles.contractRow}>
              <span>{g.category}</span>
              <span>{g.subtotal === 0 ? "Included" : estimate.formatINR(g.subtotal)}</span>
            </div>
          ))}
          <div className={styles.contractTotal}>
            <span>PROJECT VALUE</span>
            <span>{estimate.formatINR(total)}</span>
          </div>
        </div>

        <p className={styles.contractText}>
          Both parties look forward to creating a home that feels truly personal — thoughtfully designed, beautifully crafted and
          delivered with care.
        </p>

        <div className={styles.sigGrid}>
          <SignaturePad label="Client" sublabel={details.clientName || "—"} onChange={setClientSig} />
          <SignaturePad label="For Interior Editors" sublabel={details.designerName || "Authorised signatory"} onChange={setDesignerSig} />
        </div>
      </article>
    </div>
  );
}
