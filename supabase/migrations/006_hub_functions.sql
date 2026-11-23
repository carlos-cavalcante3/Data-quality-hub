-- =============================================================================
-- 006 - Funções de escrita expostas à aplicação (únicas operações de escrita).
-- Todas registram auditoria. A autorização por papel é verificada aqui também
-- (defesa em profundidade), além da checagem na aplicação.
-- =============================================================================

create or replace function hub.fn_user_role(p_email text)
returns text
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select role from governance.app_users where email = lower(btrim(p_email)) and active
$$;

-- Admins vêm de governance.app_users ou da lista HUB_ADMIN_EMAILS da aplicação.
-- A aplicação informa p_actor_role já resolvido; a função valida o mínimo exigido.
create or replace function hub.fn_require_role(p_actor_role text, p_min text)
returns void
language plpgsql immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  rank_actor int := case p_actor_role when 'admin' then 3 when 'analyst' then 2 when 'viewer' then 1 else 0 end;
  rank_min   int := case p_min        when 'admin' then 3 when 'analyst' then 2 when 'viewer' then 1 else 9 end;
begin
  if rank_actor < rank_min then
    raise exception 'Permissão insuficiente (%), requer %', coalesce(p_actor_role, 'nenhum'), p_min using errcode = '42501';
  end if;
end $$;

create or replace function hub.fn_audit(p_actor text, p_action text, p_target text, p_details jsonb default null)
returns void
language sql security definer
set search_path = pg_catalog, pg_temp
as $$
  insert into governance.audit_log (actor, action, target, details)
  values (left(p_actor, 200), left(p_action, 100), left(p_target, 300), p_details)
$$;

create or replace function hub.fn_run_quality(p_actor text, p_actor_role text)
returns bigint
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  perform hub.fn_require_role(p_actor_role, 'analyst');
  return quality.run_all(p_actor);
end $$;

create or replace function hub.fn_issue_create(
  p_actor text, p_actor_role text, p_rule_code text, p_department_id int,
  p_title text, p_description text, p_notes text default null)
returns bigint
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_rule int; v_id bigint; v_failed bigint; v_score numeric;
begin
  perform hub.fn_require_role(p_actor_role, 'analyst');
  if coalesce(btrim(p_title), '') = '' then raise exception 'Título obrigatório'; end if;

  if p_rule_code is not null then
    select id into v_rule from quality.validation_rules where code = p_rule_code;
    if v_rule is null then raise exception 'Regra % não encontrada', p_rule_code; end if;
    select vr.records_failed, vr.quality_score into v_failed, v_score
    from quality.validation_results vr
    where vr.rule_id = v_rule
      and vr.run_id = (select id from quality.validation_runs where status in ('sucesso','parcial') order by started_at desc limit 1)
      and ((p_department_id is null and vr.department_id is null) or vr.department_id = p_department_id);
  end if;

  insert into quality.quality_issues (rule_id, department_id, title, description, affected_records, baseline_score, notes, created_by)
  values (v_rule, p_department_id, left(p_title, 300), p_description, v_failed, v_score, p_notes, left(p_actor, 200))
  returning id into v_id;

  insert into quality.issue_events (issue_id, actor, old_status, new_status, note)
  values (v_id, left(p_actor, 200), null, 'identificado', 'Issue registrada');

  perform hub.fn_audit(p_actor, 'issue.create', 'quality.quality_issues:' || v_id,
                       jsonb_build_object('rule', p_rule_code, 'department_id', p_department_id));
  return v_id;
end $$;

create or replace function hub.fn_issue_update(
  p_actor text, p_actor_role text, p_issue_id bigint, p_status text,
  p_note text default null, p_records_corrected bigint default null)
returns void
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare v_old text;
begin
  perform hub.fn_require_role(p_actor_role, 'analyst');
  select status into v_old from quality.quality_issues where id = p_issue_id for update;
  if v_old is null then raise exception 'Issue % não encontrada', p_issue_id; end if;

  update quality.quality_issues set
    status            = p_status,
    communicated_at   = case when p_status = 'comunicado' and communicated_at is null then now() else communicated_at end,
    resolved_at       = case when p_status in ('resolvido','nao_aplicavel') then coalesce(resolved_at, now())
                             else null end,
    records_corrected = coalesce(p_records_corrected, records_corrected),
    notes             = case when p_note is not null and btrim(p_note) <> ''
                             then coalesce(notes || E'\n', '') || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || ' — ' || p_note
                             else notes end,
    updated_at        = now()
  where id = p_issue_id;

  insert into quality.issue_events (issue_id, actor, old_status, new_status, note)
  values (p_issue_id, left(p_actor, 200), v_old, p_status, p_note);

  perform hub.fn_audit(p_actor, 'issue.update', 'quality.quality_issues:' || p_issue_id,
                       jsonb_build_object('from', v_old, 'to', p_status));
end $$;

create or replace function hub.fn_app_user_upsert(p_actor text, p_actor_role text, p_email text, p_role text, p_active boolean)
returns void
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  perform hub.fn_require_role(p_actor_role, 'admin');
  if p_email !~* '^[^@\s]+@(avantia\.com\.br|wesafer\.com|esmgroup\.com\.br)$' then
    raise exception 'Somente e-mails corporativos são permitidos';
  end if;
  insert into governance.app_users (email, role, active) values (lower(btrim(p_email)), p_role, p_active)
  on conflict (email) do update set role = excluded.role, active = excluded.active;
  perform hub.fn_audit(p_actor, 'user.upsert', 'governance.app_users:' || lower(p_email),
                       jsonb_build_object('role', p_role, 'active', p_active));
end $$;

create or replace function hub.fn_dimension_weight_update(p_actor text, p_actor_role text, p_code text, p_weight numeric)
returns void
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare v_old numeric;
begin
  perform hub.fn_require_role(p_actor_role, 'admin');
  if p_weight <= 0 or p_weight > 10 then raise exception 'Peso deve estar entre 0 e 10'; end if;
  select weight into v_old from quality.dimensions where code = p_code;
  update quality.dimensions set weight = p_weight where code = p_code;
  perform hub.fn_audit(p_actor, 'dimension.weight', 'quality.dimensions:' || p_code,
                       jsonb_build_object('from', v_old, 'to', p_weight));
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'hub.fn_user_role(text)',
    'hub.fn_audit(text,text,text,jsonb)',
    'hub.fn_run_quality(text,text)',
    'hub.fn_issue_create(text,text,text,int,text,text,text)',
    'hub.fn_issue_update(text,text,bigint,text,text,bigint)',
    'hub.fn_app_user_upsert(text,text,text,text,boolean)',
    'hub.fn_dimension_weight_update(text,text,text,numeric)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to hub_app', f);
  end loop;
end $$;
grant execute on function hub.fn_require_role(text, text) to hub_app;
