import { Logo } from "@/components/Logo";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Entrar" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const user = await getUser().catch(() => null);
  const sp = await searchParams;
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
        <LoginForm next={sp.next} initialError={sp.error} />
      </div>
    </main>
  );
}
