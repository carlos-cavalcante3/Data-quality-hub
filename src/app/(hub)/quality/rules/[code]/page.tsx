import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, FileBarChart2 } from "lucide-react";
import { EChart } from "@/components/EChart";
import { FilterBar } from "@/components/FilterBar";
import { PERIOD_OPTIONS } from "@/lib/format";
import { Badge, Card, Delta, EmptyState, Kpi, PageHeader, Provenance, SeverityBadge } from "@/components/ui";
import { C, barScores, lineTrend } from "@/lib/charts";
import { hasRole, requireUser } from "@/lib/auth";
import { DIMENSION_LABEL, fmtDate, fmtDateTime, fmtInt, fmtPct } from "@/lib/format";
import { getDepartments, getFailures, getRule, getRuleByDepartment, getRuleHistory } from "@/lib/queries";
import { createIssueAction } from "../../../actions";

export default async function RuleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ departamento?: string; periodo?: string; q?: string; page?: string }>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const rule = await getRule(code);
  if (!rule) notFound();

  const dept = sp.departamento ? Number(sp.departamento) : null;
  const days = Number(sp.periodo ?? 90) || 90;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const [history, byDept, failures, depts] = await Promise.all([
    getRuleHistory(code, days, dept),
    getRuleByDepartment(code),
    getFailures({ rule: code, department: dept, search: sp.q, page, pageSize: 50 }),
    getDepartments(),
  ]);
  const current = dept ? byDept.find((d) => d.department_id === dept) : null;
  const evaluated = current ? current.records_evaluated : rule.records_evaluated;
  const failed = current ? current.records_failed : rule.records_failed;
  const passed = current ? current.records_passed : rule.records_passed;
  const score = current ? current.quality_score : rule.quality_score;
  const deptName = dept ? depts.find((d) => d.id === dept)?.name : null;
  const isDatasetRule = rule.entity === "dataset";

  const qs = (extra: Record<string, string | number | null>) => {
    const p = new URLSearchParams();
    if (dept) p.set("departamento", String(dept));
    if (sp.q) p.set("q", sp.q);
    if (sp.periodo) p.set("periodo", sp.periodo);
    Object.entries(extra).forEach(([k, v]) => (v === null ? p.delete(k) : p.set(k, String(v))));
    return p.toString();
  };
  const pages = Math.max(1, Math.ceil(failures.total / failures.pageSize));

  return (
    <>
      <PageHeader
        eyebrow={`Regra ${rule.code} · v${rule.version}`}
        title={rule.name}
        description={rule.description}
        actions={
          <>
            <Link className="btn" href={`/reports/view?regra=${rule.code}${dept ? `&departamento=${dept}` : ""}`}>
              <FileBarChart2 size={14} /> Relatório
            </Link>
            {hasRole(user, "analyst") && (
              <a className="btn" href={`/api/export/failures?regra=${rule.code}${dept ? `&departamento=${dept}` : ""}`}>
                <Download size={14} /> Exportar afetados (CSV)
              </a>
            )}
          </>
        }
      />
      <FilterBar
        filters={[
          { key: "departamento", label: "Departamento", type: "select", allLabel: "Todos (consolidado)", options: depts.map((d) => ({ value: String(d.id), label: d.name })) },
          { key: "periodo", label: "Período do histórico", type: "select", options: PERIOD_OPTIONS, defaultValue: "90" },
        ]}
      />

      <div className="grid g-4">
        <Kpi tone="brand" label={`Score${deptName ? ` · ${deptName}` : ""}`} value={fmtPct(score)} band={rule.last_status === "erro" ? "validacao_nao_executada" : (evaluated ?? 0) < 20 ? "dados_insuficientes" : score != null ? (score >= 95 ? "alta" : score >= 80 ? "intermediaria" : "baixa") : "dados_insuficientes"} hint={`Meta: ${fmtPct(rule.expected_threshold, 0)}`} />
        <Kpi label="Registros avaliados" value={fmtInt(evaluated)} hint={rule.population} />
        <Kpi label="Registros afetados" value={fmtInt(failed)} hint={evaluated ? `${fmtPct((100 * (failed ?? 0)) / evaluated)} de inconsistência` : undefined} />
        <Kpi label="Registros aprovados" value={fmtInt(passed)} footer={!dept ? <div className="kpi-meta"><Delta value={rule.delta_score} /><span className="muted small">vs {fmtDate(rule.previous_day)}</span></div> : undefined} />
      </div>

      <Card title="Origem e regra do indicador" className="mt">
        <Provenance
          items={[
            { label: "Dimensão", value: DIMENSION_LABEL[rule.dimension] },
            { label: "Dataset", value: <Link href={`/catalog?obj=${rule.dataset_name}`}>{rule.dataset_name}</Link> },
            { label: "Campo", value: rule.column_name ?? "—" },
            { label: "Entidade", value: rule.entity },
            { label: "Severidade", value: <SeverityBadge severity={rule.severity} /> },
            { label: "População (denominador)", value: rule.population },
            { label: "Última avaliação", value: fmtDateTime(rule.last_evaluated_at) },
            { label: "Execução", value: rule.last_run_id ? <Link href={`/observability/executions/dq:${rule.last_run_id}`}>#{rule.last_run_id}</Link> : "—" },
            { label: "Situação", value: <Badge kind={rule.band} /> },
          ]}
        />
        {rule.error_message && <div className="callout" style={{ marginTop: 12 }}>Erro na última execução: {rule.error_message}</div>}
        <details style={{ marginTop: 12 }}>
          <summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>Ver definição verificável (SQL da regra)</summary>
          <pre className="code" style={{ marginTop: 8 }}>{rule.check_sql.trim()}</pre>
        </details>
      </Card>

      <div className="grid g-2 mt">
        {history.length > 1 ? (
          <EChart
            title="Evolução histórica"
            subtitle={deptName ? `Departamento: ${deptName}` : "Consolidado"}
            option={lineTrend({
              days: history.map((h) => h.day),
              series: [{ name: "Score", data: history.map((h) => h.quality_score), color: C.blue, width: 3 }],
              yMin: 0,
              yMax: 100,
              unit: "%",
              markLines: [{ name: `Meta ${rule.expected_threshold}%`, value: rule.expected_threshold }],
            })}
            height={260}
          />
        ) : (
          <Card title="Evolução histórica">
            <EmptyState title="Histórico em construção">Uma avaliação por dia é registrada; a série aparece a partir do segundo dia.</EmptyState>
          </Card>
        )}
        <EChart
          title="Registros afetados por departamento"
          subtitle="Clique para filtrar"
          option={barScores({
            categories: byDept.map((d) => d.department_name),
            values: byDept.map((d) => d.records_failed),
            horizontal: true,
            colorByScore: false,
            color: C.orange,
            name: "Afetados",
            links: byDept.map((d) => `/quality/rules/${rule.code}?departamento=${d.department_id}`),
          })}
          links={{}}
          height={Math.max(240, byDept.length * 32 + 60)}
        />
      </div>

      <Card
        className="mt"
        title={`Registros afetados (${fmtInt(failures.total)})`}
        subtitle="Somente identificador e rótulo não sensível. Dados pessoais nunca são exibidos (LGPD)."
        actions={
          <form className="filter" style={{ flexDirection: "row", gap: 6 }}>
            {dept && <input type="hidden" name="departamento" value={dept} />}
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Filtrar por nome/id" />
            <button className="btn">Filtrar</button>
          </form>
        }
      >
        {failures.total === 0 ? (
          <EmptyState title="Nenhum registro afetado" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="t t-compact">
                <thead>
                  <tr>
                    <th>{isDatasetRule ? "Item" : "ID do registro"}</th>
                    <th>Rótulo</th>
                    <th>Detalhe</th>
                    <th>Departamento</th>
                  </tr>
                </thead>
                <tbody>
                  {failures.rows.map((f) => (
                    <tr key={f.record_id}>
                      <td className="mono small">{f.record_id}</td>
                      <td>{f.record_label ?? "—"}</td>
                      <td className="small muted">{f.detail ?? ""}</td>
                      <td className="small">{f.department_name ?? "Não identificado"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pill-row" style={{ marginTop: 10, alignItems: "center" }}>
              <span className="muted small">Página {page} de {pages}</span>
              {page > 1 && <Link className="pill" href={`?${qs({ page: page - 1 })}`}>Anterior</Link>}
              {page < pages && <Link className="pill" href={`?${qs({ page: page + 1 })}`}>Próxima</Link>}
            </div>
          </>
        )}
      </Card>

      {hasRole(user, "analyst") && (
        <Card className="mt" title="Registrar issue para acompanhamento" subtitle="Cria um item em Issues & Corrections com a linha de base atual (registros afetados e score)">
          <form action={createIssueAction} className="form-grid">
            <input type="hidden" name="rule_code" value={rule.code} />
            <label>
              Departamento responsável
              <select name="department_id" defaultValue={dept ? String(dept) : ""}>
                <option value="">Consolidado (todos)</option>
                {depts.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </label>
            <label>
              Título
              <input name="title" required defaultValue={`${rule.name}${deptName ? ` — ${deptName}` : ""}`} />
            </label>
            <label className="full">
              Descrição
              <textarea name="description" defaultValue={`${fmtInt(failed)} de ${fmtInt(evaluated)} registros (${fmtPct(evaluated ? (100 * (failed ?? 0)) / evaluated : null)}) não atendem à regra "${rule.name}" na avaliação de ${fmtDateTime(rule.last_evaluated_at)}.`} />
            </label>
            <div className="full">
              <button className="btn btn-primary">Registrar issue</button>
            </div>
          </form>
        </Card>
      )}
    </>
  );
}
