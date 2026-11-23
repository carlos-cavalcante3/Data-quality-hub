-- =============================================================================
-- 004 - Regras de qualidade iniciais (catálogo versionado)
-- Contrato de check_sql: uma linha por registro avaliado com
--   record_id, department_id, passed, record_label, detail
-- record_label/detail NUNCA podem conter dados pessoais (e-mail, telefone, CPF).
-- =============================================================================

insert into provenance.dataset_registry (dataset_name, layer, object_type, source_system, description, criticality, monitored)
values ('hub.datasets_monitorados', 'controle', 'table', 'DQ Hub', 'Conjunto lógico: atualidade de todos os datasets monitorados com SLA', 4, false)
on conflict (dataset_name) do nothing;

-- Populações reutilizadas pelas regras ------------------------------------------
create or replace view quality.vw_deals_comerciais as
select d.*,
       p.name  as pipeline_nome,
       s.name  as stage_nome,
       ud.department_id
from silver.deals d
join gold.pipelines_escopo e on e.pipeline_id = d.pipeline_id and e.uso = 'comercial'
left join silver.pipelines p on p.id = d.pipeline_id
left join silver.stages s on s.id = d.stage_id
left join governance.vw_user_department ud on ud.user_id = d.owner_id;
comment on view quality.vw_deals_comerciais is 'Negócios dos funis comerciais (gold.pipelines_escopo uso=comercial) + departamento do dono.';

create or replace view quality.vw_orgs_clientes as
select o.*, ud.department_id
from silver.organizations o
left join governance.vw_user_department ud on ud.user_id = o.owner_id
where exists (select 1 from quality.vw_deals_comerciais d where d.organization_id = o.id);
comment on view quality.vw_orgs_clientes is 'Empresas com pelo menos um negócio nos funis comerciais (clientes ativos do comercial).';

-- Upsert das regras: muda a versão quando o SQL muda ------------------------------
create or replace function quality.upsert_rule(
  p_code text, p_name text, p_description text, p_dataset text, p_column text, p_dimension text,
  p_entity text, p_population text, p_severity text, p_threshold numeric, p_sql text)
returns void language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  insert into quality.validation_rules
    (code, name, description, dataset_name, column_name, dimension, entity, population, severity, expected_threshold, check_sql)
  values (p_code, p_name, p_description, p_dataset, p_column, p_dimension, p_entity, p_population, p_severity, p_threshold, p_sql)
  on conflict (code) do update set
    name = excluded.name, description = excluded.description, dataset_name = excluded.dataset_name,
    column_name = excluded.column_name, dimension = excluded.dimension, entity = excluded.entity,
    population = excluded.population, severity = excluded.severity, expected_threshold = excluded.expected_threshold,
    check_sql = excluded.check_sql,
    version = quality.validation_rules.version + case when quality.validation_rules.check_sql is distinct from excluded.check_sql then 1 else 0 end,
    updated_at = now();
end $$;

-- ============================ COMPLETUDE ======================================
select quality.upsert_rule('DEAL_EMPRESA', 'Negócio com empresa vinculada',
  'Todo negócio comercial deve estar vinculado a uma empresa (organization_id).',
  'silver.deals', 'organization_id', 'completude', 'negocio', 'Negócios dos funis comerciais', 'alta', 95,
  $q$ select id as record_id, department_id, organization_id is not null and btrim(organization_id) <> '' as passed,
             name as record_label, pipeline_nome as detail
      from quality.vw_deals_comerciais $q$);

select quality.upsert_rule('DEAL_VALOR', 'Negócio com valor preenchido',
  'Negócios abertos ou ganhos devem ter valor total maior que zero.',
  'silver.deals', 'total_price', 'completude', 'negocio', 'Negócios comerciais abertos ou ganhos', 'alta', 90,
  $q$ select id, department_id, coalesce(total_price,0) > 0, name, pipeline_nome || ' · ' || coalesce(stage_nome,'?')
      from quality.vw_deals_comerciais where status in ('ongoing','paused','won') $q$);

select quality.upsert_rule('DEAL_PREVISAO', 'Negócio aberto com previsão de fechamento',
  'Negócios abertos devem ter data prevista de fechamento.',
  'silver.deals', 'expected_close_date', 'completude', 'negocio', 'Negócios comerciais abertos', 'media', 85,
  $q$ select id, department_id, expected_close_date is not null, name, pipeline_nome || ' · ' || coalesce(stage_nome,'?')
      from quality.vw_deals_comerciais where status in ('ongoing','paused') $q$);

select quality.upsert_rule('DEAL_TIPO_CONTRATO', 'Negócio com tipo de contrato',
  'Negócios comerciais devem informar o tipo de contrato/projeto.',
  'silver.deals', 'custom_fields_tipo_de_contrato', 'completude', 'negocio', 'Negócios dos funis comerciais', 'media', 85,
  $q$ select id, department_id, nullif(btrim(custom_fields_tipo_de_contrato),'') is not null, name, pipeline_nome
      from quality.vw_deals_comerciais $q$);

select quality.upsert_rule('DEAL_MOTIVO_PERDA', 'Negócio perdido com motivo',
  'Negócios perdidos devem ter motivo da perda (texto ou id do motivo).',
  'silver.deals', 'motivo_da_perda', 'completude', 'negocio', 'Negócios comerciais perdidos', 'media', 95,
  $q$ select id, department_id, nullif(btrim(motivo_da_perda),'') is not null or lost_reason_id is not null, name, pipeline_nome
      from quality.vw_deals_comerciais where status = 'lost' $q$);

select quality.upsert_rule('DEAL_DATA_PROPOSTA', 'Proposta entregue com data de entrega',
  'Quando "Proposta entregue ao cliente" = Sim, a data de entrega da proposta deve estar preenchida.',
  'silver.deals', 'data_de_entrega_da_proposta', 'completude', 'negocio', 'Negócios comerciais com proposta entregue = Sim', 'media', 90,
  $q$ select id, department_id, data_de_entrega_da_proposta is not null, name, pipeline_nome
      from quality.vw_deals_comerciais where proposta_entregue_ao_cliente = 'Sim' $q$);

select quality.upsert_rule('ORG_CNPJ', 'Empresa cliente com CNPJ',
  'Empresas com negócios comerciais devem ter CNPJ preenchido.',
  'silver.organizations', 'cnpj', 'completude', 'empresa', 'Empresas com negócio comercial', 'alta', 90,
  $q$ select id, department_id, nullif(btrim(cnpj),'') is not null, name, null
      from quality.vw_orgs_clientes $q$);

select quality.upsert_rule('ORG_UF', 'Empresa cliente com estado (UF)',
  'Empresas com negócios comerciais devem ter o estado preenchido.',
  'silver.organizations', 'custom_fields_estado', 'completude', 'empresa', 'Empresas com negócio comercial', 'media', 85,
  $q$ select id, department_id, nullif(btrim(custom_fields_estado),'') is not null, name, null
      from quality.vw_orgs_clientes $q$);

select quality.upsert_rule('ORG_CIDADE', 'Empresa cliente com cidade',
  'Empresas com negócios comerciais devem ter a cidade preenchida.',
  'silver.organizations', 'custom_fields_cidade', 'completude', 'empresa', 'Empresas com negócio comercial', 'baixa', 80,
  $q$ select id, department_id, nullif(btrim(custom_fields_cidade),'') is not null, name, null
      from quality.vw_orgs_clientes $q$);

select quality.upsert_rule('ORG_SEGMENTO', 'Empresa cliente com segmento',
  'Empresas com negócios comerciais devem ter segmento identificado.',
  'silver.organizations', 'segment_name', 'completude', 'empresa', 'Empresas com negócio comercial', 'media', 80,
  $q$ select id, department_id, nullif(btrim(segment_name),'') is not null, name, null
      from quality.vw_orgs_clientes $q$);

select quality.upsert_rule('CONTATO_MEIO', 'Contato com e-mail ou telefone',
  'Contatos devem ter ao menos um meio de contato (e-mail ou telefone). Só contagem: nenhum dado pessoal é exibido.',
  'silver.contacts', 'email_principal / telefone_principal', 'completude', 'contato', 'Todos os contatos', 'media', 90,
  $q$ select c.id, ud.department_id,
             nullif(btrim(c.email_principal),'') is not null or nullif(btrim(c.telefone_principal),'') is not null,
             'Contato ' || right(c.id, 6), coalesce(o.name, 'Sem empresa')
      from silver.contacts c
      left join silver.organizations o on o.id = c.organization_id
      left join governance.vw_user_department ud on ud.user_id = o.owner_id $q$);

select quality.upsert_rule('CONTATO_EMPRESA', 'Contato vinculado a empresa',
  'Contatos devem estar vinculados a uma empresa.',
  'silver.contacts', 'organization_id', 'completude', 'contato', 'Todos os contatos', 'baixa', 85,
  $q$ select c.id, null::int, c.organization_id is not null, 'Contato ' || right(c.id, 6), null
      from silver.contacts c $q$);

select quality.upsert_rule('HIST_ETAPAS_COBERTURA', 'Negócio com histórico de etapas',
  'Negócios comerciais criados a partir de 2026 devem ter histórico de etapas em silver.deal_etapas (base do funil e da linha do tempo).',
  'silver.deal_etapas', 'deal_id', 'completude', 'negocio', 'Negócios comerciais criados desde 01/01/2026', 'alta', 95,
  $q$ select d.id, d.department_id, exists (select 1 from silver.deal_etapas e where e.deal_id = d.id), d.name, d.pipeline_nome
      from quality.vw_deals_comerciais d where d.created_at >= '2026-01-01' $q$);

-- ============================ VALIDADE ========================================
select quality.upsert_rule('ORG_CNPJ_VALIDO', 'CNPJ válido (dígitos verificadores)',
  'CNPJs preenchidos devem ter 14 dígitos e dígitos verificadores corretos.',
  'silver.organizations', 'cnpj', 'validade', 'empresa', 'Empresas com CNPJ preenchido', 'alta', 98,
  $q$ select o.id, ud.department_id, quality.fn_cnpj_valido(o.cnpj), o.name, 'CNPJ ' || quality.fn_mask_doc(o.cnpj)
      from silver.organizations o
      left join governance.vw_user_department ud on ud.user_id = o.owner_id
      where nullif(btrim(o.cnpj),'') is not null $q$);

select quality.upsert_rule('CONTATO_EMAIL_VALIDO', 'E-mail de contato em formato válido',
  'E-mails preenchidos devem ter formato válido. O e-mail não é exibido.',
  'silver.contacts', 'email_principal', 'validade', 'contato', 'Contatos com e-mail preenchido', 'media', 98,
  $q$ select c.id, ud.department_id, c.email_principal ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$',
             'Contato ' || right(c.id, 6), null
      from silver.contacts c
      left join silver.organizations o on o.id = c.organization_id
      left join governance.vw_user_department ud on ud.user_id = o.owner_id
      where nullif(btrim(c.email_principal),'') is not null $q$);

select quality.upsert_rule('DEAL_VALOR_NAO_NEGATIVO', 'Valor do negócio não negativo',
  'Valores total, único e recorrente não podem ser negativos.',
  'silver.deals', 'total_price', 'validade', 'negocio', 'Todos os negócios', 'alta', 100,
  $q$ select d.id, ud.department_id,
             coalesce(d.total_price,0) >= 0 and coalesce(d.one_time_price,0) >= 0 and coalesce(d.recurrence_price,0) >= 0,
             d.name, null
      from silver.deals d left join governance.vw_user_department ud on ud.user_id = d.owner_id $q$);

select quality.upsert_rule('DEAL_STATUS_DOMINIO', 'Status do negócio no domínio',
  'Status deve ser ongoing, paused, won ou lost.',
  'silver.deals', 'status', 'validade', 'negocio', 'Todos os negócios', 'alta', 100,
  $q$ select d.id, ud.department_id, d.status in ('ongoing','paused','won','lost'), d.name, 'status=' || coalesce(d.status,'nulo')
      from silver.deals d left join governance.vw_user_department ud on ud.user_id = d.owner_id $q$);

select quality.upsert_rule('TASK_STATUS_DOMINIO', 'Status da tarefa no domínio',
  'Status da tarefa deve ser open, completed ou canceled.',
  'silver.tasks', 'status', 'validade', 'tarefa', 'Todas as tarefas', 'media', 100,
  $q$ select t.id, ud.department_id, t.status in ('open','completed','canceled'), t.name, 'status=' || coalesce(t.status,'nulo')
      from silver.tasks t
      left join silver.deals d on d.id = t.deal_id
      left join governance.vw_user_department ud on ud.user_id = d.owner_id $q$);

-- ============================ UNICIDADE =======================================
select quality.upsert_rule('ORG_CNPJ_UNICO', 'CNPJ não repetido entre empresas',
  'Um CNPJ não deve estar associado a mais de um cadastro de empresa.',
  'silver.organizations', 'cnpj', 'unicidade', 'empresa', 'Empresas com CNPJ preenchido', 'alta', 99,
  $q$ with base as (
        select o.id, o.name, o.owner_id, regexp_replace(o.cnpj,'\D','','g') as doc
        from silver.organizations o where nullif(btrim(o.cnpj),'') is not null),
      dup as (select doc, count(*) n from base group by doc)
      select b.id, ud.department_id, dup.n = 1, b.name,
             case when dup.n > 1 then dup.n || ' cadastros com o mesmo CNPJ ' || quality.fn_mask_doc(b.doc) end
      from base b join dup using (doc)
      left join governance.vw_user_department ud on ud.user_id = b.owner_id $q$);

select quality.upsert_rule('ORG_NOME_UNICO', 'Nome de empresa não duplicado',
  'Empresas não devem ter o mesmo nome normalizado (sem acento, caixa e espaços). Indica possíveis cadastros duplicados.',
  'silver.organizations', 'name', 'unicidade', 'empresa', 'Empresas com nome preenchido', 'media', 95,
  $q$ with base as (
        select o.id, o.name, o.owner_id,
               lower(regexp_replace(translate(btrim(o.name),'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç','AAAAEEIOOOUCaaaaeeiooouc'),'\s+',' ','g')) as k
        from silver.organizations o where nullif(btrim(o.name),'') is not null),
      dup as (select k, count(*) n from base group by k)
      select b.id, ud.department_id, dup.n = 1, b.name,
             case when dup.n > 1 then dup.n || ' cadastros com o mesmo nome' end
      from base b join dup using (k)
      left join governance.vw_user_department ud on ud.user_id = b.owner_id $q$);

select quality.upsert_rule('CONTATO_EMAIL_UNICO', 'E-mail de contato não repetido',
  'O mesmo e-mail não deve aparecer em mais de um contato. O e-mail não é exibido.',
  'silver.contacts', 'email_principal', 'unicidade', 'contato', 'Contatos com e-mail preenchido', 'baixa', 97,
  $q$ with base as (
        select c.id, c.organization_id, lower(btrim(c.email_principal)) as k
        from silver.contacts c where nullif(btrim(c.email_principal),'') is not null),
      dup as (select k, count(*) n from base group by k)
      select b.id, ud.department_id, dup.n = 1, 'Contato ' || right(b.id, 6),
             case when dup.n > 1 then dup.n || ' contatos com o mesmo e-mail' end
      from base b join dup using (k)
      left join silver.organizations o on o.id = b.organization_id
      left join governance.vw_user_department ud on ud.user_id = o.owner_id $q$);

select quality.upsert_rule('BRONZE_SILVER_DEALS', 'Negócio da bronze presente na silver',
  'Cada negócio extraído para bronze.deals deve existir em silver.deals (perda na transformação).',
  'silver.deals', 'id', 'integridade', 'negocio', 'Todos os negócios de bronze.deals', 'alta', 100,
  $q$ select b.id, ud.department_id, exists (select 1 from silver.deals s where s.id = b.id), b.name, null
      from bronze.deals b left join governance.vw_user_department ud on ud.user_id = b.owner_id $q$);

-- ============================ CONSISTÊNCIA ====================================
select quality.upsert_rule('DEAL_FECHADO_COM_DATA', 'Negócio ganho/perdido com data de fechamento',
  'Negócios ganhos ou perdidos devem ter data de fechamento.',
  'silver.deals', 'closed_at', 'consistencia', 'negocio', 'Negócios comerciais ganhos ou perdidos', 'alta', 100,
  $q$ select id, department_id, closed_at is not null, name, status
      from quality.vw_deals_comerciais where status in ('won','lost') $q$);

select quality.upsert_rule('DEAL_FECHAMENTO_APOS_CRIACAO', 'Fechamento posterior à criação',
  'A data de fechamento não pode ser anterior à data de criação (indica negócio importado ou data incorreta).',
  'silver.deals', 'closed_at', 'consistencia', 'negocio', 'Negócios comerciais com data de fechamento', 'media', 95,
  $q$ select id, department_id, closed_at >= created_at, name,
             'criado ' || to_char(created_at,'DD/MM/YYYY') || ', fechado ' || to_char(closed_at,'DD/MM/YYYY')
      from quality.vw_deals_comerciais where closed_at is not null and created_at is not null $q$);

select quality.upsert_rule('DEAL_GANHO_COM_VALOR', 'Negócio ganho com valor',
  'Negócios ganhos devem ter valor total maior que zero.',
  'silver.deals', 'total_price', 'consistencia', 'negocio', 'Negócios comerciais ganhos', 'alta', 98,
  $q$ select id, department_id, coalesce(total_price,0) > 0, name, pipeline_nome
      from quality.vw_deals_comerciais where status = 'won' $q$);

select quality.upsert_rule('DEAL_ABERTO_FORA_ENCERRADO', 'Negócio aberto fora da etapa Encerrado',
  'Negócios abertos não deveriam estar na etapa "Encerrado".',
  'silver.deals', 'stage_id', 'consistencia', 'negocio', 'Negócios comerciais abertos', 'media', 99,
  $q$ select id, department_id, coalesce(stage_nome,'') not ilike 'encerrad%', name, pipeline_nome || ' · ' || coalesce(stage_nome,'?')
      from quality.vw_deals_comerciais where status in ('ongoing','paused') $q$);

select quality.upsert_rule('DEAL_ETAPA_DO_FUNIL', 'Etapa pertence ao funil do negócio',
  'A etapa atual do negócio deve pertencer ao mesmo funil do negócio.',
  'silver.deals', 'stage_id', 'consistencia', 'negocio', 'Negócios com etapa cadastrada', 'alta', 100,
  $q$ select d.id, ud.department_id, s.pipeline_id = d.pipeline_id, d.name, null
      from silver.deals d join silver.stages s on s.id = d.stage_id
      left join governance.vw_user_department ud on ud.user_id = d.owner_id $q$);

select quality.upsert_rule('TASK_CONCLUIDA_COM_DATA', 'Tarefa concluída com data de conclusão',
  'Tarefas concluídas devem ter data de conclusão.',
  'silver.tasks', 'completed_at', 'consistencia', 'tarefa', 'Tarefas concluídas', 'media', 100,
  $q$ select t.id, ud.department_id, t.completed_at is not null, t.name, t.type
      from silver.tasks t
      left join silver.deals d on d.id = t.deal_id
      left join governance.vw_user_department ud on ud.user_id = d.owner_id
      where t.status = 'completed' $q$);

-- ============================ INTEGRIDADE =====================================
select quality.upsert_rule('DEAL_EMPRESA_EXISTE', 'Empresa referenciada existe',
  'organization_id do negócio deve existir em silver.organizations.',
  'silver.deals', 'organization_id', 'integridade', 'negocio', 'Negócios com empresa informada', 'alta', 100,
  $q$ select d.id, ud.department_id, exists (select 1 from silver.organizations o where o.id = d.organization_id), d.name, null
      from silver.deals d left join governance.vw_user_department ud on ud.user_id = d.owner_id
      where d.organization_id is not null $q$);

select quality.upsert_rule('DEAL_DONO_EXISTE', 'Responsável do negócio existe',
  'owner_id do negócio deve existir em silver.users.',
  'silver.deals', 'owner_id', 'integridade', 'negocio', 'Todos os negócios', 'alta', 100,
  $q$ select d.id, ud.department_id, d.owner_id is not null and exists (select 1 from silver.users u where u.id = d.owner_id), d.name, null
      from silver.deals d left join governance.vw_user_department ud on ud.user_id = d.owner_id $q$);

select quality.upsert_rule('DEAL_ETAPA_EXISTE', 'Etapa referenciada existe',
  'stage_id do negócio deve existir em silver.stages.',
  'silver.deals', 'stage_id', 'integridade', 'negocio', 'Todos os negócios', 'alta', 100,
  $q$ select d.id, ud.department_id, exists (select 1 from silver.stages s where s.id = d.stage_id), d.name, null
      from silver.deals d left join governance.vw_user_department ud on ud.user_id = d.owner_id $q$);

select quality.upsert_rule('DEAL_FUNIL_EXISTE', 'Funil referenciado existe',
  'pipeline_id do negócio deve existir em silver.pipelines.',
  'silver.deals', 'pipeline_id', 'integridade', 'negocio', 'Todos os negócios', 'alta', 100,
  $q$ select d.id, ud.department_id, exists (select 1 from silver.pipelines p where p.id = d.pipeline_id), d.name, null
      from silver.deals d left join governance.vw_user_department ud on ud.user_id = d.owner_id $q$);

select quality.upsert_rule('TASK_NEGOCIO_EXISTE', 'Negócio da tarefa existe',
  'deal_id da tarefa deve existir em silver.deals.',
  'silver.tasks', 'deal_id', 'integridade', 'tarefa', 'Tarefas com negócio informado', 'media', 100,
  $q$ select t.id, ud.department_id, d.id is not null, t.name, null
      from silver.tasks t
      left join silver.deals d on d.id = t.deal_id
      left join governance.vw_user_department ud on ud.user_id = d.owner_id
      where t.deal_id is not null $q$);

select quality.upsert_rule('CONTATO_EMPRESA_EXISTE', 'Empresa do contato existe',
  'organization_id do contato deve existir em silver.organizations.',
  'silver.contacts', 'organization_id', 'integridade', 'contato', 'Contatos com empresa informada', 'media', 100,
  $q$ select c.id, ud.department_id, o.id is not null, 'Contato ' || right(c.id, 6), null
      from silver.contacts c
      left join silver.organizations o on o.id = c.organization_id
      left join governance.vw_user_department ud on ud.user_id = o.owner_id
      where c.organization_id is not null $q$);

-- ============================ ATUALIDADE ======================================
select quality.upsert_rule('DATASET_NO_PRAZO', 'Dataset atualizado dentro do SLA',
  'Datasets monitorados com SLA devem ter sido atualizados dentro do intervalo esperado (provenance.dataset_registry.expected_interval).',
  'hub.datasets_monitorados', null, 'atualidade', 'dataset', 'Datasets monitorados com SLA definido', 'alta', 100,
  $q$ select m.dataset_name, null::int, m.freshness_status = 'ok', m.dataset_name,
             case when m.freshness_minutes is not null then 'última atualização há ' || round(m.freshness_minutes/60.0,1) || ' h (SLA ' || m.expected_interval || ')' else m.freshness_status end
      from observability.dataset_metrics m
      where m.run_id = nullif(current_setting('quality.run_id', true), '')::bigint
        and m.expected_interval is not null and m.freshness_status in ('ok','atrasado','critico','sem_dados') $q$);

select quality.upsert_rule('DEAL_ABERTO_MOVIMENTADO', 'Negócio aberto movimentado em 90 dias',
  'Negócios abertos devem ter alguma atualização nos últimos 90 dias (registro desatualizado na origem).',
  'silver.deals', 'updated_at', 'atualidade', 'negocio', 'Negócios comerciais abertos', 'media', 80,
  $q$ select id, department_id, updated_at >= now() - interval '90 days', name,
             'última atualização ' || to_char(updated_at,'DD/MM/YYYY')
      from quality.vw_deals_comerciais where status in ('ongoing','paused') $q$);

select quality.upsert_rule('SNAPSHOT_DIARIO', 'Snapshot diário gerado',
  'Cada um dos últimos 30 dias deve existir no histórico de snapshots (gold.deals_snapshot_datas ou gold.deals_snapshot).',
  'gold.deals_snapshot', 'snapshot_date', 'atualidade', 'dataset', 'Últimos 30 dias (até ontem)', 'alta', 95,
  $q$ select to_char(g::date,'YYYY-MM-DD'), null::int,
             exists (select 1 from gold.deals_snapshot_datas s where s.snapshot_date = g::date)
             or exists (select 1 from gold.deals_snapshot s where s.snapshot_date = g::date),
             'Snapshot de ' || to_char(g::date,'DD/MM/YYYY'), null
      from generate_series(current_date - 30, current_date - 1, interval '1 day') g $q$);
