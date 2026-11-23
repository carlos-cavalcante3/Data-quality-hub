import { Sidebar } from "@/components/Sidebar";
import { requireUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { fmtAgo, fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const [user, meta] = await Promise.all([requireUser("viewer"), queryOne<{ last_run: Date | null; last_status: string | null; last_data: Date | null }>(
    `select (select started_at from hub.v_last_run) as last_run,
            (select status from hub.v_last_run) as last_status,
            (select max(last_updated_at) from hub.v_dataset_metrics_latest where layer in ('bronze','silver','privado')) as last_data`,
  ).catch(() => null)]);

  return (
    <div className="shell">
      <Sidebar email={user.email} role={user.role} />
      <div className="main">
        {user.devBypass && <div className="dev-banner">Modo desenvolvimento: login ignorado (HUB_DEV_AUTH_BYPASS_EMAIL). Indisponível em produção.</div>}
        <header className="topbar">
          <div className="topbar-meta">
            <span>
              Última validação: <strong>{fmtDateTime(meta?.last_run)}</strong> ({fmtAgo(meta?.last_run)})
            </span>
            <span>
              Último dado recebido: <strong>{fmtDateTime(meta?.last_data)}</strong>
            </span>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
