import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BookCopy, Check, History, Pencil, Plus, Save, Star, Trash2 } from "lucide-react";
import { Button, Input, Modal, Skeleton } from "./ui";
import { QuotationOptionsEditor } from "./QuotationOptionsEditor";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { estimate, type VersionInfo, type VersionKind } from "../lib/estimate";
import { DEFAULT_OPTIONS, withDefaults, type QuotationOptions } from "../lib/quotationOptions";
import { toast } from "../lib/toast";
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
  const { catalog, reloadCatalog } = useSession();
  const { list, reload } = useVersions("ratebook");
  const [busy, setBusy] = useState("");
  const [saving, setSaving] = useState(false);
  const active = list?.find((v) => v.isActive) ?? null;
  const base = list?.find((v) => v.isBase) ?? null;
  const custom = list != null && !active;
  const current = active ? String(active.id) : "custom";
  const [pick, setPick] = useState("custom");

  // Re-check the match whenever the rate book changes.
  useEffect(() => {
    if (catalog) void reload();
  }, [catalog, reload]);
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
      await reloadCatalog();
      await reload();
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
      await reload();
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
        {custom && <option value="custom">Custom (unsaved) · currently using</option>}
        {choices.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
            {v.isActive ? " · currently using" : ""}
          </option>
        ))}
        {backups.length > 0 && (
          <optgroup label="Backups">
            {backups.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.isActive ? " · currently using" : ""}
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
            await reload();
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
export function TermsVersionBar({ value, onApply }: { value: QuotationOptions; onApply: (o: QuotationOptions) => void }) {
  const { list, reload } = useVersions("terms");
  const [pick, setPick] = useState("");
  const [saving, setSaving] = useState(false);
  const apply = async () => {
    if (pick === "__builtin") {
      onApply({ ...DEFAULT_OPTIONS, showSignatures: value.showSignatures });
      toast("Loaded the original PDF terms", "Save to keep them for this contract.");
      return;
    }
    try {
      const v = await api<VersionFull>("getVersion", { id: Number(pick) });
      onApply({ ...withDefaults(v.data as QuotationOptions), showSignatures: value.showSignatures });
      toast(`Loaded "${v.name}"`, "Save to keep it for this contract.");
    } catch (e) {
      toast.error("Couldn't load that version", (e as Error).message);
    }
  };
  return (
    <div className={styles.bar}>
      <BookCopy size={16} />
      <select className={`input ${styles.select}`} value={pick} onChange={(e) => setPick(e.target.value)}>
        <option value="">Load saved terms…</option>
        {(list ?? []).map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
            {v.isDefault ? " (currently using)" : ""}
          </option>
        ))}
        <option value="__builtin">Original PDF terms</option>
      </select>
      <Button variant="outline" size="sm" onClick={apply} disabled={!pick}>
        Load
      </Button>
      <span className={styles.sep} />
      <Button variant="ghost" size="sm" onClick={() => setSaving(true)}>
        <Save size={14} /> Save as version
      </Button>
      <NameDialog
        open={saving}
        title="Save terms as a version"
        description="Saves these included / not included points, payment schedule and timeline so you can reuse them for other clients."
        onClose={() => setSaving(false)}
        onSave={async (name) => {
          try {
            await api("saveVersion", { kind: "terms", name, data: value });
            toast.success("Terms version saved", name);
            await reload();
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
  const { reloadCatalog } = useSession();
  const { list, error, reload } = useVersions("ratebook");
  const [busy, setBusy] = useState(0);

  const restore = async (v: VersionInfo) => {
    if (!window.confirm(`Use "${v.name}" as the rate book?\n\nIf the current rates aren't saved as a version, they are kept as a backup first.`)) return;
    setBusy(v.id);
    try {
      const res = await api<{ backupId: number | null }>("restoreRateBook", { id: v.id });
      await Promise.all([reloadCatalog(), reload()]);
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
        <SaveRateBookVersion onSaved={reload} />
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
            <RenameDelete v={v} onChanged={reload} />
          </>
        )}
      />
    </section>
  );
}

function TermsVersions() {
  const { list, error, reload } = useVersions("terms");
  const [editing, setEditing] = useState<{ id?: number; name: string; data: QuotationOptions } | null>(null);
  const [busy, setBusy] = useState(false);

  const open = async (v?: VersionInfo) => {
    if (!v) {
      setEditing({ name: "", data: DEFAULT_OPTIONS });
      return;
    }
    try {
      const full = await api<VersionFull>("getVersion", { id: v.id });
      setEditing({ id: v.id, name: full.name, data: withDefaults(full.data as QuotationOptions) });
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

