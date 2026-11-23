"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export type FilterDef =
  | { key: string; label: string; type: "select"; options: { value: string; label: string }[]; allLabel?: string; defaultValue?: string }
  | { key: string; label: string; type: "search"; placeholder?: string };

/** Filtros persistidos na URL (compartilháveis e consistentes entre módulos). */
export function FilterBar({ filters }: { filters: FilterDef[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    start(() => router.push(`${pathname}?${next.toString()}`));
  }

  return (
    <div className={`filterbar no-print ${pending ? "is-pending" : ""}`}>
      {filters.map((f) =>
        f.type === "select" ? (
          <label key={f.key} className="filter">
            <span>{f.label}</span>
            <select value={params.get(f.key) ?? f.defaultValue ?? ""} onChange={(e) => set(f.key, e.target.value)}>
              {f.allLabel !== undefined && <option value="">{f.allLabel}</option>}
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <form
            key={f.key}
            className="filter"
            onSubmit={(e) => {
              e.preventDefault();
              const v = new FormData(e.currentTarget).get(f.key)?.toString() ?? "";
              set(f.key, v);
            }}
          >
            <span>{f.label}</span>
            <input name={f.key} defaultValue={params.get(f.key) ?? ""} placeholder={f.placeholder} />
          </form>
        ),
      )}
    </div>
  );
}
