// Leitura de variáveis em TEMPO DE EXECUÇÃO (acesso dinâmico evita que o Next
// "congele" valores vazios no build). Aceita os nomes usados pela integração
// Supabase ↔ Vercel e os nomes do .env.example.

function first(names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

export function supabasePublicConfig(): { url: string; key: string } | null {
  const url = first(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const key = first([
    "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ]);
  return url && key ? { url, key } : null;
}

export function databaseUrl(): string | undefined {
  return first(["DATABASE_URL", "POSTGRES_URL", "DATABASE_URL_READONLY"]);
}

/** Lista o que falta para a aplicação funcionar (exibido na tela de login). */
export function missingConfig(): string[] {
  const missing: string[] = [];
  if (!first(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"])) missing.push("SUPABASE_URL");
  if (!first(["SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]))
    missing.push("SUPABASE_ANON_KEY");
  if (!databaseUrl()) missing.push("DATABASE_URL");
  return missing;
}
