import Link from "next/link";
import { EChart } from "@/components/EChart";
import { FilterBar } from "@/components/FilterBar";
import { PERIOD_OPTIONS } from "@/lib/format";
import { Badge, Card, EmptyState, Kpi, PageHeader, SeverityBadge } from "@/components/ui";
import { C, barScores, heatmap, lineTrend, stackedBars } from "@/lib/charts";
import { byPriority, problemOf } from "@/lib/sort";
import { DIMENSION_LABEL, bandOf, fmtAgo, fmtDateTime, fmtInt, fmtPct } from "@/lib/format";
import {
  getDatasetMetricsLatest, getDepartmentSummary, getDimensions, getExecutionDaily, getLastRun, getPipelines, getRules,
  getScoreTrend, getScoresLatest, getScoresLatestDepartment,
} from "@/lib/queries";

export const metadata = { title: "Overview" };


export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  const sp = await searchParams;
  const days = Number(sp.periodo ?? 90) || 90;
  const [lastRun, scores, trend, rules, depts, deptScores, pipelines, execDaily, datasets, dims] = await Promise.all([
    getLastRun(), getScoresLatest(), getScoreTrend(days), getRules(), getDepartmentSummary(), getScoresLatestDepartment(),
    getPipelines(), getExecutionDaily(30), getDatasetMetricsLatest(), getDimensions(),
  ]);

  if (!lastRun) {
    return (
      <>
        <PageHeader title="Data Health Overview" />
        <EmptyState title="Nenhuma validação executada">
          Execute <code>npm run db:run-quality</code> ou use Settings → “Executar validações agora”. Sem execução, nenhum índice é calculado.
        </EmptyState>
      </>
    );
  }

  const overall = scores.find((s) => s.level === "geral");
  const dimScore = (code: string) => scores.find((s) => s.level === "dimensao" && s.dimension === code);
  const trendOverall = trend.filter((t) => t.level === "geral");
  const days30 = trendOverall.find((t) => t.day <= new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10));
  const deltaOverall = overall?.score != null && days30?.score != null ? overall.score - days30.score : null;

  const totalFailures = rules.reduce((a, r) => a + (r.records_failed ?? 0), 0);
  const totalChecks = rules.reduce((a, r) => a + (r.records_evaluated ?? 0), 0);
  const execRuns = pipelines.reduce((a, p) => a + p.runs_30d, 0);
  const execFails = pipelines.reduce((a, p) => a + p.failures_30d, 0);
  const monitoredDatasets = datasets.filter((d) => !d.error_message);
  const staleDatasets = datasets.filter((d) => d.freshness_status === "atrasado" || d.freshness_status === "critico");
  const lastData = datasets.filter((d) => ["bronze", "silver", "privado"].includes(d.layer ?? "")).map((d) => d.last_updated_at).filter((d): d is Date => !!d).sort((a, b) => new Date(a).getTime() - new Date(b).getTime()).at(-1) ?? null;

  // Série temporal: índice geral + dimensões
  const dayList = [...new Set(trend.map((t) => t.day))].sort();
  const series = [
    { name: "Índice geral", data: dayList.map((d) => trendOverall.find((t) => t.day === d)?.score ?? null), color: C.blue, width: 3 },
    ...dims.map((dm) => ({
      name: dm.name,
      data: dayList.map((d) => trend.find((t) => t.day === d && t.level === "dimensao" && t.dimension === dm.code)?.score ?? null),
      width: 1.5,
    })),
  ];

  // Distribuição dos problemas por dimensão (ocorrências)
  const failByDim = dims.map((dm) => rules.filter((r) => r.dimension === dm.code).reduce((a, r) => a + (r.records_failed ?? 0), 0));

  // Heatmap departamento × dimensão
  const deptList = depts.filter((d) => d.checks_evaluated > 0);
  const hmValues: [number, number, number | null][] = [];
  deptList.forEach((d, y) =>
    dims.forEach((dm, x) => {
      const s = deptScores.find((s) => s.department_id === d.department_id && s.level === "dimensao" && s.dimension === dm.code);
      hmValues.push([x, y, s?.score ?? null]);
    }),
  );

  // Comparação entre datasets
  const dsScores = scores.filter((s) => s.level === "dataset").sort((a, b) => (a.score ?? 0) - (b.score ?? 0));

  // Execuções por dia (todas as pipelines)
  const execDays = [...new Set(execDaily.map((e) => e.day))].sort();
  const sumBy = (day: string, k: "sucesso" | "falha" | "outros") => execDaily.filter((e) => e.day === day).reduce((a, e) => a + e[k], 0);

  // Atenção: regras fora da meta, separadas por ONDE o problema nasce
  const outOfTarget = rules.filter((r) => r.meets_threshold === false || r.last_status === "erro").sort(byPriority);
  const attentionCrm = outOfTarget.filter((r) => r.problem_source === "crm");
  const attentionPipeline = outOfTarget.filter((r) => r.problem_source === "pipeline");
  const sumFailed = (list: typeof rules) => list.reduce((a, r) => a + (r.records_failed ?? 0), 0);
  const badPipelines = pipelines.filter((p) => ["atrasado", "critico", "sem_evidencia"].includes(p.health));

  return (
    <>
      <PageHeader
        eyebrow="Visão executiva"
        title="Data Health Overview"
        description="Confiabilidade e Rastreabilidade dos dados disponíveis"
        actions={
          <Link className="btn btn-accent" href="/reports">
            Gerar relatório
          </Link>
        }
      />
      <FilterBar filters={[{ key: "periodo", label: "Período das séries", type: "select", options: PERIOD_OPTIONS, defaultValue: "90" }]} />

      <div className="grid g-6">
        <Kpi
          tone="brand"
          label="Índice geral de qualidade"
          value={overall?.score != null ? fmtPct(overall.score) : "Dados insuficientes"}
          band={bandOf(overall?.score)}
          delta={deltaOverall}
          hint={overall ? `${fmtInt(overall.records_passed)} de ${fmtInt(overall.records_evaluated)} verificações aprovadas · ${overall.rules_count} regras` : "Sem regras com volume suficiente"}
          href="/docs#indice"
        />
        {dims.map((dm) => {
          const s = dimScore(dm.code);
          return (
            <Kpi
              key={dm.code}
              label={dm.name}
              value={s?.score != null ? fmtPct(s.score) : "—"}
              band={s ? bandOf(s.score, s.records_evaluated) : "validacao_nao_executada"}
              hint={s ? `${fmtInt(s.records_evaluated - s.records_passed)} falhas em ${fmtInt(s.records_evaluated)} verificações` : "Nenhuma regra executada"}
              href={`/quality?dimensao=${dm.code}`}
            />
          );
        })}
      </div>

      <div className="grid g-6" style={{ marginTop: 14 }}>
        <Kpi label="Inconsistências (ocorrências)" value={fmtInt(totalFailures)} hint={`em ${fmtInt(totalChecks)} verificações · um registro pode ter várias`} href="/quality" />
        <Kpi label="Regras abaixo da meta" value={`${rules.filter((r) => r.meets_threshold === false).length} / ${rules.length}`} hint="regras ativas avaliadas" href="/quality" />
        <Kpi label="Pipelines monitorados" value={fmtInt(pipelines.length)} hint={`${pipelines.filter((p) => p.health === "ok").length} saudáveis · ${badPipelines.length} com atenção`} href="/observability" />
        <Kpi label="Taxa de sucesso (30 dias)" value={execRuns ? fmtPct((100 * (execRuns - execFails)) / execRuns) : "—"} hint={`${fmtInt(execRuns - execFails)} de ${fmtInt(execRuns)} execuções`} href="/observability" />
        <Kpi label="Datasets monitorados" value={fmtInt(monitoredDatasets.length)} hint={`${staleDatasets.length} desatualizados fora do SLA`} href="/observability#atualidade" />
        <Kpi label="Última atualização dos dados" value={fmtAgo(lastData)} hint={`${fmtDateTime(lastData)} · validação ${fmtDateTime(lastRun.started_at)}`} />
      </div>

      <div className="grid g-3" style={{ marginTop: 14 }}>
        <div className="span-2">
          {dayList.length > 1 ? (
            <EChart
              title="Evolução da qualidade"
              subtitle="Última validação de cada dia · índice geral e dimensões"
              option={lineTrend({ days: dayList, series, yMin: 0, yMax: 100, unit: "%", markLines: [{ name: "Alta (95%)", value: 95 }, { name: "Intermediária (80%)", value: 80 }] })}
              height={300}
            />
          ) : (
            <Card title="Evolução da qualidade">
              <EmptyState title="Histórico em construção">
                O gráfico aparece a partir de duas avaliações em dias diferentes. A validação diária roda pelo Vercel Cron.
              </EmptyState>
            </Card>
          )}
        </div>
        <EChart
          title="Problemas por dimensão"
          subtitle="Ocorrências na última validação"
          option={barScores({ categories: dims.map((d) => d.name), values: failByDim, horizontal: true, colorByScore: false, color: C.orange, name: "Ocorrências", links: dims.map((d) => `/quality?dimensao=${d.code}`) })}
          links={{}}
          height={300}
        />
      </div>

      <div className="grid g-2" style={{ marginTop: 14 }}>
        <EChart
          title="Qualidade por departamento × dimensão"
          subtitle="Score (%) por departamento responsável · clique na linha em Departamentos para detalhar"
          option={heatmap({ x: dims.map((d) => d.name), y: deptList.map((d) => d.name), values: hmValues })}
          height={Math.max(260, deptList.length * 38 + 90)}
        />
        <EChart
          title="Comparação entre datasets"
          subtitle="Score ponderado das dimensões avaliadas em cada dataset"
          option={barScores({ categories: dsScores.map((d) => d.dataset_name ?? ""), values: dsScores.map((d) => d.score), horizontal: true, max: 100, unit: "%", links: dsScores.map((d) => `/quality?dataset=${d.dataset_name}`) })}
          links={{}}
          height={Math.max(260, dsScores.length * 34 + 60)}
        />
      </div>

      <div className="grid g-3" style={{ marginTop: 14 }}>
        <EChart
          className="span-2"
          title="Histórico de execuções dos pipelines (30 dias)"
          subtitle="Inclui evidências indiretas (snapshot diário) até o ETL principal ser instrumentado"
          option={stackedBars({
            categories: execDays.map((d) => d.slice(8, 10) + "/" + d.slice(5, 7)),
            series: [
              { name: "Sucesso", data: execDays.map((d) => sumBy(d, "sucesso")), color: C.green },
              { name: "Falha", data: execDays.map((d) => sumBy(d, "falha")), color: C.critical },
              { name: "Outros", data: execDays.map((d) => sumBy(d, "outros")), color: C.amber },
            ],
          })}
          height={260}
        />
        <Card title="Pipelines" subtitle="Saúde pelo SLA de atualização">
          <ul className="attention-list">
            {pipelines.map((p) => (
              <li key={p.name}>
                <div>
                  <Link href={`/observability/pipelines/${p.name}`}>{p.display_name}</Link>
                  <div className="muted small">Último sucesso {fmtAgo(p.last_success_at)}</div>
                </div>
                <Badge kind={p.health} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid g-2" style={{ marginTop: 14 }}>
        <Card
          title={`Ação dos departamentos · CRM (${attentionCrm.length})`}
          subtitle={`Cadastro no RD Station · ${fmtInt(sumFailed(attentionCrm))} registros afetados · ordem: severidade, afetados`}
          actions={<Link className="btn" href="/quality?origem=crm">Ver todos</Link>}
        >
          <AttentionTable rules={attentionCrm.slice(0, 8)} />
        </Card>
        <Card
          title={`Ação da Engenharia de Dados · Banco/ETL (${attentionPipeline.length})`}
          subtitle={`Extração, transformação ou carga · ${fmtInt(sumFailed(attentionPipeline))} registros afetados`}
          actions={<Link className="btn" href="/quality?origem=pipeline">Ver todos</Link>}
        >
          <AttentionTable rules={attentionPipeline.slice(0, 8)} />
        </Card>
      </div>

      <div className="grid g-2" style={{ marginTop: 14 }}>
        <Card title="Datasets fora do SLA de atualização" subtitle="Última atualização observada × intervalo esperado">
          {staleDatasets.length === 0 ? (
            <EmptyState title="Todos os datasets com SLA estão em dia" />
          ) : (
            <table className="t">
              <thead>
                <tr>
                  <th>Dataset</th>
                  <th>Última atualização</th>
                  <th>SLA</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {staleDatasets.map((d) => (
                  <tr key={d.dataset_name}>
                    <td><Link href={`/catalog?obj=${d.dataset_name}`}>{d.dataset_name}</Link></td>
                    <td>{fmtDateTime(d.last_updated_at)} <span className="muted">({fmtAgo(d.last_updated_at)})</span></td>
                    <td className="muted">{d.expected_interval}</td>
                    <td><Badge kind={d.freshness_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small" style={{ marginTop: 10 }}>
            SLAs iniciais são estimativas a validar com os responsáveis (Settings → Métricas).
          </p>
        </Card>
      </div>
    </>
  );
}

function AttentionTable({ rules }: { rules: Awaited<ReturnType<typeof getRules>> }) {
  if (rules.length === 0) return <EmptyState title="Nada fora da meta" />;
  return (
    <div className="table-wrap">
      <table className="t">
        <thead>
          <tr>
            <th>Problema</th>
            <th>Sev.</th>
            <th className="num">Afetados</th>
            <th className="num">Conformidade</th>
            <th className="num">Meta</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.code}>
              <td>
                <Link href={`/quality/rules/${r.code}`}>{problemOf(r)}</Link>
                <div className="muted small">{DIMENSION_LABEL[r.dimension]} · {r.dataset_name}{r.column_name ? ` · ${r.column_name}` : ""}</div>
              </td>
              <td><SeverityBadge severity={r.severity} /></td>
              <td className="num">{fmtInt(r.records_failed)} <span className="muted">/ {fmtInt(r.records_evaluated)}</span></td>
              <td className="num">{r.last_status === "erro" ? <Badge kind="erro" /> : fmtPct(r.quality_score)}</td>
              <td className="num muted">{fmtPct(r.expected_threshold, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
