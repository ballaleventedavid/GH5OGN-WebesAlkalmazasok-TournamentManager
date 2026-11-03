import { Search } from "lucide-react";
import type { ReactNode } from "react";
import type { Match } from "../../shared/types";
export function Crest({
  name,
  color,
  small = false,
}: {
  name: string;
  color: string;
  small?: boolean;
}) {
  return (
    <span
      className={`crest ${small ? "small" : ""}`}
      style={{ background: color }}
    >
      {name}
    </span>
  );
}
export function Status({ status }: { status: Match["status"] }) {
  return (
    <span className={`badge ${status}`}>
      <i />
      {status === "final"
        ? "Lezárt"
        : status === "draft"
          ? "Jóváhagyásra vár"
          : "Ütemezett"}
    </span>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
export function Button({
  children,
  onClick,
  primary = false,
  disabled = false,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`btn ${primary ? "primary" : ""} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function SearchBox({
  value,
  set,
  placeholder,
}: {
  value: string;
  set: (s: string) => void;
  placeholder: string;
}) {
  return (
    <div className="search">
      <Search size={17} />
      <input
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </div>
  );
}
