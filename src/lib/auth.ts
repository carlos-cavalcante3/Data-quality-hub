import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase";
import { queryOne } from "./db";

export type Role = "viewer" | "analyst" | "admin";
export type HubUser = { email: string; role: Role | null; devBypass: boolean };

const RANK: Record<Role, number> = { viewer: 1, analyst: 2, admin: 3 };

function list(env: string | undefined): string[] {
  return (env ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** Domínios corporativos aceitos. A variável HUB_ALLOWED_DOMAINS só pode restringir esta lista, nunca ampliar. */
export const CORPORATE_DOMAINS = ["avantia.com.br", "wesafer.com", "esmgroup.com.br"];

export function allowedDomains(): string[] {
  const d = list(process.env.HUB_ALLOWED_DOMAINS).filter((x) => CORPORATE_DOMAINS.includes(x));
  return d.length ? d : CORPORATE_DOMAINS;
}

/** Provedor SSO aceito (Microsoft Entra ID no Supabase = "azure"). Login por senha/link não é aceito. */
export function ssoProvider(): string {
  return (process.env.HUB_SSO_PROVIDER ?? "azure").trim().toLowerCase();
}

/**
 * A sessão ATUAL foi criada pelo SSO corporativo?
 * - amr (método do login atual) precisa ser "oauth" — senha/OTP/link são recusados;
 * - a conta precisa ter o provedor SSO vinculado (app_metadata.providers), mesmo que
 *   tenha sido criada antes por e-mail em outro app do mesmo projeto Supabase.
 */
export function isSsoSession(claims: unknown): boolean {
  const c = (claims ?? {}) as { amr?: { method?: string }[]; app_metadata?: { provider?: string; providers?: string[] } };
  const viaOAuth = Array.isArray(c.amr) && c.amr.some((a) => a?.method === "oauth");
  const meta = c.app_metadata ?? {};
  const linked = meta.provider === ssoProvider() || (meta.providers ?? []).includes(ssoProvider());
  return viaOAuth && linked;
}

export function isAllowedEmail(email: string): boolean {
  const domain = email.toLowerCase().split("@")[1] ?? "";
  return allowedDomains().includes(domain);
}

/** Bypass de login apenas em desenvolvimento local; nunca na Vercel nem em produção. */
function devBypassEmail(): string | null {
  const email = process.env.HUB_DEV_AUTH_BYPASS_EMAIL;
  if (!email) return null;
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL) return null;
  return email.toLowerCase();
}

// Papel do usuário em cache por 2 min (evita uma ida ao banco a cada navegação).
const roleCache = new Map<string, { role: Role | null; at: number }>();

async function resolveRole(email: string): Promise<Role | null> {
  if (list(process.env.HUB_ADMIN_EMAILS).includes(email)) return "admin";
  const hit = roleCache.get(email);
  if (hit && Date.now() - hit.at < 120_000) return hit.role;
  const row = await queryOne<{ role: Role | null }>("select hub.fn_user_role($1) as role", [email]);
  const role = row?.role ?? null;
  roleCache.set(email, { role, at: Date.now() });
  return role;
}

export function clearRoleCache() {
  roleCache.clear();
}

export const getUser = cache(async (): Promise<HubUser | null> => {
  const bypass = devBypassEmail();
  if (bypass) return { email: bypass, role: await resolveRole(bypass), devBypass: true };

  const supabase = await supabaseServer();
  // getClaims valida o JWT localmente (chaves assimétricas) e só consulta o Auth quando necessário.
  const { data } = await supabase.auth.getClaims();
  const email = (data?.claims?.email as string | undefined)?.toLowerCase();
  if (!email || !isAllowedEmail(email)) return null;
  if (!isSsoSession(data?.claims)) return null;
  return { email, role: await resolveRole(email), devBypass: false };
});

export async function requireUser(min: Role = "viewer"): Promise<HubUser & { role: Role }> {
  const user = await getUser();
  if (!user) redirect("/login");
  if (!user.role) redirect("/acesso-negado");
  if (RANK[user.role] < RANK[min]) redirect("/acesso-negado");
  return user as HubUser & { role: Role };
}

export function hasRole(user: { role: Role | null } | null, min: Role): boolean {
  return !!user?.role && RANK[user.role] >= RANK[min];
}
