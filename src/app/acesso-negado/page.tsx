import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AccessDenied() {
  const user = await getUser().catch(() => null);
  return (
    <main className="login-wrap">
      <div className="login-card">
        <h1>Acesso não autorizado</h1>
        <p className="small" style={{ color: "var(--text-2)" }}>
          {user ? (
            <>O usuário <strong>{user.email}</strong> está autenticado, mas não tem permissão para este recurso do Data Quality Hub.</>
          ) : (
            <>Faça login com um e-mail corporativo autorizado.</>
          )}
        </p>
        <p className="small muted">Solicite acesso à Engenharia de Dados (cadastro em governance.app_users).</p>
        <form action="/auth/signout" method="post" style={{ marginTop: 14 }}>
          <button className="btn">Sair</button>
        </form>
      </div>
    </main>
  );
}
