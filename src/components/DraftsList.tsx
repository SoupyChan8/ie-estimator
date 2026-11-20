import { useCallback, useEffect, useState } from "react";
import { FileClock, Play, Trash2 } from "lucide-react";
import { Button, Skeleton } from "./ui";
import { api } from "../lib/api";
import { ago, type DraftInfo } from "../lib/drafts";
import { estimate, type Tier } from "../lib/estimate";
import { toast } from "../lib/toast";
import styles from "./DraftsList.module.css";

/** Saved estimate drafts, newest first, with Continue and Delete. Used on the welcome screen and in the Studio. */
export function DraftsList({ onContinue, compact }: { onContinue: (d: DraftInfo) => void; compact?: boolean }) {
  const [list, setList] = useState<DraftInfo[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(0);

  const load = useCallback(async () => {
    try {
      setList(await api<DraftInfo[]>("listDrafts"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (d: DraftInfo) => {
    if (!window.confirm(`Delete the draft "${d.label}"? This can't be undone.`)) return;
    setBusy(d.id);
    try {
      await api("deleteDraft", { id: d.id });
      setList((l) => (l ? l.filter((x) => x.id !== d.id) : l));
      toast.success("Draft deleted");
    } catch (e) {
      toast.error("Couldn't delete", (e as Error).message);
    } finally {
      setBusy(0);
    }
  };

  if (error) return <p className={styles.empty}>{error}</p>;
  if (!list) return <Skeleton style={{ height: 120 }} />;
  if (!list.length)
    return (
      <p className={styles.empty}>
        No saved drafts. While making an estimate, tap <b>Save draft</b> at the top to keep it for later.
      </p>
    );
  return (
    <div className={`${styles.list} ${compact ? styles.compact : ""}`}>
      {list.map((d) => (
        <div key={d.id} className={styles.row}>
          <FileClock size={20} className={styles.icon} />
          <div className={styles.main}>
            <span className={styles.label}>{d.label}</span>
            <span className={styles.meta}>
              {[
                d.clientName && d.clientName !== d.label ? d.clientName : "",
                d.bhk ? `${d.bhk} BHK` : "",
                d.carpetArea ? `${estimate.formatNumber(d.carpetArea)} sq.ft` : "",
                estimate.TIERS[d.tier as Tier]?.label ?? "",
              ]
                .filter(Boolean)
                .join(" · ")}
              <br />
              Saved {ago(d.updatedAt)}
              {d.createdBy ? ` by ${d.createdBy}` : ""}
            </span>
          </div>
          <span className={styles.total}>{d.total ? estimate.formatINR(d.total) : ""}</span>
          <div className={styles.actions}>
            <Button size="sm" onClick={() => onContinue(d)} disabled={!!busy}>
              <Play size={14} /> Continue
            </Button>
            <button className={styles.del} onClick={() => remove(d)} disabled={!!busy} aria-label={`Delete draft ${d.label}`} title="Delete draft">
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
