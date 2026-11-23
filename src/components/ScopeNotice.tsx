import Link from "next/link";
import type { ScopeRow } from "@/lib/queries";
import { fmtInt } from "@/lib/format";

/** Regra de escopo exibida no topo das análises. */
export function ScopeNotice({ scope }: { scope: ScopeRow[] }) {
  const inScope = scope.filter((s) => s.in_scope);
  const out = scope.filter((s) => !s.in_scope);
  return (
    <div className="callout callout-info" style={{ marginBottom: 14 }}>
      <strong>Escopo de análise:</strong> {inScope.length} funis usados pelos painéis ({inScope.map((s) => s.pipeline_name).join(", ")}).
      {out.length > 0 && (
        <> Fora do escopo: {out.map((s) => `${s.pipeline_name} (${fmtInt(s.deals)} negócios)`).join(", ")}.</>
      )}{" "}
      <Link href="/docs#escopo">Ver regra</Link>
    </div>
  );
}

export function ScopeTable({ scope }: { scope: ScopeRow[] }) {
  return (
    <table className="t t-compact">
      <thead>
        <tr><th>Funil</th><th>Situação</th><th className="num">Negócios</th><th>Motivo</th></tr>
      </thead>
      <tbody>
        {scope.map((s) => (
          <tr key={s.pipeline_id}>
            <td>{s.pipeline_name}</td>
            <td>{s.in_scope ? <span className="badge badge-ok">{s.scope_use === "somente_historico" ? "em escopo (histórico)" : "em escopo"}</span> : <span className="badge badge-muted">fora do escopo</span>}</td>
            <td className="num">{fmtInt(s.deals)}</td>
            <td className="small muted">{s.in_scope ? "Alimenta os painéis da empresa (gold.pipelines_escopo)." : s.exclusion_reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
