import Link from "next/link";
import { Download, KeyRound, Link2, ListTree, Lock, Search } from "lucide-react";
import { Badge, Card, EmptyState, Kpi, PageHeader, Provenance } from "@/components/ui";
import { fmtBytes, fmtDateTime, fmtInt, fmtPct } from "@/lib/format";
import {
  getCatalogColumns, getCatalogFunctions, getCatalogObjects, getLineageEdges, getRules, searchColumns,
} from "@/lib/queries";

export const metadata = { title: "Catálogo do banco" };

const SCHEMA_ORDER = ["bronze", "silver", "gold", "privado", "public", "hub", "quality", "observability", "control", "provenance", "governance"];
const TYPE_SHORT: Record<string, string> = { tabela: "T", view: "V", "view materializada": "MV", "tabela particionada": "TP", "tabela externa": "TE" };

type SP = { schema?: string; tipo?: string; q?: string; obj?: string; tab?: string; coluna?: string; view?: string; hub?: string };

function href(sp: SP, patch: Partial<SP>) {
  const p = new URLSearchParams();
  const merged = { ...sp, ...patch };
  Object.entries(merged).forEach(([k, v]) => v && p.set(k, v));
  return `/catalog?${p.toString()}`;
}

export default async function CatalogPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const showHub = sp.hub === "1";
  const [all, columns, edges, rules, colHits, functions] = await Promise.all([
    getCatalogObjects(),
    sp.obj ? getCatalogColumns(sp.obj) : Promise.resolve([]),
    sp.obj ? getLineageEdges() : Promise.resolve([]),
    sp.obj ? getRules() : Promise.resolve([]),
    sp.coluna ? searchColumns(sp.coluna) : Promise.resolve([]),
    sp.view === "funcoes" ? getCatalogFunctions() : Promise.resolve([]),
  ]);
  const visible = all.filter((o) => showHub || !o.is_hub_object || o.full_name === sp.obj);
  const objects = visible.filter(
    (o) =>
      (!sp.schema || o.schema_name === sp.schema) &&
      (!sp.tipo || o.object_type === sp.tipo) &&
      (!sp.q || o.full_name.toLowerCase().includes(sp.q.toLowerCase()) || (o.comment ?? "").toLowerCase().includes(sp.q.toLowerCase())),
  );
  const schemas = SCHEMA_ORDER.filter((s) => visible.some((o) => o.schema_name === s));
  const types = [...new Set(visible.map((o) => o.object_type))];

  const selected = sp.obj ? all.find((o) => o.full_name === sp.obj) ?? null : null;
  const tab = sp.tab ?? "colunas";

  const totals = {
    tabelas: visible.filter((o) => o.object_type.startsWith("tabela")).length,
    views: visible.filter((o) => o.object_type === "view").length,
    mvs: visible.filter((o) => o.object_type === "view materializada").length,
    colunas: visible.reduce((a, o) => a + o.column_count, 0),
    bytes: visible.reduce((a, o) => a + (o.total_bytes ?? 0), 0),
    semRls: visible.filter((o) => o.object_type.startsWith("tabela") && !o.rls_enabled).length,
  };

  return (
    <>
      <PageHeader
        eyebrow="Referência"
        title="Catálogo do banco"
        description="Todas as tabelas, views e views materializadas do Supabase, lidas ao vivo do catálogo do PostgreSQL: colunas, tipos, nulidade, chaves, índices, estatísticas, definição e dependências."
        actions={
          <>
            <Link className={`btn ${sp.view === "funcoes" ? "btn-primary" : ""}`} href={sp.view === "funcoes" ? "/catalog" : "/catalog?view=funcoes"}>
              <ListTree size={14} /> {sp.view === "funcoes" ? "Ver objetos" : "Ver funções"}
            </Link>
            <a className="btn" href="/api/export/catalog">
              <Download size={14} /> Exportar dicionário (CSV)
            </a>
          </>
        }
      />

      <div className="grid g-6">
        <Kpi tone="brand" label="Tabelas" value={fmtInt(totals.tabelas)} hint={`${totals.semRls} sem RLS`} />
        <Kpi label="Views" value={fmtInt(totals.views)} />
        <Kpi label="Views materializadas" value={fmtInt(totals.mvs)} />
        <Kpi label="Colunas" value={fmtInt(totals.colunas)} />
        <Kpi label="Tamanho em disco" value={fmtBytes(totals.bytes)} hint="tabelas + índices + TOAST" />
        <Kpi label="Schemas" value={fmtInt(schemas.length)} hint={showHub ? "incluindo os do Hub" : "dados corporativos"} />
      </div>

      {sp.view === "funcoes" ? (
        <Card className="mt" title={`Funções (${functions.length})`} subtitle="Assinatura, retorno e modo de segurança (definer executa com o dono)">
          <div className="table-wrap">
            <table className="t t-compact">
              <thead>
                <tr><th>Schema</th><th>Função</th><th>Argumentos</th><th>Retorno</th><th>Segurança</th><th>Linguagem</th></tr>
              </thead>
              <tbody>
                {functions.filter((f) => showHub || !["hub", "quality", "governance", "observability", "control", "provenance"].includes(f.schema_name)).map((f) => (
                  <tr key={f.schema_name + f.function_name + f.arguments}>
                    <td>{f.schema_name}</td>
                    <td className="mono">{f.function_name}</td>
                    <td className="mono small">{f.arguments || "—"}</td>
                    <td className="mono small">{f.result_type}</td>
                    <td>{f.security === "definer" ? <Badge kind="atrasado">definer</Badge> : <span className="muted small">invoker</span>}</td>
                    <td className="small">{f.language}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="split mt">
          {/* -------- Lista de objetos -------- */}
          <section className="card" style={{ padding: 0 }}>
            <div style={{ padding: 12, borderBottom: "1px solid var(--border)" }}>
              <form action="/catalog" className="filter" style={{ flexDirection: "row", gap: 6 }}>
                {sp.schema && <input type="hidden" name="schema" value={sp.schema} />}
                {sp.tipo && <input type="hidden" name="tipo" value={sp.tipo} />}
                {showHub && <input type="hidden" name="hub" value="1" />}
                <input name="q" defaultValue={sp.q ?? ""} placeholder="Buscar objeto…" style={{ flex: 1, minWidth: 0 }} />
                <button className="btn" aria-label="Buscar"><Search size={14} /></button>
              </form>
              <div className="pill-row" style={{ marginTop: 8 }}>
                <Link className={`pill ${!sp.schema ? "active" : ""}`} href={href(sp, { schema: undefined, obj: undefined })}>todos</Link>
                {schemas.map((s) => (
                  <Link key={s} className={`pill ${sp.schema === s ? "active" : ""}`} href={href(sp, { schema: s, obj: undefined })}>
                    {s} <span className="muted">{visible.filter((o) => o.schema_name === s).length}</span>
                  </Link>
                ))}
              </div>
              <div className="pill-row" style={{ marginTop: 6 }}>
                <Link className={`pill ${!sp.tipo ? "active" : ""}`} href={href(sp, { tipo: undefined })}>todos os tipos</Link>
                {types.map((t) => (
                  <Link key={t} className={`pill ${sp.tipo === t ? "active" : ""}`} href={href(sp, { tipo: t })}>{t}</Link>
                ))}
                <Link className={`pill ${showHub ? "active" : ""}`} href={href(sp, { hub: showHub ? undefined : "1" })}>objetos do Hub</Link>
              </div>
            </div>
            <div className="list-scroll">
              {objects.length === 0 && <div style={{ padding: 12 }}><EmptyState title="Nenhum objeto encontrado" /></div>}
              {objects.map((o) => (
                <Link key={o.full_name} href={href(sp, { obj: o.full_name, tab: undefined })} className={`obj-item ${sp.obj === o.full_name ? "active" : ""}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span>
                      <span className="badge badge-muted" style={{ marginRight: 6 }}>{TYPE_SHORT[o.object_type] ?? "?"}</span>
                      <span className="muted">{o.schema_name}.</span>
                      <strong>{o.object_name}</strong>
                    </span>
                    {o.contains_personal_data && <span title="Contém dados pessoais"><Lock size={13} color="#b45309" /></span>}
                  </div>
                  <div className="meta">
                    {o.column_count} colunas
                    {o.estimated_rows != null && ` · ~${fmtInt(o.exact_rows ?? o.estimated_rows)} linhas`}
                    {o.total_bytes != null && ` · ${fmtBytes(o.total_bytes)}`}
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {/* -------- Detalhe -------- */}
          <div className="stack">
            {!selected ? (
              <>
                <Card title="Buscar coluna em todo o banco" subtitle="Encontre onde um campo aparece (ex.: cnpj, owner_id, created_at)">
                  <form action="/catalog" className="filter" style={{ flexDirection: "row", gap: 6 }}>
                    <input name="coluna" defaultValue={sp.coluna ?? ""} placeholder="nome da coluna" />
                    <button className="btn btn-primary">Buscar</button>
                  </form>
                  {sp.coluna && (
                    <div className="table-wrap" style={{ marginTop: 12 }}>
                      {colHits.length === 0 ? (
                        <EmptyState title="Nenhuma coluna encontrada" />
                      ) : (
                        <table className="t t-compact">
                          <thead>
                            <tr><th>Objeto</th><th>Coluna</th><th>Tipo</th><th>Nulo</th><th>Chave</th></tr>
                          </thead>
                          <tbody>
                            {colHits.map((c) => (
                              <tr key={c.full_name + c.column_name}>
                                <td><Link href={href({}, { obj: c.full_name })}>{c.full_name}</Link></td>
                                <td className="mono">{c.column_name}</td>
                                <td className="mono small">{c.data_type}</td>
                                <td>{c.is_nullable ? "sim" : <strong>não</strong>}</td>
                                <td className="small">{c.is_primary_key ? "PK" : c.foreign_key_ref ? `FK → ${c.foreign_key_ref}` : ""}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </Card>
                <Card title={`Objetos (${objects.length})`} subtitle="Selecione um objeto à esquerda para ver colunas, tipos e definição">
                  <div className="table-wrap">
                    <table className="t t-compact">
                      <thead>
                        <tr><th>Objeto</th><th>Tipo</th><th className="num">Linhas</th><th className="num">Tamanho</th><th className="num">Colunas</th><th>RLS</th><th>Descrição</th></tr>
                      </thead>
                      <tbody>
                        {objects.map((o) => (
                          <tr key={o.full_name}>
                            <td><Link href={href(sp, { obj: o.full_name })}>{o.full_name}</Link></td>
                            <td className="small">{o.object_type}</td>
                            <td className="num">{o.estimated_rows != null ? fmtInt(o.exact_rows ?? o.estimated_rows) : "—"}</td>
                            <td className="num">{fmtBytes(o.total_bytes)}</td>
                            <td className="num">{o.column_count}</td>
                            <td>{o.object_type.startsWith("tabela") ? (o.rls_enabled ? <Badge kind="ok">ativo</Badge> : <Badge kind="critico">inativo</Badge>) : <span className="muted">—</span>}</td>
                            <td className="small muted" style={{ maxWidth: 320 }}>{o.registry_description ?? o.comment ?? ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            ) : (
              <ObjectDetail sp={sp} selected={selected} columns={columns} edges={edges} rules={rules} tab={tab} />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function ObjectDetail({
  sp, selected, columns, edges, rules, tab,
}: {
  sp: SP;
  selected: Awaited<ReturnType<typeof getCatalogObjects>>[number];
  columns: Awaited<ReturnType<typeof getCatalogColumns>>;
  edges: Awaited<ReturnType<typeof getLineageEdges>>;
  rules: Awaited<ReturnType<typeof getRules>>;
  tab: string;
}) {
  const upstream = edges.filter((e) => e.destination_dataset === selected.full_name);
  const downstream = edges.filter((e) => e.source_dataset === selected.full_name);
  const objRules = rules.filter((r) => r.dataset_name === selected.full_name);
  const tabs = [
    { key: "colunas", label: `Colunas (${columns.length})` },
    ...(selected.definition ? [{ key: "definicao", label: "Definição SQL" }] : []),
    { key: "dependencias", label: `Dependências (${upstream.length + downstream.length})` },
    { key: "qualidade", label: `Regras de qualidade (${objRules.length})` },
  ];

  return (
    <>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <div>
            <div className="eyebrow">{selected.object_type}</div>
            <h2 style={{ fontSize: 19 }}>
              <span className="muted">{selected.schema_name}.</span>
              {selected.object_name}
            </h2>
            {(selected.registry_description || selected.comment) && <p className="page-desc">{selected.registry_description ?? selected.comment}</p>}
          </div>
          <div className="pill-row">
            {selected.contains_personal_data && <Badge kind="atrasado"><Lock size={11} /> dados pessoais</Badge>}
            {selected.object_type.startsWith("tabela") && (selected.rls_enabled ? <Badge kind="ok">RLS ativo · {selected.policy_count} políticas</Badge> : <Badge kind="critico">RLS inativo</Badge>)}
            {selected.layer && <Badge kind="info">{selected.layer}</Badge>}
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <Provenance
            items={[
              { label: "Linhas", value: selected.exact_rows != null ? `${fmtInt(selected.exact_rows)} (contagem exata)` : selected.estimated_rows != null ? `~${fmtInt(selected.estimated_rows)} (estimativa)` : "—" },
              { label: "Tamanho", value: fmtBytes(selected.total_bytes) },
              { label: "Colunas", value: selected.column_count },
              { label: "Dono", value: selected.owner },
              { label: "Pipeline", value: selected.pipeline_name ?? "—" },
              { label: "Criticidade", value: selected.criticality ? `${selected.criticality} / 5` : "—" },
              { label: "Última atualização dos dados", value: fmtDateTime(selected.last_updated_at) },
              { label: "Estatísticas (ANALYZE)", value: fmtDateTime(selected.last_analyzed_at) },
            ]}
          />
        </div>
      </Card>

      <div className="tabs">
        {tabs.map((t) => (
          <Link key={t.key} href={href(sp, { tab: t.key })} className={tab === t.key ? "active" : ""}>{t.label}</Link>
        ))}
      </div>

      {tab === "colunas" && (
        <Card>
          <div className="table-wrap">
            <table className="t t-compact">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Coluna</th>
                  <th>Tipo de dado</th>
                  <th>Aceita nulo</th>
                  <th>Chaves / índice</th>
                  <th>Padrão</th>
                  <th className="num" title="Estimativa do ANALYZE do PostgreSQL">% nulos*</th>
                  <th className="num" title="Valores distintos (negativo = fração das linhas)">Distintos*</th>
                  <th>Comentário</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((c) => (
                  <tr key={c.column_name}>
                    <td className="num muted">{c.ordinal}</td>
                    <td className="mono"><strong>{c.column_name}</strong></td>
                    <td className="mono small">{c.data_type}</td>
                    <td>{c.is_nullable ? <span className="muted">sim</span> : <strong>não</strong>}</td>
                    <td className="small">
                      <div className="pill-row">
                        {c.is_primary_key && <span className="badge badge-info"><KeyRound size={11} /> PK</span>}
                        {c.is_unique && !c.is_primary_key && <span className="badge badge-muted">único</span>}
                        {c.foreign_key_ref && <span className="badge badge-muted" title={c.foreign_key_ref}><Link2 size={11} /> FK → {c.foreign_key_ref}</span>}
                        {c.is_indexed && !c.is_primary_key && <span className="badge badge-muted">índice</span>}
                      </div>
                    </td>
                    <td className="mono small muted" style={{ maxWidth: 200, wordBreak: "break-all" }}>{c.column_default ?? ""}</td>
                    <td className="num">
                      {c.null_frac != null ? <span style={{ color: c.null_frac > 0.5 ? "var(--bad)" : c.null_frac > 0.1 ? "var(--warn)" : undefined }}>{fmtPct(c.null_frac * 100)}</span> : <span className="muted">—</span>}
                    </td>
                    <td className="num small">{c.n_distinct == null ? "—" : c.n_distinct < 0 ? `${fmtPct(-c.n_distinct * 100, 0)} únicos` : fmtInt(c.n_distinct)}</td>
                    <td className="small muted">{c.comment ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            * Estatísticas amostrais do PostgreSQL (pg_stats), coletadas na última validação. Para views não há estatística.
          </p>
        </Card>
      )}

      {tab === "definicao" && selected.definition && (
        <Card title="Definição SQL" subtitle="pg_get_viewdef — exatamente o que o banco executa">
          <pre className="code">{selected.definition}</pre>
        </Card>
      )}

      {tab === "dependencias" && (
        <div className="grid g-2">
          <Card title={`Origem (${upstream.length})`} subtitle="Objetos que alimentam este">
            {upstream.length === 0 ? <EmptyState title="Sem origem registrada" /> : (
              <ul className="attention-list">
                {upstream.map((e) => (
                  <li key={e.source_dataset + e.edge_type}>
                    <Link href={href({}, { obj: e.source_dataset })}>{e.source_dataset}</Link>
                    <span className="small muted">{e.edge_type}{e.transformation_name ? ` · ${e.transformation_name}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={`Destino (${downstream.length})`} subtitle="Objetos e consumidores que dependem deste">
            {downstream.length === 0 ? <EmptyState title="Nenhum dependente registrado" /> : (
              <ul className="attention-list">
                {downstream.map((e) => (
                  <li key={e.destination_dataset + e.edge_type}>
                    <Link href={href({}, { obj: e.destination_dataset })}>{e.destination_dataset}</Link>
                    <span className="small muted">{e.edge_type}{e.transformation_name ? ` · ${e.transformation_name}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <div className="span-2">
            <Link className="btn" href={`/lineage?ds=${selected.full_name}`}>Abrir na linhagem visual</Link>
          </div>
        </div>
      )}

      {tab === "qualidade" && (
        <Card>
          {objRules.length === 0 ? (
            <EmptyState title="Nenhuma regra de qualidade para este objeto">
              Novas regras são cadastradas em <code>quality.validation_rules</code> (migration versionada), nunca no frontend.
            </EmptyState>
          ) : (
            <table className="t t-compact">
              <thead>
                <tr><th>Regra</th><th>Campo</th><th className="num">Avaliados</th><th className="num">Afetados</th><th className="num">Score</th><th>Situação</th></tr>
              </thead>
              <tbody>
                {objRules.map((r) => (
                  <tr key={r.code}>
                    <td><Link href={`/quality/rules/${r.code}`}>{r.name}</Link></td>
                    <td className="mono small">{r.column_name}</td>
                    <td className="num">{fmtInt(r.records_evaluated)}</td>
                    <td className="num">{fmtInt(r.records_failed)}</td>
                    <td className="num">{fmtPct(r.quality_score)}</td>
                    <td><Badge kind={r.band} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </>
  );
}
