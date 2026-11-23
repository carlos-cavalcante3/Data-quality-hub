import Link from "next/link";
import { notFound } from "next/navigation";
import { FileBarChart2 } from "lucide-react";
import { EChart } from "@/components/EChart";
import { FilterBar } from "@/components/FilterBar";
import { Badge, Card, Delta, EmptyState, Kpi, PageHeader, ScoreBar, SeverityBadge } from "@/components/ui";
import { C, barScores, lineTrend } from "@/lib/charts";
import { DIMENSION_LABEL, ISSUE_STATUS_LABEL, PERIOD_OPTIONS, fmtDate, fmtInt, fmtPct } from "@/lib/format";
import { byAffected, problemOf } from "@/lib/sort";
import {
  getDepartmentEntities, getDepartmentMembers, getDepartmentPipelines, getDepartmentRuleResults, getDepartmentSummary, getDimensions,
  getIssues, getScoreTrendDepartment, getScoresLatestDepartment, getTeamMembersAssignedElsewhere,
} from "@/lib/queries";

const ENTITY_LABEL: Record<string, string> = { negocio: "Negócios", empresa: "Empresas", contato: "Contatos", tarefa: "Tarefas", dataset: "Datasets" };
const ENTITY_SOURCE: Record<string, string> = {
  negocio: "negócios em que um membro é o responsável (owner)",
  empresa: "empresas em que um membro é o responsável",
  contato: "contatos de empresas sob responsabilidade de um membro",
  tarefa: "tarefas de negócios sob responsabilidade de um membro",
};

export default async function DepartmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ periodo?: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const sp = await searchParams;
  const days = Number(sp.periodo ?? 90) || 90;
  const [summary, dims, scores, results, trend, issues, members, pipelines, entities] = await Promise.all([
    getDepartmentSummary(), getDimensions(), getScoresLatestDepartment(), getDepartmentRuleResults(id), getScoreTrendDepartment(days, id),
    getIssues(null, id), getDepartmentMembers(id), getDepartmentPipelines(id), getDepartmentEntities(id),
  ]);
  const d = summary.find((s) => s.department_id === id);
  if (!d) notFound();
  const isUnassigned = d.code === "nao_identificado";
  const elsewhere = d.source === "rd_team" ? await getTeamMembersAssignedElsewhere(id, d.name) : [];
  const deptName = new Map(summary.map((s) => [s.department_id, s.name]));
  const myScores = scores.filter((s) => s.department_id === id);
  const problems = results.filter((r) => r.records_failed > 0).sort(byAffected);
  const completeness = results
    .filter((r) => r.dimension === "completude" && r.records_failed > 0)
    .map((r) => ({ ...r, pct: (100 * r.records_failed) / r.records_evaluated }))
    .sort((a, b) => b.pct - a.pct);
  const dayList = [...new Set(trend.map((t) => t.day))].sort();
  const totalDeals = pipelines.reduce((a, p) => a + p.deals, 0);
  const outOfScope = pipelines.filter((p) => p.escopo === "fora_do_escopo").reduce((a, p) => a + p.deals, 0);

  return (
    <>
      <PageHeader
        eyebrow="Departamento"
        title={d.name}
        description={
          isUnassigned
            ? "Registros cujo responsável não está em nenhuma equipe do RD (ou não tem responsável). Não é possível atribuir a qualidade a um departamento."
            : `Equipe do RD Station. Inclui os registros em que um membro da equipe é o responsável.`
        }
        actions={
          <Link className="btn btn-accent" href={`/reports/view?departamento=${id}`}>
            <FileBarChart2 size={14} /> Gerar relatório do departamento
          </Link>
        }
      />
      <FilterBar filters={[{ key: "periodo", label: "Período", type: "select", options: PERIOD_OPTIONS, defaultValue: "90" }]} />

      <div className="grid g-6">
        <Kpi tone="brand" label="Índice de qualidade" value={d.overall_score != null ? fmtPct(d.overall_score) : "Dados insuficientes"} band={d.band} delta={d.delta_score} hint={d.previous_day ? `vs ${fmtDate(d.previous_day)}` : undefined} />
        <Kpi label="Completude geral" value={fmtPct(d.completeness_score)} />
        <Kpi label="Negócios (todos os funis)" value={fmtInt(totalDeals)} hint={`${fmtInt(d.deals_comerciais)} nos funis comerciais`} />
        <Kpi label="Empresas sob responsabilidade" value={fmtInt(members.reduce((a, m) => a + m.empresas, 0))} hint={`${fmtInt(d.empresas_clientes)} com negócio comercial`} />
        <Kpi label="Registros com problema" value={fmtInt(d.unique_records_with_issues)} hint={`${fmtInt(d.occurrences)} ocorrências em ${fmtInt(d.checks_evaluated)} verificações`} />
        <Kpi label="Issues abertas" value={fmtInt(d.open_issues)} href={`/issues?departamento=${id}`} />
      </div>

      <div className="grid g-3 mt">
        <Card className="span-2" title="Composição" subtitle={isUnassigned ? "Responsáveis sem equipe no RD" : "Membros da equipe no RD (bronze.teams) e os registros sob sua responsabilidade"}>
          {members.length === 0 ? (
            <EmptyState title="Nenhum membro">{isUnassigned ? "Todos os responsáveis estão em alguma equipe; aqui entram só registros sem responsável." : "Equipe sem usuários no RD."}</EmptyState>
          ) : (
            <table className="t t-compact">
              <thead>
                <tr><th>Responsável</th><th>Equipes no RD</th><th>Atribuição</th><th className="num">Negócios</th><th className="num">Comerciais</th><th className="num">Empresas</th></tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.user_id}>
                    <td>{m.user_name}</td>
                    <td className="small">{m.all_teams ?? <span className="muted">nenhuma</span>}</td>
                    <td className="small">
                      {m.rule === "override_manual" ? <Badge kind="info">manual</Badge> : m.rule === "sem_equipe" ? <Badge kind="sem_dados">sem equipe</Badge> : m.teams_count > 1 ? <Badge kind="atrasado">prioridade</Badge> : <span className="muted">equipe única</span>}
                    </td>
                    <td className="num">{fmtInt(m.deals_total)}</td>
                    <td className="num">{fmtInt(m.deals_comerciais)}</td>
                    <td className="num">{fmtInt(m.empresas)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {elsewhere.length > 0 && (
            <div className="callout" style={{ marginTop: 10 }}>
              Também são da equipe no RD, mas foram atribuídos a outro departamento pela prioridade:{" "}
              {elsewhere.map((m) => `${m.user_name} → ${deptName.get(m.department_id) ?? "?"}`).join("; ")}. Os registros dessas pessoas não entram aqui.
            </div>
          )}
          <p className="small muted" style={{ marginTop: 8 }}>
            Quem está em mais de uma equipe é atribuído à de maior prioridade (Vendas → Áudio e Vídeo → Backoffice → Marketing). Atribuições manuais: <code>governance.user_department_override</code>.
          </p>
        </Card>
        <Card title="Negócios por funil" subtitle={outOfScope ? `${fmtInt(outOfScope)} fora do escopo comercial (não entram nos painéis comerciais)` : "Todos dentro do escopo comercial"}>
          {pipelines.length === 0 ? <EmptyState title="Sem negócios" /> : (
            <ul className="attention-list">
              {pipelines.map((p) => (
                <li key={p.pipeline_name ?? "?"}>
                  <span className="small">{p.pipeline_name ?? "Sem funil"}</span>
                  <span className="small">
                    <strong>{fmtInt(p.deals)}</strong>{" "}
                    {p.escopo === "comercial" ? <Badge kind="ok">comercial</Badge> : p.escopo === "somente_historico" ? <Badge kind="sem_dados">histórico</Badge> : <Badge kind="sem_sla">fora</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt" title="De onde vêm as verificações" subtitle="Cada regra avalia uma entidade. Ordem: mais verificações primeiro">
        <table className="t t-compact">
          <thead><tr><th>Entidade</th><th>Origem dos registros</th><th className="num">Regras</th><th className="num">Verificações</th><th className="num">Com problema</th><th className="num">%</th></tr></thead>
          <tbody>
            {entities.map((e) => (
              <tr key={e.entity}>
                <td>{ENTITY_LABEL[e.entity] ?? e.entity}</td>
                <td className="small muted">{ENTITY_SOURCE[e.entity] ?? ""}</td>
                <td className="num">{e.rules}</td>
                <td className="num">{fmtInt(e.checks_evaluated)}</td>
                <td className="num">{fmtInt(e.occurrences)}</td>
                <td className="num">{e.checks_evaluated ? fmtPct((100 * e.occurrences) / e.checks_evaluated) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid g-2 mt">
        {dayList.length > 1 ? (
          <EChart
            title="Evolução da qualidade"
            option={lineTrend({
              days: dayList,
              series: [
                { name: "Índice", data: dayList.map((day) => trend.find((t) => t.day === day && t.level === "geral")?.score ?? null), color: C.blue, width: 3 },
                { name: "Completude", data: dayList.map((day) => trend.find((t) => t.day === day && t.level === "dimensao" && t.dimension === "completude")?.score ?? null), color: C.orange },
              ],
              yMin: 0,
              yMax: 100,
              unit: "%",
              markX: issues.filter((i) => i.communicated_at).map((i) => ({ label: `Comunicado #${i.id}`, day: new Date(i.communicated_at!).toISOString().slice(0, 10) })),
            })}
            height={260}
          />
        ) : (
          <Card title="Evolução da qualidade"><EmptyState title="Histórico em construção">A série aparece a partir de validações em dois dias diferentes.</EmptyState></Card>
        )}
        <EChart
          title="Qualidade por dimensão"
          option={barScores({
            categories: dims.map((x) => x.name),
            values: dims.map((x) => myScores.find((s) => s.level === "dimensao" && s.dimension === x.code)?.score ?? null),
            max: 100,
            unit: "%",
            threshold: 95,
          })}
          height={260}
        />
      </div>

      <div className="grid g-2 mt">
        <EChart
          title="Campos com maior incompletude"
          subtitle="% dos registros do departamento sem o campo · ordem: maior primeiro"
          option={barScores({
            categories: completeness.map((r) => problemOf(r)),
            values: completeness.map((r) => r.pct),
            horizontal: true,
            colorByScore: false,
            color: C.orange,
            unit: "%",
            links: completeness.map((r) => `/quality/rules/${r.rule_code}?departamento=${id}`),
          })}
          links={{}}
          height={Math.max(240, completeness.length * 28 + 60)}
        />
        <Card title="Principais problemas" subtitle="Ordem: mais registros afetados primeiro (um registro pode aparecer em vários)">
          {problems.length === 0 ? <EmptyState title="Nenhum problema encontrado" /> : (
            <table className="t t-compact">
              <thead>
                <tr><th>Problema</th><th>Sev.</th><th className="num">Afetados</th><th className="num">Avaliados</th><th style={{ width: 90 }}>Conformidade</th></tr>
              </thead>
              <tbody>
                {problems.map((r) => (
                  <tr key={r.rule_code}>
                    <td><Link href={`/quality/rules/${r.rule_code}?departamento=${id}`}>{problemOf(r)}</Link><div className="small muted">{DIMENSION_LABEL[r.dimension]} · {r.dataset_name}</div></td>
                    <td><SeverityBadge severity={r.severity} /></td>
                    <td className="num"><strong>{fmtInt(r.records_failed)}</strong></td>
                    <td className="num muted">{fmtInt(r.records_evaluated)}</td>
                    <td><ScoreBar value={r.quality_score} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card className="mt" title={`Acompanhamento de correções (${issues.length})`} actions={<Link className="btn" href="/issues">Ver todas</Link>}>
        {issues.length === 0 ? <EmptyState title="Nenhuma issue registrada para este departamento">Abra um problema e use “Registrar issue”.</EmptyState> : (
          <table className="t t-compact">
            <thead>
              <tr><th>#</th><th>Problema</th><th>Status</th><th className="num">Linha de base</th><th className="num">Atual</th><th>Evolução</th></tr>
            </thead>
            <tbody>
              {issues.map((i) => (
                <tr key={i.id}>
                  <td className="muted">{i.id}</td>
                  <td><Link href={`/issues/${i.id}`}>{i.title}</Link></td>
                  <td><Badge kind={i.status}>{ISSUE_STATUS_LABEL[i.status]}</Badge></td>
                  <td className="num">{fmtInt(i.affected_records)} <span className="muted">({fmtPct(i.baseline_score)})</span></td>
                  <td className="num">{fmtInt(i.current_failed)} <span className="muted">({fmtPct(i.current_score)})</span></td>
                  <td><Delta value={i.current_score != null && i.baseline_score != null ? i.current_score - i.baseline_score : null} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
