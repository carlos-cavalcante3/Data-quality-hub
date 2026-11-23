import Link from "next/link";
import { EChart } from "@/components/EChart";
import { Badge, Card, Delta, PageHeader, ScoreBar } from "@/components/ui";
import { C, barScores, heatmap } from "@/lib/charts";
import { fmtDate, fmtInt, fmtPct } from "@/lib/format";
import { getDepartmentEntities, getDepartmentSummary, getDimensions, getScoresLatestDepartment } from "@/lib/queries";

export const metadata = { title: "Departamentos" };

export default async function DepartmentsPage() {
  const [summaryRaw, dims, deptScores, entities] = await Promise.all([getDepartmentSummary(), getDimensions(), getScoresLatestDepartment(), getDepartmentEntities(null)]);
  // Tabela: ordem alfabética, "Não identificado" por último. Gráficos: pior score primeiro.
  const summary = [...summaryRaw].sort((a, b) => (a.code === "nao_identificado" ? 1 : 0) - (b.code === "nao_identificado" ? 1 : 0) || a.name.localeCompare(b.name, "pt-BR"));
  const evaluated = summary.filter((d) => d.checks_evaluated > 0);
  const byOverall = [...evaluated].sort((a, b) => (a.overall_score ?? 101) - (b.overall_score ?? 101));
  const byCompleteness = [...evaluated].sort((a, b) => (a.completeness_score ?? 101) - (b.completeness_score ?? 101));
  const ENTITY_LABEL: Record<string, string> = { negocio: "negócios", empresa: "empresas", contato: "contatos", tarefa: "tarefas" };
  const mainSource = (id: number) => {
    const rows = entities.filter((e) => e.department_id === id).sort((a, b) => b.checks_evaluated - a.checks_evaluated);
    const total = rows.reduce((a, e) => a + e.checks_evaluated, 0);
    return rows.slice(0, 2).map((e) => `${ENTITY_LABEL[e.entity] ?? e.entity} ${Math.round((100 * e.checks_evaluated) / (total || 1))}%`).join(" · ");
  };
  const hm: [number, number, number | null][] = [];
  evaluated.forEach((d, y) =>
    dims.forEach((dm, x) => hm.push([x, y, deptScores.find((s) => s.department_id === d.department_id && s.level === "dimensao" && s.dimension === dm.code)?.score ?? null])),
  );

  return (
    <>
      <PageHeader
        eyebrow="Análise organizacional"
        title="Qualidade por departamento"
        description="Transforma indicadores técnicos em informação para os responsáveis. O objetivo é encontrar problemas estruturais e oportunidades de padronização, não criar ranking punitivo."
      />
      <div className="callout callout-info">
        Departamento = equipe do RD Station do responsável pelo registro. Contatos herdam o responsável da empresa; tarefas, o do negócio.
        Abra um departamento para ver os membros, os funis e de onde vêm as verificações. Compare com cautela: as populações são diferentes.
      </div>

      <div className="grid g-2 mt">
        <EChart
          title="Índice de qualidade por departamento"
          subtitle="Ordem: pior primeiro · score ponderado na população de cada departamento"
          option={barScores({ categories: byOverall.map((d) => d.name), values: byOverall.map((d) => d.overall_score), horizontal: true, max: 100, unit: "%", threshold: 95, links: byOverall.map((d) => `/departments/${d.department_id}`) })}
          links={{}}
          height={Math.max(260, evaluated.length * 34 + 60)}
        />
        <EChart
          title="Completude por departamento"
          subtitle="Ordem: pior primeiro · campos obrigatórios preenchidos"
          option={barScores({ categories: byCompleteness.map((d) => d.name), values: byCompleteness.map((d) => d.completeness_score), horizontal: true, max: 100, unit: "%", threshold: 95, links: byCompleteness.map((d) => `/departments/${d.department_id}`) })}
          links={{}}
          height={Math.max(260, evaluated.length * 34 + 60)}
        />
      </div>

      <div className="mt">
        <EChart
          title="Matriz de qualidade: departamento × dimensão"
          subtitle="Células vazias = sem população suficiente (menos de 20 verificações) nessa dimensão"
          option={heatmap({ x: dims.map((d) => d.name), y: evaluated.map((d) => d.name), values: hm })}
          height={Math.max(260, evaluated.length * 40 + 90)}
        />
      </div>

      <Card className="mt" title="Resumo por departamento" subtitle="Ocorrências somam falhas de todas as regras; registros únicos contam cada registro uma vez">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Departamento</th>
                <th className="num">Negócios comerciais</th>
                <th className="num">Empresas clientes</th>
                <th>Origem das verificações</th>
                <th className="num">Verificações</th>
                <th className="num">Ocorrências</th>
                <th className="num">Registros únicos c/ problema</th>
                <th style={{ width: 120 }}>Índice</th>
                <th className="num">Índice</th>
                <th className="num">Completude</th>
                <th>vs ~30 dias</th>
                <th className="num">Issues abertas</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((d) => (
                <tr key={d.department_id}>
                  <td><Link href={`/departments/${d.department_id}`}>{d.name}</Link><div className="small muted">{d.source === "rd_team" ? "equipe do RD" : d.source}</div></td>
                  <td className="num">{fmtInt(d.deals_comerciais)}</td>
                  <td className="num">{fmtInt(d.empresas_clientes)}</td>
                  <td className="small muted">{mainSource(d.department_id)}</td>
                  <td className="num">{fmtInt(d.checks_evaluated)}</td>
                  <td className="num">{fmtInt(d.occurrences)}</td>
                  <td className="num">{fmtInt(d.unique_records_with_issues)}</td>
                  <td><ScoreBar value={d.overall_score} threshold={95} /></td>
                  <td className="num">{d.overall_score != null ? fmtPct(d.overall_score) : <Badge kind="dados_insuficientes" />}</td>
                  <td className="num">{fmtPct(d.completeness_score)}</td>
                  <td><Delta value={d.delta_score} />{d.previous_day && <div className="small muted">{fmtDate(d.previous_day)}</div>}</td>
                  <td className="num">{d.open_issues > 0 ? <Link href={`/issues?departamento=${d.department_id}`}>{d.open_issues}</Link> : 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="small muted mt">Cor de referência: <span style={{ color: C.green }}>≥ 95% alta</span> · <span style={{ color: C.amber }}>80–95% intermediária</span> · <span style={{ color: C.red }}>&lt; 80% baixa</span>.</p>
    </>
  );
}
