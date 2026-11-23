import Link from "next/link";
import { EChart } from "@/components/EChart";
import { FilterBar } from "@/components/FilterBar";
import { PERIOD_OPTIONS } from "@/lib/format";
import { Badge, Card, EmptyState, Kpi, PageHeader } from "@/components/ui";
import { C, lineVolume, scatterExecutions, stackedBars } from "@/lib/charts";
import { HEALTH_LABEL, STATUS_LABEL, fmtAgo, fmtDateTime, fmtDuration, fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { getDatasetMetricsHistory, getDatasetMetricsLatest, getExecutionDaily, getExecutions, getPipelines, getSchemaChanges } from "@/lib/queries";

export const metadata = { title: "Observability" };

export default async function ObservabilityPage({ searchParams }: { searchParams: Promise<{ periodo?: string; dataset?: string; pipeline?: string }> }) {
  const sp = await searchParams;
  const days = Number(sp.periodo ?? 30) || 30;
  const [pipelines, executions, daily, datasets, schemaChanges] = await Promise.all([
    getPipelines(),
    getExecutions({ days, pipeline: sp.pipeline ?? null, limit: 2000 }),
    getExecutionDaily(days),
    getDatasetMetricsLatest(),
    getSchemaChanges(30),
  ]);
  const volumeDataset = sp.dataset ?? "silver.deals";
  const volume = await getDatasetMetricsHistory(volumeDataset, Math.max(days, 30));

  const runs = executions.length;
  const ok = executions.filter((e) => e.status === "sucesso").length;
  const fail = executions.filter((e) => e.status === "falha").length;
  const running = executions.filter((e) => e.status === "em_andamento").length;
  const durations = executions.map((e) => e.duration_s).filter((d): d is number => d != null);
  const avgDur = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  const stale = datasets.filter((d) => ["atrasado", "critico"].includes(d.freshness_status));
  const volumeAlerts = datasets.filter((d) => d.volume_variation_pct != null && Math.abs(d.volume_variation_pct) >= 20);

  const dayList = [...new Set(daily.map((d) => d.day))].sort();
  const pipelineNames = pipelines.map((p) => p.name);
  const failedRecent = executions.filter((e) => e.status === "falha").slice(0, 15);

  const durationExecs = executions.filter((e) => e.duration_s != null).slice(0, 200).reverse();

  return (
    <>
      <PageHeader
        eyebrow="Data Observability"
        title="Monitoramento da infraestrutura"
        description="Execuções, atualidade, volume e estabilidade dos pipelines e datasets. Diferencia falha de processamento de problema na origem."
      />
      <FilterBar
        filters={[
          { key: "periodo", label: "Período", type: "select", options: PERIOD_OPTIONS, defaultValue: "30" },
          { key: "pipeline", label: "Pipeline", type: "select", allLabel: "Todos", options: pipelines.map((p) => ({ value: p.name, label: p.display_name })) },
        ]}
      />

      <div className="grid g-6">
        <Kpi tone="brand" label="Execuções no período" value={fmtInt(runs)} hint={`${fmtInt(ok)} sucesso · ${fmtInt(fail)} falha · ${running} em andamento`} />
        <Kpi label="Taxa de sucesso" value={runs ? fmtPct((100 * ok) / runs) : "—"} band={runs ? (ok / runs >= 0.95 ? "alta" : ok / runs >= 0.8 ? "intermediaria" : "baixa") : "dados_insuficientes"} hint={`${fmtInt(ok)} de ${fmtInt(runs)}`} />
        <Kpi label="Tempo médio de processamento" value={fmtDuration(avgDur)} hint={`${durations.length} execuções com duração registrada`} />
        <Kpi label="Pipelines com atenção" value={fmtInt(pipelines.filter((p) => p.health !== "ok").length)} hint={`de ${pipelines.length} monitorados`} />
        <Kpi label="Datasets desatualizados" value={fmtInt(stale.length)} hint={`de ${datasets.filter((d) => d.expected_interval).length} com SLA`} />
        <Kpi label="Variação de volume ≥ 20%" value={fmtInt(volumeAlerts.length)} hint="entre as duas últimas coletas" />
      </div>

      <Card title="Pipelines" subtitle="Saúde avaliada pelo último sucesso × intervalo esperado" className="mt">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Pipeline</th>
                <th>Orquestração</th>
                <th>Último sucesso</th>
                <th className="num">Execuções 30d</th>
                <th className="num">Falhas 30d</th>
                <th className="num">Sucesso</th>
                <th className="num">Duração média</th>
                <th>Evidência</th>
                <th>Saúde</th>
              </tr>
            </thead>
            <tbody>
              {pipelines.map((p) => (
                <tr key={p.name}>
                  <td>
                    <Link href={`/observability/pipelines/${p.name}`}>{p.display_name}</Link>
                    <div className="muted small mono">{p.name}</div>
                  </td>
                  <td className="small">{p.orchestrator}<div className="muted">{p.schedule_desc}</div></td>
                  <td className="small nowrap">{fmtDateTime(p.last_success_at)}<div className="muted">{fmtAgo(p.last_success_at)} · SLA {p.expected_interval ?? "—"}</div></td>
                  <td className="num">{fmtInt(p.runs_30d)}</td>
                  <td className="num">{fmtInt(p.failures_30d)}</td>
                  <td className="num">{fmtPct(p.success_rate_30d)}</td>
                  <td className="num">{fmtDuration(p.avg_duration_s)}</td>
                  <td className="small muted" style={{ maxWidth: 260 }}>{p.evidence_source}{p.has_inferred && <div><Badge kind="atrasado">inferida</Badge></div>}</td>
                  <td><Badge kind={p.health}>{HEALTH_LABEL[p.health]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid g-2 mt">
        <EChart
          title="Linha temporal de execuções"
          subtitle="Cada ponto é uma execução · clique para ver o detalhe"
          option={scatterExecutions({
            pipelines: pipelineNames,
            points: executions.map((e) => ({ t: new Date(e.started_at).getTime(), pipeline: e.pipeline_name, status: e.status, duration: e.duration_s, link: `/observability/executions/${encodeURIComponent(e.id)}` })),
          })}
          links={{}}
          height={280}
        />
        <EChart
          title="Taxa de sucesso por dia"
          subtitle="Execuções por status"
          option={stackedBars({
            categories: dayList.map((d) => d.slice(8, 10) + "/" + d.slice(5, 7)),
            series: [
              { name: "Sucesso", data: dayList.map((d) => daily.filter((x) => x.day === d && (!sp.pipeline || x.pipeline_name === sp.pipeline)).reduce((a, x) => a + x.sucesso, 0)), color: C.green },
              { name: "Falha", data: dayList.map((d) => daily.filter((x) => x.day === d && (!sp.pipeline || x.pipeline_name === sp.pipeline)).reduce((a, x) => a + x.falha, 0)), color: C.critical },
              { name: "Outros", data: dayList.map((d) => daily.filter((x) => x.day === d && (!sp.pipeline || x.pipeline_name === sp.pipeline)).reduce((a, x) => a + x.outros, 0)), color: C.amber },
            ],
          })}
          height={280}
        />
      </div>

      <div className="grid g-2 mt">
        {durationExecs.length > 1 ? (
          <EChart
            title="Duração das execuções"
            subtitle="Somente execuções com início e fim registrados"
            option={{
              grid: { left: 48, right: 24, top: 36, bottom: 32, containLabel: true },
              tooltip: { trigger: "item" },
              legend: { top: 0 },
              xAxis: { type: "time" },
              yAxis: { type: "value", name: "segundos" },
              series: [...new Set(durationExecs.map((e) => e.pipeline_name))].map((p) => ({
                name: p,
                type: "line",
                symbolSize: 5,
                data: durationExecs.filter((e) => e.pipeline_name === p).map((e) => [new Date(e.started_at).getTime(), Number(e.duration_s?.toFixed(1))]),
              })),
            }}
            height={260}
          />
        ) : (
          <Card title="Duração das execuções">
            <EmptyState title="Sem durações registradas">
              Os logs atuais do ETL não registram início e fim. Instrumente o pipeline com <code>integrations/dq_hub_logger.py</code> para gravar em <code>control.pipeline_executions</code>.
            </EmptyState>
          </Card>
        )}
        <div id="volume">
          <EChart
            title={`Volume ao longo do tempo · ${volumeDataset}`}
            subtitle="Quantidade de linhas por coleta diária (troque o dataset na tabela de atualidade)"
            option={lineVolume({ days: volume.map((v) => v.day), values: volume.map((v) => v.row_count), name: "Linhas" })}
            height={260}
          />
        </div>
      </div>

      <Card title="Atualidade e volume dos datasets" subtitle="Coleta da última validação · SLA inicial a validar com os responsáveis" className="mt">
        <div id="atualidade" className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Dataset</th>
                <th>Camada</th>
                <th className="num">Linhas</th>
                <th className="num">Variação</th>
                <th>Última atualização</th>
                <th>SLA</th>
                <th>Atualidade</th>
                <th>Pipeline</th>
              </tr>
            </thead>
            <tbody>
              {datasets.map((d) => (
                <tr key={d.dataset_name}>
                  <td>
                    <Link href={`/observability?${new URLSearchParams({ ...(sp.periodo ? { periodo: sp.periodo } : {}), dataset: d.dataset_name }).toString()}#volume`}>{d.dataset_name}</Link>
                  </td>
                  <td className="small">{d.layer}</td>
                  <td className="num">{fmtInt(d.row_count)}</td>
                  <td className="num">
                    {d.volume_variation_pct == null ? <span className="muted">—</span> : <span style={{ color: Math.abs(d.volume_variation_pct) >= 20 ? "var(--bad)" : undefined }}>{d.volume_variation_pct > 0 ? "+" : ""}{fmtNum(d.volume_variation_pct)}%</span>}
                  </td>
                  <td className="small nowrap">{fmtDateTime(d.last_updated_at)} <span className="muted">{fmtAgo(d.last_updated_at)}</span></td>
                  <td className="small muted">{d.expected_interval ?? "sem SLA"}</td>
                  <td><Badge kind={d.freshness_status} /></td>
                  <td className="small muted">{d.pipeline_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid g-2 mt">
        <Card title="Falhas recentes" subtitle="Execuções com status de falha no período">
          {failedRecent.length === 0 ? (
            <EmptyState title="Nenhuma falha no período" />
          ) : (
            <table className="t t-compact">
              <thead>
                <tr><th>Quando</th><th>Pipeline</th><th>Erro</th></tr>
              </thead>
              <tbody>
                {failedRecent.map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap small"><Link href={`/observability/executions/${encodeURIComponent(e.id)}`}>{fmtDateTime(e.started_at)}</Link></td>
                    <td className="small">{e.pipeline_name}{e.inferred && <div className="muted">inferida</div>}</td>
                    <td className="small">{e.error_message ?? STATUS_LABEL[e.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Mudanças de esquema detectadas" subtitle="Comparação da estrutura das tabelas entre validações (a primeira coleta é a linha de base)">
          {schemaChanges.length === 0 ? (
            <EmptyState title="Nenhuma mudança de esquema desde a linha de base" />
          ) : (
            <table className="t t-compact">
              <thead>
                <tr><th>Quando</th><th>Dataset</th><th>Alteração</th></tr>
              </thead>
              <tbody>
                {schemaChanges.map((c) => {
                  const prev = new Map(c.previous_columns.map((x) => [x.name, x]));
                  const cur = new Map(c.columns.map((x) => [x.name, x]));
                  const added = c.columns.filter((x) => !prev.has(x.name)).map((x) => `+ ${x.name}`);
                  const removed = c.previous_columns.filter((x) => !cur.has(x.name)).map((x) => `− ${x.name}`);
                  const changed = c.columns.filter((x) => prev.has(x.name) && (prev.get(x.name)!.type !== x.type || prev.get(x.name)!.not_null !== x.not_null)).map((x) => `~ ${x.name}: ${prev.get(x.name)!.type} → ${x.type}`);
                  return (
                    <tr key={c.dataset_name + c.captured_at}>
                      <td className="small nowrap">{fmtDateTime(c.captured_at)}</td>
                      <td className="small"><Link href={`/catalog?obj=${c.dataset_name}`}>{c.dataset_name}</Link></td>
                      <td className="small mono">{[...added, ...removed, ...changed].join(", ") || "ordem/atributos"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
