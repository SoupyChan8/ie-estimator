import { useRef, useState } from "react";
import { GripVertical, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "./ui";
import { estimate } from "../lib/estimate";
import { DEFAULT_OPTIONS, type QuotationOptions } from "../lib/quotationOptions";
import styles from "./QuotationOptionsEditor.module.css";

type Props = { value: QuotationOptions; onChange: (v: QuotationOptions) => void; /** Contract total; omit to hide the rupee amounts. */ total?: number };

/** Studio editor for the PDF's included / not-included points, payment schedule and project timeline. */
export function QuotationOptionsEditor({ value, onChange, total }: Props) {
  const set = <K extends keyof QuotationOptions>(k: K, v: QuotationOptions[K]) => onChange({ ...value, [k]: v });
  const pctTotal = value.payments.reduce((s, p) => s + (Number(p.pct) || 0), 0);

  return (
    <div className={styles.wrap}>
      <PointList
        title="What's included"
        items={value.included}
        onChange={(v) => set("included", v)}
        onReset={() => set("included", DEFAULT_OPTIONS.included)}
        placeholder="e.g. BWP ply with laminate finish"
      />
      <PointList
        title="What's not included"
        items={value.notIncluded}
        onChange={(v) => set("notIncluded", v)}
        onReset={() => set("notIncluded", DEFAULT_OPTIONS.notIncluded)}
        placeholder="e.g. Appliances"
      />

      <section className={styles.block}>
        <header className={styles.head}>
          <h3>Payment schedule</h3>
          <span className={`${styles.badge} ${pctTotal === 100 ? styles.ok : styles.warn}`}>
            {pctTotal}% {pctTotal === 100 ? "✓" : "· should add up to 100%"}
          </span>
          <Button variant="ghost" size="sm" onClick={() => set("payments", DEFAULT_OPTIONS.payments)}>
            <RotateCcw size={14} /> Defaults
          </Button>
        </header>
        <div className={styles.rows}>
          {value.payments.map((p, i) => (
            <div key={i} className={styles.payRow}>
              <label className={styles.pct}>
                <input
                  className="input"
                  inputMode="decimal"
                  value={p.pct}
                  onChange={(e) => {
                    const next = [...value.payments];
                    next[i] = { ...p, pct: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 };
                    set("payments", next);
                  }}
                  aria-label="Percent"
                />
                <span>%</span>
              </label>
              <input
                className="input"
                value={p.title}
                placeholder="Stage, e.g. Design Approval"
                onChange={(e) => {
                  const next = [...value.payments];
                  next[i] = { ...p, title: e.target.value };
                  set("payments", next);
                }}
              />
              <input
                className="input"
                value={p.sub}
                placeholder="When, e.g. After final 3D design"
                onChange={(e) => {
                  const next = [...value.payments];
                  next[i] = { ...p, sub: e.target.value };
                  set("payments", next);
                }}
              />
              <span className={styles.amt}>{total != null ? estimate.formatINR((total * (Number(p.pct) || 0)) / 100) : ""}</span>
              <button className={styles.del} onClick={() => set("payments", value.payments.filter((_, k) => k !== i))} aria-label="Delete stage">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => set("payments", [...value.payments, { pct: 0, title: "", sub: "" }])} disabled={value.payments.length >= 10}>
          <Plus size={14} /> Add stage
        </Button>
      </section>

      <section className={styles.block}>
        <header className={styles.head}>
          <h3>Project timeline</h3>
          <Button variant="ghost" size="sm" onClick={() => set("timeline", DEFAULT_OPTIONS.timeline)}>
            <RotateCcw size={14} /> Defaults
          </Button>
        </header>
        <div className={styles.rows}>
          {value.timeline.map((t, i) => (
            <div key={i} className={styles.timeRow}>
              <span className={styles.num}>{i + 1}</span>
              <input
                className="input"
                value={t.title}
                placeholder="Phase, e.g. Production"
                onChange={(e) => {
                  const next = [...value.timeline];
                  next[i] = { ...t, title: e.target.value };
                  set("timeline", next);
                }}
              />
              <input
                className="input"
                value={t.sub}
                placeholder="Duration, e.g. 3–4 weeks"
                onChange={(e) => {
                  const next = [...value.timeline];
                  next[i] = { ...t, sub: e.target.value };
                  set("timeline", next);
                }}
              />
              <button className={styles.del} onClick={() => set("timeline", value.timeline.filter((_, k) => k !== i))} aria-label="Delete phase">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => set("timeline", [...value.timeline, { title: "", sub: "" }])} disabled={value.timeline.length >= 8}>
          <Plus size={14} /> Add phase
        </Button>
      </section>
    </div>
  );
}

function PointList(props: { title: string; items: string[]; onChange: (v: string[]) => void; onReset: () => void; placeholder: string }) {
  const { title, items, onChange, onReset, placeholder } = props;
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  // index: the row being dragged (it moves through the list live); offset: how far it is from its slot
  const [drag, setDragState] = useState<{ index: number; startY: number; offset: number } | null>(null);
  // the latest drag position, read by pointer events that arrive faster than React re-renders
  const dragRef = useRef<typeof drag>(null);
  const setDrag = (d: typeof drag) => {
    dragRef.current = d;
    setDragState(d);
  };
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const move = (from: number, to: number) => {
    const list = itemsRef.current;
    if (to < 0 || to >= list.length || from === to) return;
    const next = [...list];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    itemsRef.current = next;
    onChange(next);
  };

  // distance between two neighbouring rows (offsetTop ignores the dragged row's own transform)
  const step = (i: number) => {
    const a = rowRefs.current[i];
    const b = rowRefs.current[i + 1];
    return a && b ? b.offsetTop - a.offsetTop : 52;
  };

  const onPointerDown = (i: number) => (e: React.PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ index: i, startY: e.clientY, offset: 0 });
    document.documentElement.classList.add("is-grabbing");
  };
  const onPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    const cur = dragRef.current;
    if (!cur) return;
    let { index, startY } = cur;
    let offset = e.clientY - startY;
    // passed half of the neighbour: swap with it and carry on from the new slot
    while (offset > 0 && index < itemsRef.current.length - 1 && offset > step(index) / 2) {
      const h = step(index);
      move(index, index + 1);
      index += 1;
      startY += h;
      offset -= h;
    }
    while (offset < 0 && index > 0 && -offset > step(index - 1) / 2) {
      const h = step(index - 1);
      move(index, index - 1);
      index -= 1;
      startY -= h;
      offset += h;
    }
    setDrag({ index, startY, offset });
  };
  const endDrag = () => {
    setDrag(null);
    document.documentElement.classList.remove("is-grabbing");
  };
  const onKeyDown = (i: number) => (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const to = e.key === "ArrowUp" ? i - 1 : i + 1;
      move(i, to);
      requestAnimationFrame(() => (rowRefs.current[to]?.querySelector("[data-handle]") as HTMLElement | null)?.focus());
    }
  };

  return (
    <section className={styles.block}>
      <header className={styles.head}>
        <h3>{title}</h3>
        <span className={styles.count}>{items.length} points</span>
        <Button variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw size={14} /> Defaults
        </Button>
      </header>
      <div className={styles.rows}>
        {items.map((t, i) => {
          const dragging = drag?.index === i;
          return (
            <div
              key={i}
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              className={`${styles.pointRow} ${dragging ? styles.dragging : ""}`}
              style={dragging ? { transform: `translateY(${drag.offset}px)` } : undefined}
            >
              <span
                data-handle
                className={styles.handle}
                role="button"
                tabIndex={0}
                aria-label={`Drag to reorder "${t || "point"}" (or use the arrow keys)`}
                title="Drag to move"
                onPointerDown={onPointerDown(i)}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onKeyDown={onKeyDown(i)}
              >
                <GripVertical size={16} />
              </span>
              <input
                className="input"
                value={t}
                placeholder={placeholder}
                onChange={(e) => onChange(items.map((x, k) => (k === i ? e.target.value : x)))}
              />
              <button className={styles.del} onClick={() => onChange(items.filter((_, k) => k !== i))} aria-label="Delete point">
                <Trash2 size={16} />
              </button>
            </div>
          );
        })}
      </div>
      <Button variant="outline" size="sm" onClick={() => onChange([...items, ""])} disabled={items.length >= 20}>
        <Plus size={14} /> Add point
      </Button>
    </section>
  );
}
