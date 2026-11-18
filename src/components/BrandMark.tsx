import { brandAssets } from "../lib/brandAssets";
import styles from "./BrandMark.module.css";

type Props = { tone?: "dark" | "light"; size?: "sm" | "md" | "lg"; className?: string };

/** The Interior Editors archway + wordmark logo from the website. */
export function BrandMark({ tone = "dark", size = "md", className }: Props) {
  return (
    <img
      src={tone === "light" ? brandAssets.logoLight : brandAssets.logoDark}
      alt="Interior Editors"
      className={`${styles.logo} ${styles[size]} ${className ?? ""}`}
      draggable={false}
    />
  );
}
