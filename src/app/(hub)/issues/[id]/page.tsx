import Link from "next/link";
import { notFound } from "next/navigation";
import { FileBarChart2 } from "lucide-react";
import { EChart } from "@/components/EChart";
import { Badge, Card, Delta, EmptyState, Kpi, PageHeader, Provenance } from "@/components/ui";
import { C, lineTrend } from "@/lib/charts";
import { hasRole, requireUser } from "@/lib/auth";
import { ISSUE_STATUS, ISSUE_STATUS_LABEL, fmtDate, fmtDateTime, fmtInt, fmtPct } from "@/lib/format";
import { getIssue, getIssueEvents, getRuleHistory } from "@/lib/queries";
import { updateIssueAction } from "../../actions";

export default async function IssuePage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const user = await requireUser();
  const issue = await getIssue(id);
  if (!issue) notFound();
  const [events, history] = await Promise.all([
    getIssueEvents(id),
    issue.rule_code ? getRuleHistory(issue.rule_code, 365, issue.department_id) : Promise.resolve([]),
  ]);
  const delta = issue.current_score != null && issue.baseline_score != null ? issue.current_score - issue.baseline_score : null;

  return (
    <>
      <PageHeader
        eyebrow={`Issue #${issue.id}`}
        title={issue.title}
        description={issue.description ?? undefined}
        actions={
          issue.rule_code && (
            <Link className="btn" href={`/reports/view?regra=${issue.rule_code}${issue.department_id ? `&departamento=${issue.department_id}` : ""}&issue=${issue.id}`}>
              <FileBarChart2 size={14} /> Relatório de evidência
            </Link>
          )
        }
      />
      <div className="grid g-4">
        <Kpi tone="brand" label="Status" value={<Badge kind={issue.status}>{ISSUE_STATUS_LABEL[issue.status]}</Badge>} hint={`Atualizada ${fmtDateTime(issue.updated_at)}`} />
        <Kpi label="Afetados na identificação" value={fmtInt(issue.affected_records)} hint={`score ${fmtPct(issue.baseline_score)} em ${fmtDate(issue.detected_at)}`} />
        <Kpi label="Afetados hoje" value={fmtInt(issue.current_failed)} hint={`score ${fmtPct(issue.current_score)}`} footer={<div className="kpi-meta"><Delta value={delta} /></div>} />
        <Kpi label="Registros corrigidos (informado)" value={fmtInt(issue.records_corrected)} hint={issue.affected_records != null && issue.current_failed != null ? `redução medida: ${fmtInt(issue.affected_records - issue.current_failed)}` : undefined} />
      </div>

      <Card className="mt" title="Contexto">
        <Provenance
          items={[
            { label: "Regra", value: issue.rule_code ? <Link href={`/quality/rules/${issue.rule_code}${issue.department_id ? `?departamento=${issue.department_id}` : ""}`}>{issue.rule_name}</Link> : "—" },
            { label: "Dataset", value: issue.dataset_name ?? "—" },
            { label: "Departamento", value: issue.department_name ?? "Consolidado" },
            { label: "Identificada", value: fmtDateTime(issue.detected_at) },
            { label: "Comunicada", value: fmtDateTime(issue.communicated_at) },
            { label: "Resolvida", value: fmtDateTime(issue.resolved_at) },
            { label: "Registrada por", value: issue.created_by },
          ]}
        />
        {issue.notes && <pre className="small" style={{ whiteSpace: "pre-wrap", marginTop: 12, fontFamily: "inherit" }}>{issue.notes}</pre>}
      </Card>

      <div className="grid g-2 mt">
        {history.length > 1 ? (
          <EChart
            title="Evolução do indicador desde a identificação"
            subtitle="Marcadores: identificação e comunicação ao departamento"
            option={lineTrend({
              days: history.map((h) => h.day),
              series: [{ name: "Score", data: history.map((h) => h.quality_score), color: C.blue, width: 3 }],
              yMin: 0,
              yMax: 100,
              unit: "%",
              markX: [
                { label: "Identificada", day: new Date(issue.detected_at).toISOString().slice(0, 10) },
                ...(issue.communicated_at ? [{ label: "Comunicada", day: new Date(issue.communicated_at).toISOString().slice(0, 10) }] : []),
              ],
            })}
            height={260}
          />
        ) : (
          <Card title="Evolução do indicador"><EmptyState title="Histórico em construção" /></Card>
        )}
        <Card title="Linha do tempo">
          <ul className="attention-list">
            {events.map((e) => (
              <li key={e.id} style={{ display: "block" }}>
                <div className="small"><strong>{fmtDateTime(e.at)}</strong> · {e.actor}</div>
                <div className="small">
                  {e.old_status ? `${ISSUE_STATUS_LABEL[e.old_status]} → ` : ""}
                  {e.new_status ? ISSUE_STATUS_LABEL[e.new_status] : ""}
                </div>
                {e.note && <div className="small muted">{e.note}</div>}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {hasRole(user, "analyst") && (
        <Card className="mt" title="Atualizar acompanhamento">
          <form action={updateIssueAction} className="form-grid">
            <input type="hidden" name="issue_id" value={issue.id} />
            <label>
              Novo status
              <select name="status" defaultValue={issue.status}>
                {ISSUE_STATUS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
            <label>
              Registros corrigidos (informado pelo departamento)
              <input name="records_corrected" type="number" min={0} defaultValue={issue.records_corrected ?? ""} />
            </label>
            <label className="full">
              Observação
              <textarea name="note" maxLength={5000} placeholder="Ex.: relatório enviado ao gestor comercial por e-mail" />
            </label>
            <div className="full">
              <button className="btn btn-primary">Salvar</button>
            </div>
          </form>
        </Card>
      )}
    </>
  );
}
