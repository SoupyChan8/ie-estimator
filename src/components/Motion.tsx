import { Fragment, useEffect, useRef, useState, type ElementType, type ReactNode } from "react";
import arch from "../lib/archPaths.json";
import styles from "./Motion.module.css";

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Website preloader: the archway logo draws itself line by line on plaster,
 * then the curtain wipes upward (clip-path inset, cubic-bezier(.7,0,.2,1)).
 */
export function Preloader({ ready }: { ready: boolean }) {
  const [minDone, setMinDone] = useState(reduced());
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMinDone(true), 1500);
    return () => clearTimeout(t);
  }, []);
  const done = ready && minDone;
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setGone(true), 1200);
    return () => clearTimeout(t);
  }, [done]);
  if (gone) return null;
  const paths = (arch as { w: number; h: number; paths: number[][][] }).paths;
  return (
    <div className={`${styles.loader} ${done ? styles.loaderDone : ""}`} aria-hidden>
      <div className={styles.loaderIn}>
        <svg viewBox={`0 0 ${arch.w} ${arch.h}`} className={styles.arch}>
          {paths.map((pts, i) => (
            <path
              key={i}
              d={pts.map(([x, y], k) => `${k ? "L" : "M"}${x},${y}`).join(" ")}
              pathLength={1}
              style={{ animationDelay: `${(i / paths.length) * 0.9}s` }}
            />
          ))}
        </svg>
        <div className={styles.loaderName}>Interior Editors</div>
        <div className={styles.loaderTag}>DESIGN · TRANSFORM · INSPIRE</div>
      </div>
    </div>
  );
}

/** Headline whose words rise into place one after another (website hero / page-hero intro). */
export function SplitTitle({ text, as: Tag = "h1", className, delay = 0 }: { text: string; as?: ElementType; className?: string; delay?: number }) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <Tag className={className} aria-label={text}>
      {words.map((w, i) => (
        <Fragment key={i}>
          <span className={styles.w} aria-hidden>
            <span className={styles.wi} style={{ animationDelay: `${delay + i * 0.07}s` }}>
              {w}
            </span>
          </span>
          {i < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </Tag>
  );
}

/** Fades and lifts its children in, like the website's step and section reveals. */
export function Rise({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <div className={`${styles.rise} ${className ?? ""}`} style={{ animationDelay: `${delay}s` }}>
      {children}
    </div>
  );
}

/** Smoothly counts a number to its new value (expo-out). */
export function useCountUp(value: number, ms = 900) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced()) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const e = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setShown(a + (value - a) * e);
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value, ms]);
  return shown;
}
