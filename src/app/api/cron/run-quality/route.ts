import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { HUB_DATA_TAG, execute } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** Chamado pelo Vercel Cron (vercel.json). Executa as validações e coleta métricas. */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await execute<{ run_id: number }>("select hub.fn_run_quality('vercel-cron', 'analyst') as run_id", [], "55s");
  revalidateTag(HUB_DATA_TAG);
  return NextResponse.json({ ok: true, run_id: rows[0]?.run_id });
}
