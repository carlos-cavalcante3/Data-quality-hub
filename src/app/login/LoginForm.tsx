"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

const ERRORS: Record<string, string> = {
  dominio: "Acesso permitido apenas para contas @avantia.com.br, @wesafer.com e @esmgroup.com.br.",
  sso: "O acesso é feito exclusivamente pelo login corporativo Microsoft.",
  callback: "Não foi possível concluir o login. Tente novamente.",
};

function MicrosoftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export function LoginForm({
  next, initialError, supabaseUrl, supabaseKey, provider,
}: { next?: string; initialError?: string; supabaseUrl: string; supabaseKey: string; provider: string }) {
  const [error, setError] = useState<string | null>(initialError ? ERRORS[initialError] ?? ERRORS.callback : null);
  const [busy, setBusy] = useState(false);
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  async function signIn() {
    setError(null);
    setBusy(true);
    try {
      const supabase = createBrowserClient(supabaseUrl, supabaseKey);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: provider as "azure",
        options: {
          scopes: "openid email profile",
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`,
        },
      });
      if (error) throw error;
    } catch {
      setError(ERRORS.callback);
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
      {error && <div className="error">{error}</div>}
      <button type="button" className="btn btn-primary" disabled={busy} onClick={signIn} style={{ justifyContent: "center", padding: "10px" }}>
        <MicrosoftIcon /> {busy ? "Redirecionando…" : "Entrar com Microsoft"}
      </button>
      <p className="small muted" style={{ margin: 0, textAlign: "center" }}>
        Contas @avantia.com.br, @wesafer.com e @esmgroup.com.br
      </p>
    </div>
  );
}
