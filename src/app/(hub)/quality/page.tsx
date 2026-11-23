import Link from "next/link";
import { EChart } from "@/components/EChart";
import { FilterBar } from "@/components/FilterBar";
import { PERIOD_OPTIONS } from "@/lib/format";
import { Badge, Card, Delta, EmptyState, PageHeader, ScoreBar, SeverityBadge } from "@/components/ui";
import { C, barScores, lineTrend, stackedBars } from "@/lib/charts";
import { DIMENSION_LABEL, fmtDateTime, fmtInt, fmtPct } from "@/lib/format";
import { RULE_SORTS, byAffected, problemOf, sortRules } from "@/lib/sort";
import { getDepartmentDimensionIssues, getDepartments, getDimensions, getRules, getScoreTrend, getScoresLatest } from "@/lib/queries";

export const metadata = { title: "Data Quality" };

export default async function QualityPage({
  searchParams,
}: {
  searchParams: Promise<{ dimensao?: string; dataset?: string; departamento?: string; periodo?: string; q?: string; ordem?: string }>;
}) {
  const sp = await searchParams;
  const days = Number(sp.periodo ?? 90) || 90;
  const [rulesAll, scores, trend, dims, depts, deptIssues] = await Promise.all([
    getRules(), getScoresLatest(), getScoreTrend(days), getDimensions(), getDepartments(), getDepartmentDimensionIssues(),
  ]);

  const filtered = rulesAll.filter(
    (r) =>
      (!sp.dimensao || r.dimension === sp.dimensao) &&
      (!sp.dataset || r.dataset_name === sp.dataset) &&
      (!sp.q || (r.name + (r.problem_label ?? "") + r.code + (r.column_name ?? "")).toLowerCase().includes(sp.q.toLowerCase())),
  );
  const rules = sortRules(filtered, sp.ordem);
  const datasets = [...new Set(rulesAll.map((r) => r.dataset_name))].sort();

  const dimScores = dims.map((d) => scores.find((s) => s.level === "dimensao" && s.dimension === d.code));
  const dayList = [...new Set(trend.map((t) => t.day))].sort();
  const trendSeries = dims
    .filter((d) => !sp.dimensao || d.code === sp.dimensao)
    .map((d) => ({ name: d.name, data: dayList.map((day) => trend.find((t) => t.day === day && t.level === "dimensao" && t.dimension === d.code)?.score ?? null) }));

  const completeness = rulesAll
    .filter((r) => r.dimension === "completude" && (r.records_evaluated ?? 0) >= r.min_population)
    .map((r) => ({ ...r, pct: (100 * (r.records_failed ?? 0)) / (r.records_evaluated ?? 1) }))
    .sort((a, b) => b.pct - a.pct);

  const byDataset = datasets.map((ds) => {
    const rs = rules.filter((r) => r.dataset_name === ds);
    return { ds, failed: rs.reduce((a, r) => a + (r.records_failed ?? 0), 0), passed: rs.reduce((a, r) => a + (r.records_passed ?? 0), 0) };
  }).filter((d) => d.failed + d.passed > 0).sort((a, b) => b.failed - a.failed);

  const deptAgg = depts
    .map((d) => {
      const rows = deptIssues.filter((x) => x.department_id === d.id && (!sp.dimensao || x.dimension === sp.dimensao));
      return { id: d.id, name: d.name, occ: rows.reduce((a, r) => a + r.occurrences, 0) };
    })
    .filter((d) => d.occ > 0)
    .sort((a, b) => b.occ - a.occ);

  const validVsInvalid = rules.filter((r) => (r.records_failed ?? 0) > 0).sort(byAffected).slice(0, 15);

  return (
    <>
      <PageHeader
        eyebrow="Data Quality Engineering"
        title="Qualidade dos dados"
        description="Resultados das regras de qualidade, sempre com população avaliada (denominador), regra e data. Clique em um indicador ou regra para ver os registros afetados."
      />
      <FilterBar
        filters={[
          { key: "dimensao", label: "Dimensão", type: "select", allLabel: "Todas", options: dims.map((d) => ({ value: d.code, label: d.name })) },
          { key: "dataset", label: "Tabela", type: "select", allLabel: "Todas", options: datasets.map((d) => ({ value: d, label: d })) },
          { key: "periodo", label: "Período", type: "select", options: PERIOD_OPTIONS, defaultValue: "90" },
          { key: "q", label: "Regra ou campo", type: "search", placeholder: "ex.: cnpj" },
          { key: "ordem", label: "Ordenar regras por", type: "select", options: RULE_SORTS, defaultValue: "prioridade" },
        ]}
      />

      <div className="grid g-2">
        <EChart
          title="Qualidade por dimensão"
          subtitle="Score ponderado na última validação · meta de referência 95%"
          option={barScores({
            categories: dims.map((d) => d.name),
            values: dimScores.map((s) => s?.score ?? null),
            max: 100,
            unit: "%",
            threshold: 95,
            links: dims.map((d) => `/quality?dimensao=${d.code}`),
          })}
          links={{}}
          height={280}
        />
        {dayList.length > 1 ? (
          <EChart title="Evolução por dimensão" subtitle="Última validação de cada dia" option={lineTrend({ days: dayList, series: trendSeries, yMin: 0, yMax: 100, unit: "%" })} height={280} />
        ) : (
          <Card title="Evolução por dimensão">
            <EmptyState title="Histórico em construção">A série temporal aparece a partir de validações em dois dias diferentes.</EmptyState>
          </Card>
        )}
      </div>

      <div className="grid g-3" style={{ marginTop: 14 }}>
        <EChart
          title="Campos com maior incompletude"
          subtitle="% de registros sem o campo, na população de cada regra"
          option={barScores({
            categories: completeness.map((r) => `${r.column_name ?? r.code} (${r.dataset_name.split(".")[1]})`),
            values: completeness.map((r) => Number(r.pct.toFixed(1))),
            horizontal: true,
            colorByScore: false,
            color: C.orange,
            unit: "%",
            name: "Incompletude",
            links: completeness.map((r) => `/quality/rules/${r.code}`),
          })}
          links={{}}
          height={Math.max(280, completeness.length * 26 + 60)}
        />
        <EChart
          title="Problemas por tabela"
          subtitle="Verificações aprovadas × com falha"
          option={stackedBars({
            categories: byDataset.map((d) => d.ds),
            horizontal: true,
            series: [
              { name: "Com falha", data: byDataset.map((d) => d.failed), color: C.red },
              { name: "Aprovadas", data: byDataset.map((d) => d.passed), color: "#bbdfc6" },
            ],
            links: byDataset.map((d) => `/quality?dataset=${d.ds}`),
          })}
          links={{}}
          height={Math.max(280, byDataset.length * 30 + 70)}
        />
        <EChart
          title="Problemas por departamento"
          subtitle="Ocorrências (um registro pode ter várias)"
          option={barScores({
            categories: deptAgg.map((d) => d.name),
            values: deptAgg.map((d) => d.occ),
            horizontal: true,
            colorByScore: false,
            color: C.blue,
            name: "Ocorrências",
            links: deptAgg.map((d) => `/departments/${d.id}`),
          })}
          links={{}}
          height={Math.max(280, deptAgg.length * 30 + 60)}
        />
      </div>

      <div style={{ marginTop: 14 }}>
        <EChart
          title="Registros afetados × conformes por problema"
          subtitle="15 problemas com mais registros afetados (filtros aplicados) · ordem: afetados"
          option={stackedBars({
            categories: validVsInvalid.map((r) => problemOf(r)),
            horizontal: true,
            series: [
              { name: "Afetados", data: validVsInvalid.map((r) => r.records_failed ?? 0), color: C.red },
              { name: "Conformes", data: validVsInvalid.map((r) => r.records_passed ?? 0), color: "#bbdfc6" },
            ],
            links: validVsInvalid.map((r) => `/quality/rules/${r.code}`),
          })}
          links={{}}
          height={Math.max(300, validVsInvalid.length * 26 + 70)}
        />
      </div>

      <Card title={`Regras de qualidade (${rules.length})`} subtitle={`Ordenadas por: ${RULE_SORTS.find((s) => s.value === (sp.ordem ?? "prioridade"))?.label.toLowerCase()} · cada linha mostra a população avaliada, os registros afetados e a variação em ~30 dias`} className="mt">
        <div className="table-wrap" style={{ marginTop: 4 }}>
          <table className="t">
            <thead>
              <tr>
                <th>Regra</th>
                <th>Dimensão</th>
                <th>Tabela · campo</th>
                <th>Sev.</th>
                <th className="num">Avaliados</th>
                <th className="num">Afetados</th>
                <th style={{ width: 130 }}>Score / meta</th>
                <th className="num">Score</th>
                <th>Tendência</th>
                <th>Situação</th>
                <th>Avaliação</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.code}>
                  <td>
                    <Link href={`/quality/rules/${r.code}`}>{r.name}</Link>
                    {(r.records_failed ?? 0) > 0 && <div className="small" style={{ color: "var(--bad)" }}>{problemOf(r)}: {fmtInt(r.records_failed)}</div>}
                    <div className="muted small mono">{r.code}</div>
                  </td>
                  <td>{DIMENSION_LABEL[r.dimension]}</td>
                  <td className="small">
                    {r.dataset_name}
                    {r.column_name && <div className="muted mono">{r.column_name}</div>}
                  </td>
                  <td><SeverityBadge severity={r.severity} /></td>
                  <td className="num">{fmtInt(r.records_evaluated)}</td>
                  <td className="num">{fmtInt(r.records_failed)}</td>
                  <td><ScoreBar value={r.quality_score} threshold={r.expected_threshold} /></td>
                  <td className="num">{fmtPct(r.quality_score)}</td>
                  <td><Delta value={r.delta_score} /></td>
                  <td><Badge kind={r.band} /></td>
                  <td className="small muted nowrap">{fmtDateTime(r.last_evaluated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
