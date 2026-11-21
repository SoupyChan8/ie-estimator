import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BookCopy, Check, History, Pencil, Plus, Save, Star, Trash2 } from "lucide-react";
import { Button, Input, Modal, Skeleton } from "./ui";
import { QuotationOptionsEditor } from "./QuotationOptionsEditor";
import { api, onRateBookState } from "../lib/api";
import { estimate, type VersionInfo, type VersionKind } from "../lib/estimate";
import { DEFAULT_OPTIONS, withDefaults, type QuotationOptions } from "../lib/quotationOptions";
import { toast } from "../lib/toast";
import { useDeviceDraft } from "../lib/deviceDraft";
import { RestoreBar } from "./RestoreBar";
import styles from "./Versions.module.css";

type VersionFull = VersionInfo & { data: unknown };

function useVersions(kind: VersionKind) {
  const [list, setList] = useState<VersionInfo[] | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      setList(await api<VersionInfo[]>("listVersions", { kind }));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [kind]);
  useEffect(() => {
    void reload();
  }, [reload]);
  // Rate book changes send back the fresh version list, so there's nothing to re-fetch.
  useEffect(() => (kind === "ratebook" ? onRateBookState((s) => setList(s.versions)) : undefined), [kind]);
  return { list, error, reload };
}

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : `${estimate.formatDate(d)} · ${d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`;
};

/** A small "name this version" dialog. */
function NameDialog(props: { open: boolean; title: string; description?: string; initial?: string; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const { open, title, description, initial = "", onClose, onSave } = props;
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setName(initial);
  }, [open, initial]);
  const submit = async () => {
    setBusy(true);
    try {
      await onSave(name.trim());
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim() || busy}>
            {busy ? "Saving…" : "Save version"}
          </Button>
        </>
      }
    >
      <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nov 2026 rates" onKeyDown={(e) => e.key === "Enter" && name.trim() && submit()} />
    </Modal>
  );
}

/** Button that snapshots the live rate book as a named version. */
export function SaveRateBookVersion({ onSaved }: { onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  const month = new Date().toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Save size={14} /> Save version
      </Button>
      <NameDialog
        open={open}
        title="Save rate book version"
        description="Keeps a copy of every category, item, add-on and rate as they are right now. You can restore it later."
        initial={`${month} rates`}
        onClose={() => setOpen(false)}
        onSave={async (name) => {
          try {
            await api("saveVersion", { kind: "ratebook", name });
            toast.success("Rate book version saved", name);
            onSaved?.();
          } catch (e) {
            toast.error("Couldn't save the version", (e as Error).message);
            throw e;
          }
        }}
      />
    </>
  );
}

const isBackup = (v: VersionInfo) => /^(Backup before|Custom rates before)/.test(v.name);

/**
 * Top of the Rate book page. Shows the version the live rate book matches, or "Custom (unsaved)" once it
 * has been edited away from every saved version; the estimator always uses the live rates, saved or not.
 */
export function RateBookVersionBar() {
  const { list } = useVersions("ratebook");
  const [busy, setBusy] = useState("");
  const [saving, setSaving] = useState(false);
  const active = list?.find((v) => v.isActive) ?? null;
  const base = list?.find((v) => v.isBase) ?? null;
  const custom = list != null && !active;
  const current = active ? String(active.id) : "custom";
  const [pick, setPick] = useState("custom");

  useEffect(() => {
    setPick(current);
  }, [current]);

  const choices = (list ?? []).filter((v) => !isBackup(v) || v.isActive);
  const backups = (list ?? []).filter((v) => isBackup(v) && !v.isActive);
  const target = list?.find((v) => String(v.id) === pick) ?? null;

  const use = async () => {
    if (!target || target.isActive) return;
    const note = custom ? "\n\nYour custom rates aren't saved as a version, so they'll be kept as a backup first." : "";
    if (!window.confirm(`Use "${target.name}" as the rate book?${note}`)) return;
    setBusy("use");
    try {
      const res = await api<{ backupId: number | null }>("restoreRateBook", { id: target.id });
      toast.success(`Now using "${target.name}"`, res.backupId ? "Your custom rates were kept as a backup version." : undefined);
    } catch (e) {
      toast.error("Couldn't switch versions", (e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const update = async () => {
    if (!base) return;
    if (!window.confirm(`Overwrite "${base.name}" with the current custom rates?`)) return;
    setBusy("update");
    try {
      await api("saveVersion", { id: base.id, snapshot: true });
      toast.success(`"${base.name}" updated`);
    } catch (e) {
      toast.error("Couldn't update the version", (e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const month = new Date().toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  return (
    <div className={styles.rbBar}>
      <div className={styles.rbStatus}>
        <span className={styles.rbLabel}>Currently using</span>
        <span className={styles.rbName}>
          {list == null ? "…" : active ? active.name : "Custom (unsaved)"}
          {custom && <span className={styles.editedTag}>{base ? `Edited from ${base.name}` : "Not saved"}</span>}
        </span>
      </div>
      <select className={`input ${styles.select}`} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Rate book version">
        {custom && <option value="custom">Custom (unsaved)</option>}
        {choices.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
            {v.isActive ? " ✓" : ""}
          </option>
        ))}
        {backups.length > 0 && (
          <optgroup label="Backups">
            {backups.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.isActive ? " ✓" : ""}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {pick === current ? (
        <span className={styles.usingTag}>
          <Check size={14} /> Currently using
        </span>
      ) : (
        <Button variant="outline" size="sm" onClick={use} disabled={!target || !!busy}>
          <History size={14} /> {busy === "use" ? "Switching…" : "Use this version"}
        </Button>
      )}
      <span className={styles.sep} />
      {custom && base && (
        <Button size="sm" onClick={update} disabled={!!busy}>
          <Check size={14} /> {busy === "update" ? "Updating…" : `Update "${base.name}"`}
        </Button>
      )}
      <Button variant={custom ? "outline" : "ghost"} size="sm" onClick={() => setSaving(true)} disabled={!!busy}>
        <Save size={14} /> Save as new version
      </Button>
      <NameDialog
        open={saving}
        title="Save as new rate book version"
        description="Keeps a copy of every category, item, add-on and rate as they are right now."
        initial={`${month} rates`}
        onClose={() => setSaving(false)}
        onSave={async (name) => {
          try {
            await api("saveVersion", { kind: "ratebook", name });
            toast.success("Rate book version saved", name);
          } catch (e) {
            toast.error("Couldn't save the version", (e as Error).message);
            throw e;
          }
        }}
      />
    </div>
  );
}

/** In a contract's Quotation details: load a saved terms version, or save the current terms as one. */
type TermsPart = Pick<QuotationOptions, "included" | "notIncluded" | "payments" | "timeline">;

/** The terms content only, tidied the way the server stores it, for comparing with saved versions. */
function termsKey(o: Partial<QuotationOptions> | null | undefined): string {
  const t = (v: unknown) => String(v ?? "").trim();
  const list = (a: unknown) => (Array.isArray(a) ? a : []).map(t).filter(Boolean);
  return JSON.stringify({
    i: list(o?.included),
    n: list(o?.notIncluded),
    p: (o?.payments ?? []).map((x) => [Number(x.pct) || 0, t(x.title), t(x.sub)]).filter((x) => x[0] || x[1]),
    t: (o?.timeline ?? []).map((x) => [t(x.title), t(x.sub)]).filter((x) => x[0]),
  });
}
const termsOnly = (o: QuotationOptions): TermsPart => ({
  included: o.included, notIncluded: o.notIncluded, payments: o.payments, timeline: o.timeline,
});

const BUILTIN = "builtin";
const BUILTIN_NAME = "Original PDF terms";

/**
 * In a contract's Quotation details: which terms version these points match ("Currently using"), or
 * "Custom" once they've been edited; switch versions, update the one they came from, or save as new.
 */
export function TermsVersionBar({ value, onApply }: { value: QuotationOptions; onApply: (o: QuotationOptions) => void }) {
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [base, setBase] = useState<string | null>(null); // version the custom edits started from
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await api<VersionInfo[]>("listVersions", { kind: "terms", withData: true });
      // older backends don't send the content with the list
      const full = await Promise.all(
        list.map(async (v) => (v.data !== undefined ? v : { ...v, data: (await api<VersionFull>("getVersion", { id: v.id })).data })),
      );
      setVersions(full);
    } catch (e) {
      toast.error("Couldn't load the saved terms", (e as Error).message);
      setVersions([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const key = termsKey(value);
  const options = [
    ...(versions ?? []).map((v) => ({ id: String(v.id), name: v.name, isDefault: v.isDefault, key: termsKey(v.data as QuotationOptions) })),
    { id: BUILTIN, name: BUILTIN_NAME, isDefault: !(versions ?? []).some((v) => v.isDefault), key: termsKey(DEFAULT_OPTIONS) },
  ];
  // prefer the version they came from, then the one in use for new quotations, then the newest
  const matches = options.filter((o) => o.key === key);
  const match = matches.find((o) => o.id === base) ?? matches.find((o) => o.isDefault) ?? matches[0] ?? null;
  const current = match ? match.id : "custom";
  const baseOpt = options.find((o) => o.id === base) ?? null;

  useEffect(() => {
    if (match) setBase(match.id);
  }, [match?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setPick(current);
  }, [current]);

  const keep = { showSignatures: value.showSignatures, quotationNo: value.quotationNo, validity: value.validity };

  const use = () => {
    const target = options.find((o) => o.id === pick);
    if (!target) return;
    if (!match && !window.confirm(`Replace the custom points on this quotation with "${target.name}"?`)) return;
    const data =
      target.id === BUILTIN ? DEFAULT_OPTIONS : withDefaults(versions?.find((v) => String(v.id) === target.id)?.data as QuotationOptions);
    onApply({ ...withDefaults(data), ...keep });
    setBase(target.id);
    toast(`Now using "${target.name}"`, "Save to keep it for this contract.");
  };

  const update = async () => {
    if (!baseOpt || baseOpt.id === BUILTIN) return;
    if (!window.confirm(`Overwrite the saved version "${baseOpt.name}" with these points? Other contracts that already use it keep their own copy.`)) return;
    setBusy("update");
    try {
      await api("saveVersion", { id: Number(baseOpt.id), kind: "terms", name: baseOpt.name, data: termsOnly(value) });
      await load();
      toast.success(`"${baseOpt.name}" updated`);
    } catch (e) {
      toast.error("Couldn't update the version", (e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className={styles.rbBar}>
      <div className={styles.rbStatus}>
        <span className={styles.rbLabel}>Terms · currently using</span>
        <span className={styles.rbName}>
          {versions == null ? "…" : match ? match.name : "Custom"}
          {versions != null && !match && (
            <span className={styles.editedTag}>{baseOpt ? `Edited from ${baseOpt.name}` : "Not a saved version"}</span>
          )}
        </span>
      </div>
      <select className={`input ${styles.select}`} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Terms version">
        {!match && <option value="custom">Custom</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
            {o.id === current ? " ✓" : ""}
          </option>
        ))}
      </select>
      {pick === current ? (
        <span className={styles.usingTag}>
          <Check size={14} /> Currently using
        </span>
      ) : (
        <Button variant="outline" size="sm" onClick={use} disabled={!!busy}>
          <History size={14} /> Use this version
        </Button>
      )}
      <span className={styles.sep} />
      {!match && baseOpt && baseOpt.id !== BUILTIN && (
        <Button size="sm" onClick={update} disabled={!!busy}>
          <Check size={14} /> {busy === "update" ? "Updating…" : `Update "${baseOpt.name}"`}
        </Button>
      )}
      <Button variant={match ? "ghost" : "outline"} size="sm" onClick={() => setSaving(true)} disabled={!!busy}>
        <Save size={14} /> Save as new version
      </Button>
      <NameDialog
        open={saving}
        title="Save terms as a new version"
        description="Saves these included / not included points, payment schedule and timeline so you can reuse them for other clients."
        onClose={() => setSaving(false)}
        onSave={async (name) => {
          try {
            const res = await api<{ id: number }>("saveVersion", { kind: "terms", name, data: termsOnly(value) });
            await load();
            setBase(String(res.id));
            toast.success("Terms version saved", name);
          } catch (e) {
            toast.error("Couldn't save the version", (e as Error).message);
            throw e;
          }
        }}
      />
    </div>
  );
}

/** Studio tab: every saved rate book and terms version. */
export function VersionsTab() {
  return (
    <div className={styles.tab}>
      <RateBookVersions />
      <TermsVersions />
    </div>
  );
}

function RateBookVersions() {
  const { list, error } = useVersions("ratebook");
  const [busy, setBusy] = useState(0);

  const restore = async (v: VersionInfo) => {
    if (!window.confirm(`Use "${v.name}" as the rate book?\n\nIf the current rates aren't saved as a version, they are kept as a backup first.`)) return;
    setBusy(v.id);
    try {
      const res = await api<{ backupId: number | null }>("restoreRateBook", { id: v.id });
      toast.success(`Now using "${v.name}"`, res.backupId ? "Your custom rates were kept as a backup version." : undefined);
    } catch (e) {
      toast.error("Couldn't load that version", (e as Error).message);
    } finally {
      setBusy(0);
    }
  };

  return (
    <section className={styles.section}>
      <header className={styles.head}>
        <div>
          <h2>Rate book versions</h2>
          <p>Snapshots of every category, item, add-on and rate. Loading one makes it the rate book the estimator uses; signed contracts keep the prices they were signed at.</p>
        </div>
        <SaveRateBookVersion />
      </header>
      {list && !list.some((v) => v.isActive) && (
        <div className={`${styles.row} ${styles.rowDefault}`}>
          <div className={styles.rowMain}>
            <span className={styles.name}>
              Custom (unsaved) <span className={styles.defaultTag}>Currently using</span>
            </span>
            <span className={styles.meta}>
              The live rate book doesn't match any saved version. The estimator uses it as it is; save it if you want to
              keep it.
            </span>
          </div>
        </div>
      )}
      <VersionList
        list={list}
        error={error}
        empty="No rate book versions yet. Save one before changing your rates."
        busy={busy}
        actions={(v) => (
          <>
            {!v.isActive && (
              <Button variant="outline" size="sm" onClick={() => restore(v)} disabled={!!busy}>
                <History size={14} /> {busy === v.id ? "Switching…" : "Use this version"}
              </Button>
            )}
            <RenameDelete v={v} onChanged={() => undefined} />
          </>
        )}
      />
    </section>
  );
}

type TermsEdit = { id?: number; name: string; data: QuotationOptions };

function TermsVersions() {
  const { list, error, reload } = useVersions("terms");
  const [editing, setEditingState] = useState<TermsEdit | null>(null);
  const [editingOrig, setEditingOrig] = useState("");
  const setEditing = setEditingState;
  const startEditing = (e: TermsEdit) => {
    setEditingState(e);
    setEditingOrig(JSON.stringify(e));
  };
  const [busy, setBusy] = useState(false);
  // an unsaved terms edit is kept on this device until it's saved or cancelled
  const kept = useDeviceDraft<TermsEdit | null>("terms-version", editing, editing != null && JSON.stringify(editing) !== editingOrig, editing?.name ?? "");

  const open = async (v?: VersionInfo) => {
    if (!v) {
      startEditing({ name: "", data: DEFAULT_OPTIONS });
      return;
    }
    try {
      const full = await api<VersionFull>("getVersion", { id: v.id });
      startEditing({ id: v.id, name: full.name, data: withDefaults(full.data as QuotationOptions) });
    } catch (e) {
      toast.error("Couldn't open that version", (e as Error).message);
    }
  };

  const save = async () => {
    if (!editing?.name.trim()) return;
    setBusy(true);
    try {
      await api("saveVersion", { id: editing.id, kind: "terms", name: editing.name.trim(), data: editing.data });
      toast.success(editing.id ? "Terms version updated" : "Terms version saved");
      setEditing(null);
      await reload();
    } catch (e) {
      toast.error("Couldn't save", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const makeDefault = async (v: VersionInfo | null) => {
    try {
      await api("setDefaultTerms", { id: v ? v.id : null });
      await reload();
      toast.success(v ? `Now using "${v.name}"` : "Now using the original PDF terms", "New quotations start with these terms.");
    } catch (e) {
      toast.error("Couldn't change the default", (e as Error).message);
    }
  };

  const anyDefault = (list ?? []).some((v) => v.isDefault);

  return (
    <section className={styles.section}>
      <header className={styles.head}>
        <div>
          <h2>Terms versions</h2>
          <p>
            Sets of included / not included points, payment schedule and project timeline. The one in use is what every new
            quotation starts with; any contract can load a different one.
          </p>
        </div>
        <Button size="sm" onClick={() => open()}>
          <Plus size={14} /> New terms version
        </Button>
      </header>
      {kept.pending?.value && (
        <RestoreBar
          text={kept.pending.value.id ? `Changes to the terms version “${kept.pending.label}”` : `New terms version “${kept.pending.label || "untitled"}”`}
          at={kept.pending.at}
          onRestore={() => {
            const v = kept.restore();
            if (!v) return;
            const stillThere = v.id == null || (list ?? []).some((x) => x.id === v.id);
            setEditingState(stillThere ? v : { ...v, id: undefined });
            setEditingOrig("");
          }}
          onDiscard={kept.discard}
        />
      )}
      <div className={`${styles.row} ${!anyDefault ? styles.rowDefault : ""}`}>
        <div className={styles.rowMain}>
          <span className={styles.name}>
            Original PDF terms {!anyDefault && <span className={styles.defaultTag}>Currently using</span>}
          </span>
          <span className={styles.meta}>Built in · the points and schedule from your quotation PDF</span>
        </div>
        <div className={styles.actions}>
          {anyDefault && (
            <Button variant="ghost" size="sm" onClick={() => makeDefault(null)}>
              <Star size={14} /> Use this version
            </Button>
          )}
        </div>
      </div>
      <VersionList
        list={list}
        error={error}
        empty="No saved terms yet."
        busy={0}
        actions={(v) => (
          <>
            {!v.isDefault && (
              <Button variant="ghost" size="sm" onClick={() => makeDefault(v)}>
                <Star size={14} /> Use this version
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => open(v)}>
              <Pencil size={14} /> Edit
            </Button>
            <RenameDelete v={v} onChanged={reload} renameHidden />
          </>
        )}
      />

      {editing &&
        createPortal(
        <div className={styles.editorOverlay} role="dialog" aria-modal="true" aria-label="Edit terms version">
          <div className={styles.editor}>
            <div className={styles.editorHead}>
              <Input
                autoFocus={!editing.id}
                className={styles.nameInput}
                value={editing.name}
                placeholder="Version name, e.g. Standard terms 2026"
                onChange={(e) => setEditing((x) => (x ? { ...x, name: e.target.value } : x))}
              />
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button onClick={save} disabled={!editing.name.trim() || busy}>
                <Check size={16} /> {busy ? "Saving…" : "Save version"}
              </Button>
            </div>
            <QuotationOptionsEditor
              value={editing.data}
              onChange={(data) => setEditing((x) => (x ? { ...x, data } : x))}
            />
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}

function VersionList(props: {
  list: VersionInfo[] | null;
  error: string;
  empty: string;
  busy: number;
  actions: (v: VersionInfo) => React.ReactNode;
}) {
  const { list, error, empty, actions } = props;
  if (error) return <p className={styles.error}>{error}</p>;
  if (!list) return <Skeleton style={{ height: 120 }} />;
  if (!list.length) return <p className={styles.empty}>{empty}</p>;
  return (
    <div className={styles.list}>
      {list.map((v, i) => (
        <div key={v.id} className={`${styles.row} ${v.isDefault || v.isActive ? styles.rowDefault : ""}`} style={{ animationDelay: `${i * 0.04}s` }}>
          <div className={styles.rowMain}>
            <span className={styles.name}>
              {v.name} {(v.isDefault || v.isActive) && <span className={styles.defaultTag}>Currently using</span>}
              {v.isBase && <span className={styles.editedTag}>Custom edits started here</span>}
            </span>
            <span className={styles.meta}>
              {v.summary}
              <br />
              Saved {when(v.updatedAt || v.createdAt)}
              {v.createdBy ? ` by ${v.createdBy}` : ""}
            </span>
          </div>
          <div className={styles.actions}>{actions(v)}</div>
        </div>
      ))}
    </div>
  );
}

function RenameDelete({ v, onChanged, renameHidden }: { v: VersionInfo; onChanged: () => void; renameHidden?: boolean }) {
  const [renaming, setRenaming] = useState(false);
  const del = async () => {
    if (!window.confirm(`Delete the version "${v.name}"? This can't be undone.`)) return;
    try {
      await api("deleteVersion", { id: v.id });
      toast.success("Version deleted");
      onChanged();
    } catch (e) {
      toast.error("Couldn't delete", (e as Error).message);
    }
  };
  return (
    <>
      {!renameHidden && (
        <Button variant="ghost" size="sm" onClick={() => setRenaming(true)} aria-label="Rename">
          <Pencil size={14} />
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={del} aria-label="Delete version">
        <Trash2 size={14} />
      </Button>
      <NameDialog
        open={renaming}
        title="Rename version"
        initial={v.name}
        onClose={() => setRenaming(false)}
        onSave={async (name) => {
          try {
            await api("saveVersion", { id: v.id, name });
            onChanged();
          } catch (e) {
            toast.error("Couldn't rename", (e as Error).message);
            throw e;
          }
        }}
      />
    </>
  );
}

