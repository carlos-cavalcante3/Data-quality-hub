"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

const DOMAINS = ["avantia.com.br", "wesafer.com", "esmgroup.com.br"];

export function LoginForm({ next, initialError, supabaseUrl, supabaseKey }: { next?: string; initialError?: string; supabaseUrl: string; supabaseKey: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "link">("password");
  const [error, setError] = useState<string | null>(initialError ? "Não foi possível concluir o login." : null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const domain = email.trim().toLowerCase().split("@")[1];
    if (!domain || !DOMAINS.includes(domain)) {
      setError("Use seu e-mail corporativo.");
      return;
    }
    setBusy(true);
    try {
      const supabase = createBrowserClient(supabaseUrl, supabaseKey);
      if (mode === "password") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        window.location.assign(safeNext);
      } else {
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}` },
        });
        if (error) throw error;
        setInfo("Enviamos um link de acesso para o seu e-mail.");
      }
    } catch {
      setError(mode === "password" ? "E-mail ou senha inválidos." : "Não foi possível enviar o link. Verifique se o usuário existe.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label className="field">
        E-mail corporativo
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      {mode === "password" && (
        <label className="field">
          Senha
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
      )}
      {error && <div className="error">{error}</div>}
      {info && <div className="success">{info}</div>}
      <button className="btn btn-primary" disabled={busy} style={{ justifyContent: "center", padding: "9px" }}>
        {busy ? "Aguarde…" : mode === "password" ? "Entrar" : "Enviar link de acesso"}
      </button>
      <button type="button" className="btn" style={{ justifyContent: "center" }} onClick={() => setMode(mode === "password" ? "link" : "password")}>
        {mode === "password" ? "Entrar com link por e-mail" : "Entrar com senha"}
      </button>
    </form>
  );
}
