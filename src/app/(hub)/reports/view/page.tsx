import Link from "next/link";
import { EChart } from "@/components/EChart";
import { PrintButton } from "@/components/PrintButton";
import { Card, EmptyState } from "@/components/ui";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { C, barScores, lineTrend } from "@/lib/charts";
import { DIMENSION_LABEL, fmtDate, fmtDateTime, fmtInt, fmtPct } from "@/lib/format";
import {
  getDepartmentRuleResults, getDepartmentSummary, getDepartments, getDimensions, getFailures, getLastRun, getRuleHistory, getRules,
  getScoreTrend, getScoreTrendDepartment, getScoresLatest, getScoresLatestDepartment,
} from "@/lib/queries";

export const metadata = { title: "Relatório" };

const IMPACT: Record<string, string> = {
  completude: "Campos não preenchidos limitam a identificação correta dos clientes e negócios e podem comprometer integrações, deduplicações e análises comerciais.",
  validade: "Valores em formato inválido impedem validações automáticas e integrações com outros sistemas (ex.: consulta de CNPJ).",
  unicidade: "Cadastros duplicados distorcem contagens de clientes, histórico de relacionamento e indicadores de carteira.",
  consistencia: "Informações contraditórias entre campos geram indicadores divergentes entre painéis e relatórios.",
  integridade: "Referências quebradas fazem registros desaparecerem de relatórios que dependem dos relacionamentos.",
  atualidade: "Registros desatualizados reduzem a confiabilidade das decisões baseadas na posição atual do pipeline.",
};
const RECOMMEND: Record<string, string> = {
  completude: "Revisar e completar os registros listados e tornar o preenchimento obrigatório no CRM sempre que possível.",
  validade: "Corrigir os valores na origem e padronizar o formato de entrada no CRM.",
  unicidade: "Unificar os cadastros duplicados no CRM, mantendo um registro principal.",
  consistencia: "Revisar as datas e status dos registros e alinhar o processo de fechamento no CRM.",
  integridade: "Revisar os vínculos (empresa, responsável, etapa) dos registros afetados.",
  atualidade: "Atualizar os registros parados e revisar se ainda são oportunidades válidas.",
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

  // Resultados das regras no escopo (consolidado ou departamento)
  const scopeResults = deptId
    ? (await getDepartmentRuleResults(deptId)).map((r) => ({ code: r.rule_code, name: r.rule_name, dimension: r.dimension, dataset: r.dataset_name, evaluated: r.records_evaluated, failed: r.records_failed, score: r.quality_score }))
    : rulesAll.filter((r) => r.last_status === "ok").map((r) => ({ code: r.code, name: r.name, dimension: r.dimension, dataset: r.dataset_name, evaluated: r.records_evaluated ?? 0, failed: r.records_failed ?? 0, score: r.quality_score }));
  const results = scopeResults.filter((r) => (!sp.regra || r.code === sp.regra) && (!sp.dimensao || r.dimension === sp.dimensao));
  const rule = sp.regra ? rulesAll.find((r) => r.code === sp.regra) : null;
  const ruleMeta = (code: string) => rulesAll.find((r) => r.code === code);

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
  const top = [...results].filter((r) => r.failed > 0).sort((a, b) => b.failed - a.failed).slice(0, 8);
  const mainDim = top[0]?.dimension ?? sp.dimensao ?? "completude";

  // Série: regra (se escolhida) ou índice geral
  const series = sp.regra
    ? { days: ruleHistory.map((h) => h.day), data: ruleHistory.map((h) => h.quality_score), name: rule?.name ?? "Score" }
    : (() => {
        const days = [...new Set(trend.map((t) => t.day))].sort();
        const lvl = sp.dimensao ? "dimensao" : "geral";
        return { days, data: days.map((d) => trend.find((t) => t.day === d && t.level === lvl && (!sp.dimensao || t.dimension === sp.dimensao))?.score ?? null), name: sp.dimensao ? DIMENSION_LABEL[sp.dimensao] : "Índice geral" };
      })();
  const first = series.data.find((v) => v != null) ?? null;
  const last = [...series.data].reverse().find((v) => v != null) ?? null;
  const delta = first != null && last != null && series.days.length > 1 ? last - first : null;

  const failByDim = dims.map((d) => results.filter((r) => r.dimension === d.code).reduce((a, r) => a + r.failed, 0));
  const generatedAt = new Date();
  await audit(user.email, "report.generate", `report:${dept?.code ?? "consolidado"}`, { rule: sp.regra ?? null, dimension: sp.dimensao ?? null, examples: sp.exemplos === "1", run_id: lastRun.id });

  const scopeName = dept?.name ?? "Todos os departamentos";
  const headline = rule
    ? `${fmtPct(results[0] && results[0].evaluated ? (100 * results[0].failed) / results[0].evaluated : null)} dos registros avaliados não atendem à regra “${rule.name}” (${fmtInt(results[0]?.failed)} de ${fmtInt(results[0]?.evaluated)}).`
    : top[0]
      ? `O principal problema é “${top[0].name}”: ${fmtInt(top[0].failed)} de ${fmtInt(top[0].evaluated)} registros (${fmtPct((100 * top[0].failed) / top[0].evaluated)}).`
      : "Nenhuma inconsistência relevante foi encontrada no escopo selecionado.";

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
            <h1 style={{ fontSize: 22, color: "var(--brand-blue-dark)" }}>{rule ? rule.name : sp.dimensao ? `Dimensão ${DIMENSION_LABEL[sp.dimensao]}` : "Situação geral da qualidade"}</h1>
            <div className="small" style={{ marginTop: 4 }}>
              Departamento: <strong>{scopeName}</strong> · Período analisado: últimos {days} dias (até {fmtDate(generatedAt)})
            </div>
          </div>
          <div className="small" style={{ textAlign: "right", color: "var(--text-2)" }}>
            <div>Gerado em {fmtDateTime(generatedAt)}</div>
            <div>por {user.email}</div>
            <div>Validação #{lastRun.id} · {fmtDateTime(lastRun.started_at)}</div>
            <div>Fonte: Supabase/PostgreSQL (camada silver, CRM RD Station)</div>
          </div>
        </header>

        <h2>Indicadores</h2>
        <div className="grid g-4">
          <Card><div className="kpi-label">Verificações avaliadas</div><div className="kpi-value">{fmtInt(totalEvaluated)}</div><div className="kpi-hint">registro × regra no escopo</div></Card>
          <Card><div className="kpi-label">Verificações com inconsistência</div><div className="kpi-value">{fmtInt(totalFailed)}</div><div className="kpi-hint">{totalEvaluated ? fmtPct((100 * totalFailed) / totalEvaluated) : "—"} do total</div></Card>
          <Card><div className="kpi-label">Completude</div><div className="kpi-value">{fmtPct(compl?.score)}</div><div className="kpi-hint">{compl ? `${fmtInt(compl.records_passed)} de ${fmtInt(compl.records_evaluated)} campos preenchidos` : "sem dados suficientes"}</div></Card>
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
            title="Principais problemas (registros afetados)"
            exportName="principais_problemas"
            option={barScores({ categories: top.map((r) => r.name), values: top.map((r) => r.failed), horizontal: true, colorByScore: false, color: C.orange, name: "Afetados" })}
            height={240}
          />
          <EChart
            title="Score por regra"
            exportName="score_por_regra"
            option={barScores({ categories: results.slice(0, 12).map((r) => r.name), values: results.slice(0, 12).map((r) => r.score), horizontal: true, max: 100, unit: "%" })}
            height={Math.max(240, Math.min(12, results.length) * 24 + 60)}
          />
          <EChart
            title="Distribuição das inconsistências por dimensão"
            exportName="distribuicao_dimensao"
            option={barScores({ categories: dims.map((d) => d.name), values: failByDim, colorByScore: false, color: C.blue, name: "Ocorrências" })}
            height={240}
          />
        </div>

        <h2>Detalhamento</h2>
        <table className="t t-compact">
          <thead>
            <tr><th>Regra</th><th>Dimensão</th><th>Tabela · campo</th><th className="num">Avaliados</th><th className="num">Afetados</th><th className="num">%</th><th className="num">Variação ~30d</th></tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const m = ruleMeta(r.code);
              return (
                <tr key={r.code}>
                  <td>{r.name}</td>
                  <td>{DIMENSION_LABEL[r.dimension]}</td>
                  <td className="small">{r.dataset}{m?.column_name ? ` · ${m.column_name}` : ""}</td>
                  <td className="num">{fmtInt(r.evaluated)}</td>
                  <td className="num">{fmtInt(r.failed)}</td>
                  <td className="num">{r.evaluated ? fmtPct((100 * r.failed) / r.evaluated) : "—"}</td>
                  <td className="num small">{!deptId && m?.delta_score != null ? `${m.delta_score > 0 ? "+" : ""}${m.delta_score.toFixed(1)} p.p.` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="small muted">Um registro pode ter mais de um problema; por isso, a soma de afetados não é a quantidade de registros únicos.</p>

        {examples && examples.rows.length > 0 && (
          <>
            <h3 style={{ marginTop: 14, fontSize: 13 }}>Exemplos de registros afetados ({fmtInt(examples.total)} no total)</h3>
            <table className="t t-compact">
              <thead><tr><th>Regra</th><th>ID</th><th>Registro</th><th>Detalhe</th></tr></thead>
              <tbody>
                {examples.rows.map((f) => (
                  <tr key={f.rule_code + f.record_id}><td className="small">{f.rule_name}</td><td className="mono small">{f.record_id}</td><td>{f.record_label}</td><td className="small muted">{f.detail}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <h2>Conclusão</h2>
        <p>
          Foram avaliadas {fmtInt(totalEvaluated)} verificações de qualidade {dept ? <>nos registros sob responsabilidade de <strong>{dept.name}</strong></> : "em todos os departamentos"}, na validação de {fmtDateTime(lastRun.started_at)}.
        </p>
        <p><strong>{headline}</strong></p>
        {delta != null && (
          <p>
            Em relação ao início do período ({fmtDate(series.days[0])}), o indicador {Math.abs(delta) < 0.5 ? "ficou estável" : delta > 0 ? `melhorou ${delta.toFixed(1)} p.p.` : `piorou ${Math.abs(delta).toFixed(1)} p.p.`}.
          </p>
        )}
        <p><strong>Impacto potencial:</strong> {IMPACT[mainDim]}</p>
        <p><strong>Recomendação:</strong> {RECOMMEND[mainDim]} Solicitamos a avaliação e correção dos registros identificados; a evolução será acompanhada nas próximas avaliações.</p>
        {sp.notas && <p><strong>Observações:</strong> {sp.notas.slice(0, 2000)}</p>}
        <p className="small muted" style={{ marginTop: 18 }}>
          Metodologia: cada regra é uma consulta SQL versionada em <code>quality.validation_rules</code>, executada no banco. Denominador = população descrita em cada regra.
          Departamento = equipe do RD do dono do registro. Dados pessoais não são incluídos neste relatório.
        </p>
      </article>
    </>
  );
}
