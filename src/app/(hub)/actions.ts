"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { execute } from "@/lib/db";
import { ISSUE_STATUS } from "@/lib/format";

const statusValues = ISSUE_STATUS.map((s) => s.value) as [string, ...string[]];

export async function runQualityAction(): Promise<void> {
  const user = await requireUser("analyst");
  await execute("select hub.fn_run_quality($1, $2)", [user.email, user.role], "300s");
  revalidatePath("/", "layout");
  redirect("/settings?ok=run");
}

const issueSchema = z.object({
  rule_code: z.string().max(80).optional().transform((v) => v || null),
  department_id: z.coerce.number().int().positive().optional().or(z.literal("").transform(() => undefined)),
  title: z.string().trim().min(3).max(300),
  description: z.string().max(5000).optional(),
  notes: z.string().max(5000).optional(),
});

export async function createIssueAction(formData: FormData): Promise<void> {
  const user = await requireUser("analyst");
  const data = issueSchema.parse(Object.fromEntries(formData));
  const rows = await execute<{ id: number }>("select hub.fn_issue_create($1, $2, $3, $4, $5, $6, $7) as id", [
    user.email, user.role, data.rule_code, data.department_id ?? null, data.title, data.description ?? null, data.notes || null,
  ]);
  revalidatePath("/issues");
  redirect(`/issues/${rows[0].id}`);
}

const updateSchema = z.object({
  issue_id: z.coerce.number().int().positive(),
  status: z.enum(statusValues),
  note: z.string().max(5000).optional(),
  records_corrected: z.union([z.literal("").transform(() => null), z.coerce.number().int().min(0)]).optional(),
});

export async function updateIssueAction(formData: FormData): Promise<void> {
  const user = await requireUser("analyst");
  const d = updateSchema.parse(Object.fromEntries(formData));
  await execute("select hub.fn_issue_update($1, $2, $3, $4, $5, $6)", [
    user.email, user.role, d.issue_id, d.status, d.note || null, d.records_corrected ?? null,
  ]);
  revalidatePath(`/issues/${d.issue_id}`);
  revalidatePath("/issues");
}

const userSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  role: z.enum(["viewer", "analyst", "admin"]),
  active: z.enum(["true", "false"]).transform((v) => v === "true"),
});

export async function upsertUserAction(formData: FormData): Promise<void> {
  const user = await requireUser("admin");
  const d = userSchema.parse(Object.fromEntries(formData));
  await execute("select hub.fn_app_user_upsert($1, $2, $3, $4, $5)", [user.email, user.role, d.email, d.role, d.active]);
  revalidatePath("/settings");
}

const weightSchema = z.object({ code: z.string().max(40), weight: z.coerce.number().positive().max(10) });

export async function updateWeightAction(formData: FormData): Promise<void> {
  const user = await requireUser("admin");
  const d = weightSchema.parse(Object.fromEntries(formData));
  await execute("select hub.fn_dimension_weight_update($1, $2, $3, $4)", [user.email, user.role, d.code, d.weight]);
  revalidatePath("/", "layout");
}
