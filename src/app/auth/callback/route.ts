import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail, isSsoSession } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";

function back(origin: string, error: string, reason: string) {
  // Aparece nos logs da Vercel (Runtime Logs) para diagnóstico
  console.warn(`[auth/callback] login recusado: ${reason}`);
  return NextResponse.redirect(new URL(`/login?error=${error}`, origin));
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const raw = request.cookies.get("hub_next")?.value;
  const next = raw ? decodeURIComponent(raw) : "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (providerError) return back(url.origin, "callback", `erro do provedor: ${providerError}`);
  if (!code) return back(url.origin, "callback", "callback sem code");

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user || !data.session) return back(url.origin, "callback", `troca do código falhou: ${error?.message ?? "sem sessão"}`);

  const email = data.user.email?.toLowerCase() ?? "";
  // Token recém-emitido pelo próprio Supabase (resposta TLS da troca do código)
  const claims = JSON.parse(Buffer.from(data.session.access_token.split(".")[1], "base64url").toString("utf8"));

  if (!isAllowedEmail(email) || !isSsoSession(claims)) {
    // "local": encerra só a sessão deste app — não derruba o login do usuário em outros apps do mesmo projeto
    await supabase.auth.signOut({ scope: "local" });
    const amr = Array.isArray(claims.amr) ? claims.amr.map((a: { method?: string }) => a.method).join(",") : "sem amr";
    const meta = claims.app_metadata ?? {};
    return back(
      url.origin,
      isAllowedEmail(email) ? "sso" : "dominio",
      `domínio=${email.split("@")[1] ?? "?"} amr=${amr} provider=${meta.provider} providers=${(meta.providers ?? []).join(",")}`,
    );
  }

  const res = NextResponse.redirect(new URL(safeNext, url.origin));
  res.cookies.delete("hub_next");
  return res;
}
