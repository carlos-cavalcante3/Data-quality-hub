-- =============================================================================
-- 001 - Fundação do Data Quality & Reliability Hub
-- Cria os schemas de monitoramento, o papel de aplicação e as tabelas base.
-- NÃO altera bronze, silver, gold, privado ou public.
-- =============================================================================

create schema if not exists governance;
create schema if not exists control;
create schema if not exists quality;
create schema if not exists observability;
create schema if not exists provenance;
create schema if not exists hub;

comment on schema governance    is 'DQ Hub: departamentos, responsáveis, usuários do Hub e auditoria';
comment on schema control       is 'DQ Hub: cadastro e execuções de pipelines';
comment on schema quality       is 'DQ Hub: regras de qualidade, execuções, resultados, falhas e issues';
comment on schema observability is 'DQ Hub: métricas de volume, atualidade e esquema dos datasets';
comment on schema provenance    is 'DQ Hub: cadastro de datasets, linhagem e transformações';
comment on schema hub           is 'DQ Hub: views e funções consumidas pela aplicação (única superfície exposta ao app)';

-- Papel da aplicação: sem login. A aplicação faz SET ROLE hub_app em cada transação.
-- Para produção, crie um usuário de login próprio membro de hub_app (ver docs/SEGURANCA.md).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'hub_app') then
    create role hub_app nologin;
  end if;
end $$;

do $$
begin
  execute 'grant hub_app to postgres with inherit false, set true';
exception when others then
  raise notice 'grant hub_app to postgres: %', sqlerrm;
end $$;

revoke all on schema governance, control, quality, observability, provenance, hub from public;
do $$
declare r text;
begin
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema governance, control, quality, observability, provenance, hub from %I', r);
    end if;
  end loop;
end $$;
grant usage on schema hub to hub_app;

-- -----------------------------------------------------------------------------
-- governance
-- -----------------------------------------------------------------------------
create table if not exists governance.departments (
  id          serial primary key,
  code        text not null unique,
  name        text not null,
  source      text not null default 'rd_team' check (source in ('rd_team','manual','sistema')),
  source_ref  text unique,                       -- id da equipe no RD (bronze.teams.id)
  priority    int  not null default 100,         -- menor = preferido quando o usuário está em mais de uma equipe
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
comment on table governance.departments is 'Departamentos. Origem padrão: equipes do RD (bronze.teams). "Não identificado" recebe registros sem atribuição confiável.';

insert into governance.departments (code, name, source, priority)
values ('nao_identificado', 'Não identificado', 'sistema', 999)
on conflict (code) do nothing;

create table if not exists governance.user_department_override (
  user_id       text primary key,                -- silver.users.id
  department_id int not null references governance.departments(id),
  reason        text,
  created_at    timestamptz not null default now()
);
comment on table governance.user_department_override is 'Atribuição manual usuário → departamento. Tem precedência sobre a equipe do RD.';

create table if not exists governance.dataset_ownership (
  id                  serial primary key,
  dataset_name        text not null,
  column_name         text,
  department_id       int not null references governance.departments(id),
  responsibility_type text not null check (responsibility_type in ('preenchimento','manutencao','processamento','consumo')),
  notes               text,
  effective_from      date not null default current_date,
  effective_until     date
);

create table if not exists governance.app_users (
  email      text primary key check (email = lower(email)),
  role       text not null check (role in ('viewer','analyst','admin')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table governance.app_users is 'Usuários autorizados no Hub e seus papéis. Admins iniciais também podem vir da variável HUB_ADMIN_EMAILS.';

create table if not exists governance.audit_log (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  actor   text not null,
  action  text not null,
  target  text,
  details jsonb
);
create index if not exists audit_log_at_idx on governance.audit_log (at desc);

-- -----------------------------------------------------------------------------
-- provenance
-- -----------------------------------------------------------------------------
create table if not exists provenance.dataset_registry (
  dataset_name           text primary key,      -- schema.objeto, ou nome lógico (ex.: rd.api.deals)
  layer                  text not null check (layer in ('origem','bronze','silver','gold','privado','consumo','controle')),
  object_type            text not null default 'table' check (object_type in ('table','view','materialized_view','api','dashboard','automation')),
  source_system          text,
  source_dataset         text,
  description            text,
  pipeline_name          text,
  update_frequency       text,
  expected_interval      interval,              -- SLA de atualização (null = sem SLA definido)
  freshness_expr         text,                  -- expressão SQL da última atualização (ex.: max de updated_at)
  criticality            int not null default 2 check (criticality between 1 and 5),
  contains_personal_data boolean not null default false,
  monitored              boolean not null default true,
  active                 boolean not null default true
);

create table if not exists provenance.transformation_registry (
  name           text primary key,
  description    text not null,
  pipeline_name  text,
  implemented_in text,                          -- função, script, view
  rule_summary   text
);

create table if not exists provenance.lineage_edges (
  id                  serial primary key,
  source_dataset      text not null,
  destination_dataset text not null,
  pipeline_name       text,
  transformation_name text,
  edge_type           text not null default 'etl' check (edge_type in ('etl','funcao','webhook','consumo')),
  notes               text,
  created_at          timestamptz not null default now(),
  unique (source_dataset, destination_dataset, edge_type)
);
comment on table provenance.lineage_edges is 'Linhagem declarada (ETL, funções, consumidores). Dependências entre views/MVs são lidas do catálogo do Postgres em hub.v_lineage_edges.';

-- -----------------------------------------------------------------------------
-- control
-- -----------------------------------------------------------------------------
create table if not exists control.pipeline_registry (
  name              text primary key,
  display_name      text not null,
  description       text,
  orchestrator      text,
  schedule_desc     text,
  expected_interval interval,
  source_system     text,
  repository        text,
  evidence_source   text,                       -- de onde o Hub lê as execuções
  active            boolean not null default true
);

create table if not exists control.pipeline_executions (
  id                bigserial primary key,
  pipeline_name     text not null references control.pipeline_registry(name),
  execution_id      text not null,
  started_at        timestamptz not null,
  finished_at       timestamptz,
  status            text not null check (status in ('em_andamento','sucesso','falha','parcial','cancelado')),
  source            text,
  records_extracted bigint,
  records_inserted  bigint,
  records_updated   bigint,
  records_rejected  bigint,
  error_message     text,
  code_version      text,
  run_url           text,                       -- link para o run do GitHub Actions/Airflow
  details           jsonb,
  created_at        timestamptz not null default now(),
  unique (pipeline_name, execution_id)
);
create index if not exists pipeline_executions_started_idx on control.pipeline_executions (pipeline_name, started_at desc);

create table if not exists control.pipeline_alerts (
  id            bigserial primary key,
  pipeline_name text,
  alert_type    text not null,
  severity      text not null default 'media' check (severity in ('baixa','media','alta','critica')),
  message       text not null,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);

-- -----------------------------------------------------------------------------
-- quality
-- -----------------------------------------------------------------------------
create table if not exists quality.dimensions (
  code        text primary key,
  name        text not null,
  description text not null,
  weight      numeric(5,2) not null check (weight > 0),
  sort        int not null
);

insert into quality.dimensions (code, name, description, weight, sort) values
  ('completude',  'Completude',  'Presença das informações esperadas nos registros', 0.25, 1),
  ('validade',    'Validade',    'Formatos e domínios respeitados', 0.20, 2),
  ('unicidade',   'Unicidade',   'Ausência de duplicidades', 0.15, 3),
  ('consistencia','Consistência','Informações relacionadas respeitam as mesmas regras', 0.15, 4),
  ('integridade', 'Integridade', 'Referências entre entidades existem', 0.15, 5),
  ('atualidade',  'Atualidade',  'Dados disponíveis e atualizados dentro do prazo esperado', 0.10, 6)
on conflict (code) do nothing;

create table if not exists quality.validation_rules (
  id                 serial primary key,
  code               text not null unique,
  name               text not null,
  description        text not null,
  dataset_name       text not null references provenance.dataset_registry(dataset_name),
  column_name        text,
  dimension          text not null references quality.dimensions(code),
  entity             text not null,             -- negocio, empresa, contato, tarefa, dataset ...
  population         text not null,             -- descrição do denominador
  severity           text not null default 'media' check (severity in ('baixa','media','alta','critica')),
  expected_threshold numeric(5,2) not null default 95,
  check_sql          text not null,             -- SELECT record_id, department_id, passed, record_label, detail
  version            int not null default 1,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on column quality.validation_rules.check_sql is
  'Consulta que devolve UMA linha por registro avaliado: record_id text, department_id int, passed boolean, record_label text, detail text. Nunca devolver dados pessoais em record_label/detail.';

create table if not exists quality.validation_runs (
  id           bigserial primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'em_andamento' check (status in ('em_andamento','sucesso','parcial','falha')),
  triggered_by text not null,
  rules_total  int,
  rules_ok     int,
  rules_error  int,
  datasets_ok  int,
  duration_ms  int,
  notes        text
);
create index if not exists validation_runs_started_idx on quality.validation_runs (started_at desc);

create table if not exists quality.validation_results (
  id                bigserial primary key,
  run_id            bigint not null references quality.validation_runs(id) on delete cascade,
  rule_id           int not null references quality.validation_rules(id),
  rule_version      int not null,
  evaluated_at      timestamptz not null default now(),
  department_id     int references governance.departments(id),   -- null = consolidado
  records_evaluated bigint not null default 0,
  records_passed    bigint not null default 0,
  records_failed    bigint not null default 0,
  quality_score     numeric(6,2),                                 -- null quando não há registros avaliados
  status            text not null check (status in ('ok','sem_dados','erro')),
  error_message     text
);
create unique index if not exists validation_results_uq on quality.validation_results (run_id, rule_id, coalesce(department_id, -1));
create index if not exists validation_results_rule_idx on quality.validation_results (rule_id, evaluated_at desc);

create table if not exists quality.validation_failures (
  run_id        bigint not null references quality.validation_runs(id) on delete cascade,
  rule_id       int not null references quality.validation_rules(id),
  record_id     text not null,
  department_id int references governance.departments(id),
  record_label  text,
  detail        text,
  primary key (run_id, rule_id, record_id)
);
create index if not exists validation_failures_dept_idx on quality.validation_failures (run_id, department_id);

create table if not exists quality.quality_issues (
  id                bigserial primary key,
  rule_id           int references quality.validation_rules(id),
  department_id     int references governance.departments(id),
  title             text not null,
  description       text,
  affected_records  bigint,
  baseline_score    numeric(6,2),
  detected_at       timestamptz not null default now(),
  communicated_at   timestamptz,
  status            text not null default 'identificado'
                    check (status in ('identificado','comunicado','em_correcao','parcialmente_corrigido','resolvido','nao_aplicavel')),
  resolved_at       timestamptz,
  records_corrected bigint,
  notes             text,
  created_by        text not null,
  updated_at        timestamptz not null default now()
);

create table if not exists quality.issue_events (
  id         bigserial primary key,
  issue_id   bigint not null references quality.quality_issues(id) on delete cascade,
  at         timestamptz not null default now(),
  actor      text not null,
  old_status text,
  new_status text,
  note       text
);

-- -----------------------------------------------------------------------------
-- observability
-- -----------------------------------------------------------------------------
create table if not exists observability.dataset_metrics (
  id                   bigserial primary key,
  run_id               bigint references quality.validation_runs(id) on delete set null,
  dataset_name         text not null,
  collected_at         timestamptz not null default now(),
  row_count            bigint,
  last_updated_at      timestamptz,
  freshness_minutes    numeric,
  expected_interval    interval,
  freshness_status     text not null check (freshness_status in ('ok','atrasado','critico','sem_sla','sem_dados','erro')),
  volume_variation_pct numeric,
  error_message        text
);
create index if not exists dataset_metrics_ds_idx on observability.dataset_metrics (dataset_name, collected_at desc);

create table if not exists observability.schema_snapshots (
  id           bigserial primary key,
  run_id       bigint references quality.validation_runs(id) on delete set null,
  captured_at  timestamptz not null default now(),
  dataset_name text not null,
  columns_hash text not null,
  columns      jsonb not null
);
create index if not exists schema_snapshots_ds_idx on observability.schema_snapshots (dataset_name, captured_at desc);

-- Perfil estatístico das colunas (pg_stats, amostragem do ANALYZE). Guarda só a última coleta.
create table if not exists observability.column_stats (
  dataset_name text not null,
  column_name  text not null,
  null_frac    numeric,
  n_distinct   numeric,
  avg_width    int,
  collected_at timestamptz not null default now(),
  primary key (dataset_name, column_name)
);
