-- =============================================================================
-- 003 - Motor de validação
-- quality.run_all() executa todas as regras ativas, coleta métricas de
-- volume/atualidade/esquema e grava tudo com run_id (histórico preservado).
-- =============================================================================

-- Validação de CNPJ (dígitos verificadores). Aceita com ou sem máscara.
create or replace function quality.fn_cnpj_valido(p text)
returns boolean
language plpgsql immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  d text := regexp_replace(coalesce(p,''), '\D', '', 'g');
  w1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  w2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s int; r int; dv1 int; dv2 int;
begin
  if length(d) <> 14 or d ~ '^(\d)\1{13}$' then return false; end if;
  s := 0; for i in 1..12 loop s := s + substr(d,i,1)::int * w1[i]; end loop;
  r := s % 11; dv1 := case when r < 2 then 0 else 11 - r end;
  s := 0; for i in 1..13 loop s := s + substr(d,i,1)::int * w2[i]; end loop;
  r := s % 11; dv2 := case when r < 2 then 0 else 11 - r end;
  return substr(d,13,1)::int = dv1 and substr(d,14,1)::int = dv2;
end $$;

-- Máscara para exibição (LGPD): mantém só os 2 primeiros e os 2 últimos dígitos.
create or replace function quality.fn_mask_doc(p text)
returns text
language sql immutable
set search_path = pg_catalog, pg_temp
as $$
  select case when p is null or btrim(p) = '' then null
              else left(regexp_replace(p,'\D','','g'),2) || '.***.***/****-' || right(regexp_replace(p,'\D','','g'),2) end
$$;

create or replace function quality.run_all(p_triggered_by text default 'manual')
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_run      bigint;
  v_t0       timestamptz := clock_timestamp();
  v_unk      int;
  r          record;
  d          record;
  v_ok       int := 0;
  v_err      int := 0;
  v_ds_ok    int := 0;
  v_cnt      bigint;
  v_max      timestamptz;
  v_prev     bigint;
  v_schema   text;
  v_table    text;
begin
  if not pg_try_advisory_xact_lock(hashtext('quality.run_all')) then
    raise exception 'Já existe uma execução de validação em andamento';
  end if;

  perform set_config('statement_timeout', '120s', true);
  perform governance.sync_departments();
  v_unk := governance.fn_unassigned_department();

  insert into quality.validation_runs (triggered_by) values (left(p_triggered_by, 200))
  returning id into v_run;
  perform set_config('quality.run_id', v_run::text, true);

  -- 1) Métricas de volume e atualidade dos datasets monitorados ---------------
  for d in select * from provenance.dataset_registry where monitored and active and dataset_name like '%.%' order by dataset_name loop
    begin
      v_schema := split_part(d.dataset_name, '.', 1);
      v_table  := split_part(d.dataset_name, '.', 2);
      if d.freshness_expr is not null then
        execute format('select count(*), (%s)::timestamptz from %I.%I', d.freshness_expr, v_schema, v_table) into v_cnt, v_max;
      else
        execute format('select count(*), null::timestamptz from %I.%I', v_schema, v_table) into v_cnt, v_max;
      end if;

      select m.row_count into v_prev
      from observability.dataset_metrics m
      where m.dataset_name = d.dataset_name and m.error_message is null
      order by m.collected_at desc limit 1;

      insert into observability.dataset_metrics
        (run_id, dataset_name, row_count, last_updated_at, freshness_minutes, expected_interval, freshness_status, volume_variation_pct)
      values (
        v_run, d.dataset_name, v_cnt, v_max,
        case when v_max is not null then round((extract(epoch from now() - v_max) / 60)::numeric, 1) end,
        d.expected_interval,
        case
          when v_max is null and d.freshness_expr is not null then 'sem_dados'
          when d.expected_interval is null then 'sem_sla'
          when now() - v_max <= d.expected_interval then 'ok'
          when now() - v_max <= d.expected_interval * 2 then 'atrasado'
          else 'critico'
        end,
        case when v_prev > 0 then round(100.0 * (v_cnt - v_prev) / v_prev, 2) end
      );
      v_ds_ok := v_ds_ok + 1;
    exception when others then
      insert into observability.dataset_metrics (run_id, dataset_name, freshness_status, error_message)
      values (v_run, d.dataset_name, 'erro', left(sqlerrm, 500));
    end;
  end loop;

  -- 2) Snapshot de esquema (grava só quando a estrutura mudou) -----------------
  insert into observability.schema_snapshots (run_id, dataset_name, columns_hash, columns)
  select v_run, s.dataset_name, s.h, s.cols
  from (
    select n.nspname || '.' || c.relname as dataset_name,
           md5(string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' order by a.attnum)) as h,
           jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull) order by a.attnum) as cols
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname in ('bronze','silver','gold','privado','public')
      and c.relkind in ('r','v','m','p')
    group by n.nspname, c.relname
  ) s
  where not exists (
    select 1 from (
      select distinct on (ss.dataset_name) ss.dataset_name, ss.columns_hash
      from observability.schema_snapshots ss
      where ss.dataset_name = s.dataset_name
      order by ss.dataset_name, ss.captured_at desc, ss.id desc
    ) last where last.columns_hash = s.h
  );

  -- 2b) Perfil estatístico das colunas (estimativa do ANALYZE) -----------------
  begin
    delete from observability.column_stats;
    insert into observability.column_stats (dataset_name, column_name, null_frac, n_distinct, avg_width)
    select schemaname || '.' || tablename, attname, round(null_frac::numeric, 4), round(n_distinct::numeric, 4), avg_width
    from pg_stats
    where schemaname in ('bronze','silver','gold','privado','public')
      and not inherited;
  exception when others then
    raise notice 'column_stats: %', sqlerrm;
  end;

  -- 3) Regras de qualidade ----------------------------------------------------
  create temp table if not exists _dq_eval (
    record_id     text,
    department_id int,
    passed        boolean,
    record_label  text,
    detail        text
  ) on commit drop;

  for r in select * from quality.validation_rules where active order by id loop
    begin
      truncate _dq_eval;
      execute format(
        'insert into _dq_eval (record_id, department_id, passed, record_label, detail)
         select q.record_id::text, q.department_id::int, coalesce(q.passed, false), q.record_label::text, q.detail::text
         from (%s) as q(record_id, department_id, passed, record_label, detail)', r.check_sql);

      update _dq_eval set department_id = v_unk where department_id is null;

      -- consolidado
      insert into quality.validation_results
        (run_id, rule_id, rule_version, department_id, records_evaluated, records_passed, records_failed, quality_score, status)
      select v_run, r.id, r.version, null,
             count(*), count(*) filter (where passed), count(*) filter (where not passed),
             case when count(*) > 0 then round(100.0 * count(*) filter (where passed) / count(*), 2) end,
             case when count(*) = 0 then 'sem_dados' else 'ok' end
      from _dq_eval;

      -- por departamento
      insert into quality.validation_results
        (run_id, rule_id, rule_version, department_id, records_evaluated, records_passed, records_failed, quality_score, status)
      select v_run, r.id, r.version, e.department_id,
             count(*), count(*) filter (where passed), count(*) filter (where not passed),
             round(100.0 * count(*) filter (where passed) / count(*), 2), 'ok'
      from _dq_eval e
      group by e.department_id;

      -- registros afetados (somente id + rótulo não sensível)
      insert into quality.validation_failures (run_id, rule_id, record_id, department_id, record_label, detail)
      select distinct on (record_id) v_run, r.id, record_id, department_id, left(record_label, 200), left(detail, 300)
      from _dq_eval where not passed
      order by record_id;

      v_ok := v_ok + 1;
    exception when others then
      insert into quality.validation_results
        (run_id, rule_id, rule_version, department_id, status, error_message)
      values (v_run, r.id, r.version, null, 'erro', left(sqlerrm, 500));
      v_err := v_err + 1;
    end;
  end loop;

  -- 4) Retenção: registros afetados ficam 45 dias (resultados agregados ficam para sempre)
  delete from quality.validation_failures f
  using quality.validation_runs vr
  where vr.id = f.run_id and vr.started_at < now() - interval '45 days';

  update quality.validation_runs set
    finished_at = clock_timestamp(),
    status      = case when v_err = 0 then 'sucesso' when v_ok = 0 then 'falha' else 'parcial' end,
    rules_total = v_ok + v_err,
    rules_ok    = v_ok,
    rules_error = v_err,
    datasets_ok = v_ds_ok,
    duration_ms = (extract(epoch from clock_timestamp() - v_t0) * 1000)::int
  where id = v_run;

  insert into governance.audit_log (actor, action, target, details)
  values (left(p_triggered_by, 200), 'quality.run_all', 'quality.validation_runs:' || v_run,
          jsonb_build_object('rules_ok', v_ok, 'rules_error', v_err, 'datasets_ok', v_ds_ok));

  return v_run;
end $$;

revoke all on function quality.run_all(text) from public;
