"use client";

import { useEffect } from "react";

export default function HubError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <h2 style={{ fontSize: 17 }}>Não foi possível carregar esta tela</h2>
      <p className="small" style={{ color: "var(--text-2)" }}>
        Ocorreu um erro ao consultar os dados. Tente novamente; se persistir, verifique a conexão com o banco (variável <code>DATABASE_URL</code>) nos logs da Vercel.
      </p>
      {error.digest && <p className="small muted">Código do erro: <code>{error.digest}</code></p>}
      <button className="btn btn-primary" onClick={() => reset()}>Tentar novamente</button>
    </div>
  );
}
