import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Lock, LogOut, Minus, Pencil, Plus, RotateCcw, X } from "lucide-react";
import { Button, Input, Skeleton } from "../components/ui";
import { BrandMark } from "../components/BrandMark";
import { SignaturePad } from "../components/SignaturePad";
import { Rise, SplitTitle, useCountUp } from "../components/Motion";
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
  // Rates agreed with the client while bargaining, per finish: { premium: { itemId: rate } }
  const [agreed, setAgreed] = useState<Partial<Record<Tier, Record<number, number>>>>({});
  const [details, setDetails] = useState<ClientDetails>(emptyDetails);
  const [clientSig, setClientSig] = useState<string | null>(null);
  const [designerSig, setDesignerSig] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ quotationNo: string; total: number } | null>(null);

  const area = Number(areaText) || 0;
  const lines = useMemo(
    () => (catalog ? estimate.buildLineItems(catalog, qty, tier, agreed[tier]) : []),
    [catalog, qty, tier, agreed],
  );
  const setAgreedRate = (itemId: number, rate: number | null) =>
    setAgreed((a) => {
      const forTier = { ...(a[tier] ?? {}) };
      if (rate === null) delete forTier[itemId];
      else forTier[itemId] = rate;
      return { ...a, [tier]: forTier };
    });
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
    setAgreed({});
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
        <picture>
          <source media="(orientation: landscape)" srcSet={brandAssets.welcomeLandscape} />
          <img src={brandAssets.welcomePortrait} alt="" className={`${styles.welcomeImage} ${styles.archReveal}`} />
        </picture>
        <div className={styles.welcomeShade} aria-hidden />
        <div className={styles.welcomeInner}>
          <BrandMark tone="light" size="lg" />
          <div className={styles.welcomeCenter}>
            <Rise delay={0.2}>
              <p className={styles.welcomeKicker}>DESIGN &nbsp;·&nbsp; TRANSFORM &nbsp;·&nbsp; INSPIRE</p>
            </Rise>
            <SplitTitle text="A home that feels like you" className={styles.welcomeTitle} delay={0.35} />
            <Rise delay={0.9}>
            <p className={styles.welcomeSub}>
              Tell us about your home and the spaces you'd like to transform — we'll show you an instant estimate.
            </p>
            </Rise>
            <Rise delay={1.05}>
            <Button variant="gold" size="lg" onClick={() => go("home")} disabled={!catalog}>
              {catalog ? "Begin your estimate" : "Loading rate book…"} <ArrowRight size={18} />
            </Button>
            </Rise>
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
  const homeKey = `${bhk}-${area}`;
  const homeCommitted = committedHome === homeKey;
  const stepOk: Partial<Record<Step, boolean>> = {
    home: !!bhk && area >= 50,
    scope: selectedCount > 0,
    quantities: selectedCount > 0,
    tier: true,
    estimate: true,
    details: !!details.clientName.trim(),
  };
  /** Back is always allowed; forward only when every step before it is filled in (and the home size is confirmed). */
  const canJump = (i: number) => {
    if (i === flowIndex) return false;
    if (i < flowIndex) return true;
    for (let k = 0; k < i; k++) if (!stepOk[FLOW[k].id]) return false;
    // past Scope only once this home size is confirmed (a new or changed size resets the selection)
    if (i > 1 && !homeCommitted) return false;
    return true;
  };
  const jump = (i: number) => {
    if (!canJump(i)) return;
    const target = FLOW[i].id;
    if (step === "home" && i > 0) {
      if (committedHome !== homeKey) return commitHome(); // resets the scope if the size changed
    }
    if (target === "details") goDetails();
    else go(target);
  };

  return (
    <main className={styles.app}>
      <header className={styles.header}>
        <button className={styles.brandButton} onClick={resetAll} aria-label="Start over">
          <BrandMark size="sm" />
        </button>
        {step !== "done" && (
          <ol className={styles.steps}>
            {FLOW.map((f, i) => (
              <li key={f.id} className={`${styles.step} ${i === flowIndex ? styles.stepActive : ""} ${i < flowIndex ? styles.stepDone : ""}`}>
                <button
                  type="button"
                  className={styles.stepBtn}
                  onClick={() => jump(i)}
                  disabled={!canJump(i)}
                  aria-current={i === flowIndex ? "step" : undefined}
                  aria-label={`Step ${i + 1}: ${f.label}`}
                >
                  <b>{String(i + 1).padStart(2, "0")}</b>
                  <span className={styles.stepLabel}>{f.label}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
        {step !== "done" && flowIndex >= 0 && (
          <div className={styles.stepMobile} aria-hidden>
            <span>
              <b>{String(flowIndex + 1).padStart(2, "0")}</b> / {String(FLOW.length).padStart(2, "0")}
            </span>
            <span className={styles.stepMobileLabel}>{FLOW[flowIndex]?.label}</span>
            <span className={styles.stepMobileBar}>
              <span style={{ width: `${((flowIndex + 1) / FLOW.length) * 100}%` }} />
            </span>
          </div>
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
          <div key={step} className={styles.stepIn}>
            {step === "home" && <HomeStep bhk={bhk} setBhk={setBhk} areaText={areaText} setAreaText={setAreaText} />}
            {step === "scope" && bhk && <ScopeStep catalog={catalog} bhk={bhk} area={area} qty={qty} setQty={setQty} />}
            {step === "quantities" && <QuantitiesStep catalog={catalog} qty={qty} setQty={setQty} />}
            {step === "tier" && <TierStep tier={tier} setTier={setTier} />}
            {step === "estimate" && (
              <EstimateStep
                catalog={catalog}
                qty={qty}
                tier={tier}
                setTier={setTier}
                bhk={bhk ?? 0}
                area={area}
                agreed={agreed[tier] ?? {}}
                setAgreedRate={setAgreedRate}
              />
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
          </div>
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
      <SplitTitle text="Tell us about your home" className={styles.title} />
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
        .map((c) => {
          const items = catalog.items.filter((i) => i.categoryId === c.id && i.active);
          const mains = estimate.orderItems(items.filter((i) => i.parentId == null));
          return { category: c, items, mains };
        })
        .filter((g) => g.mains.length > 0 && estimate.categoryApplies(g.items, bhk)),
    [catalog, bhk],
  );

  const kids = (items: CatalogItem[], main: CatalogItem) => estimate.childrenOf(items, main.id);
  const fits = (i: CatalogItem) => estimate.baseQty(i, bhk) > 0;

  /** A main item plus the add-ons that suit this home size. */
  const withDefaults = (next: Record<number, number>, items: CatalogItem[], main: CatalogItem) => {
    next[main.id] = estimate.defaultQty(main, bhk, area);
    for (const k of kids(items, main)) if (fits(k)) next[k.id] = estimate.defaultQty(k, bhk, area);
  };

  const toggleMain = (items: CatalogItem[], main: CatalogItem) =>
    setQty((q) => {
      const next = { ...q };
      if (next[main.id] != null) {
        delete next[main.id];
        for (const k of kids(items, main)) delete next[k.id];
      } else withDefaults(next, items, main);
      return next;
    });

  const toggleAddon = (items: CatalogItem[], main: CatalogItem, addon: CatalogItem) =>
    setQty((q) => {
      const next = { ...q };
      if (next[addon.id] != null) delete next[addon.id];
      else {
        if (next[main.id] == null) next[main.id] = estimate.defaultQty(main, bhk, area);
        next[addon.id] = estimate.defaultQty(addon, bhk, area);
      }
      return next;
    });

  /** Every piece in a room, add-ons included. Pieces with no quantity for this BHK start from the nearest size that has one. */
  const selectAllIn = (next: Record<number, number>, items: CatalogItem[], mains: CatalogItem[]) => {
    for (const m of mains) {
      next[m.id] = estimate.defaultQty(m, bhk, area);
      for (const k of kids(items, m)) if (k.active) next[k.id] = estimate.defaultQty(k, bhk, area);
    }
  };

  const toggleCategory = (items: CatalogItem[], mains: CatalogItem[], on: boolean) =>
    setQty((q) => {
      const next = { ...q };
      for (const i of items) delete next[i.id];
      if (on) selectAllIn(next, items, mains);
      return next;
    });

  const selectWholeHome = () => {
    const next: Record<number, number> = {};
    for (const g of groups) selectAllIn(next, g.items, g.mains);
    setQty(next);
  };

  return (
    <div className={styles.stepWrap}>
      <p className={styles.kicker}>02 · SCOPE</p>
      <SplitTitle text="Which spaces shall we design?" className={styles.title} />
      <p className={styles.lede}>Tap a space to see what's included. Each piece can come with optional add-ons.</p>
      <div className={styles.scopeActions}>
        <Button variant="outline" onClick={selectWholeHome}>
          Select whole home
        </Button>
        <Button variant="ghost" onClick={() => setQty({})}>
          Clear
        </Button>
      </div>

      <div className={styles.scopeList}>
        {groups.map(({ category, items, mains }) => {
          const picked = items.filter((i) => qty[i.id] != null).length;
          const pickedMains = mains.filter((m) => qty[m.id] != null).length;
          const state = pickedMains === 0 ? "none" : pickedMains === mains.length ? "all" : "some";
          const isOpen = open === category.id;
          return (
            <div key={category.id} className={`${styles.scopeCard} ${picked ? styles.scopeCardOn : ""}`}>
              <div className={styles.scopeHead}>
                <button
                  type="button"
                  className={`${styles.tick} ${state !== "none" ? styles.tickOn : ""}`}
                  onClick={() => toggleCategory(items, mains, state === "none")}
                  aria-label={`Select ${category.name}`}
                >
                  {state === "all" && <Check size={16} />}
                  {state === "some" && <Minus size={16} />}
                </button>
                <button type="button" className={styles.scopeTitle} onClick={() => setOpen(isOpen ? null : category.id)}>
                  <span className={styles.scopeName}>{category.name}</span>
                  <span className={styles.scopeCount}>{picked ? `${picked} selected` : `${mains.length} pieces`}</span>
                  <ChevronDown size={20} className={`${styles.chev} ${isOpen ? styles.chevOpen : ""}`} />
                </button>
              </div>
              {isOpen && (
                <ul className={styles.scopeItems}>
                  {mains.map((main, mi) => {
                    const on = qty[main.id] != null;
                    const addons = kids(items, main).filter((k) => k.active);
                    return (
                      <li key={main.id} className={`${styles.scopeItemWrap} ${on ? styles.scopeItemOn : ""}`} style={{ animationDelay: `${mi * 0.04}s` }}>
                        <button type="button" className={styles.scopeItem} onClick={() => toggleMain(items, main)}>
                          <span className={`${styles.tick} ${styles.tickSm} ${on ? styles.tickOn : ""}`}>{on && <Check size={13} />}</span>
                          <span className={styles.scopeItemText}>
                            <span className={styles.scopeItemName}>{main.name}</span>
                            {main.description && <span className={styles.scopeItemDesc}>{main.description}</span>}
                          </span>
                        </button>
                        {addons.length > 0 && (
                          <div className={styles.addons}>
                            <span className={styles.addonsLabel}>Add-ons</span>
                            {addons.map((a) => {
                              const aon = qty[a.id] != null;
                              return (
                                <button
                                  key={a.id}
                                  type="button"
                                  className={`${styles.addon} ${aon ? styles.addonOn : ""}`}
                                  onClick={() => toggleAddon(items, main, a)}
                                  aria-pressed={aon}
                                >
                                  {aon ? <Check size={13} /> : <Plus size={13} />} {a.name}
                                </button>
                              );
                            })}
                          </div>
                        )}
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
    .map((c) => ({
      category: c,
      items: estimate.orderItems(catalog.items.filter((i) => i.categoryId === c.id && qty[i.id] != null)),
    }))
    .filter((g) => g.items.length > 0);

  // a quantity can't go below 1 (to drop a piece, remove it); typing may pass through 0, fixed on leaving the box
  const setOne = (id: number, v: number, min = 1) => setQty((q) => ({ ...q, [id]: Math.max(min, Math.round(v * 100) / 100) }));
  const remove = (item: CatalogItem) =>
    setQty((q) => {
      const n = { ...q };
      delete n[item.id];
      if (item.parentId == null) for (const k of estimate.childrenOf(catalog.items, item.id)) delete n[k.id];
      return n;
    });

  return (
    <div className={styles.stepWrap}>
      <p className={styles.kicker}>03 · SIZES</p>
      <SplitTitle text="Fine-tune the sizes" className={styles.title} />
      <p className={styles.lede}>We've suggested sizes for your home. Adjust anything that doesn't match your space.</p>
      {groups.map(({ category, items }) => (
        <div key={category.id} className={styles.qtyGroup}>
          <h2 className={styles.qtyGroupTitle}>{category.name}</h2>
          {items.map((item) => {
            const v = qty[item.id];
            const step = item.unit === "sqft" ? 5 : 1;
            const child = item.parentId != null;
            return (
              <div key={item.id} className={`${styles.qtyRow} ${child ? styles.qtyChild : ""}`}>
                <div className={styles.qtyName}>
                  <span>
                    {child && <span className={styles.addonMark}>Add-on · </span>}
                    {item.name}
                  </span>
                  <span className={styles.qtyDesc}>{item.description}</span>
                </div>
                {item.unit === "lumpsum" ? (
                  <span className={styles.qtyIncluded}>1 lot</span>
                ) : (
                  <div className={styles.stepper}>
                    <button type="button" onClick={() => setOne(item.id, v - step)} disabled={v <= 1} aria-label="Decrease">
                      <Minus size={16} />
                    </button>
                    <input
                      inputMode="decimal"
                      value={v || ""}
                      onChange={(e) => setOne(item.id, Number(e.target.value.replace(/[^0-9.]/g, "")) || 0, 0)}
                      onBlur={() => {
                        if (!(v >= 1)) setOne(item.id, 1);
                      }}
                    />
                    <button type="button" onClick={() => setOne(item.id, v + step)} aria-label="Increase">
                      <Plus size={16} />
                    </button>
                    <span className={styles.qtyUnit}>{estimate.UNIT_LABEL[item.unit]}</span>
                  </div>
                )}
                <button type="button" className={styles.qtyRemove} onClick={() => remove(item)} aria-label="Remove">
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
      <SplitTitle text="Choose your finish" className={styles.title} />
      <p className={styles.lede}>The same design, crafted in three levels of materials and detailing.</p>
      <div className={styles.tierGrid}>
        {TIER_ORDER.map((t, idx) => {
          const meta = estimate.TIERS[t];
          const on = tier === t;
          return (
            <button
              key={t}
              type="button"
              className={`${styles.tierCard} ${on ? styles.tierOn : ""}`}
              onClick={() => setTier(t)}
              aria-pressed={on}
              style={{ animationDelay: `${0.15 + idx * 0.08}s` }}
            >
              <span className={styles.tierTagPill}>{meta.tag}</span>
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

function EstimateStep(props: {
  catalog: Catalog;
  qty: Record<number, number>;
  tier: Tier;
  setTier: (t: Tier) => void;
  bhk: number;
  area: number;
  agreed: Record<number, number>;
  setAgreedRate: (itemId: number, rate: number | null) => void;
}) {
  const { catalog, qty, tier, setTier, bhk, area, agreed, setAgreedRate } = props;
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const lines = estimate.buildLineItems(catalog, qty, tier, agreed);
  const groups = estimate.groupByCategory(lines);
  const total = estimate.total(lines);
  const listTotal = lines.reduce((s, l) => s + Math.round(l.qty * (l.listRate ?? l.rate)), 0);
  const diff = listTotal - total;
  const shown = useCountUp(total);

  const commit = () => {
    if (!editing) return;
    const v = Number(editing.text.replace(/[^\d.]/g, ""));
    const line = lines.find((l) => l.itemId === editing.id);
    if (line && editing.text.trim() !== "" && Number.isFinite(v)) {
      const list = line.listRate ?? line.rate;
      setAgreedRate(editing.id, Math.round(v * 100) / 100 === list ? null : Math.round(v * 100) / 100);
    }
    setEditing(null);
  };

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
        {diff !== 0 && <s className={styles.totalWas}>{estimate.formatINR(listTotal)}</s>}
        <div className={styles.totalLine}>
          <span className={styles.totalValue}>{estimate.formatINR(shown)}</span>
          {diff !== 0 && (
            <span className={`${styles.saveBadge} ${diff < 0 ? styles.saveBadgeUp : ""}`}>
              {diff > 0 ? (
                <>
                  <small>Special price</small>You save {estimate.formatINR(diff)}
                </>
              ) : (
                <>
                  <small>Adjusted</small>+{estimate.formatINR(-diff)}
                </>
              )}
            </span>
          )}
        </div>
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
              <div className={`${styles.bdRowsWrap} ${isOpen ? styles.bdRowsOpen : ""}`}>
                <div className={styles.bdRows}>
                  {g.lines.map((l) => {
                    const changed = l.listRate != null;
                    const isEditing = editing?.id === l.itemId;
                    return (
                      <div key={l.itemId} className={`${styles.bdRow} ${l.parentItemId != null ? styles.bdChild : ""}`}>
                        <span className={styles.bdItem}>{l.parentItemId != null ? `+ ${l.name}` : l.name}</span>
                        <span className={styles.bdCalc}>
                          {l.unit !== "lumpsum" && l.rate !== 0 && (
                            <span>
                              {estimate.formatNumber(l.qty)} {estimate.UNIT_LABEL[l.unit]} ×{" "}
                            </span>
                          )}
                          {isEditing ? (
                            <span className={styles.rateEdit}>
                              ₹
                              <input
                                autoFocus
                                inputMode="decimal"
                                value={editing.text}
                                aria-label={`Rate for ${l.name}`}
                                onChange={(e) => setEditing({ id: l.itemId, text: e.target.value })}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") commit();
                                  if (e.key === "Escape") setEditing(null);
                                }}
                                onFocus={(e) => e.target.select()}
                              />
                              <button type="button" className={styles.rateBtn} onClick={commit} aria-label="Use this rate">
                                <Check size={15} />
                              </button>
                              <button type="button" className={styles.rateBtn} onClick={() => setEditing(null)} aria-label="Cancel">
                                <X size={15} />
                              </button>
                            </span>
                          ) : (
                            <>
                              {changed && <s className={styles.rateOld}>{estimate.formatINR(l.listRate!)}</s>}
                              <span className={changed ? styles.rateNew : undefined}>
                                {l.rate === 0 ? "Included" : estimate.formatINR(l.rate)}
                              </span>
                              <button
                                type="button"
                                className={styles.rateBtn}
                                onClick={() => setEditing({ id: l.itemId, text: String(l.rate) })}
                                aria-label={`Edit rate for ${l.name}`}
                              >
                                <Pencil size={14} />
                              </button>
                              {changed && (
                                <button
                                  type="button"
                                  className={styles.rateBtn}
                                  onClick={() => setAgreedRate(l.itemId, null)}
                                  aria-label={`Back to the standard rate for ${l.name}`}
                                  title="Back to the rate book rate"
                                >
                                  <RotateCcw size={13} />
                                </button>
                              )}
                            </>
                          )}
                        </span>
                        <span className={`${styles.bdAmt} ${changed ? styles.rateNew : ""}`}>
                          {l.amount === 0 ? "Included" : estimate.formatINR(l.amount)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
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
      <SplitTitle text="Let's make it yours" className={styles.title} />
      <p className={styles.lede}>A few details for your agreement.</p>
      <div className={styles.form}>
        <label className={styles.formField}>
          <span>Client name *</span>
          <Input {...field("clientName")} placeholder="Name" autoComplete="off" />
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
