import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { csvResponse, toCsv } from "@/lib/csv";
import { getAllCatalogColumns } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getUser();
  if (!user?.role) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const cols = await getAllCatalogColumns();
  await audit(user.email, "export.catalog", "hub.v_catalog_columns", { rows: cols.length });
  const csv = toCsv(
    ["schema", "objeto", "ordem", "coluna", "tipo", "aceita_nulo", "padrao", "pk", "unica", "fk", "indexada", "pct_nulos_estimado", "distintos_estimado", "comentario"],
    cols.map((c) => [c.schema_name, c.object_name, c.ordinal, c.column_name, c.data_type, c.is_nullable, c.column_default, c.is_primary_key, c.is_unique, c.foreign_key_ref, c.is_indexed, c.null_frac != null ? (c.null_frac * 100).toFixed(2) : null, c.n_distinct, c.comment]),
  );
  return csvResponse(`catalogo_banco_${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
