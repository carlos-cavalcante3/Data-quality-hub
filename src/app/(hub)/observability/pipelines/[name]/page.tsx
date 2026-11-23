import Link from "next/link";
import { notFound } from "next/navigation";
import { EChart } from "@/components/EChart";
import { Badge, Card, EmptyState, Kpi, PageHeader, Provenance } from "@/components/ui";
import { scatterExecutions } from "@/lib/charts";
import { STATUS_LABEL, fmtAgo, fmtDateTime, fmtDuration, fmtInt, fmtPct } from "@/lib/format";
import { getExecutions, getPipelines } from "@/lib/queries";

export default async function PipelinePage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const pipeline = (await getPipelines()).find((p) => p.name === name);
  if (!pipeline) notFound();
  const execs = await getExecutions({ pipeline: name, days: 120, limit: 1000 });

  return (
    <>
      <PageHeader eyebrow="Pipeline" title={pipeline.display_name} description={pipeline.description} />
      <div className="grid g-4">
        <Kpi tone="brand" label="Saúde" value={<Badge kind={pipeline.health} />} hint={`SLA ${pipeline.expected_interval ?? "—"}`} />
        <Kpi label="Último sucesso" value={fmtAgo(pipeline.last_success_at)} hint={fmtDateTime(pipeline.last_success_at)} />
        <Kpi label="Execuções (30 dias)" value={fmtInt(pipeline.runs_30d)} hint={`${pipeline.failures_30d} falhas · sucesso ${fmtPct(pipeline.success_rate_30d)}`} />
        <Kpi label="Duração média" value={fmtDuration(pipeline.avg_duration_s)} />
      </div>
      <Card className="mt" title="Cadastro">
        <Provenance
          items={[
            { label: "Orquestração", value: pipeline.orchestrator },
            { label: "Agenda", value: pipeline.schedule_desc },
            { label: "Fonte", value: pipeline.source_system },
            { label: "Evidência de execução", value: pipeline.evidence_source },
            { label: "Repositório", value: pipeline.repository ?? "—" },
          ]}
        />
        {pipeline.has_inferred && (
          <div className="callout" style={{ marginTop: 12 }}>
            As execuções deste pipeline são inferidas a partir do snapshot diário, porque o ETL ainda não grava log de execução no banco.
            Instrumente com <code>integrations/dq_hub_logger.py</code> para registrar início, fim, volumes e erros reais.
          </div>
        )}
      </Card>
      <div className="mt">
        <EChart
          title="Histórico de execuções (120 dias)"
          option={scatterExecutions({ pipelines: [name], points: execs.map((e) => ({ t: new Date(e.started_at).getTime(), pipeline: name, status: e.status, duration: e.duration_s, link: `/observability/executions/${encodeURIComponent(e.id)}` })) })}
          links={{}}
          height={180}
        />
      </div>
      <Card className="mt" title={`Execuções (${execs.length})`}>
        {execs.length === 0 ? (
          <EmptyState title="Nenhuma execução registrada" />
        ) : (
          <div className="table-wrap">
            <table className="t t-compact">
              <thead>
                <tr><th>Início</th><th>Identificador</th><th>Status</th><th className="num">Duração</th><th className="num">Inseridos</th><th>Erro</th></tr>
              </thead>
              <tbody>
                {execs.slice(0, 300).map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap"><Link href={`/observability/executions/${encodeURIComponent(e.id)}`}>{fmtDateTime(e.started_at)}</Link></td>
                    <td className="mono small">{e.execution_id}</td>
                    <td><Badge kind={e.status}>{STATUS_LABEL[e.status] ?? e.status}</Badge></td>
                    <td className="num">{fmtDuration(e.duration_s)}</td>
                    <td className="num">{fmtInt(e.records_inserted)}</td>
                    <td className="small">{e.error_message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
