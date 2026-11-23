import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail, isSsoSession } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (!code) return NextResponse.redirect(new URL("/login?error=callback", url.origin));

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(new URL("/login?error=callback", url.origin));

  const email = data.user.email?.toLowerCase() ?? "";
  if (!isAllowedEmail(email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=dominio", url.origin));
  }
  if (!isSsoSession(data.user.app_metadata)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=sso", url.origin));
  }
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
