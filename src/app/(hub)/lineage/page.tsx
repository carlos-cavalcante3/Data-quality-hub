import Link from "next/link";
import { EChart } from "@/components/EChart";
import { FilterBar } from "@/components/FilterBar";
import { Badge, Card, EmptyState, PageHeader, Provenance } from "@/components/ui";
import { fmtAgo, fmtDateTime, fmtInt } from "@/lib/format";
import { getCatalogObject, getDatasetMetricsLatest, getDatasetRegistry, getLineageEdges, getRules, getTransformations } from "@/lib/queries";

export const metadata = { title: "Data Lineage" };

const LAYER_COLOR: Record<string, string> = {
  origem: "#64748b", rd: "#64748b", bronze: "#b45309", silver: "#64748b", gold: "#ca8a04", privado: "#7c3aed",
  public: "#0891b2", painel: "#0b4a8b", n8n: "#be185d", consumo: "#0b4a8b", hub: "#15803d",
};
function layerOf(name: string) {
  return name.split(".")[0];
}

export default async function LineagePage({ searchParams }: { searchParams: Promise<{ ds?: string; prof?: string }> }) {
  const sp = await searchParams;
  const depth = Math.min(6, Math.max(1, Number(sp.prof ?? 3) || 3));
  const [edges, registry, transformations, metrics, rules] = await Promise.all([
    getLineageEdges(), getDatasetRegistry(), getTransformations(), getDatasetMetricsLatest(), getRules(),
  ]);
  const nodesAll = [...new Set(edges.flatMap((e) => [e.source_dataset, e.destination_dataset]))].sort();
  const ds = sp.ds && nodesAll.includes(sp.ds) ? sp.ds : "silver.deals";

  // BFS para cima (origem) e para baixo (destino)
  const level = new Map<string, number>([[ds, 0]]);
  let frontier = [ds];
  for (let d = 1; d <= depth; d++) {
    const next: string[] = [];
    for (const n of frontier) for (const e of edges.filter((e) => e.destination_dataset === n)) if (!level.has(e.source_dataset)) { level.set(e.source_dataset, -d); next.push(e.source_dataset); }
    frontier = next;
  }
  frontier = [ds];
  for (let d = 1; d <= depth; d++) {
    const next: string[] = [];
    for (const n of frontier) for (const e of edges.filter((e) => e.source_dataset === n)) if (!level.has(e.destination_dataset)) { level.set(e.destination_dataset, d); next.push(e.destination_dataset); }
    frontier = next;
  }
  const byLevel = new Map<number, string[]>();
  for (const [n, l] of level) byLevel.set(l, [...(byLevel.get(l) ?? []), n].sort());
  const maxRows = Math.max(...[...byLevel.values()].map((v) => v.length));
  const nodes = [...level.entries()].map(([name, l]) => {
    const col = byLevel.get(l)!;
    const idx = col.indexOf(name);
    return {
      name,
      x: l * 300,
      y: (idx - (col.length - 1) / 2) * 56,
      symbol: "roundRect",
      symbolSize: [Math.min(250, name.length * 7 + 24), 30],
      itemStyle: { color: name === ds ? "#f07c1b" : "#ffffff", borderColor: LAYER_COLOR[layerOf(name)] ?? "#94a3b8", borderWidth: 2 },
      label: { show: true, color: name === ds ? "#ffffff" : "#0f172a", fontSize: 11, fontWeight: name === ds ? "bold" : "normal" },
      link: `/lineage?ds=${encodeURIComponent(name)}${sp.prof ? `&prof=${sp.prof}` : ""}`,
    };
  });
  const links = edges
    .filter((e) => level.has(e.source_dataset) && level.has(e.destination_dataset))
    .map((e) => ({
      source: e.source_dataset,
      target: e.destination_dataset,
      lineStyle: { color: e.edge_type === "dependencia_sql" ? "#94a3b8" : e.edge_type === "consumo" ? "#0b4a8b" : "#f07c1b", width: 1.5, curveness: 0.15, type: e.edge_type === "consumo" ? "dashed" : "solid" },
      label: { show: false, formatter: e.transformation_name ?? e.edge_type },
    }));

  const option = {
    tooltip: { formatter: "{b}" },
    series: [
      {
        type: "graph",
        layout: "none",
        roam: true,
        edgeSymbol: ["none", "arrow"],
        edgeSymbolSize: 7,
        emphasis: { focus: "adjacency", label: { show: true } },
        data: nodes,
        links,
      },
    ],
  };

  const reg = registry.find((r) => r.dataset_name === ds);
  const obj = ds.includes(".") ? await getCatalogObject(ds) : null;
  const met = metrics.find((m) => m.dataset_name === ds);
  const upstreamEdges = edges.filter((e) => e.destination_dataset === ds);
  const downstreamEdges = edges.filter((e) => e.source_dataset === ds);
  const transf = transformations.filter((t) => upstreamEdges.some((e) => e.transformation_name === t.name));
  const dsRules = rules.filter((r) => r.dataset_name === ds);
  // Origens primárias (tabelas sem origem no grafo completo) que alimentam o dataset
  const roots = [...level.entries()].filter(([n, l]) => l < 0 && !edges.some((e) => e.destination_dataset === n)).map(([n]) => n);

  return (
    <>
      <PageHeader
        eyebrow="Data Lineage & Provenance"
        title="Rastreabilidade"
        description="De onde vêm os dados e como chegam aos indicadores. Combina a linhagem declarada (ETL, funções, consumidores) com as dependências reais entre views e materializadas lidas do PostgreSQL."
      />
      <FilterBar
        filters={[
          { key: "ds", label: "Dataset / indicador", type: "select", options: nodesAll.map((n) => ({ value: n, label: n })), defaultValue: ds },
          { key: "prof", label: "Profundidade", type: "select", options: ["1", "2", "3", "4", "6"].map((v) => ({ value: v, label: `${v} nível(is)` })), defaultValue: "3" },
        ]}
      />
      <EChart
        title={`Linhagem de ${ds}`}
        subtitle="Laranja: ETL/funções · Cinza: dependência SQL · Azul tracejado: consumidores · clique em um nó para recentrar · arraste/zoom"
        option={option}
        links={{}}
        height={Math.max(360, maxRows * 60 + 80)}
      />

      <div className="grid g-2 mt">
        <Card title="Proveniência do dataset">
          <Provenance
            items={[
              { label: "Camada", value: reg?.layer ?? layerOf(ds) },
              { label: "Sistema de origem", value: reg?.source_system ?? "—" },
              { label: "Dataset de origem", value: reg?.source_dataset ?? "—" },
              { label: "Pipeline responsável", value: reg?.pipeline_name ? <Link href={`/observability/pipelines/${reg.pipeline_name}`}>{reg.pipeline_name}</Link> : "—" },
              { label: "Frequência", value: reg?.update_frequency ?? "—" },
              { label: "Última atualização", value: met?.last_updated_at ? `${fmtDateTime(met.last_updated_at)} (${fmtAgo(met.last_updated_at)})` : "—" },
              { label: "Linhas", value: fmtInt(met?.row_count ?? obj?.estimated_rows ?? null) },
              { label: "Origens primárias", value: roots.length ? roots.join(", ") : "—" },
            ]}
          />
          {reg?.description && <p className="small" style={{ marginTop: 10 }}>{reg.description}</p>}
          {obj && <Link className="btn" style={{ marginTop: 10 }} href={`/catalog?obj=${ds}`}>Ver colunas no catálogo</Link>}
        </Card>
        <Card title="Transformações aplicadas" subtitle="Na entrada deste dataset">
          {transf.length === 0 && upstreamEdges.every((e) => e.edge_type === "dependencia_sql") ? (
            upstreamEdges.length ? (
              <p className="small">Este objeto é uma view/materializada: a transformação é a própria definição SQL (aba “Definição SQL” do catálogo).</p>
            ) : (
              <EmptyState title="Sem transformação registrada" />
            )
          ) : (
            <ul className="attention-list">
              {transf.map((t) => (
                <li key={t.name} style={{ display: "block" }}>
                  <strong>{t.name}</strong> <span className="muted small">· {t.implemented_in}</span>
                  <div className="small">{t.description}</div>
                  {t.rule_summary && <div className="small muted">{t.rule_summary}</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid g-3 mt">
        <Card title={`Alimentado por (${upstreamEdges.length})`}>
          <ul className="attention-list">
            {upstreamEdges.map((e) => (
              <li key={e.source_dataset + e.edge_type}><Link href={`/lineage?ds=${e.source_dataset}`}>{e.source_dataset}</Link><Badge kind="info">{e.edge_type}</Badge></li>
            ))}
          </ul>
        </Card>
        <Card title={`Alimenta (${downstreamEdges.length})`}>
          <ul className="attention-list">
            {downstreamEdges.map((e) => (
              <li key={e.destination_dataset + e.edge_type}><Link href={`/lineage?ds=${e.destination_dataset}`}>{e.destination_dataset}</Link><Badge kind="info">{e.edge_type}</Badge></li>
            ))}
          </ul>
        </Card>
        <Card title={`Regras de qualidade (${dsRules.length})`}>
          {dsRules.length === 0 ? <EmptyState title="Sem regras neste dataset" /> : (
            <ul className="attention-list">
              {dsRules.map((r) => (
                <li key={r.code}><Link href={`/quality/rules/${r.code}`}>{r.name}</Link><Badge kind={r.band} /></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <p className="muted small mt">
        Histórico de alterações por registro: hoje disponível para negócios em <Link href="/lineage?ds=gold.deals_historico_mudancas">gold.deals_historico_mudancas</Link> (valor e gestor) e
        trocas de etapa em <Link href="/lineage?ds=silver.deals_historico">silver.deals_historico</Link>. Rastreabilidade em nível de coluna fica para a próxima fase.
      </p>
    </>
  );
}
