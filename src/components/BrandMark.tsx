import styles from "./BrandMark.module.css";

type Props = { tone?: "dark" | "light"; size?: "sm" | "md" | "lg"; className?: string };

export function BrandMark({ tone = "dark", size = "md", className }: Props) {
  return (
    <div className={`${styles.mark} ${styles[tone]} ${styles[size]} ${className ?? ""}`}>
      <span className={styles.monogram}>IE</span>
      <span className={styles.words}>
        <span className={styles.name}>INTERIOR EDITORS</span>
        <span className={styles.tag}>SPACES FOR A BETTER YOU</span>
      </span>
    </div>
  );
}
