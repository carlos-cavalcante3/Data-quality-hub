import Link from "next/link";
import { EChart } from "@/components/EChart";
import { PrintButton } from "@/components/PrintButton";
import { Card, EmptyState } from "@/components/ui";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { C, barScores, lineTrend } from "@/lib/charts";
import { DIMENSION_LABEL, SEVERITY_LABEL, fmtDate, fmtDateTime, fmtInt, fmtPct } from "@/lib/format";
import { byAffected, byWorstScore, problemOf } from "@/lib/sort";
import {
  getDepartmentRuleResults, getDepartmentSummary, getDepartments, getDimensions, getFailures, getLastRun, getRuleHistory, getRules,
  getScoreTrend, getScoreTrendDepartment, getScoresLatest, getScoresLatestDepartment,
} from "@/lib/queries";

export const metadata = { title: "Relatório" };

type Row = {
  code: string; name: string; problem_label: string | null; severity: string; dimension: string; dataset: string; column: string | null;
  evaluated: number; failed: number; score: number | null; impact: string | null; recommendation: string | null; delta: number | null;
};

export default async function ReportView({
  searchParams,
}: {
  searchParams: Promise<{ departamento?: string; regra?: string; dimensao?: string; periodo?: string; notas?: string; exemplos?: string; issue?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const deptId = sp.departamento ? Number(sp.departamento) : null;
  const days = Number(sp.periodo ?? 90) || 90;
  const [lastRun, depts, rulesAll, dims, deptSummary] = await Promise.all([getLastRun(), getDepartments(), getRules(), getDimensions(), getDepartmentSummary()]);
  if (!lastRun) return <EmptyState title="Nenhuma validação executada ainda" />;
  const dept = deptId ? depts.find((d) => d.id === deptId) : null;
  const deptSum = deptId ? deptSummary.find((d) => d.department_id === deptId) : null;
  const meta = new Map(rulesAll.map((r) => [r.code, r]));

  // Resultados das regras no escopo (consolidado ou departamento)
  const scoped: Row[] = deptId
    ? (await getDepartmentRuleResults(deptId)).map((r) => ({
        code: r.rule_code, name: r.rule_name, problem_label: r.problem_label, severity: r.severity, dimension: r.dimension, dataset: r.dataset_name,
        column: r.column_name, evaluated: r.records_evaluated, failed: r.records_failed, score: r.quality_score,
        impact: meta.get(r.rule_code)?.impact ?? null, recommendation: meta.get(r.rule_code)?.recommendation ?? null, delta: null,
      }))
    : rulesAll.filter((r) => r.last_status === "ok" && (r.records_evaluated ?? 0) > 0).map((r) => ({
        code: r.code, name: r.name, problem_label: r.problem_label, severity: r.severity, dimension: r.dimension, dataset: r.dataset_name,
        column: r.column_name, evaluated: r.records_evaluated ?? 0, failed: r.records_failed ?? 0, score: r.quality_score,
        impact: r.impact, recommendation: r.recommendation, delta: r.delta_score,
      }));
  const results = scoped.filter((r) => (!sp.regra || r.code === sp.regra) && (!sp.dimensao || r.dimension === sp.dimensao));
  const rule = sp.regra ? meta.get(sp.regra) : null;

  const [scores, trendAll, trendDept, ruleHistory, examples] = await Promise.all([
    deptId ? getScoresLatestDepartment().then((s) => s.filter((x) => x.department_id === deptId)) : getScoresLatest(),
    deptId ? Promise.resolve([]) : getScoreTrend(days),
    deptId ? getScoreTrendDepartment(days, deptId) : Promise.resolve([]),
    sp.regra ? getRuleHistory(sp.regra, days, deptId) : Promise.resolve([]),
    sp.exemplos === "1" ? getFailures({ rule: sp.regra, department: deptId, pageSize: 15 }) : Promise.resolve(null),
  ]);
  const trend = deptId ? trendDept : trendAll;

  const overall = scores.find((s) => s.level === "geral");
  const compl = scores.find((s) => s.level === "dimensao" && s.dimension === "completude");
  const totalEvaluated = results.reduce((a, r) => a + r.evaluated, 0);
  const totalFailed = results.reduce((a, r) => a + r.failed, 0);
  const problems = results.filter((r) => r.failed > 0).sort(byAffected);
  const top = problems.slice(0, 8);
  // Regras com população abaixo do mínimo não entram no ranking de conformidade (dados insuficientes)
  const minPop = (r: Row) => meta.get(r.code)?.min_population ?? 20;
  const insufficient = results.filter((r) => r.evaluated < minPop(r));
  const worstScores = results.filter((r) => r.evaluated >= minPop(r)).sort(byWorstScore).slice(0, 12);

  // Série: regra (se escolhida) ou índice geral/dimensão
  const series = sp.regra
    ? { days: ruleHistory.map((h) => h.day), data: ruleHistory.map((h) => h.quality_score), name: rule?.name ?? "Score" }
    : (() => {
        const dayList = [...new Set(trend.map((t) => t.day))].sort();
        const lvl = sp.dimensao ? "dimensao" : "geral";
        return {
          days: dayList,
          data: dayList.map((d) => trend.find((t) => t.day === d && t.level === lvl && (!sp.dimensao || t.dimension === sp.dimensao))?.score ?? null),
          name: sp.dimensao ? DIMENSION_LABEL[sp.dimensao] : "Índice geral",
        };
      })();
  const first = series.data.find((v) => v != null) ?? null;
  const last = [...series.data].reverse().find((v) => v != null) ?? null;
  const delta = first != null && last != null && series.days.length > 1 ? last - first : null;

  const failByDim = dims.map((d) => ({ name: d.name, v: results.filter((r) => r.dimension === d.code).reduce((a, r) => a + r.failed, 0) })).sort((a, b) => b.v - a.v);
  const generatedAt = new Date();
  await audit(user.email, "report.generate", `report:${dept?.code ?? "consolidado"}`, { rule: sp.regra ?? null, dimension: sp.dimensao ?? null, examples: sp.exemplos === "1", run_id: lastRun.id });

  const scopeName = dept?.name ?? "Todos os departamentos";
  const pct = (r: Row) => (r.evaluated ? (100 * r.failed) / r.evaluated : null);

  return (
    <>
      <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 14, justifyContent: "space-between" }}>
        <Link className="btn" href="/reports">← Alterar filtros</Link>
        <PrintButton />
      </div>
      <article className="report">
        <header className="report-head">
          <div>
            <div className="eyebrow">Relatório de qualidade dos dados</div>
            <h1 style={{ fontSize: 22, color: "var(--brand-blue-dark)" }}>
              {rule ? problemOf(rule) : sp.dimensao ? `Dimensão ${DIMENSION_LABEL[sp.dimensao]}` : "Situação geral da qualidade"}
            </h1>
            <div className="small" style={{ marginTop: 4 }}>
              Departamento: <strong>{scopeName}</strong> · Período analisado: últimos {days} dias (até {fmtDate(generatedAt)})
            </div>
          </div>
          <div className="small" style={{ textAlign: "right", color: "var(--text-2)" }}>
            <div>Gerado em {fmtDateTime(generatedAt)}</div>
            <div>por {user.email}</div>
            <div>Validação #{lastRun.id} · {fmtDateTime(lastRun.started_at)}</div>
            <div>Fonte: Supabase/PostgreSQL (CRM RD Station)</div>
          </div>
        </header>

        <h2>Indicadores</h2>
        <div className="grid g-4">
          <Card><div className="kpi-label">Verificações avaliadas</div><div className="kpi-value">{fmtInt(totalEvaluated)}</div><div className="kpi-hint">registro × regra no escopo</div></Card>
          <Card><div className="kpi-label">Verificações com problema</div><div className="kpi-value">{fmtInt(totalFailed)}</div><div className="kpi-hint">{totalEvaluated ? fmtPct((100 * totalFailed) / totalEvaluated) : "—"} do total · {problems.length} tipos de problema</div></Card>
          <Card><div className="kpi-label">Completude</div><div className="kpi-value">{fmtPct(compl?.score)}</div><div className="kpi-hint">{compl ? `${fmtInt(compl.records_passed)} de ${fmtInt(compl.records_evaluated)} campos preenchidos` : "dados insuficientes"}</div></Card>
          <Card><div className="kpi-label">Índice de qualidade</div><div className="kpi-value">{overall?.score != null ? fmtPct(overall.score) : "Dados insuficientes"}</div><div className="kpi-hint">{deptSum ? `${fmtInt(deptSum.unique_records_with_issues)} registros únicos com problema` : "ponderado por dimensão e criticidade"}</div></Card>
        </div>

        <h2>Visualizações</h2>
        <div className="grid g-2">
          {series.days.length > 1 ? (
            <EChart title={`Evolução · ${series.name}`} exportName="evolucao" option={lineTrend({ days: series.days, series: [{ name: series.name, data: series.data, color: C.blue, width: 3 }], yMin: 0, yMax: 100, unit: "%", markLines: rule ? [{ name: `Meta ${rule.expected_threshold}%`, value: rule.expected_threshold }] : undefined })} height={240} />
          ) : (
            <Card title="Evolução"><EmptyState title="Histórico insuficiente">É necessário mais de um dia de avaliação para mostrar a evolução.</EmptyState></Card>
          )}
          <EChart
            title="Principais problemas"
            subtitle="Registros afetados · ordem: mais afetados primeiro"
            exportName="principais_problemas"
            option={barScores({ categories: top.map((r) => problemOf(r)), values: top.map((r) => r.failed), horizontal: true, colorByScore: false, color: C.orange, name: "Registros afetados" })}
            height={Math.max(240, top.length * 30 + 60)}
          />
          <EChart
            title="Conformidade por regra"
            subtitle={`% de registros que atendem à regra · ordem: pior primeiro${insufficient.length ? ` · ${insufficient.length} regra(s) com dados insuficientes omitida(s)` : ""}`}
            exportName="conformidade_por_regra"
            option={barScores({ categories: worstScores.map((r) => r.name), values: worstScores.map((r) => r.score), horizontal: true, max: 100, unit: "%" })}
            height={Math.max(240, worstScores.length * 26 + 60)}
          />
          <EChart
            title="Problemas por dimensão de qualidade"
            subtitle="Verificações com problema · ordem: maior primeiro"
            exportName="problemas_por_dimensao"
            option={barScores({ categories: failByDim.map((d) => d.name), values: failByDim.map((d) => d.v), horizontal: true, colorByScore: false, color: C.blue, name: "Ocorrências" })}
            height={240}
          />
        </div>

        <h2>Detalhamento dos problemas</h2>
        {problems.length === 0 ? (
          <p>Nenhum problema encontrado no escopo selecionado.</p>
        ) : (
          <table className="t t-compact">
            <thead>
              <tr><th>Problema</th><th>Severidade</th><th>Tabela · campo</th><th className="num">Afetados</th><th className="num">Avaliados</th><th className="num">%</th><th className="num">Variação ~30d</th></tr>
            </thead>
            <tbody>
              {problems.map((r) => (
                <tr key={r.code}>
                  <td>{problemOf(r)}<div className="small muted">{DIMENSION_LABEL[r.dimension]}</div></td>
                  <td className="small">{SEVERITY_LABEL[r.severity]}</td>
                  <td className="small">{r.dataset}{r.column ? ` · ${r.column}` : ""}</td>
                  <td className="num"><strong>{fmtInt(r.failed)}</strong></td>
                  <td className="num">{fmtInt(r.evaluated)}</td>
                  <td className="num">{fmtPct(pct(r))}</td>
                  <td className="num small">{r.delta != null ? `${r.delta > 0 ? "+" : ""}${r.delta.toFixed(1)} p.p.` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="small muted">Um registro pode ter mais de um problema; por isso, a soma de afetados não é a quantidade de registros únicos.</p>

        {examples && examples.rows.length > 0 && (
          <>
            <h3 style={{ marginTop: 14, fontSize: 13 }}>Exemplos de registros afetados ({fmtInt(examples.total)} no total)</h3>
            <table className="t t-compact">
              <thead><tr><th>Problema</th><th>ID</th><th>Registro</th><th>Detalhe</th></tr></thead>
              <tbody>
                {examples.rows.map((f) => (
                  <tr key={f.rule_code + f.record_id}><td className="small">{problemOf(f)}</td><td className="mono small">{f.record_id}</td><td>{f.record_label}</td><td className="small muted">{f.detail}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <h2>Conclusão</h2>
        <p>
          Foram avaliadas {fmtInt(totalEvaluated)} verificações de qualidade {dept ? <>nos registros sob responsabilidade de <strong>{dept.name}</strong></> : "em todos os departamentos"}, na validação de {fmtDateTime(lastRun.started_at)}.
          {delta != null && <> Em relação ao início do período ({fmtDate(series.days[0])}), o indicador {Math.abs(delta) < 0.5 ? "ficou estável" : delta > 0 ? `melhorou ${delta.toFixed(1)} p.p.` : `piorou ${Math.abs(delta).toFixed(1)} p.p.`}.</>}
        </p>
        {problems.length === 0 ? (
          <p>Nenhuma inconsistência relevante foi encontrada.</p>
        ) : (
          <ol style={{ paddingLeft: 18 }}>
            {problems.slice(0, 3).map((r) => (
              <li key={r.code} style={{ marginBottom: 8 }}>
                <strong>{problemOf(r)}</strong>: {fmtInt(r.failed)} de {fmtInt(r.evaluated)} registros ({fmtPct(pct(r))}).
                {r.impact && <><br /><span className="small"><strong>Impacto:</strong> {r.impact}</span></>}
                {r.recommendation && <><br /><span className="small"><strong>Ação recomendada:</strong> {r.recommendation}</span></>}
              </li>
            ))}
          </ol>
        )}
        <p>Solicitamos a avaliação e correção dos registros identificados. A evolução será acompanhada nas próximas avaliações.</p>
        {sp.notas && <p><strong>Observações:</strong> {sp.notas.slice(0, 2000)}</p>}
        <p className="small muted" style={{ marginTop: 18 }}>
          Metodologia: cada regra é uma consulta versionada executada no banco; o denominador é a população descrita na regra.
          Departamento = equipe do RD do responsável pelo registro.
        </p>
      </article>
    </>
  );
}
