import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { DIMENSION_LABEL, fmtPct } from "@/lib/format";
import { getDimensions, getRules } from "@/lib/queries";

export const metadata = { title: "Métricas e regras" };

export default async function DocsPage() {
  const [dims, rules] = await Promise.all([getDimensions(), getRules()]);
  return (
    <>
      <PageHeader eyebrow="Documentação" title="Métricas, regras e critérios" description="Como cada número do Hub é calculado. Tudo aqui é lido do banco: pesos, regras e populações." />

      <Card title="Princípios">
        <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>A interface não decide se o dado é confiável: ela mostra o resultado de regras SQL versionadas em <code>quality.validation_rules</code>, executadas no banco por <code>quality.run_all()</code>.</li>
          <li>Todo indicador tem denominador explícito (população da regra), data e execução de origem.</li>
          <li>O histórico nunca é sobrescrito: cada execução grava novos resultados com <code>run_id</code>.</li>
          <li><strong>Ocorrências ≠ registros únicos:</strong> um registro pode falhar em várias regras.</li>
          <li>Ausência de avaliação não é 100%: aparece como “Validação não executada” ou “Dados insuficientes”.</li>
          <li>As tabelas bronze, silver e gold não são alteradas. O Hub vive nos schemas <code>governance</code>, <code>control</code>, <code>quality</code>, <code>observability</code>, <code>provenance</code> e <code>hub</code>.</li>
        </ul>
      </Card>

      <Card className="mt" title="Índice de qualidade" subtitle="Ponderado e documentado (não é uma média simples)">
        <div id="indice" />
        <pre className="code">{`score(dataset, dimensão) = 100 × Σ aprovados / Σ avaliados        (todas as regras da dimensão naquele dataset)
score(dataset)           = Σ score(ds, dim) × peso(dim) / Σ peso(dim)    (só dimensões avaliadas)
peso(dataset)            = criticidade(1–5) × log10(volume + 10)          (tabela grande e crítica pesa mais, sem dominar)
score(dimensão)          = Σ score(ds, dim) × peso(ds) / Σ peso(ds)
índice geral             = Σ score(ds) × peso(ds) / Σ peso(ds)

Combinações (dataset × dimensão) com menos de 20 registros avaliados → "Dados insuficientes" e ficam fora da agregação.
Faixas: Alta ≥ 95% · Intermediária 80–95% · Baixa < 80%.`}</pre>
        <table className="t t-compact" style={{ marginTop: 12 }}>
          <thead><tr><th>Dimensão</th><th>Definição</th><th className="num">Peso</th></tr></thead>
          <tbody>
            {dims.map((d) => (
              <tr key={d.code}><td><strong>{d.name}</strong></td><td className="small">{d.description}</td><td className="num">{d.weight}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="mt" title="Atribuição de departamento">
        <ol className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Override manual em <code>governance.user_department_override</code>, se existir.</li>
          <li>Equipe do RD (<code>bronze.teams.user_ids</code>) do dono do registro (<code>owner_id</code>). Usuário em mais de uma equipe: a de menor prioridade (Vendas 10, Áudio e Vídeo 20, Backoffice 50, Marketing 60).</li>
          <li>Contatos herdam o dono da empresa; tarefas herdam o dono do negócio.</li>
          <li>Sem dono ou sem equipe → <strong>Não identificado</strong>. A origem do registro nunca define o departamento sozinha.</li>
        </ol>
      </Card>

      <Card className="mt" title={`Catálogo de regras (${rules.length})`}>
        <div className="table-wrap">
          <table className="t t-compact">
            <thead><tr><th>Código</th><th>Regra</th><th>Dimensão</th><th>População (denominador)</th><th className="num">Meta</th><th>Versão</th></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.code}>
                  <td className="mono small"><Link href={`/quality/rules/${r.code}`}>{r.code}</Link></td>
                  <td>{r.name}<div className="small muted">{r.description}</div></td>
                  <td>{DIMENSION_LABEL[r.dimension]}</td>
                  <td className="small">{r.population}</td>
                  <td className="num">{fmtPct(r.expected_threshold, 0)}</td>
                  <td className="small">v{r.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt" title="Atualidade e pipelines">
        <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Atualidade = <code>now() − última atualização</code> do dataset (<code>provenance.dataset_registry.freshness_expr</code>) comparada ao SLA (<code>expected_interval</code>): até 1× SLA “ok”, até 2× “atrasado”, acima “crítico”.</li>
          <li>Os SLAs iniciais são estimativas e precisam ser validados com os responsáveis.</li>
          <li>ETL principal: enquanto não houver log no banco, as execuções são <strong>inferidas</strong> pelos dias com snapshot gravado. Instrumentar com <code>integrations/dq_hub_logger.py</code>.</li>
          <li>ETL pré-vendas: <code>privado.etl_sync_log</code>. Edge Function rd-sync: último estado em <code>privado.rd_sync_state</code>.</li>
        </ul>
      </Card>
    </>
  );
}
