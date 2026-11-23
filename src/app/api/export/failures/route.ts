import { NextResponse, type NextRequest } from "next/server";
import { getUser, hasRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { csvResponse, toCsv } from "@/lib/csv";
import { getFailuresForExport, getLastRun } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user || !hasRole(user, "analyst")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rule = req.nextUrl.searchParams.get("regra");
  const deptRaw = req.nextUrl.searchParams.get("departamento");
  const dept = deptRaw && /^\d+$/.test(deptRaw) ? Number(deptRaw) : null;
  if (rule && !/^[A-Z0-9_]{2,80}$/.test(rule)) return NextResponse.json({ error: "regra inválida" }, { status: 400 });

  const [rows, run] = await Promise.all([getFailuresForExport(rule, dept), getLastRun()]);
  await audit(user.email, "export.failures", `rule:${rule ?? "todas"}`, { department_id: dept, rows: rows.length, run_id: run?.id });

  const csv = toCsv(
    ["execucao", "regra", "nome_regra", "dimensao", "dataset", "entidade", "id_registro", "rotulo", "detalhe", "departamento"],
    rows.map((r) => [r.run_id, r.rule_code, r.rule_name, r.dimension, r.dataset_name, r.entity, r.record_id, r.record_label, r.detail, r.department_name ?? "Não identificado"]),
  );
  const stamp = new Date().toISOString().slice(0, 10);
  return csvResponse(`registros_afetados_${rule ?? "todas"}_${stamp}.csv`, csv);
}
