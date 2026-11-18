import { brandAssets } from "../lib/brandAssets";
import styles from "./BrandMark.module.css";

type Props = { tone?: "dark" | "light"; size?: "sm" | "md" | "lg"; stacked?: boolean; className?: string };

/** The Interior Editors archway logo, drawn at its true proportions (never stretched). */
export function BrandMark({ tone = "dark", size = "md", stacked = false, className }: Props) {
  const src = stacked
    ? tone === "light" ? brandAssets.logoStackLight : brandAssets.logoStackDark
    : tone === "light" ? brandAssets.logoLight : brandAssets.logoDark;
  return (
    <img
      src={src}
      alt="Interior Editors"
      className={`${styles.logo} ${stacked ? styles.stacked : ""} ${styles[size]} ${className ?? ""}`}
      draggable={false}
    />
  );
}
