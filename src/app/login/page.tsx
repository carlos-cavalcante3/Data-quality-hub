import { Logo } from "@/components/Logo";
import { redirect } from "next/navigation";
import { getUser, ssoProvider } from "@/lib/auth";
import { missingConfig, supabasePublicConfig } from "@/lib/env";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Entrar" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const user = await getUser().catch(() => null);
  const sp = await searchParams;
  const cfg = supabasePublicConfig();
  const missing = missingConfig();
  if (user?.role) redirect(sp.next?.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/");
  return (
    <main className="login-wrap">
      <div className="login-card">
        <div className="brand" style={{ padding: 0, border: 0 }}>
          <Logo />
          <div>
            <div className="brand-name">Data Quality Hub</div>
          </div>
        </div>
        <h1 style={{ marginTop: 22 }}>Entrar</h1>
        <p className="muted small" style={{ margin: "4px 0 0" }}>
          Acesso restrito a e-mails corporativos autorizados.
        </p>
        {cfg && missing.length === 0 ? (
          <LoginForm next={sp.next} initialError={sp.error} supabaseUrl={cfg.url} supabaseKey={cfg.key} provider={ssoProvider()} />
        ) : (
          <div className="callout" style={{ marginTop: 18 }}>
            <strong>Configuração incompleta no servidor.</strong> Defina as variáveis de ambiente abaixo e faça um novo deploy:
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {missing.map((m) => (
                <li key={m}><code>{m}</code></li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}
