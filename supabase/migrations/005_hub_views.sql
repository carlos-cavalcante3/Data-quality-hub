-- =============================================================================
-- 005 - Índice de qualidade e views consumidas pela aplicação (schema hub)
-- A aplicação só enxerga o schema hub (papel hub_app).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Índice de qualidade (documentado em docs/METRICAS.md)
--   score(dataset, dimensão) = 100 × Σ aprovados / Σ avaliados   (regras da dimensão no dataset)
--   score(dataset)           = Σ score(ds,dim) × peso(dim) / Σ peso(dim)   (só dimensões avaliadas)
--   peso(dataset)            = criticidade × log10(volume + 10)
--   score(dimensão)          = Σ score(ds,dim) × peso(ds) / Σ peso(ds)
--   score(geral)             = Σ score(ds) × peso(ds) / Σ peso(ds)
--   Combinações com menos de 20 registros avaliados = "dados_insuficientes" e ficam fora da agregação.
-- -----------------------------------------------------------------------------
create or replace function quality.fn_run_scores(p_run bigint, p_department int default null)
returns table (
  level             text,
  dataset_name      text,
  dimension         text,
  score             numeric,
  records_evaluated bigint,
  records_passed    bigint,
  rules_count       int,
  status            text
)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
with res as (
  select r.dataset_name, r.dimension, vr.records_evaluated, vr.records_passed
  from quality.validation_results vr
  join quality.validation_rules r on r.id = vr.rule_id
  where vr.run_id = p_run and vr.status = 'ok' and vr.records_evaluated > 0
    and ((p_department is null and vr.department_id is null) or vr.department_id = p_department)
),
dd_all as (
  select dataset_name, dimension,
         sum(records_evaluated)::bigint ev, sum(records_passed)::bigint ps, count(*)::int n,
         100.0 * sum(records_passed) / sum(records_evaluated) sc
  from res group by dataset_name, dimension
),
dd as (select * from dd_all where ev >= 20),
ds as (
  select dd.dataset_name, sum(dd.sc * dm.weight) / sum(dm.weight) sc,
         sum(dd.ev)::bigint ev, sum(dd.ps)::bigint ps, sum(dd.n)::int n, max(dd.ev) vol
  from dd join quality.dimensions dm on dm.code = dd.dimension
  group by dd.dataset_name
),
dsw as (
  select ds.*, coalesce(reg.criticality, 2) * log(10::numeric, (ds.vol + 10)::numeric) w
  from ds left join provenance.dataset_registry reg on reg.dataset_name = ds.dataset_name
)
select 'dataset_dimensao', dataset_name, dimension, round(sc, 2), ev, ps, n,
       case when ev < 20 then 'dados_insuficientes' else 'ok' end
from dd_all
union all
select 'dataset', dataset_name, null, round(sc, 2), ev, ps, n, 'ok' from dsw
union all
select 'dimensao', null, dd.dimension, round(sum(dd.sc * dsw.w) / sum(dsw.w), 2), sum(dd.ev)::bigint, sum(dd.ps)::bigint, sum(dd.n)::int, 'ok'
from dd join dsw on dsw.dataset_name = dd.dataset_name
group by dd.dimension
union all
select 'geral', null, null, round(sum(sc * w) / sum(w), 2), sum(ev)::bigint, sum(ps)::bigint, sum(n)::int, 'ok'
from dsw having count(*) > 0
$$;
revoke all on function quality.fn_run_scores(bigint, int) from public;
grant execute on function quality.fn_run_scores(bigint, int) to hub_app;

create or replace function quality.fn_band(p_score numeric, p_threshold numeric default null)
returns text language sql immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when p_score is null then 'dados_insuficientes'
    when p_score >= 95 then 'alta'
    when p_score >= 80 then 'intermediaria'
    else 'baixa' end
$$;
grant execute on function quality.fn_band(numeric, numeric) to hub_app;

-- -----------------------------------------------------------------------------
-- Cadastros
-- -----------------------------------------------------------------------------
create or replace view hub.v_departments as
select id, code, name, source, source_ref, priority, active from governance.departments;

create or replace view hub.v_dimensions as
select code, name, description, weight, sort from quality.dimensions;

create or replace view hub.v_dataset_registry as
select * from provenance.dataset_registry;

create or replace view hub.v_transformations as
select * from provenance.transformation_registry;

-- -----------------------------------------------------------------------------
-- Execuções de validação
-- -----------------------------------------------------------------------------
create or replace view hub.v_runs as
select id, started_at, finished_at, status, triggered_by, rules_total, rules_ok, rules_error, datasets_ok, duration_ms
from quality.validation_runs;

create or replace view hub.v_last_run as
select * from hub.v_runs where status in ('sucesso','parcial') order by started_at desc limit 1;

-- Última execução válida de cada dia (fuso de Brasília): base das séries temporais.
create or replace view hub.v_daily_runs as
select distinct on ((started_at at time zone 'America/Sao_Paulo')::date)
       (started_at at time zone 'America/Sao_Paulo')::date as day, id as run_id, started_at
from quality.validation_runs
where status in ('sucesso','parcial')
order by (started_at at time zone 'America/Sao_Paulo')::date, started_at desc;

-- -----------------------------------------------------------------------------
-- Regras e resultados
-- -----------------------------------------------------------------------------
create or replace view hub.v_rule_results as
select vr.id, vr.run_id, ru.started_at as run_started_at,
       (ru.started_at at time zone 'America/Sao_Paulo')::date as day,
       r.id as rule_id, r.code as rule_code, r.name as rule_name, r.dimension, r.dataset_name,
       vr.department_id, d.name as department_name,
       vr.records_evaluated, vr.records_passed, vr.records_failed, vr.quality_score, vr.status, vr.error_message,
       vr.rule_version, vr.evaluated_at
from quality.validation_results vr
join quality.validation_rules r on r.id = vr.rule_id
join quality.validation_runs ru on ru.id = vr.run_id
left join governance.departments d on d.id = vr.department_id;

create or replace view hub.v_rules as
with last as (select run_id from hub.v_daily_runs order by day desc limit 1),
     cur as (
       select vr.* from quality.validation_results vr
       where vr.department_id is null and vr.run_id = (select id from hub.v_last_run)),
     prev as (
       -- resultado de ~30 dias atrás (execução diária mais próxima)
       select distinct on (vr.rule_id) vr.rule_id, vr.quality_score, dr.day
       from quality.validation_results vr
       join hub.v_daily_runs dr on dr.run_id = vr.run_id
       where vr.department_id is null and vr.status = 'ok'
         and dr.day <= (now() at time zone 'America/Sao_Paulo')::date - 1
       order by vr.rule_id, abs(dr.day - ((now() at time zone 'America/Sao_Paulo')::date - 30)), dr.day desc)
select r.id, r.code, r.name, r.description, r.dataset_name, r.column_name, r.dimension, dm.name as dimension_name,
       r.entity, r.population, r.severity, r.expected_threshold, r.check_sql, r.version, r.active, r.updated_at,
       reg.layer, reg.criticality,
       cur.run_id as last_run_id, cur.evaluated_at as last_evaluated_at, cur.status as last_status, cur.error_message,
       cur.records_evaluated, cur.records_passed, cur.records_failed, cur.quality_score,
       case when cur.status = 'erro' then 'validacao_nao_executada'
            when cur.status is null then 'validacao_nao_executada'
            when cur.records_evaluated < 20 then 'dados_insuficientes'
            else quality.fn_band(cur.quality_score) end as band,
       cur.quality_score >= r.expected_threshold as meets_threshold,
       prev.quality_score as previous_score, prev.day as previous_day,
       cur.quality_score - prev.quality_score as delta_score
from quality.validation_rules r
join quality.dimensions dm on dm.code = r.dimension
left join provenance.dataset_registry reg on reg.dataset_name = r.dataset_name
left join cur on cur.rule_id = r.id
left join prev on prev.rule_id = r.id;

-- Registros afetados na última execução (somente id + rótulo não sensível).
create or replace view hub.v_failures_latest as
select f.run_id, r.code as rule_code, r.name as rule_name, r.dimension, r.dataset_name, r.entity,
       f.record_id, f.record_label, f.detail, f.department_id, d.name as department_name
from quality.validation_failures f
join quality.validation_rules r on r.id = f.rule_id
left join governance.departments d on d.id = f.department_id
where f.run_id = (select id from hub.v_last_run);

-- -----------------------------------------------------------------------------
-- Índices (última execução e séries)
-- -----------------------------------------------------------------------------
create or replace view hub.v_scores_latest as
select lr.id as run_id, lr.started_at, s.*
from hub.v_last_run lr
cross join lateral quality.fn_run_scores(lr.id, null) s;

create or replace view hub.v_scores_latest_department as
select lr.id as run_id, d.id as department_id, d.name as department_name, s.*
from hub.v_last_run lr
cross join governance.departments d
cross join lateral quality.fn_run_scores(lr.id, d.id) s
where d.active;

create or replace view hub.v_score_trend as
select dr.day, dr.run_id, s.level, s.dataset_name, s.dimension, s.score, s.records_evaluated, s.records_passed
from hub.v_daily_runs dr
cross join lateral quality.fn_run_scores(dr.run_id, null) s
where s.level in ('geral','dimensao','dataset');

create or replace view hub.v_score_trend_department as
select dr.day, dr.run_id, d.id as department_id, d.name as department_name, s.level, s.dimension, s.score, s.records_evaluated
from hub.v_daily_runs dr
cross join governance.departments d
cross join lateral quality.fn_run_scores(dr.run_id, d.id) s
where d.active and s.level in ('geral','dimensao');

-- Problemas por departamento e dimensão (ocorrências ≠ registros únicos)
create or replace view hub.v_department_dimension_issues as
select vr.department_id, d.name as department_name, r.dimension,
       sum(vr.records_failed)::bigint as occurrences,
       sum(vr.records_evaluated)::bigint as checks_evaluated
from quality.validation_results vr
join quality.validation_rules r on r.id = vr.rule_id
join governance.departments d on d.id = vr.department_id
where vr.run_id = (select id from hub.v_last_run) and vr.status = 'ok'
group by vr.department_id, d.name, r.dimension;

create or replace view hub.v_department_summary as
with lr as (select id from hub.v_last_run),
pop_deals as (
  select coalesce(department_id, (select id from governance.departments where code = 'nao_identificado')) department_id, count(*) n
  from quality.vw_deals_comerciais group by 1),
pop_orgs as (
  select coalesce(department_id, (select id from governance.departments where code = 'nao_identificado')) department_id, count(*) n
  from quality.vw_orgs_clientes group by 1),
fails as (
  select f.department_id,
         count(*)::bigint as occurrences,
         count(distinct r.entity || ':' || f.record_id)::bigint as unique_records
  from quality.validation_failures f
  join quality.validation_rules r on r.id = f.rule_id
  where f.run_id = (select id from lr) and r.entity <> 'dataset'
  group by f.department_id),
checks as (
  select vr.department_id, sum(vr.records_evaluated)::bigint as checks_evaluated
  from quality.validation_results vr where vr.run_id = (select id from lr) and vr.department_id is not null
  group by vr.department_id),
sc as (
  select department_id,
         max(score) filter (where level = 'geral') as overall_score,
         max(score) filter (where level = 'dimensao' and dimension = 'completude') as completeness_score
  from hub.v_scores_latest_department group by department_id),
prev as (
  select distinct on (t.department_id) t.department_id, t.score as previous_score, t.day as previous_day
  from hub.v_score_trend_department t
  where t.level = 'geral' and t.day <= (now() at time zone 'America/Sao_Paulo')::date - 1
  order by t.department_id, abs(t.day - ((now() at time zone 'America/Sao_Paulo')::date - 30)), t.day desc)
select d.id as department_id, d.code, d.name, d.source, d.priority,
       coalesce(pd.n, 0) as deals_comerciais, coalesce(po.n, 0) as empresas_clientes,
       coalesce(ch.checks_evaluated, 0) as checks_evaluated,
       coalesce(f.occurrences, 0) as occurrences, coalesce(f.unique_records, 0) as unique_records_with_issues,
       sc.overall_score, sc.completeness_score, quality.fn_band(sc.overall_score) as band,
       prev.previous_score, prev.previous_day, sc.overall_score - prev.previous_score as delta_score,
       (select count(*) from quality.quality_issues qi where qi.department_id = d.id and qi.status not in ('resolvido','nao_aplicavel')) as open_issues
from governance.departments d
left join pop_deals pd on pd.department_id = d.id
left join pop_orgs po on po.department_id = d.id
left join checks ch on ch.department_id = d.id
left join fails f on f.department_id = d.id
left join sc on sc.department_id = d.id
left join prev on prev.department_id = d.id
where d.active;

-- -----------------------------------------------------------------------------
-- Observabilidade
-- -----------------------------------------------------------------------------
create or replace view hub.v_dataset_metrics_latest as
select distinct on (m.dataset_name)
       m.dataset_name, m.collected_at, m.row_count, m.last_updated_at, m.freshness_minutes, m.expected_interval,
       m.freshness_status, m.volume_variation_pct, m.error_message,
       r.layer, r.pipeline_name, r.criticality, r.update_frequency, r.description
from observability.dataset_metrics m
left join provenance.dataset_registry r on r.dataset_name = m.dataset_name
order by m.dataset_name, m.collected_at desc;

create or replace view hub.v_dataset_metrics_history as
select dataset_name, collected_at, (collected_at at time zone 'America/Sao_Paulo')::date as day,
       row_count, last_updated_at, freshness_minutes, freshness_status, volume_variation_pct
from observability.dataset_metrics where error_message is null;

create or replace view hub.v_pipeline_executions as
select 'ctl:' || e.id as id, e.pipeline_name, e.execution_id, e.started_at, e.finished_at,
       extract(epoch from e.finished_at - e.started_at)::numeric as duration_s, e.status, e.source,
       e.records_extracted, e.records_inserted, e.records_updated, e.records_rejected,
       e.error_message, e.code_version, e.run_url, e.details, false as inferred, 'control.pipeline_executions' as evidence
from control.pipeline_executions e
union all
select 'etl:' || l.id, 'etl-prevendas', l.id::text, l.executado_em, null, null,
       case l.status when 'sucesso' then 'sucesso' else 'falha' end, 'privado.etl_sync_log',
       null, l.linhas_processadas::bigint, null, null,
       case when l.status <> 'sucesso' then l.detalhes end, null, null,
       case when l.detalhes is not null then jsonb_build_object('detalhes', l.detalhes) end, false, 'privado.etl_sync_log'
from privado.etl_sync_log l
union all
select 'rds:' || s.id, 'rd-sync-prevendas', to_char(s.ultimo_inicio, 'YYYYMMDDHH24MISS'), s.ultimo_inicio, s.ultimo_fim,
       extract(epoch from s.ultimo_fim - s.ultimo_inicio)::numeric,
       case s.ultimo_status when 'sucesso' then 'sucesso' when 'parcial' then 'parcial' else 'falha' end, 'privado.rd_sync_state',
       null, null, null, null, case when s.ultimo_status <> 'sucesso' then s.detalhes end, null, null,
       jsonb_build_object('detalhes', s.detalhes, 'cursor_updated_at', s.cursor_updated_at), false, 'privado.rd_sync_state (somente último estado)'
from privado.rd_sync_state s
union all
select 'dq:' || v.id, 'dq-hub-validacoes', v.id::text, v.started_at, v.finished_at,
       extract(epoch from v.finished_at - v.started_at)::numeric,
       case v.status when 'sucesso' then 'sucesso' when 'parcial' then 'parcial' when 'em_andamento' then 'em_andamento' else 'falha' end,
       'quality.run_all', null, null, null, null,
       case when v.rules_error > 0 then v.rules_error || ' regra(s) com erro' end, null, null,
       jsonb_build_object('rules_ok', v.rules_ok, 'rules_error', v.rules_error, 'datasets_ok', v.datasets_ok, 'triggered_by', v.triggered_by),
       false, 'quality.validation_runs'
from quality.validation_runs v
union all
-- Evidência indireta do ETL principal: um snapshot diário gravado = execução diária concluída.
select 'snap:' || to_char(g.day, 'YYYYMMDD'), 'etl-rd-principal', 'snapshot-' || to_char(g.day, 'YYYY-MM-DD'),
       (g.day::timestamp at time zone 'America/Sao_Paulo'), null, null,
       case when g.ok then 'sucesso' else 'falha' end, 'inferido: gold.deals_snapshot_datas',
       null, null, null, null,
       case when not g.ok then 'Nenhum snapshot diário gravado neste dia' end, null, null, null, true,
       'Evidência indireta (snapshot diário). Instrumente o ETL para registrar execuções reais.'
from (
  select gs::date as day,
         exists (select 1 from gold.deals_snapshot_datas s where s.snapshot_date = gs::date)
         or exists (select 1 from gold.deals_snapshot s where s.snapshot_date = gs::date) as ok
  from generate_series(
         greatest((select min(snapshot_date) from gold.deals_snapshot_datas), current_date - 120),
         current_date, interval '1 day') gs
) g;

create or replace view hub.v_pipelines as
with ex as (select * from hub.v_pipeline_executions),
agg as (
  select pipeline_name,
         max(started_at) as last_execution_at,
         max(started_at) filter (where status = 'sucesso') as last_success_at,
         count(*) filter (where started_at >= now() - interval '30 days') as runs_30d,
         count(*) filter (where started_at >= now() - interval '30 days' and status = 'falha') as failures_30d,
         round(100.0 * count(*) filter (where started_at >= now() - interval '30 days' and status = 'sucesso')
               / nullif(count(*) filter (where started_at >= now() - interval '30 days'), 0), 1) as success_rate_30d,
         round(avg(duration_s) filter (where started_at >= now() - interval '30 days'), 1) as avg_duration_s,
         bool_or(inferred) as has_inferred
  from ex group by pipeline_name)
select p.name, p.display_name, p.description, p.orchestrator, p.schedule_desc, p.expected_interval,
       p.source_system, p.repository, p.evidence_source, p.active,
       a.last_execution_at, a.last_success_at, coalesce(a.runs_30d, 0) as runs_30d, coalesce(a.failures_30d, 0) as failures_30d,
       a.success_rate_30d, a.avg_duration_s, coalesce(a.has_inferred, false) as has_inferred,
       case
         when a.last_success_at is null then 'sem_evidencia'
         when p.expected_interval is null then 'sem_sla'
         when now() - a.last_success_at <= p.expected_interval then 'ok'
         when now() - a.last_success_at <= p.expected_interval * 2 then 'atrasado'
         else 'critico'
       end as health
from control.pipeline_registry p
left join agg a on a.pipeline_name = p.name;

create or replace view hub.v_schema_changes as
select s.dataset_name, s.captured_at, s.columns, prev.columns as previous_columns, prev.captured_at as previous_captured_at
from observability.schema_snapshots s
join lateral (
  select p.columns, p.captured_at from observability.schema_snapshots p
  where p.dataset_name = s.dataset_name and (p.captured_at, p.id) < (s.captured_at, s.id)
  order by p.captured_at desc, p.id desc limit 1
) prev on true;

-- -----------------------------------------------------------------------------
-- Issues & correções
-- -----------------------------------------------------------------------------
create or replace view hub.v_issues as
select i.*, r.code as rule_code, r.name as rule_name, r.dimension, r.dataset_name, d.name as department_name,
       cur.quality_score as current_score, cur.records_failed as current_failed,
       (select count(*) from quality.issue_events e where e.issue_id = i.id) as events_count
from quality.quality_issues i
left join quality.validation_rules r on r.id = i.rule_id
left join governance.departments d on d.id = i.department_id
left join lateral (
  select vr.quality_score, vr.records_failed from quality.validation_results vr
  where vr.rule_id = i.rule_id and vr.run_id = (select id from hub.v_last_run)
    and ((i.department_id is null and vr.department_id is null) or vr.department_id = i.department_id)
  limit 1) cur on true;

create or replace view hub.v_issue_events as
select * from quality.issue_events;

-- -----------------------------------------------------------------------------
-- Catálogo do banco (todas as tabelas, views e materializadas + colunas)
-- -----------------------------------------------------------------------------
create or replace view hub.v_catalog_objects as
select n.nspname as schema_name, c.relname as object_name, n.nspname || '.' || c.relname as full_name,
       case c.relkind when 'r' then 'tabela' when 'p' then 'tabela particionada' when 'v' then 'view'
                      when 'm' then 'view materializada' when 'f' then 'tabela externa' end as object_type,
       case when c.relkind in ('r','p','m') then coalesce(st.n_live_tup, nullif(c.reltuples, -1)::bigint) end as estimated_rows,
       case when c.relkind in ('r','p','m') then pg_total_relation_size(c.oid) end as total_bytes,
       c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policy_count,
       obj_description(c.oid, 'pg_class') as comment,
       (select count(*) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)::int as column_count,
       case when c.relkind in ('v','m') then pg_get_viewdef(c.oid, true) end as definition,
       pg_get_userbyid(c.relowner) as owner,
       greatest(st.last_analyze, st.last_autoanalyze) as last_analyzed_at,
       r.layer, r.description as registry_description, r.criticality, r.contains_personal_data, r.pipeline_name,
       m.row_count as exact_rows, m.collected_at as metrics_collected_at, m.last_updated_at, m.freshness_status,
       (n.nspname in ('governance','control','quality','observability','provenance','hub')) as is_hub_object
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_stat_all_tables st on st.relid = c.oid
left join provenance.dataset_registry r on r.dataset_name = n.nspname || '.' || c.relname
left join hub.v_dataset_metrics_latest m on m.dataset_name = n.nspname || '.' || c.relname
where n.nspname in ('bronze','silver','gold','privado','public','governance','control','quality','observability','provenance','hub')
  and c.relkind in ('r','p','v','m','f');

create or replace view hub.v_catalog_columns as
select n.nspname as schema_name, c.relname as object_name, n.nspname || '.' || c.relname as full_name,
       a.attnum as ordinal, a.attname as column_name,
       format_type(a.atttypid, a.atttypmod) as data_type,
       t.typname as base_type,
       not a.attnotnull as is_nullable,
       pg_get_expr(ad.adbin, ad.adrelid) as column_default,
       exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'p' and a.attnum = any (k.conkey)) as is_primary_key,
       exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'u' and a.attnum = any (k.conkey)) as is_unique,
       (select string_agg(fn.nspname || '.' || fc.relname || '.' || fa.attname, ', ')
          from pg_constraint k
          join pg_class fc on fc.oid = k.confrelid
          join pg_namespace fn on fn.oid = fc.relnamespace
          join pg_attribute fa on fa.attrelid = k.confrelid and fa.attnum = k.confkey[array_position(k.conkey, a.attnum)]
          where k.conrelid = c.oid and k.contype = 'f' and a.attnum = any (k.conkey)) as foreign_key_ref,
       exists (select 1 from pg_index i where i.indrelid = c.oid and a.attnum = any (i.indkey::int2[])) as is_indexed,
       col_description(c.oid, a.attnum) as comment,
       cs.null_frac, cs.n_distinct, cs.avg_width
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
join pg_type t on t.oid = a.atttypid
left join pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum
left join observability.column_stats cs on cs.dataset_name = n.nspname || '.' || c.relname and cs.column_name = a.attname
where n.nspname in ('bronze','silver','gold','privado','public','governance','control','quality','observability','provenance','hub')
  and c.relkind in ('r','p','v','m','f');

create or replace view hub.v_catalog_functions as
select n.nspname as schema_name, p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as result_type,
       case when p.prosecdef then 'definer' else 'invoker' end as security,
       l.lanname as language,
       obj_description(p.oid, 'pg_proc') as comment
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname in ('bronze','silver','gold','privado','public','governance','control','quality','observability','provenance','hub')
  and p.prokind in ('f','p');

-- -----------------------------------------------------------------------------
-- Linhagem: declarada + dependências reais entre views/MVs (pg_depend)
-- -----------------------------------------------------------------------------
create or replace view hub.v_lineage_edges as
select e.source_dataset, e.destination_dataset, e.edge_type, e.pipeline_name, e.transformation_name, 'declarada' as origin
from provenance.lineage_edges e
union
select distinct sn.nspname || '.' || sc.relname, vn.nspname || '.' || v.relname, 'dependencia_sql', null::text, null::text, 'catalogo_postgres'
from pg_rewrite rw
join pg_class v on v.oid = rw.ev_class
join pg_namespace vn on vn.oid = v.relnamespace
join pg_depend dep on dep.objid = rw.oid and dep.classid = 'pg_rewrite'::regclass and dep.refclassid = 'pg_class'::regclass
join pg_class sc on sc.oid = dep.refobjid
join pg_namespace sn on sn.oid = sc.relnamespace
where sc.oid <> v.oid
  and vn.nspname in ('bronze','silver','gold','privado','public')
  and sn.nspname in ('bronze','silver','gold','privado','public');

-- -----------------------------------------------------------------------------
-- Auditoria e usuários
-- -----------------------------------------------------------------------------
create or replace view hub.v_audit_log as
select id, at, actor, action, target, details from governance.audit_log;

create or replace view hub.v_app_users as
select email, role, active, created_at from governance.app_users;

-- Permissões do papel da aplicação: somente leitura no schema hub.
grant select on all tables in schema hub to hub_app;
