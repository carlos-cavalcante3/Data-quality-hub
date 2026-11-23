import { Card, PageHeader } from "@/components/ui";
import { PERIOD_OPTIONS } from "@/lib/format";
import { getDepartments, getDimensions, getRules } from "@/lib/queries";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const [depts, rules, dims] = await Promise.all([getDepartments(), getRules(), getDimensions()]);
  return (
    <>
      <PageHeader
        eyebrow="Evidências"
        title="Relatórios visuais"
        description="Monte um relatório com os filtros desejados, revise e exporte em PDF (impressão) ou os gráficos em PNG. Cada relatório registra data de geração, origem dos dados, denominadores e a execução de validação usada."
      />
      <Card title="Configurar relatório">
        <form action="/reports/view" method="get" className="form-grid">
          <label>
            Departamento
            <select name="departamento" defaultValue="">
              <option value="">Todos (visão consolidada)</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
          <label>
            Regra / indicador (opcional)
            <select name="regra" defaultValue="">
              <option value="">Todas as regras</option>
              {rules.map((r) => (
                <option key={r.code} value={r.code}>{r.problem_label ?? r.name}</option>
              ))}
            </select>
          </label>
          <label>
            Dimensão de qualidade
            <select name="dimensao" defaultValue="">
              <option value="">Todas</option>
              {dims.map((d) => (
                <option key={d.code} value={d.code}>{d.name}</option>
              ))}
            </select>
          </label>
          <label>
            Período da evolução
            <select name="periodo" defaultValue="90">
              {PERIOD_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>
          <label className="full">
            Observações (aparecem na conclusão)
            <textarea name="notas" maxLength={2000} placeholder="Ex.: Solicitamos a correção dos registros até 15/12. A evolução será acompanhada nas próximas avaliações." />
          </label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input type="checkbox" name="exemplos" value="1" /> Incluir exemplos de registros afetados
          </label>
          <div className="full">
            <button className="btn btn-primary">Gerar relatório</button>
          </div>
        </form>
      </Card>
    </>
  );
}
