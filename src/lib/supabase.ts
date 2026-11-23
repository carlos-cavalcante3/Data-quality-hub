import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabasePublicConfig } from "./env";

export function supabaseConfig() {
  const cfg = supabasePublicConfig();
  if (!cfg) throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY não configuradas");
  return cfg;
}

export async function supabaseServer() {
  const { url, key } = supabaseConfig();
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // chamado a partir de Server Component: o middleware renova a sessão
        }
      },
    },
  });
}
