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

export function allowedDomains(): string[] {
  const d = list(process.env.HUB_ALLOWED_DOMAINS);
  return d.length ? d : ["avantia.com.br", "wesafer.com", "esmgroup.com.br"];
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

async function resolveRole(email: string): Promise<Role | null> {
  if (list(process.env.HUB_ADMIN_EMAILS).includes(email)) return "admin";
  const row = await queryOne<{ role: Role | null }>("select hub.fn_user_role($1) as role", [email]);
  return row?.role ?? null;
}

export const getUser = cache(async (): Promise<HubUser | null> => {
  const bypass = devBypassEmail();
  if (bypass) return { email: bypass, role: await resolveRole(bypass), devBypass: true };

  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.toLowerCase();
  if (!email || !isAllowedEmail(email)) return null;
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
