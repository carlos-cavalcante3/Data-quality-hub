import "server-only";
import { execute } from "./db";

export async function audit(actor: string, action: string, target: string, details?: Record<string, unknown>) {
  await execute("select hub.fn_audit($1, $2, $3, $4::jsonb)", [actor, action, target, details ? JSON.stringify(details) : null]).catch(() => undefined);
}
