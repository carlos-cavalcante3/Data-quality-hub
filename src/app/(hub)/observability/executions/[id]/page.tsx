import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, EmptyState, PageHeader, Provenance } from "@/components/ui";
import { DIMENSION_LABEL, STATUS_LABEL, fmtDateTime, fmtDuration, fmtInt, fmtPct } from "@/lib/format";
import { getExecution, getRunResults } from "@/lib/queries";

export default async function ExecutionPage({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const e = await getExecution(id);
  if (!e) notFound();
  const dqRun = e.pipeline_name === "dq-hub-validacoes" ? Number(e.execution_id) : null;
  const results = dqRun ? await getRunResults(dqRun) : [];

  return (
    <>
      <PageHeader
        eyebrow="Detalhe da execução"
        title={`${e.pipeline_name} · ${e.execution_id}`}
        description={e.inferred ? "Execução inferida a partir de evidência indireta (não é um log real do pipeline)." : `Fonte: ${e.evidence}`}
      />
      <Card>
        <Provenance
          items={[
            { label: "Pipeline", value: <Link href={`/observability/pipelines/${e.pipeline_name}`}>{e.pipeline_name}</Link> },
            { label: "Identificador", value: <span className="mono">{e.execution_id}</span> },
            { label: "Status", value: <Badge kind={e.status}>{STATUS_LABEL[e.status] ?? e.status}</Badge> },
            { label: "Início", value: fmtDateTime(e.started_at) },
            { label: "Término", value: fmtDateTime(e.finished_at) },
            { label: "Duração", value: fmtDuration(e.duration_s) },
            { label: "Fonte consultada", value: e.source ?? "—" },
            { label: "Extraídos", value: fmtInt(e.records_extracted) },
            { label: "Inseridos", value: fmtInt(e.records_inserted) },
            { label: "Atualizados", value: fmtInt(e.records_updated) },
            { label: "Rejeitados", value: fmtInt(e.records_rejected) },
            { label: "Versão do código", value: e.code_version ?? "—" },
            { label: "Log externo", value: e.run_url ? <a href={e.run_url} target="_blank" rel="noreferrer noopener">abrir</a> : "—" },
          ]}
        />
        {e.error_message && <div className="callout" style={{ marginTop: 12 }}>Erro: {e.error_message}</div>}
      </Card>
      {e.details && (
        <Card className="mt" title="Detalhes / logs relacionados">
          <pre className="code">{JSON.stringify(e.details, null, 2)}</pre>
        </Card>
      )}
      {dqRun && (
        <Card className="mt" title={`Resultados das regras nesta execução (${results.length})`}>
          {results.length === 0 ? (
            <EmptyState title="Sem resultados" />
          ) : (
            <table className="t t-compact">
              <thead>
                <tr><th>Regra</th><th>Dimensão</th><th className="num">Avaliados</th><th className="num">Afetados</th><th className="num">Score</th><th>Status</th></tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.rule_code}>
                    <td><Link href={`/quality/rules/${r.rule_code}`}>{r.rule_name}</Link></td>
                    <td>{DIMENSION_LABEL[r.dimension]}</td>
                    <td className="num">{fmtInt(r.records_evaluated)}</td>
                    <td className="num">{fmtInt(r.records_failed)}</td>
                    <td className="num">{fmtPct(r.quality_score)}</td>
                    <td>{r.status === "erro" ? <Badge kind="erro">{r.error_message}</Badge> : <Badge kind="ok">{r.status}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      <div className="callout callout-info mt">
        Para separar <strong>dado ruim na origem</strong> de <strong>falha de processamento</strong>: compare esta execução com as regras de integridade
        bronze → silver (ex.: <Link href="/quality/rules/BRONZE_SILVER_DEALS">BRONZE_SILVER_DEALS</Link>) e com a atualidade dos datasets no mesmo dia.
        Falha na execução + regra de integridade com perda indica processamento. Execução com sucesso + regra de completude ruim indica origem.
      </div>
    </>
  );
}
