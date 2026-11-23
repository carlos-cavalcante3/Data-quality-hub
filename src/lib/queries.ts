import "server-only";
import { query, queryOne } from "./db";

// ----------------------------------------------------------------------------
// Tipos
// ----------------------------------------------------------------------------
export type Run = {
  id: number; started_at: Date; finished_at: Date | null; status: string; triggered_by: string;
  rules_total: number | null; rules_ok: number | null; rules_error: number | null; datasets_ok: number | null; duration_ms: number | null;
};
export type Score = {
  level: "geral" | "dimensao" | "dataset" | "dataset_dimensao"; dataset_name: string | null; dimension: string | null;
  score: number | null; records_evaluated: number; records_passed: number; rules_count: number; status: string;
};
export type TrendPoint = { day: string; level: string; dataset_name: string | null; dimension: string | null; score: number | null; records_evaluated: number };
export type Rule = {
  id: number; code: string; name: string; problem_label: string | null; impact: string | null; recommendation: string | null; min_population: number; description: string; dataset_name: string; column_name: string | null;
  dimension: string; dimension_name: string; entity: string; population: string; severity: string; expected_threshold: number;
  check_sql: string; version: number; active: boolean; updated_at: Date; layer: string | null; criticality: number | null;
  last_run_id: number | null; last_evaluated_at: Date | null; last_status: string | null; error_message: string | null;
  records_evaluated: number | null; records_passed: number | null; records_failed: number | null; quality_score: number | null;
  band: string; meets_threshold: boolean | null; previous_score: number | null; previous_day: string | null; delta_score: number | null;
};
export type Department = { id: number; code: string; name: string; source: string; priority: number; active: boolean };
export type DepartmentSummary = {
  department_id: number; code: string; name: string; source: string; priority: number;
  deals_comerciais: number; empresas_clientes: number; checks_evaluated: number; occurrences: number;
  unique_records_with_issues: number; overall_score: number | null; completeness_score: number | null; band: string;
  previous_score: number | null; previous_day: string | null; delta_score: number | null; open_issues: number;
};
export type Pipeline = {
  name: string; display_name: string; description: string | null; orchestrator: string | null; schedule_desc: string | null;
  expected_interval: string | null; source_system: string | null; repository: string | null; evidence_source: string | null;
  last_execution_at: Date | null; last_success_at: Date | null; runs_30d: number; failures_30d: number;
  success_rate_30d: number | null; avg_duration_s: number | null; has_inferred: boolean; health: string;
};
export type Execution = {
  id: string; pipeline_name: string; execution_id: string; started_at: Date; finished_at: Date | null; duration_s: number | null;
  status: string; source: string | null; records_extracted: number | null; records_inserted: number | null;
  records_updated: number | null; records_rejected: number | null; error_message: string | null; code_version: string | null;
  run_url: string | null; details: Record<string, unknown> | null; inferred: boolean; evidence: string;
};
export type DatasetMetric = {
  dataset_name: string; collected_at: Date; row_count: number | null; last_updated_at: Date | null; freshness_minutes: number | null;
  expected_interval: string | null; freshness_status: string; volume_variation_pct: number | null; error_message: string | null;
  layer: string | null; pipeline_name: string | null; criticality: number | null; update_frequency: string | null; description: string | null;
};
export type Failure = {
  run_id: number; rule_code: string; rule_name: string; problem_label: string | null; dimension: string; dataset_name: string; entity: string;
  record_id: string; record_label: string | null; detail: string | null; department_id: number | null; department_name: string | null;
};
export type Issue = {
  id: number; rule_id: number | null; department_id: number | null; title: string; description: string | null;
  affected_records: number | null; baseline_score: number | null; detected_at: Date; communicated_at: Date | null;
  status: string; resolved_at: Date | null; records_corrected: number | null; notes: string | null; created_by: string;
  updated_at: Date; rule_code: string | null; rule_name: string | null; dimension: string | null; dataset_name: string | null;
  department_name: string | null; current_score: number | null; current_failed: number | null; events_count: number;
};
export type CatalogObject = {
  schema_name: string; object_name: string; full_name: string; object_type: string; estimated_rows: number | null;
  total_bytes: number | null; rls_enabled: boolean; policy_count: number; comment: string | null; column_count: number;
  definition: string | null; owner: string; last_analyzed_at: Date | null; layer: string | null; registry_description: string | null;
  criticality: number | null; contains_personal_data: boolean | null; pipeline_name: string | null; exact_rows: number | null;
  metrics_collected_at: Date | null; last_updated_at: Date | null; freshness_status: string | null; is_hub_object: boolean;
};
export type CatalogColumn = {
  schema_name: string; object_name: string; full_name: string; ordinal: number; column_name: string; data_type: string;
  base_type: string; is_nullable: boolean; column_default: string | null; is_primary_key: boolean; is_unique: boolean;
  foreign_key_ref: string | null; is_indexed: boolean; comment: string | null; null_frac: number | null; n_distinct: number | null; avg_width: number | null;
};
export type LineageEdge = { source_dataset: string; destination_dataset: string; edge_type: string; pipeline_name: string | null; transformation_name: string | null; origin: string };

// ----------------------------------------------------------------------------
// Execuções e índices
// ----------------------------------------------------------------------------
export const getLastRun = () => queryOne<Run>("select * from hub.v_last_run");
export const getRuns = (limit = 30) => query<Run>("select * from hub.v_runs order by started_at desc limit $1", [limit]);

export const getScoresLatest = () =>
  query<Score>("select level, dataset_name, dimension, score, records_evaluated, records_passed, rules_count, status from hub.v_scores_latest");

export const getScoresLatestDepartment = () =>
  query<Score & { department_id: number; department_name: string }>(
    "select department_id, department_name, level, dataset_name, dimension, score, records_evaluated, records_passed, rules_count, status from hub.v_scores_latest_department",
  );

export const getScoreTrend = (days: number) =>
  query<TrendPoint>(
    `select day::text as day, level, dataset_name, dimension, score, records_evaluated
     from hub.v_score_trend where day >= (now() at time zone 'America/Sao_Paulo')::date - $1::int order by day`,
    [days],
  );

export const getScoreTrendDepartment = (days: number, departmentId?: number) =>
  query<TrendPoint & { department_id: number; department_name: string }>(
    `select day::text as day, department_id, department_name, level, null::text as dataset_name, dimension, score, records_evaluated
     from hub.v_score_trend_department
     where day >= (now() at time zone 'America/Sao_Paulo')::date - $1::int and ($2::int is null or department_id = $2)
     order by day`,
    [days, departmentId ?? null],
  );

// ----------------------------------------------------------------------------
// Regras
// ----------------------------------------------------------------------------
export const getRules = () => query<Rule>("select * from hub.v_rules order by dimension, code");
export const getRule = (code: string) => queryOne<Rule>("select * from hub.v_rules where code = $1", [code]);

export const getRuleHistory = (code: string, days: number, departmentId?: number | null) =>
  query<{ day: string; run_id: number; records_evaluated: number; records_passed: number; records_failed: number; quality_score: number | null; status: string }>(
    `select distinct on (day) day::text as day, run_id, records_evaluated, records_passed, records_failed, quality_score, status
     from hub.v_rule_results
     where rule_code = $1 and day >= (now() at time zone 'America/Sao_Paulo')::date - $2::int
       and (($3::int is null and department_id is null) or department_id = $3)
     order by day, run_started_at desc`,
    [code, days, departmentId ?? null],
  );

export const getRuleByDepartment = (code: string) =>
  query<{ department_id: number; department_name: string; records_evaluated: number; records_passed: number; records_failed: number; quality_score: number | null }>(
    `select department_id, department_name, records_evaluated, records_passed, records_failed, quality_score
     from hub.v_rule_results
     where rule_code = $1 and department_id is not null and run_id = (select id from hub.v_last_run)
     order by records_failed desc`,
    [code],
  );

export type DeptRuleResult = { rule_code: string; rule_name: string; problem_label: string | null; severity: string; entity: string; column_name: string | null; dimension: string; dataset_name: string; records_evaluated: number; records_failed: number; quality_score: number | null };
export const getDepartmentRuleResults = (departmentId: number) =>
  query<DeptRuleResult & { dimension: string; dataset_name: string; records_evaluated: number; records_failed: number; quality_score: number | null }>(
    `select rule_code, rule_name, problem_label, severity, entity, column_name, dimension, dataset_name, records_evaluated, records_failed, quality_score
     from hub.v_rule_results where department_id = $1 and run_id = (select id from hub.v_last_run) and status = 'ok'
     order by records_failed desc`,
    [departmentId],
  );

export type FailureFilter = { rule?: string; department?: number | null; search?: string; page?: number; pageSize?: number };

export async function getFailures(f: FailureFilter) {
  const pageSize = Math.min(f.pageSize ?? 50, 500);
  const offset = Math.max(0, ((f.page ?? 1) - 1) * pageSize);
  const where = `($1::text is null or rule_code = $1) and ($2::int is null or department_id = $2)
                 and ($3::text is null or record_label ilike '%' || $3 || '%' or record_id ilike '%' || $3 || '%')`;
  const params = [f.rule ?? null, f.department ?? null, f.search?.trim() || null];
  const [rows, total] = await Promise.all([
    query<Failure>(`select * from hub.v_failures_latest where ${where} order by department_name nulls last, record_label limit ${pageSize} offset ${offset}`, params),
    queryOne<{ n: number }>(`select count(*)::int as n from hub.v_failures_latest where ${where}`, params),
  ]);
  return { rows, total: total?.n ?? 0, pageSize, page: f.page ?? 1 };
}

export const getFailuresForExport = (rule: string | null, department: number | null, limit = 20000) =>
  query<Failure>(
    `select * from hub.v_failures_latest where ($1::text is null or rule_code = $1) and ($2::int is null or department_id = $2)
     order by rule_code, department_name nulls last, record_label limit $3`,
    [rule, department, limit],
  );

// ----------------------------------------------------------------------------
// Departamentos
// ----------------------------------------------------------------------------
export const getDepartments = () => query<Department>("select * from hub.v_departments where active order by priority, name");
export const getDepartmentSummary = () => query<DepartmentSummary>("select * from hub.v_department_summary order by priority, name");
export const getDepartmentDimensionIssues = () =>
  query<{ department_id: number; department_name: string; dimension: string; occurrences: number; checks_evaluated: number }>(
    "select * from hub.v_department_dimension_issues",
  );

// ----------------------------------------------------------------------------
// Observabilidade
// ----------------------------------------------------------------------------
export const getPipelines = () => query<Pipeline>("select *, expected_interval::text as expected_interval from hub.v_pipelines order by name");

export const getExecutions = (opts: { pipeline?: string | null; days?: number; limit?: number }) =>
  query<Execution>(
    `select * from hub.v_pipeline_executions
     where ($1::text is null or pipeline_name = $1) and started_at >= now() - make_interval(days => $2::int)
     order by started_at desc limit $3`,
    [opts.pipeline ?? null, opts.days ?? 30, opts.limit ?? 500],
  );

export const getExecution = (id: string) => queryOne<Execution>("select * from hub.v_pipeline_executions where id = $1", [id]);

export const getExecutionDaily = (days: number) =>
  query<{ day: string; pipeline_name: string; sucesso: number; falha: number; outros: number }>(
    `select (started_at at time zone 'America/Sao_Paulo')::date::text as day, pipeline_name,
            count(*) filter (where status = 'sucesso')::int as sucesso,
            count(*) filter (where status = 'falha')::int as falha,
            count(*) filter (where status not in ('sucesso','falha'))::int as outros
     from hub.v_pipeline_executions where started_at >= now() - make_interval(days => $1::int)
     group by 1, 2 order by 1`,
    [days],
  );

export const getDatasetMetricsLatest = () =>
  query<DatasetMetric>("select *, expected_interval::text as expected_interval from hub.v_dataset_metrics_latest order by layer, dataset_name");

export const getDatasetMetricsHistory = (dataset: string, days: number) =>
  query<{ day: string; collected_at: Date; row_count: number | null; freshness_minutes: number | null; volume_variation_pct: number | null }>(
    `select distinct on (day) day::text as day, collected_at, row_count, freshness_minutes, volume_variation_pct
     from hub.v_dataset_metrics_history where dataset_name = $1 and collected_at >= now() - make_interval(days => $2::int)
     order by day, collected_at desc`,
    [dataset, days],
  );

export const getSchemaChanges = (limit = 50) =>
  query<{ dataset_name: string; captured_at: Date; columns: { name: string; type: string; not_null: boolean }[]; previous_columns: { name: string; type: string; not_null: boolean }[]; previous_captured_at: Date }>(
    "select * from hub.v_schema_changes order by captured_at desc limit $1",
    [limit],
  );

export const getRunResults = (runId: number) =>
  query<{ rule_code: string; rule_name: string; dimension: string; records_evaluated: number; records_failed: number; quality_score: number | null; status: string; error_message: string | null }>(
    `select rule_code, rule_name, dimension, records_evaluated, records_failed, quality_score, status, error_message
     from hub.v_rule_results where run_id = $1 and department_id is null order by dimension, rule_code`,
    [runId],
  );

// ----------------------------------------------------------------------------
// Issues
// ----------------------------------------------------------------------------
export const getIssues = (status?: string | null, department?: number | null) =>
  query<Issue>(
    `select * from hub.v_issues where ($1::text is null or status = $1) and ($2::int is null or department_id = $2)
     order by (status in ('resolvido','nao_aplicavel')), detected_at desc`,
    [status ?? null, department ?? null],
  );
export const getIssue = (id: number) => queryOne<Issue>("select * from hub.v_issues where id = $1", [id]);
export const getIssueEvents = (id: number) =>
  query<{ id: number; at: Date; actor: string; old_status: string | null; new_status: string | null; note: string | null }>(
    "select * from hub.v_issue_events where issue_id = $1 order by at",
    [id],
  );

// ----------------------------------------------------------------------------
// Catálogo e linhagem
// ----------------------------------------------------------------------------
export const getCatalogObjects = () =>
  query<CatalogObject>("select * from hub.v_catalog_objects order by is_hub_object, schema_name, object_type, object_name");
export const getCatalogObject = (fullName: string) =>
  queryOne<CatalogObject>("select * from hub.v_catalog_objects where full_name = $1", [fullName]);
export const getCatalogColumns = (fullName: string) =>
  query<CatalogColumn>("select * from hub.v_catalog_columns where full_name = $1 order by ordinal", [fullName]);
export const getAllCatalogColumns = () =>
  query<CatalogColumn>("select * from hub.v_catalog_columns order by schema_name, object_name, ordinal");
export const getCatalogFunctions = () =>
  query<{ schema_name: string; function_name: string; arguments: string; result_type: string; security: string; language: string; comment: string | null }>(
    "select * from hub.v_catalog_functions order by schema_name, function_name",
  );
export const searchColumns = (term: string) =>
  query<CatalogColumn>(
    "select * from hub.v_catalog_columns where column_name ilike '%' || $1 || '%' order by schema_name, object_name, ordinal limit 300",
    [term],
  );

export const getLineageEdges = () => query<LineageEdge>("select * from hub.v_lineage_edges");
export const getDatasetRegistry = () =>
  query<{ dataset_name: string; layer: string; object_type: string; source_system: string | null; source_dataset: string | null; description: string | null; pipeline_name: string | null; update_frequency: string | null; expected_interval: string | null; criticality: number; contains_personal_data: boolean; monitored: boolean }>(
    "select *, expected_interval::text as expected_interval from hub.v_dataset_registry order by layer, dataset_name",
  );
export const getTransformations = () =>
  query<{ name: string; description: string; pipeline_name: string | null; implemented_in: string | null; rule_summary: string | null }>(
    "select * from hub.v_transformations order by name",
  );

// ----------------------------------------------------------------------------
// Configurações
// ----------------------------------------------------------------------------
export const getDimensions = () =>
  query<{ code: string; name: string; description: string; weight: number; sort: number }>("select * from hub.v_dimensions order by sort");
export const getAppUsers = () => query<{ email: string; role: string; active: boolean; created_at: Date }>("select * from hub.v_app_users order by email");
export const getAuditLog = (limit = 100) =>
  query<{ id: number; at: Date; actor: string; action: string; target: string | null; details: unknown }>(
    "select * from hub.v_audit_log order by at desc limit $1",
    [limit],
  );

// ----------------------------------------------------------------------------
// Composição dos departamentos
// ----------------------------------------------------------------------------
export const getDepartmentMembers = (departmentId: number) =>
  query<{ user_id: string; user_name: string; rule: string; all_teams: string | null; teams_count: number; deals_total: number; deals_comerciais: number; empresas: number }>(
    "select * from hub.v_department_members where department_id = $1 order by deals_total desc, user_name",
    [departmentId],
  );
export const getDepartmentPipelines = (departmentId: number) =>
  query<{ pipeline_name: string | null; escopo: string; deals: number }>(
    "select pipeline_name, escopo, deals from hub.v_department_pipelines where department_id = $1 order by deals desc",
    [departmentId],
  );
export const getDepartmentEntities = (departmentId?: number | null) =>
  query<{ department_id: number; entity: string; rules: number; checks_evaluated: number; occurrences: number }>(
    "select * from hub.v_department_entities where ($1::int is null or department_id = $1) order by checks_evaluated desc",
    [departmentId ?? null],
  );
export const getTeamMembersAssignedElsewhere = (departmentId: number, teamName: string) =>
  query<{ user_name: string; department_id: number; all_teams: string | null }>(
    `select m.user_name, m.department_id, m.all_teams from hub.v_department_members m
     where m.department_id <> $1 and $2 = any (string_to_array(m.all_teams, ', ')) order by m.user_name`,
    [departmentId, teamName],
  );
