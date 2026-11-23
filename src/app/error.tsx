"use client";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="login-wrap">
      <div className="login-card">
        <h1>Algo deu errado</h1>
        <p className="small" style={{ color: "var(--text-2)" }}>
          A aplicação não conseguiu carregar. Isso geralmente indica configuração ausente no servidor (variáveis de ambiente) ou falha de conexão com o banco.
        </p>
        {error.digest && <p className="small muted">Código do erro: <code>{error.digest}</code></p>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn btn-primary" onClick={() => reset()}>Tentar novamente</button>
          <a className="btn" href="/login">Ir para o login</a>
        </div>
      </div>
    </main>
  );
}
