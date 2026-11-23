import Link from "next/link";
import { notFound } from "next/navigation";
import { FileBarChart2 } from "lucide-react";
import { EChart } from "@/components/EChart";
import { FilterBar } from "@/components/FilterBar";
import { PERIOD_OPTIONS } from "@/lib/format";
import { Badge, Card, Delta, EmptyState, Kpi, PageHeader, ScoreBar } from "@/components/ui";
import { C, barScores, lineTrend } from "@/lib/charts";
import { DIMENSION_LABEL, ISSUE_STATUS_LABEL, fmtDate, fmtInt, fmtPct } from "@/lib/format";
import { getDepartmentRuleResults, getDepartmentSummary, getDimensions, getIssues, getScoreTrendDepartment, getScoresLatestDepartment } from "@/lib/queries";

export default async function DepartmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ periodo?: string }> }) {
  const id = Number((await params).id);
  const sp = await searchParams;
  const days = Number(sp.periodo ?? 90) || 90;
  const [summary, dims, scores, results, trend, issues] = await Promise.all([
    getDepartmentSummary(), getDimensions(), getScoresLatestDepartment(), getDepartmentRuleResults(id), getScoreTrendDepartment(days, id), getIssues(null, id),
  ]);
  const d = summary.find((s) => s.department_id === id);
  if (!d) notFound();
  const myScores = scores.filter((s) => s.department_id === id);
  const problems = results.filter((r) => r.records_failed > 0);
  const completeness = results.filter((r) => r.dimension === "completude" && r.records_evaluated > 0).sort((a, b) => b.records_failed / b.records_evaluated - a.records_failed / a.records_evaluated);
  const dayList = [...new Set(trend.map((t) => t.day))].sort();

  return (
    <>
      <PageHeader
        eyebrow="Departamento"
        title={d.name}
        description="Registros sob responsabilidade do departamento (dono do registro no RD), resultados das regras e evolução."
        actions={
          <Link className="btn btn-accent" href={`/reports/view?departamento=${id}`}>
            <FileBarChart2 size={14} /> Gerar relatório do departamento
          </Link>
        }
      />
      <FilterBar filters={[{ key: "periodo", label: "Período", type: "select", options: PERIOD_OPTIONS, defaultValue: "90" }]} />

      <div className="grid g-6">
        <Kpi tone="brand" label="Índice de qualidade" value={d.overall_score != null ? fmtPct(d.overall_score) : "Dados insuficientes"} band={d.band} delta={d.delta_score} hint={d.previous_day ? `vs ${fmtDate(d.previous_day)}` : undefined} />
        <Kpi label="Completude geral" value={fmtPct(d.completeness_score)} />
        <Kpi label="Negócios comerciais" value={fmtInt(d.deals_comerciais)} hint={`${fmtInt(d.empresas_clientes)} empresas clientes`} />
        <Kpi label="Verificações avaliadas" value={fmtInt(d.checks_evaluated)} hint="registro × regra" />
        <Kpi label="Registros com inconsistência" value={fmtInt(d.unique_records_with_issues)} hint={`${fmtInt(d.occurrences)} ocorrências no total`} />
        <Kpi label="Issues abertas" value={fmtInt(d.open_issues)} href={`/issues?departamento=${id}`} />
      </div>

      <div className="grid g-2 mt">
        {dayList.length > 1 ? (
          <EChart
            title="Evolução da qualidade"
            option={lineTrend({
              days: dayList,
              series: [
                { name: "Índice", data: dayList.map((day) => trend.find((t) => t.day === day && t.level === "geral")?.score ?? null), color: C.blue, width: 3 },
                { name: "Completude", data: dayList.map((day) => trend.find((t) => t.day === day && t.level === "dimensao" && t.dimension === "completude")?.score ?? null), color: C.orange },
              ],
              yMin: 0,
              yMax: 100,
              unit: "%",
              markX: issues.filter((i) => i.communicated_at).map((i) => ({ label: `Comunicado #${i.id}`, day: new Date(i.communicated_at!).toISOString().slice(0, 10) })),
            })}
            height={260}
          />
        ) : (
          <Card title="Evolução da qualidade"><EmptyState title="Histórico em construção">A série aparece a partir de validações em dois dias diferentes.</EmptyState></Card>
        )}
        <EChart
          title="Qualidade por dimensão"
          option={barScores({
            categories: dims.map((x) => x.name),
            values: dims.map((x) => myScores.find((s) => s.level === "dimensao" && s.dimension === x.code)?.score ?? null),
            max: 100,
            unit: "%",
            threshold: 95,
          })}
          height={260}
        />
      </div>

      <div className="grid g-2 mt">
        <EChart
          title="Campos com maior incompletude"
          subtitle="% de registros do departamento sem o campo"
          option={barScores({
            categories: completeness.map((r) => r.rule_name),
            values: completeness.map((r) => Number(((100 * r.records_failed) / r.records_evaluated).toFixed(1))),
            horizontal: true,
            colorByScore: false,
            color: C.orange,
            unit: "%",
            links: completeness.map((r) => `/quality/rules/${r.rule_code}?departamento=${id}`),
          })}
          links={{}}
          height={Math.max(240, completeness.length * 28 + 60)}
        />
        <Card title="Principais problemas" subtitle="Registros afetados por regra (um registro pode aparecer em várias)">
          {problems.length === 0 ? <EmptyState title="Nenhum problema encontrado" /> : (
            <table className="t t-compact">
              <thead>
                <tr><th>Regra</th><th>Dimensão</th><th className="num">Afetados</th><th className="num">Avaliados</th><th style={{ width: 100 }}>Score</th></tr>
              </thead>
              <tbody>
                {problems.map((r) => (
                  <tr key={r.rule_code}>
                    <td><Link href={`/quality/rules/${r.rule_code}?departamento=${id}`}>{r.rule_name}</Link></td>
                    <td className="small">{DIMENSION_LABEL[r.dimension]}</td>
                    <td className="num"><strong>{fmtInt(r.records_failed)}</strong></td>
                    <td className="num muted">{fmtInt(r.records_evaluated)}</td>
                    <td><ScoreBar value={r.quality_score} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card className="mt" title={`Acompanhamento de correções (${issues.length})`} actions={<Link className="btn" href="/issues">Ver todas</Link>}>
        {issues.length === 0 ? <EmptyState title="Nenhuma issue registrada para este departamento">Abra uma regra e use “Registrar issue”.</EmptyState> : (
          <table className="t t-compact">
            <thead>
              <tr><th>#</th><th>Problema</th><th>Status</th><th className="num">Linha de base</th><th className="num">Atual</th><th>Evolução</th></tr>
            </thead>
            <tbody>
              {issues.map((i) => (
                <tr key={i.id}>
                  <td className="muted">{i.id}</td>
                  <td><Link href={`/issues/${i.id}`}>{i.title}</Link></td>
                  <td><Badge kind={i.status}>{ISSUE_STATUS_LABEL[i.status]}</Badge></td>
                  <td className="num">{fmtInt(i.affected_records)} <span className="muted">({fmtPct(i.baseline_score)})</span></td>
                  <td className="num">{fmtInt(i.current_failed)} <span className="muted">({fmtPct(i.current_score)})</span></td>
                  <td><Delta value={i.current_score != null && i.baseline_score != null ? i.current_score - i.baseline_score : null} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
