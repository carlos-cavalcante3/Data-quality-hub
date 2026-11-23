import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/ui";
import { hasRole, requireUser } from "@/lib/auth";
import { STATUS_LABEL, fmtDateTime } from "@/lib/format";
import { getAppUsers, getAuditLog, getDepartments, getDimensions, getRuns } from "@/lib/queries";
import { runQualityAction, updateWeightAction, upsertUserAction } from "../actions";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const isAdmin = hasRole(user, "admin");
  const [dims, runs, users, audit, depts] = await Promise.all([
    getDimensions(), getRuns(15), getAppUsers(), isAdmin ? getAuditLog(60) : Promise.resolve([]), getDepartments(),
  ]);
  const totalWeight = dims.reduce((a, d) => a + d.weight, 0);

  return (
    <>
      <PageHeader eyebrow="Administração" title="Settings" description="Execução das validações, pesos do índice, usuários e auditoria." />
      {sp.ok === "run" && <div className="callout callout-info" style={{ marginBottom: 14 }}>Validação executada com sucesso.</div>}

      <div className="grid g-2">
        <Card title="Execução das validações" subtitle="Agendada diariamente às 07:00 (Brasília) pelo Vercel Cron · pode ser executada manualmente">
          {hasRole(user, "analyst") && (
            <form action={runQualityAction} style={{ marginBottom: 12 }}>
              <button className="btn btn-primary">Executar validações agora</button>
            </form>
          )}
          <table className="t t-compact">
            <thead><tr><th>#</th><th>Início</th><th>Status</th><th>Regras</th><th>Origem</th><th className="num">Duração</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/observability/executions/dq:${r.id}`}>{r.id}</Link></td>
                  <td className="small nowrap">{fmtDateTime(r.started_at)}</td>
                  <td><Badge kind={r.status}>{STATUS_LABEL[r.status] ?? r.status}</Badge></td>
                  <td className="small">{r.rules_ok}/{r.rules_total}{r.rules_error ? ` · ${r.rules_error} erro(s)` : ""}</td>
                  <td className="small muted">{r.triggered_by}</td>
                  <td className="num small">{r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)} s` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Pesos das dimensões" subtitle={`Usados no índice geral (soma atual: ${totalWeight.toFixed(2)}; o cálculo normaliza pela soma). Alterações são auditadas.`}>
          <table className="t t-compact">
            <thead><tr><th>Dimensão</th><th>Descrição</th><th className="num">Peso</th></tr></thead>
            <tbody>
              {dims.map((d) => (
                <tr key={d.code}>
                  <td><strong>{d.name}</strong></td>
                  <td className="small muted">{d.description}</td>
                  <td className="num">
                    {isAdmin ? (
                      <form action={updateWeightAction} style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                        <input type="hidden" name="code" value={d.code} />
                        <input name="weight" type="number" step="0.05" min="0.05" max="10" defaultValue={d.weight} style={{ width: 70 }} />
                        <button className="icon-btn">salvar</button>
                      </form>
                    ) : (
                      d.weight
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted" style={{ marginTop: 8 }}>Fórmula completa em <Link href="/docs#indice">Métricas e regras</Link>.</p>
        </Card>
      </div>

      <div className="grid g-2 mt">
        <Card title="Usuários do Hub" subtitle="Somente e-mails corporativos. Admins iniciais também vêm de HUB_ADMIN_EMAILS.">
          <table className="t t-compact">
            <thead><tr><th>E-mail</th><th>Perfil</th><th>Ativo</th></tr></thead>
            <tbody>
              {users.length === 0 && (
                <tr><td colSpan={3} className="muted small">Nenhum usuário cadastrado em governance.app_users (apenas os admins da variável de ambiente).</td></tr>
              )}
              {users.map((u) => (
                <tr key={u.email}><td>{u.email}</td><td>{u.role}</td><td>{u.active ? "sim" : "não"}</td></tr>
              ))}
            </tbody>
          </table>
          {isAdmin && (
            <form action={upsertUserAction} className="form-grid" style={{ marginTop: 12 }}>
              <label>E-mail<input name="email" type="email" required /></label>
              <label>
                Perfil
                <select name="role" defaultValue="viewer">
                  <option value="viewer">viewer — leitura</option>
                  <option value="analyst">analyst — issues, exportação, execução</option>
                  <option value="admin">admin — usuários e pesos</option>
                </select>
              </label>
              <label>
                Ativo
                <select name="active" defaultValue="true"><option value="true">sim</option><option value="false">não</option></select>
              </label>
              <div style={{ alignSelf: "end" }}><button className="btn btn-primary">Salvar usuário</button></div>
            </form>
          )}
          <p className="small muted" style={{ marginTop: 8 }}>O usuário também precisa existir no Supabase Auth (Authentication → Users).</p>
        </Card>

        <Card title="Departamentos" subtitle="Sincronizados das equipes do RD a cada validação">
          <table className="t t-compact">
            <thead><tr><th>Departamento</th><th>Origem</th><th className="num">Prioridade</th></tr></thead>
            <tbody>
              {depts.map((d) => (
                <tr key={d.id}><td>{d.name}</td><td className="small muted">{d.source}</td><td className="num">{d.priority}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {isAdmin && (
        <Card className="mt" title="Auditoria" subtitle="Exportações, relatórios, execuções, alterações de issues, usuários e pesos">
          <div className="table-wrap" style={{ maxHeight: 420, overflow: "auto" }}>
            <table className="t t-compact">
              <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Alvo</th><th>Detalhes</th></tr></thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="small nowrap">{fmtDateTime(a.at)}</td>
                    <td className="small">{a.actor}</td>
                    <td className="small mono">{a.action}</td>
                    <td className="small">{a.target}</td>
                    <td className="small mono muted">{a.details ? JSON.stringify(a.details) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
