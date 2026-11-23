import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabasePublicConfig } from "@/lib/env";

const PUBLIC_PATHS = ["/login", "/auth/callback", "/acesso-negado", "/api/cron"];

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));

  // Domínio canônico em produção: endereços de deploy da Vercel (data-quality-hub-xxxx.vercel.app)
  // não estão na lista de Redirect URLs do Supabase, e o SSO cairia na Site URL de outro app.
  const canonical = process.env.HUB_PUBLIC_HOST || process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const host = request.headers.get("host") ?? "";
  if (process.env.VERCEL_ENV === "production" && canonical && host && host !== canonical && !path.startsWith("/api/cron")) {
    const target = new URL(request.nextUrl.pathname + request.nextUrl.search, `https://${canonical}`);
    return NextResponse.redirect(target, 308);
  }

  const bypass =
    process.env.HUB_DEV_AUTH_BYPASS_EMAIL && process.env.NODE_ENV === "development" && !process.env.VERCEL;
  if (bypass) return NextResponse.next();

  let response = NextResponse.next({ request });
  const cfg = supabasePublicConfig();
  if (!cfg) return isPublic ? response : NextResponse.redirect(new URL("/login", request.url));
  const { url, key } = cfg;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  if (!data?.claims && !isPublic) {
    const login = new URL("/login", request.url);
    if (path !== "/") login.searchParams.set("next", path);
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
