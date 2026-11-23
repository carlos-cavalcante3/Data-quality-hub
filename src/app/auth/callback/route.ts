import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail, isSsoSession } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const raw = request.cookies.get("hub_next")?.value;
  const next = raw ? decodeURIComponent(raw) : "/";
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
  const res = NextResponse.redirect(new URL(safeNext, url.origin));
  res.cookies.delete("hub_next");
  return res;
}
