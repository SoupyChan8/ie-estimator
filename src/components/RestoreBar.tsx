import { History, X } from "lucide-react";
import { Button } from "./ui";
import { ago } from "../lib/drafts";
import styles from "./RestoreBar.module.css";

/** "You have unsaved changes from earlier" — Restore or Discard. */
export function RestoreBar({ text, at, onRestore, onDiscard }: { text: string; at: number; onRestore: () => void; onDiscard: () => void }) {
  return (
    <div className={styles.bar} role="status">
      <History size={18} className={styles.icon} />
      <span className={styles.text}>
        {text} <span className={styles.when}>· not saved · {ago(at)} · kept on this device</span>
      </span>
      <div className={styles.actions}>
        <Button size="sm" onClick={onRestore}>
          Restore
        </Button>
        <Button size="sm" variant="ghost" onClick={onDiscard}>
          <X size={14} /> Discard
        </Button>
      </div>
    </div>
  );
}
