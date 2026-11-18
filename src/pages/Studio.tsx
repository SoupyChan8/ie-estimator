import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, CloudUpload, Download, ExternalLink, FileText, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { Button, Input, Modal, Skeleton, Switch } from "../components/ui";
import { BrandMark } from "../components/BrandMark";
import { QuotationDocument } from "../components/QuotationDocument";
import { QuotationOptionsEditor } from "../components/QuotationOptionsEditor";
import { SaveRateBookVersion, TermsVersionBar, VersionsTab } from "../components/Versions";
import { withDefaults, type QuotationOptions } from "../lib/quotationOptions";
import { useSession } from "../lib/session";
import { api } from "../lib/api";
import { estimate, type CatalogItem, type ContractFull, type ContractSummary, type RateUnit } from "../lib/estimate";
import { blobToBase64, renderPdf, shareOrDownload } from "../lib/quotationPdf";
import { toast } from "../lib/toast";
import styles from "./Studio.module.css";

type Tab = "contracts" | "rates" | "versions" | "settings";

export default function Studio() {
  const { studioOpen, lockStudio } = useSession();
  const [tab, setTab] = useState<Tab>("contracts");
  const [openContract, setOpenContract] = useState<number | null>(null);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <BrandMark size="sm" />
          <div className={styles.headerRight}>
            <Link to="/" className="btn btn-ghost">
              <ArrowLeft size={16} /> Estimator
            </Link>
            {studioOpen && (
              <Button variant="ghost" onClick={lockStudio}>
                <Lock size={16} /> Lock studio
              </Button>
            )}
          </div>
        </header>

        {!studioOpen ? (
          <StudioGate />
        ) : openContract != null ? (
          <ContractView id={openContract} onBack={() => setOpenContract(null)} />
        ) : (
          <>
            <nav className={styles.tabs}>
              {(
                [
                  ["contracts", "Contracts"],
                  ["rates", "Rate book"],
                  ["versions", "Saved versions"],
                  ["settings", "Settings"],
                ] as [Tab, string][]
              ).map(([id, label]) => (
                <button key={id} className={`${styles.tab} ${tab === id ? styles.tabOn : ""}`} onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
            </nav>
            {tab === "contracts" && <ContractsTab onOpen={setOpenContract} />}
            {tab === "rates" && <RateBookTab />}
            {tab === "versions" && <VersionsTab />}
            {tab === "settings" && <SettingsTab />}
          </>
        )}
      </div>
    </main>
  );
}

function StudioGate() {
  const { unlockStudio, user } = useSession();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await unlockStudio(pw);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className={styles.gate} onSubmit={submit}>
      <Lock size={28} />
      <h1 className={styles.gateTitle}>Studio</h1>
      <p className={styles.muted}>
        Rate book, signed contracts and PDFs. Enter the password for <strong>{user?.email}</strong> to continue.
      </p>
      <Input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" autoComplete="current-password" />
      {err && <p className={styles.error}>{err}</p>}
      <Button type="submit" size="lg" disabled={!pw || busy}>
        {busy ? "Checking…" : "Open studio"}
      </Button>
      <p className={styles.small}>The studio locks itself after 30 minutes.</p>
    </form>
  );
}

/* ─────────── Contracts ─────────── */

function ContractsTab({ onOpen }: { onOpen: (id: number) => void }) {
  const [data, setData] = useState<ContractSummary[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<ContractSummary[]>("listContracts")
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!data)
    return (
      <div className={styles.list}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} style={{ height: 84 }} />
        ))}
      </div>
    );
  if (!data.length)
    return (
      <div className={styles.empty}>
        <FileText size={28} />
        <p>No signed agreements yet. They appear here as soon as a client signs in the estimator.</p>
      </div>
    );
  return (
    <div className={styles.list}>
      {data.map((c) => (
        <button key={c.id} className={styles.contractCard} onClick={() => onOpen(c.id)}>
          <div className={styles.ccMain}>
            <span className={styles.ccNo}>
              {c.quotationNo}
              {c.pdfUrl && <span className={styles.pdfTag}>PDF saved</span>}
            </span>
            <span className={styles.ccName}>{c.clientName}</span>
            <span className={styles.ccMeta}>
              {c.bhk} BHK · {estimate.formatNumber(c.carpetArea)} sq.ft · {estimate.TIERS[c.tier]?.label ?? c.tier}
              {c.siteAddress ? ` · ${c.siteAddress}` : ""}
            </span>
          </div>
          <div className={styles.ccRight}>
            <span className={styles.ccTotal}>{estimate.formatINR(c.total)}</span>
            <span className={styles.ccMeta}>{estimate.formatDate(c.createdAt)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function ContractView({ id, onBack }: { id: number; onBack: () => void }) {
  const [data, setData] = useState<ContractFull | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "download" | "drive" | "delete" | "save">("");
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [opts, setOpts] = useState<QuotationOptions | null>(null);
  const [savedOpts, setSavedOpts] = useState("");
  const dirty = opts != null && JSON.stringify(opts) !== savedOpts;
  const [driveUrl, setDriveUrl] = useState("");
  const exportRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.5);

  useEffect(() => {
    api<ContractFull>("getContract", { id })
      .then((c) => {
        setData(c);
        setDriveUrl(c.pdfUrl);
        const o = withDefaults(c.pdfOptions ?? c.defaultOptions);
        setOpts(o);
        setSavedOpts(JSON.stringify(o));
      })
      .catch((e) => setError((e as Error).message));
  }, [id]);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setZoom(Math.min(1, el.clientWidth / 794)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [data, view]);

  const filename = data ? `${data.quotationNo} - ${data.clientName}.pdf` : "Quotation.pdf";

  /** Saves the edited points / payments / timeline to the Sheet. Returns false if it failed. */
  const saveOptions = async (quiet = false): Promise<boolean> => {
    if (!data || !opts) return false;
    if (!dirty) return true;
    try {
      const res = await api<{ options: QuotationOptions }>("saveContractOptions", { id: data.id, options: opts });
      const o = withDefaults(res.options);
      setOpts(o);
      setSavedOpts(JSON.stringify(o));
      if (!quiet) toast.success("Quotation details saved");
      return true;
    } catch (e) {
      toast.error("Couldn't save the details", (e as Error).message);
      return false;
    }
  };

  const saveClick = async () => {
    setBusy("save");
    await saveOptions();
    setBusy("");
  };

  const download = async () => {
    if (!exportRef.current) return;
    setBusy("download");
    if (!(await saveOptions(true))) return setBusy("");
    try {
      await shareOrDownload(await renderPdf(exportRef.current), filename);
    } catch (e) {
      toast.error("Couldn't create the PDF", (e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const saveToDrive = async () => {
    if (!exportRef.current || !data) return;
    setBusy("drive");
    if (!(await saveOptions(true))) return setBusy("");
    try {
      const blob = await renderPdf(exportRef.current);
      const res = await api<{ url: string }>("savePdf", { contractId: data.id, filename, base64: await blobToBase64(blob) });
      setDriveUrl(res.url);
      toast.success("PDF saved to Google Drive");
    } catch (e) {
      toast.error("Couldn't save to Drive", (e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    if (!data || !window.confirm(`Delete ${data.quotationNo} for ${data.clientName}? This can't be undone.`)) return;
    setBusy("delete");
    try {
      await api("deleteContract", { id: data.id });
      toast.success("Contract deleted");
      onBack();
    } catch (e) {
      toast.error("Couldn't delete", (e as Error).message);
      setBusy("");
    }
  };

  return (
    <div className={styles.view}>
      <div className={styles.viewBar}>
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={16} /> All contracts
        </Button>
        <div className={styles.viewActions}>
          <Button variant="ghost" onClick={remove} disabled={!data || !!busy}>
            <Trash2 size={16} /> Delete
          </Button>
          {driveUrl && (
            <a className="btn btn-ghost" href={driveUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={16} /> Open in Drive
            </a>
          )}
          <Button variant="outline" onClick={saveToDrive} disabled={!data || !!busy}>
            <CloudUpload size={16} /> {busy === "drive" ? "Saving…" : driveUrl ? "Re-save to Drive" : "Save to Drive"}
          </Button>
          <Button onClick={download} disabled={!data || !!busy}>
            <Download size={16} /> {busy === "download" ? "Creating PDF…" : "Download PDF"}
          </Button>
        </div>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      {!data && !error && <Skeleton style={{ height: 600 }} />}
      {data && opts && (
        <>
          <div className={styles.viewHead}>
            <div>
              <div className={styles.ccNo}>{data.quotationNo}</div>
              <h2 className={styles.itemsTitle}>{data.clientName}</h2>
              <div className={styles.ccMeta}>
                {estimate.formatINR(data.total)} · {estimate.TIERS[data.tier]?.label ?? data.tier} · {data.bhk} BHK
              </div>
            </div>
            <nav className={styles.tabs}>
              <button className={`${styles.tab} ${view === "edit" ? styles.tabOn : ""}`} onClick={() => setView("edit")}>
                1 · Quotation details
              </button>
              <button className={`${styles.tab} ${view === "preview" ? styles.tabOn : ""}`} onClick={() => setView("preview")}>
                2 · PDF preview
              </button>
            </nav>
          </div>
          <label className={styles.signToggle}>
            <Switch
              checked={opts.showSignatures !== false}
              onChange={(v) => setOpts({ ...opts, showSignatures: v })}
              label="Previous digital signature"
            />
            <span>
              <strong>Previous digital signature</strong>
              <small>
                {opts.showSignatures !== false
                  ? "On: the signatures and date from the iPad appear on the PDF."
                  : "Off: blank signature lines, ready to sign on paper."}
              </small>
            </span>
          </label>
          {view === "edit" ? (
            <>
              <p className={styles.muted}>
                Edit what goes into this client's PDF. Changes are saved to the Google Sheet with this contract.
              </p>
              <TermsVersionBar value={opts} onApply={setOpts} />
              <QuotationOptionsEditor value={opts} onChange={setOpts} total={data.total} />
              <div className={styles.editBar}>
                <span className={styles.muted}>{dirty ? "Unsaved changes" : "All changes saved"}</span>
                <Button variant="outline" onClick={saveClick} disabled={!dirty || !!busy}>
                  {busy === "save" ? "Saving…" : "Save"}
                </Button>
                <Button
                  onClick={async () => {
                    if (await saveOptions(true)) setView("preview");
                  }}
                  disabled={!!busy}
                >
                  Continue to PDF <ArrowRight size={16} />
                </Button>
              </div>
            </>
          ) : (
            <div ref={previewRef} className={styles.preview}>
              <div style={{ zoom } as React.CSSProperties}>
                <QuotationDocument contract={data} options={opts} />
              </div>
            </div>
          )}
          <div className={styles.offscreen} aria-hidden>
            <QuotationDocument contract={data} options={opts} ref={exportRef} />
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────── Rate book ─────────── */

type ItemDraft = {
  id?: number;
  categoryId: number;
  parentId: number | null;
  name: string;
  description: string;
  unit: RateUnit;
  rateStandard: string;
  ratePremium: string;
  rateLuxury: string;
  qtyBhk1: string;
  qtyBhk2: string;
  qtyBhk3: string;
  qtyBhk4: string;
  scalesWithArea: boolean;
  active: boolean;
};

const toDraft = (i: CatalogItem): ItemDraft => ({
  id: i.id,
  categoryId: i.categoryId,
  parentId: i.parentId,
  name: i.name,
  description: i.description,
  unit: i.unit,
  rateStandard: String(i.rateStandard),
  ratePremium: i.ratePremium == null ? "" : String(i.ratePremium),
  rateLuxury: i.rateLuxury == null ? "" : String(i.rateLuxury),
  qtyBhk1: String(i.qtyBhk1),
  qtyBhk2: String(i.qtyBhk2),
  qtyBhk3: String(i.qtyBhk3),
  qtyBhk4: String(i.qtyBhk4),
  scalesWithArea: i.scalesWithArea,
  active: i.active,
});

const blankDraft = (categoryId: number, parentId: number | null = null): ItemDraft => ({
  categoryId,
  parentId,
  name: "",
  description: "",
  unit: "sqft",
  rateStandard: "",
  ratePremium: "",
  rateLuxury: "",
  qtyBhk1: "0",
  qtyBhk2: "0",
  qtyBhk3: "0",
  qtyBhk4: "0",
  scalesWithArea: false,
  active: true,
});

const num = (s: string) => Number(s.replace(/[^0-9.]/g, "")) || 0;

function RateBookTab() {
  const { catalog, reloadCatalog } = useSession();
  const [catId, setCatId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [catDialog, setCatDialog] = useState<{ id?: number; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const activeCat = useMemo(() => {
    if (!catalog) return null;
    return catalog.categories.find((c) => c.id === catId) ?? catalog.categories[0] ?? null;
  }, [catalog, catId]);

  const run = useCallback(
    async (fn: () => Promise<unknown>, ok: string, fail: string) => {
      setBusy(true);
      try {
        await fn();
        await reloadCatalog();
        toast.success(ok);
        return true;
      } catch (e) {
        toast.error(fail, (e as Error).message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reloadCatalog],
  );

  if (!catalog) return <Skeleton style={{ height: 400 }} />;
  const items = activeCat ? estimate.orderItems(catalog.items.filter((i) => i.categoryId === activeCat.id)) : [];

  const submitCat = async () => {
    if (!catDialog?.name.trim()) return;
    let newId = 0;
    const ok = await run(
      async () => {
        const res = await api<{ id: number }>("saveCategory", { id: catDialog.id, name: catDialog.name.trim() });
        newId = res.id;
      },
      catDialog.id ? "Category renamed" : "Category added",
      "Couldn't save category",
    );
    if (ok) {
      setCatId(newId);
      setCatDialog(null);
    }
  };

  const removeCat = async () => {
    if (!activeCat || !window.confirm(`Delete "${activeCat.name}" and all ${items.length} items in it?`)) return;
    if (await run(() => api("deleteCategory", { id: activeCat.id }), "Category deleted", "Couldn't delete")) setCatId(null);
  };

  return (
    <div className={styles.rates}>
      <aside className={styles.cats}>
        <div className={styles.catsHead}>Categories</div>
        {catalog.categories.map((c) => (
          <button key={c.id} className={`${styles.catBtn} ${activeCat?.id === c.id ? styles.catOn : ""}`} onClick={() => setCatId(c.id)}>
            <span>{c.name}</span>
            <small>{catalog.items.filter((i) => i.categoryId === c.id).length}</small>
          </button>
        ))}
        <Button variant="outline" onClick={() => setCatDialog({ name: "" })} className={styles.addCat}>
          <Plus size={16} /> Add category
        </Button>
        <SaveRateBookVersion />
      </aside>

      <section className={styles.itemsPane}>
        {activeCat ? (
          <>
            <div className={styles.itemsHead}>
              <h2 className={styles.itemsTitle}>{activeCat.name}</h2>
              <div className={styles.viewActions}>
                <Button variant="ghost" size="sm" onClick={() => setCatDialog({ id: activeCat.id, name: activeCat.name })}>
                  <Pencil size={14} /> Rename
                </Button>
                <Button variant="ghost" size="sm" onClick={removeCat} disabled={busy}>
                  <Trash2 size={14} /> Delete
                </Button>
                <Button onClick={() => setDraft(blankDraft(activeCat.id))}>
                  <Plus size={16} /> Add item
                </Button>
              </div>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th rowSpan={2}>Item</th>
                    <th rowSpan={2}>Unit</th>
                    <th colSpan={3} className={styles.groupTh}>
                      Rate (₹)
                    </th>
                    <th colSpan={4} className={styles.groupTh}>
                      Default qty by BHK
                    </th>
                  </tr>
                  <tr>
                    <th>Std</th>
                    <th>Prem</th>
                    <th>Lux</th>
                    <th>1</th>
                    <th>2</th>
                    <th>3</th>
                    <th>4</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr
                      key={i.id}
                      onClick={() => setDraft(toDraft(i))}
                      className={`${!i.active ? styles.inactive : ""} ${i.parentId != null ? styles.childRow : ""}`}
                    >
                      <td>
                        <div className={styles.itemName}>
                          {i.parentId != null && <span className={styles.addonMark}>Add-on</span>}
                          {i.name}
                          {i.parentId == null && (
                            <button
                              className={styles.addAddon}
                              onClick={(e) => {
                                e.stopPropagation();
                                setDraft(blankDraft(i.categoryId, i.id));
                              }}
                            >
                              <Plus size={12} /> Add-on
                            </button>
                          )}
                        </div>
                        <div className={styles.itemDesc}>
                          {i.scalesWithArea && <span className={styles.pill}>scales with area</span>}
                          {!i.active && <span className={styles.pill}>hidden</span>}
                          {i.description}
                        </div>
                      </td>
                      <td>{estimate.UNIT_LABEL[i.unit]}</td>
                      <td className={styles.num}>{i.rateStandard ? estimate.formatNumber(i.rateStandard) : "Incl."}</td>
                      <td className={styles.num}>{i.ratePremium == null ? "—" : estimate.formatNumber(i.ratePremium)}</td>
                      <td className={styles.num}>{i.rateLuxury == null ? "—" : estimate.formatNumber(i.rateLuxury)}</td>
                      <td className={styles.num}>{i.qtyBhk1}</td>
                      <td className={styles.num}>{i.qtyBhk2}</td>
                      <td className={styles.num}>{i.qtyBhk3}</td>
                      <td className={styles.num}>{i.qtyBhk4}</td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={9} className={styles.muted}>
                        No items yet — tap “Add item”.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className={styles.small}>
              Tap a row to edit. A blank Premium or Luxury rate uses the Standard rate. A rate of 0 shows as “Included”. A
              default qty of 0 hides the item for that BHK. You can also edit the rate book directly in the Google Sheet.
            </p>
          </>
        ) : (
          <p className={styles.muted}>Add a category to begin.</p>
        )}
      </section>

      {draft && (
        <ItemDialog
          draft={draft}
          setDraft={setDraft}
          categories={catalog.categories}
          items={catalog.items}
          busy={busy}
          onSave={async (payload) => {
            if (await run(() => api("saveItem", payload), draft.id ? "Item updated" : "Item added", "Couldn't save item")) setDraft(null);
          }}
          onDelete={async () => {
            if (!draft.id || !window.confirm(`Delete "${draft.name}"?`)) return;
            if (await run(() => api("deleteItem", { id: draft.id }), "Item deleted", "Couldn't delete")) setDraft(null);
          }}
          onClose={() => setDraft(null)}
        />
      )}

      <Modal
        open={!!catDialog}
        onClose={() => setCatDialog(null)}
        title={catDialog?.id ? "Rename category" : "New category"}
        description="Categories are the spaces clients pick on the Scope screen."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCatDialog(null)}>
              Cancel
            </Button>
            <Button onClick={submitCat} disabled={!catDialog?.name.trim() || busy}>
              Save
            </Button>
          </>
        }
      >
        <Input
          autoFocus
          value={catDialog?.name ?? ""}
          onChange={(e) => setCatDialog((c) => (c ? { ...c, name: e.target.value } : c))}
          placeholder="e.g. Kids Room"
        />
      </Modal>
    </div>
  );
}

function ItemDialog(props: {
  draft: ItemDraft;
  setDraft: React.Dispatch<React.SetStateAction<ItemDraft | null>>;
  categories: { id: number; name: string }[];
  items: CatalogItem[];
  busy: boolean;
  onSave: (payload: Record<string, unknown>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { draft, setDraft, categories, items, busy, onSave, onDelete, onClose } = props;
  const hasAddons = draft.id != null && items.some((i) => i.parentId === draft.id);
  const parentOptions = estimate.orderItems(
    items.filter((i) => i.categoryId === draft.categoryId && i.parentId == null && i.id !== draft.id),
  );
  const set = <K extends keyof ItemDraft>(k: K, v: ItemDraft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const numTxt = (k: keyof ItemDraft) => ({
    inputMode: "decimal" as const,
    value: draft[k] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value.replace(/[^0-9.]/g, "") as never),
  });

  const submit = () =>
    onSave({
      id: draft.id,
      categoryId: draft.categoryId,
      parentId: draft.parentId,
      name: draft.name.trim(),
      description: draft.description.trim(),
      unit: draft.unit,
      rateStandard: num(draft.rateStandard),
      ratePremium: draft.ratePremium.trim() === "" ? null : num(draft.ratePremium),
      rateLuxury: draft.rateLuxury.trim() === "" ? null : num(draft.rateLuxury),
      qtyBhk1: num(draft.qtyBhk1),
      qtyBhk2: num(draft.qtyBhk2),
      qtyBhk3: num(draft.qtyBhk3),
      qtyBhk4: num(draft.qtyBhk4),
      scalesWithArea: draft.scalesWithArea,
      active: draft.active,
    });

  return (
    <Modal
      open
      onClose={onClose}
      title={draft.id ? "Edit item" : draft.parentId != null ? "New add-on" : "New item"}
      className={styles.itemDialog}
      footer={
        <div className={styles.dialogFoot}>
          {draft.id ? (
            <Button variant="ghost" onClick={onDelete} disabled={busy}>
              <Trash2 size={16} /> Delete
            </Button>
          ) : (
            <span />
          )}
          <div className={styles.viewActions}>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!draft.name.trim() || busy}>
              {busy ? "Saving…" : "Save item"}
            </Button>
          </div>
        </div>
      }
    >
      <div className={styles.formGrid}>
        <label className={`${styles.field} ${styles.wide}`}>
          <span>Name</span>
          <Input value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Wardrobe" />
        </label>
        <label className={`${styles.field} ${styles.wide}`}>
          <span>Description</span>
          <Input value={draft.description} onChange={(e) => set("description", e.target.value)} placeholder="Shown to the client and on the PDF" />
        </label>
        <label className={styles.field}>
          <span>Category</span>
          <select
            className="input"
            value={draft.categoryId}
            onChange={(e) => setDraft((d) => (d ? { ...d, categoryId: Number(e.target.value), parentId: null } : d))}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Nested under</span>
          <select
            className="input"
            value={draft.parentId ?? ""}
            disabled={hasAddons}
            onChange={(e) => set("parentId", e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">— Main item —</option>
            {parentOptions.map((p) => (
              <option key={p.id} value={p.id}>
                Add-on of: {p.name}
              </option>
            ))}
          </select>
          {hasAddons && <small className={styles.fieldHint}>This item has its own add-ons, so it stays a main item.</small>}
        </label>
        <label className={styles.field}>
          <span>Unit</span>
          <select className="input" value={draft.unit} onChange={(e) => set("unit", e.target.value as RateUnit)}>
            <option value="sqft">Per sq. ft</option>
            <option value="rft">Per running ft</option>
            <option value="nos">Per piece (nos)</option>
            <option value="lumpsum">Lump sum</option>
          </select>
        </label>

        <div className={`${styles.subhead} ${styles.wide}`}>Rate per {estimate.UNIT_LABEL[draft.unit]} (₹)</div>
        <div className={`${styles.triple} ${styles.wide}`}>
          <label className={styles.field}>
            <span>Standard</span>
            <Input {...numTxt("rateStandard")} placeholder="0 = Included" />
          </label>
          <label className={styles.field}>
            <span>Premium</span>
            <Input {...numTxt("ratePremium")} placeholder="Same as Std" />
          </label>
          <label className={styles.field}>
            <span>Luxury</span>
            <Input {...numTxt("rateLuxury")} placeholder="Same as Std" />
          </label>
        </div>

        <div className={`${styles.subhead} ${styles.wide}`}>Default quantity by home size</div>
        <div className={`${styles.quad} ${styles.wide}`}>
          {(["qtyBhk1", "qtyBhk2", "qtyBhk3", "qtyBhk4"] as const).map((k, i) => (
            <label key={k} className={styles.field}>
              <span>{i + 1} BHK</span>
              <Input {...numTxt(k)} />
            </label>
          ))}
        </div>

        <div className={`${styles.switchRow} ${styles.wide}`}>
          <Switch checked={draft.scalesWithArea} onChange={(v) => set("scalesWithArea", v)} label="Scale with carpet area" />
          <span>
            Scale with carpet area
            <small>
              Defaults are for a typical home ({Object.values(estimate.REF_AREA).join(" / ")} sq.ft for 1–4 BHK) and grow or
              shrink with the actual area.
            </small>
          </span>
        </div>
        <div className={`${styles.switchRow} ${styles.wide}`}>
          <Switch checked={draft.active} onChange={(v) => set("active", v)} label="Show to clients" />
          <span>
            Show to clients
            <small>Turn off to hide the item without deleting it.</small>
          </span>
        </div>
      </div>
    </Modal>
  );
}

/* ─────────── Settings ─────────── */

function SettingsTab() {
  const { user, logout } = useSession();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("changePassword", { currentPassword: cur, newPassword: next });
      setCur("");
      setNext("");
      toast.success("Password changed");
    } catch (e2) {
      toast.error("Couldn't change password", (e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.settings}>
      <form className={styles.settingsBlock} onSubmit={submit}>
        <h2 className={styles.itemsTitle}>Change password</h2>
        <p className={styles.muted}>Signed in as {user?.email}.</p>
        <Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="Current password" autoComplete="current-password" />
        <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (6+ characters)" autoComplete="new-password" />
        <Button type="submit" disabled={!cur || next.length < 6 || busy}>
          Save new password
        </Button>
      </form>
      <div className={styles.settingsBlock}>
        <h2 className={styles.itemsTitle}>This iPad</h2>
        <p className={styles.muted}>Signing out removes access to prices and contracts on this device until you sign in again.</p>
        <Button variant="outline" onClick={() => logout()}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
