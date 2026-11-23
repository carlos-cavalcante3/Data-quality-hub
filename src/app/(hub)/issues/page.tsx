import Link from "next/link";
import { FilterBar } from "@/components/FilterBar";
import { Badge, Card, Delta, EmptyState, Kpi, PageHeader } from "@/components/ui";
import { hasRole, requireUser } from "@/lib/auth";
import { ISSUE_STATUS, ISSUE_STATUS_LABEL, fmtDate, fmtInt, fmtPct } from "@/lib/format";
import { getDepartments, getIssues, getRules } from "@/lib/queries";
import { createIssueAction } from "../actions";

export const metadata = { title: "Issues & Corrections" };

export default async function IssuesPage({ searchParams }: { searchParams: Promise<{ status?: string; departamento?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const [issues, depts, rules, allIssues] = await Promise.all([
    getIssues(sp.status ?? null, sp.departamento ? Number(sp.departamento) : null),
    getDepartments(),
    getRules(),
    getIssues(null, null),
  ]);
  const open = allIssues.filter((i) => !["resolvido", "nao_aplicavel"].includes(i.status));
  const resolved = allIssues.filter((i) => i.status === "resolvido" && i.resolved_at);
  const avgDays = resolved.length
    ? resolved.reduce((a, i) => a + (new Date(i.resolved_at!).getTime() - new Date(i.detected_at).getTime()) / 864e5, 0) / resolved.length
    : null;
  const improved = allIssues.filter((i) => i.current_score != null && i.baseline_score != null && i.current_score - i.baseline_score > 0.5).length;

  return (
    <>
      <PageHeader
        eyebrow="Gestão de correções"
        title="Issues & Corrections"
        description="Registro dos problemas comunicados aos departamentos e acompanhamento das correções, comparando a linha de base com a avaliação mais recente."
      />
      <div className="grid g-4">
        <Kpi tone="brand" label="Issues abertas" value={fmtInt(open.length)} hint={`${allIssues.length} no total`} />
        <Kpi label="Comunicadas aguardando correção" value={fmtInt(allIssues.filter((i) => ["comunicado", "em_correcao", "parcialmente_corrigido"].includes(i.status)).length)} />
        <Kpi label="Com melhoria desde a linha de base" value={fmtInt(improved)} hint="score atual > score no registro" />
        <Kpi label="Tempo médio de resolução" value={avgDays != null ? `${avgDays.toFixed(1)} dias` : "—"} hint={`${resolved.length} resolvidas`} />
      </div>

      <div className="mt">
        <FilterBar
          filters={[
            { key: "status", label: "Status", type: "select", allLabel: "Todos", options: ISSUE_STATUS },
            { key: "departamento", label: "Departamento", type: "select", allLabel: "Todos", options: depts.map((d) => ({ value: String(d.id), label: d.name })) },
          ]}
        />
      </div>

      <Card title={`Issues (${issues.length})`}>
        {issues.length === 0 ? (
          <EmptyState title="Nenhuma issue registrada">Abra uma regra em Data Quality e use “Registrar issue”, ou use o formulário abaixo.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>#</th><th>Problema</th><th>Departamento</th><th>Status</th><th>Identificada</th><th>Comunicada</th>
                  <th className="num">Afetados (base)</th><th className="num">Afetados (atual)</th><th>Evolução</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((i) => (
                  <tr key={i.id}>
                    <td className="muted">{i.id}</td>
                    <td><Link href={`/issues/${i.id}`}>{i.title}</Link>{i.rule_name && <div className="muted small">Regra: {i.rule_name}</div>}</td>
                    <td className="small">{i.department_name ?? "Consolidado"}</td>
                    <td><Badge kind={i.status}>{ISSUE_STATUS_LABEL[i.status]}</Badge></td>
                    <td className="small nowrap">{fmtDate(i.detected_at)}</td>
                    <td className="small nowrap">{fmtDate(i.communicated_at)}</td>
                    <td className="num">{fmtInt(i.affected_records)} <span className="muted small">{fmtPct(i.baseline_score)}</span></td>
                    <td className="num">{fmtInt(i.current_failed)} <span className="muted small">{fmtPct(i.current_score)}</span></td>
                    <td><Delta value={i.current_score != null && i.baseline_score != null ? i.current_score - i.baseline_score : null} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {hasRole(user, "analyst") && (
        <Card className="mt" title="Registrar nova issue">
          <form action={createIssueAction} className="form-grid">
            <label>
              Regra relacionada
              <select name="rule_code" defaultValue="">
                <option value="">— sem regra (problema manual) —</option>
                {rules.map((r) => (
                  <option key={r.code} value={r.code}>{r.problem_label ?? r.name}</option>
                ))}
              </select>
            </label>
            <label>
              Departamento responsável
              <select name="department_id" defaultValue="">
                <option value="">Consolidado (todos)</option>
                {depts.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </label>
            <label className="full">
              Título
              <input name="title" required minLength={3} maxLength={300} />
            </label>
            <label className="full">
              Descrição
              <textarea name="description" maxLength={5000} />
            </label>
            <div className="full">
              <button className="btn btn-primary">Registrar</button>
            </div>
          </form>
        </Card>
      )}
    </>
  );
}
