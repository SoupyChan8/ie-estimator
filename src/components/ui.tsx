import { forwardRef, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "gold" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
};

export function Button({ variant = "primary", size = "md", className = "", type = "button", ...rest }: BtnProps) {
  return <button type={type} className={`btn btn-${variant} ${size !== "md" ? `btn-${size}` : ""} ${className}`} {...rest} />;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className = "", ...rest },
  ref,
) {
  return <input ref={ref} className={`input ${className}`} {...rest} />;
});

export function Skeleton({ style, className = "" }: { style?: React.CSSProperties; className?: string }) {
  return <div className={`skeleton ${className}`} style={style} />;
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      onClick={() => onChange(!checked)}
    />
  );
}

export function Modal(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const { open, onClose, title, description, children, footer, className = "" } = props;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  // Portal to <body> so the dialog is never trapped under a parent's stacking layer.
  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2 className="modal-title">{title}</h2>
        {description && <p className="modal-desc">{description}</p>}
        {children}
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
