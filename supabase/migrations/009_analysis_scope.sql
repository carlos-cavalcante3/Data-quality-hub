-- =============================================================================
-- 009 - Escopo de análise: só dados que alimentam os painéis da empresa
--       (funis de gold.pipelines_escopo). MARKETING, ES PRIVADO e ARP PÚBLICO
--       ficam fora. Também recria a detecção de mudanças de negócios
--       (gold.deals_historico_mudancas), parada no ETL desde 23/09/2026.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Regra de escopo (visível no dashboard)
-- -----------------------------------------------------------------------------
create table if not exists governance.scope_exclusion_note (
  pipeline_id text primary key,
  reason      text not null
);
comment on table governance.scope_exclusion_note is 'Motivo de cada funil fora do escopo de análise (exibido no dashboard).';

insert into governance.scope_exclusion_note (pipeline_id, reason)
select p.id,
       case p.name
         when 'MARKETING' then 'Funil em estruturação pelo time de Marketing, fora do controle da Engenharia de Dados. Importações e duplicidades fazem parte da adaptação ao CRM.'
         else 'Não alimenta os painéis da empresa (fora de gold.pipelines_escopo).'
       end
from silver.pipelines p
where not exists (select 1 from gold.pipelines_escopo e where e.pipeline_id = p.id)
on conflict (pipeline_id) do update set reason = excluded.reason;

-- Funis em escopo = os mesmos usados pela camada gold (comercial + histórico)
create or replace view quality.vw_deals_escopo as
select d.*, p.name as pipeline_nome, dd.department_id
from silver.deals d
join gold.pipelines_escopo e on e.pipeline_id = d.pipeline_id
left join silver.pipelines p on p.id = d.pipeline_id
left join governance.vw_deal_department dd on dd.deal_id = d.id;
comment on view quality.vw_deals_escopo is 'Negócios dos funis usados pelos painéis (gold.pipelines_escopo: comercial + histórico).';

create or replace view quality.vw_orgs_escopo as
select o.*, od.department_id
from silver.organizations o
left join governance.vw_org_department od on od.organization_id = o.id
where o.id in (select d.organization_id from silver.deals d
               join gold.pipelines_escopo e on e.pipeline_id = d.pipeline_id
               where d.organization_id is not null);
comment on view quality.vw_orgs_escopo is 'Empresas com pelo menos um negócio nos funis em escopo.';

create or replace view quality.vw_contacts_escopo as
with deal_contacts as (
  select distinct x.cid
  from bronze.deals b
  join gold.pipelines_escopo e on e.pipeline_id = b.pipeline_id
  cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(b.contact_ids) = 'array' then b.contact_ids
           when jsonb_typeof(b.contact_ids) = 'string' and (b.contact_ids #>> '{}') like '[%' then (b.contact_ids #>> '{}')::jsonb
           else '[]'::jsonb end) as x(cid)
),
scope_orgs as (
  select distinct d.organization_id as id from silver.deals d
  join gold.pipelines_escopo e on e.pipeline_id = d.pipeline_id
  where d.organization_id is not null
)
select c.*, od.department_id
from silver.contacts c
left join governance.vw_org_department od on od.organization_id = c.organization_id
where c.organization_id in (select id from scope_orgs)
   or c.id in (select cid from deal_contacts);
comment on view quality.vw_contacts_escopo is 'Contatos de empresas em escopo ou citados em negócios dos funis em escopo.';

create or replace view quality.vw_tasks_escopo as
select t.*, dd.department_id
from silver.tasks t
left join governance.vw_deal_department dd on dd.deal_id = t.deal_id
where t.deal_id is null
   or t.deal_id in (select d.id from silver.deals d join gold.pipelines_escopo e on e.pipeline_id = d.pipeline_id)
   or t.deal_id not in (select d.id from silver.deals d);
comment on view quality.vw_tasks_escopo is 'Tarefas sem negócio, de negócios em escopo ou ligadas a negócio inexistente (checagem de integridade).';

-- Departamento MARKETING sai do Hub (funil fora do escopo)
update governance.departments set active = false where code = 'marketing';

-- -----------------------------------------------------------------------------
-- 2) Regras reescritas sobre as populações em escopo
-- -----------------------------------------------------------------------------
select quality.upsert_rule('DEAL_VALOR_NAO_NEGATIVO', 'Valor do negócio não negativo',
  'Valores total, único e recorrente não podem ser negativos.',
  'silver.deals', 'total_price', 'validade', 'negocio', 'Negócios dos funis em escopo', 'alta', 100,
  $q$ select d.id, d.department_id,
             coalesce(d.total_price,0) >= 0 and coalesce(d.one_time_price,0) >= 0 and coalesce(d.recurrence_price,0) >= 0,
             d.name, d.pipeline_nome
      from quality.vw_deals_escopo d $q$);

select quality.upsert_rule('DEAL_STATUS_DOMINIO', 'Status do negócio no domínio',
  'Status deve ser ongoing, paused, won ou lost.',
  'silver.deals', 'status', 'validade', 'negocio', 'Negócios dos funis em escopo', 'alta', 100,
  $q$ select d.id, d.department_id, d.status in ('ongoing','paused','won','lost'), d.name, 'status=' || coalesce(d.status,'nulo')
      from quality.vw_deals_escopo d $q$);

select quality.upsert_rule('DEAL_ETAPA_DO_FUNIL', 'Etapa pertence ao funil do negócio',
  'A etapa atual do negócio deve pertencer ao mesmo funil do negócio.',
  'silver.deals', 'stage_id', 'consistencia', 'negocio', 'Negócios dos funis em escopo com etapa cadastrada', 'alta', 100,
  $q$ select d.id, d.department_id, s.pipeline_id = d.pipeline_id, d.name, d.pipeline_nome
      from quality.vw_deals_escopo d join silver.stages s on s.id = d.stage_id $q$);

select quality.upsert_rule('DEAL_EMPRESA_EXISTE', 'Empresa referenciada existe',
  'organization_id do negócio deve existir em silver.organizations.',
  'silver.deals', 'organization_id', 'integridade', 'negocio', 'Negócios dos funis em escopo com empresa informada', 'alta', 100,
  $q$ select d.id, d.department_id, exists (select 1 from silver.organizations o where o.id = d.organization_id), d.name, d.pipeline_nome
      from quality.vw_deals_escopo d where d.organization_id is not null $q$);

select quality.upsert_rule('DEAL_DONO_EXISTE', 'Responsável do negócio existe',
  'owner_id do negócio deve existir em silver.users.',
  'silver.deals', 'owner_id', 'integridade', 'negocio', 'Negócios dos funis em escopo', 'alta', 100,
  $q$ select d.id, d.department_id, d.owner_id is not null and exists (select 1 from silver.users u where u.id = d.owner_id), d.name, d.pipeline_nome
      from quality.vw_deals_escopo d $q$);

select quality.upsert_rule('DEAL_ETAPA_EXISTE', 'Etapa referenciada existe',
  'stage_id do negócio deve existir em silver.stages.',
  'silver.deals', 'stage_id', 'integridade', 'negocio', 'Negócios dos funis em escopo', 'alta', 100,
  $q$ select d.id, d.department_id, exists (select 1 from silver.stages s where s.id = d.stage_id), d.name, d.pipeline_nome
      from quality.vw_deals_escopo d $q$);

select quality.upsert_rule('DEAL_FUNIL_EXISTE', 'Funil referenciado existe',
  'pipeline_id do negócio deve existir em silver.pipelines.',
  'silver.deals', 'pipeline_id', 'integridade', 'negocio', 'Negócios dos funis em escopo', 'alta', 100,
  $q$ select d.id, d.department_id, exists (select 1 from silver.pipelines p where p.id = d.pipeline_id), d.name, null
      from quality.vw_deals_escopo d $q$);

select quality.upsert_rule('BRONZE_SILVER_DEALS', 'Negócio da bronze presente na silver',
  'Cada negócio extraído para bronze.deals nos funis em escopo deve existir em silver.deals (perda na transformação).',
  'silver.deals', 'id', 'integridade', 'negocio', 'Negócios da bronze nos funis em escopo', 'alta', 100,
  $q$ select b.id, dd.department_id, exists (select 1 from silver.deals s where s.id = b.id), b.name, null
      from bronze.deals b
      join gold.pipelines_escopo e on e.pipeline_id = b.pipeline_id
      left join governance.vw_deal_department dd on dd.deal_id = b.id $q$);

select quality.upsert_rule('DEAL_DUPLICADO', 'Negócio não duplicado',
  'Negócios com o mesmo nome, empresa (nome normalizado), funil, valor e status indicam cadastro repetido.',
  'silver.deals', 'id', 'unicidade', 'negocio', 'Negócios dos funis em escopo com empresa vinculada', 'alta', 99,
  $q$ with base as (
        select d.id, d.name, d.pipeline_id, d.created_at, d.department_id,
               lower(regexp_replace(translate(btrim(d.name),'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç','AAAAEEIOOOUCaaaaeeiooouc'),'\s+',' ','g')) as nome,
               lower(regexp_replace(translate(btrim(o.name),'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç','AAAAEEIOOOUCaaaaeeiooouc'),'\s+',' ','g')) as emp,
               coalesce(d.total_price, 0) as valor, d.status
        from quality.vw_deals_escopo d join silver.organizations o on o.id = d.organization_id),
      grp as (
        select nome, emp, pipeline_id, valor, status, count(*) n,
               string_agg(distinct to_char(created_at, 'DD/MM/YY'), ', ') as datas
        from base group by 1, 2, 3, 4, 5)
      select b.id, b.department_id, g.n = 1, b.name,
             case when g.n > 1 then g.n || ' cópias (criadas em ' || g.datas || ')' end
      from base b
      join grp g on g.nome is not distinct from b.nome and g.emp = b.emp and g.pipeline_id is not distinct from b.pipeline_id
                and g.valor = b.valor and g.status is not distinct from b.status $q$);

select quality.upsert_rule('ORG_CNPJ_VALIDO', 'CNPJ válido (dígitos verificadores)',
  'CNPJs preenchidos devem ter 14 dígitos e dígitos verificadores corretos.',
  'silver.organizations', 'cnpj', 'validade', 'empresa', 'Empresas em escopo com CNPJ preenchido', 'alta', 98,
  $q$ select o.id, o.department_id, quality.fn_cnpj_valido(o.cnpj), o.name, 'CNPJ ' || quality.fn_mask_doc(o.cnpj)
      from quality.vw_orgs_escopo o
      where nullif(btrim(o.cnpj),'') is not null $q$);

select quality.upsert_rule('ORG_CNPJ_UNICO', 'CNPJ não repetido entre empresas',
  'Um CNPJ não deve estar associado a mais de um cadastro de empresa.',
  'silver.organizations', 'cnpj', 'unicidade', 'empresa', 'Empresas em escopo com CNPJ preenchido', 'alta', 99,
  $q$ with base as (
        select o.id, o.name, o.department_id, o.created_at, regexp_replace(o.cnpj,'\D','','g') as doc
        from quality.vw_orgs_escopo o where nullif(btrim(o.cnpj),'') is not null),
      dup as (select doc, count(*) n, string_agg(distinct to_char(created_at, 'DD/MM/YY'), ', ') datas from base group by doc)
      select b.id, b.department_id, dup.n = 1, b.name,
             case when dup.n > 1 then dup.n || ' cadastros com o mesmo CNPJ ' || quality.fn_mask_doc(b.doc) || ' (criados em ' || dup.datas || ')' end
      from base b join dup using (doc) $q$);

select quality.upsert_rule('ORG_NOME_UNICO', 'Nome de empresa não duplicado',
  'Empresas não devem ter o mesmo nome normalizado (sem acento, caixa e espaços). Indica possíveis cadastros duplicados.',
  'silver.organizations', 'name', 'unicidade', 'empresa', 'Empresas em escopo com nome preenchido', 'media', 95,
  $q$ with base as (
        select o.id, o.name, o.department_id, o.created_at,
               lower(regexp_replace(translate(btrim(o.name),'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç','AAAAEEIOOOUCaaaaeeiooouc'),'\s+',' ','g')) as k
        from quality.vw_orgs_escopo o where nullif(btrim(o.name),'') is not null),
      dup as (select k, count(*) n, string_agg(distinct to_char(created_at, 'DD/MM/YY'), ', ') datas from base group by k)
      select b.id, b.department_id, dup.n = 1, b.name,
             case when dup.n > 1 then dup.n || ' cadastros com o mesmo nome (criados em ' || dup.datas || ')' end
      from base b join dup using (k) $q$);

select quality.upsert_rule('SILVER_ORG_SEM_BRONZE', 'Empresa da silver com origem na bronze',
  'Cada empresa em escopo de silver.organizations deve existir em bronze.organizations (rastreabilidade da carga).',
  'silver.organizations', 'id', 'integridade', 'empresa', 'Empresas em escopo', 'media', 100,
  $q$ select o.id, o.department_id, exists (select 1 from bronze.organizations b where b.id = o.id), o.name,
             'criada em ' || to_char(o.created_at, 'DD/MM/YYYY')
      from quality.vw_orgs_escopo o $q$);

select quality.upsert_rule('ETL_SEGMENTO', 'Segmento do RD convertido na silver',
  'Empresas em escopo com segmento preenchido no RD (bronze.segment_ids) devem ter o nome do segmento em silver.organizations.segment_name.',
  'silver.organizations', 'segment_name', 'integridade', 'empresa', 'Empresas em escopo com segmento preenchido no RD', 'alta', 100,
  $q$ select o.id, o.department_id, nullif(btrim(o.segment_name), '') is not null, o.name, 'segment_ids preenchido na bronze'
      from quality.vw_orgs_escopo o
      join bronze.organizations b on b.id = o.id
      where coalesce(b.segment_ids::text, '') not in ('', 'null', '[]', '"[]"', '""') $q$);

select quality.upsert_rule('CONTATO_MEIO', 'Contato com e-mail ou telefone',
  'Contatos devem ter ao menos um meio de contato (e-mail ou telefone).',
  'silver.contacts', 'email_principal / telefone_principal', 'completude', 'contato', 'Contatos em escopo', 'media', 90,
  $q$ select c.id, c.department_id,
             nullif(btrim(c.email_principal),'') is not null or nullif(btrim(c.telefone_principal),'') is not null,
             'Contato ' || right(c.id, 6), null
      from quality.vw_contacts_escopo c $q$);

select quality.upsert_rule('CONTATO_EMPRESA', 'Contato vinculado a empresa',
  'Contatos citados em negócios em escopo devem estar vinculados a uma empresa.',
  'silver.contacts', 'organization_id', 'completude', 'contato', 'Contatos em escopo', 'baixa', 85,
  $q$ select c.id, c.department_id, c.organization_id is not null, 'Contato ' || right(c.id, 6), null
      from quality.vw_contacts_escopo c $q$);

select quality.upsert_rule('CONTATO_EMAIL_VALIDO', 'E-mail de contato em formato válido',
  'E-mails preenchidos devem ter formato válido.',
  'silver.contacts', 'email_principal', 'validade', 'contato', 'Contatos em escopo com e-mail preenchido', 'media', 98,
  $q$ select c.id, c.department_id, c.email_principal ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$', 'Contato ' || right(c.id, 6), null
      from quality.vw_contacts_escopo c
      where nullif(btrim(c.email_principal),'') is not null $q$);

select quality.upsert_rule('CONTATO_EMAIL_UNICO', 'E-mail de contato não repetido',
  'O mesmo e-mail não deve aparecer em mais de um contato.',
  'silver.contacts', 'email_principal', 'unicidade', 'contato', 'Contatos em escopo com e-mail preenchido', 'baixa', 97,
  $q$ with base as (
        select c.id, c.department_id, c.created_at, lower(btrim(c.email_principal)) as k
        from quality.vw_contacts_escopo c where nullif(btrim(c.email_principal),'') is not null),
      dup as (select k, count(*) n, string_agg(distinct to_char(created_at, 'DD/MM/YY'), ', ') datas from base group by k)
      select b.id, b.department_id, dup.n = 1, 'Contato ' || right(b.id, 6),
             case when dup.n > 1 then dup.n || ' contatos com o mesmo e-mail (criados em ' || dup.datas || ')' end
      from base b join dup using (k) $q$);

select quality.upsert_rule('CONTATO_EMPRESA_EXISTE', 'Empresa do contato existe',
  'organization_id do contato deve existir em silver.organizations.',
  'silver.contacts', 'organization_id', 'integridade', 'contato', 'Contatos em escopo com empresa informada', 'media', 100,
  $q$ select c.id, c.department_id, exists (select 1 from silver.organizations o where o.id = c.organization_id), 'Contato ' || right(c.id, 6), null
      from quality.vw_contacts_escopo c where c.organization_id is not null $q$);

select quality.upsert_rule('TASK_STATUS_DOMINIO', 'Status da tarefa no domínio',
  'Status da tarefa deve ser open, completed ou canceled.',
  'silver.tasks', 'status', 'validade', 'tarefa', 'Tarefas em escopo', 'media', 100,
  $q$ select t.id, t.department_id, t.status in ('open','completed','canceled'), t.name, 'status=' || coalesce(t.status,'nulo')
      from quality.vw_tasks_escopo t $q$);

select quality.upsert_rule('TASK_CONCLUIDA_COM_DATA', 'Tarefa concluída com data de conclusão',
  'Tarefas concluídas devem ter data de conclusão.',
  'silver.tasks', 'completed_at', 'consistencia', 'tarefa', 'Tarefas concluídas em escopo', 'media', 100,
  $q$ select t.id, t.department_id, t.completed_at is not null, t.name, t.type
      from quality.vw_tasks_escopo t where t.status = 'completed' $q$);

select quality.upsert_rule('TASK_NEGOCIO_EXISTE', 'Negócio da tarefa existe',
  'deal_id da tarefa deve existir em silver.deals.',
  'silver.tasks', 'deal_id', 'integridade', 'tarefa', 'Tarefas em escopo com negócio informado', 'media', 100,
  $q$ select t.id, t.department_id, exists (select 1 from silver.deals d where d.id = t.deal_id), t.name, null
      from quality.vw_tasks_escopo t where t.deal_id is not null $q$);

-- -----------------------------------------------------------------------------
-- 3) Detecção de mudanças de negócios (substitui a etapa parada do ETL)
--    Mesma lógica validada contra as 708 mudanças históricas (100% iguais):
--    compara dias consecutivos do snapshot e registra mudança de valor e de gestor.
-- -----------------------------------------------------------------------------
create or replace function gold.atualizar_historico_mudancas(p_desde date default null)
returns int
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_desde date := coalesce(p_desde, (select max(detectado_em) from gold.deals_historico_mudancas), '1900-01-01'::date);
  v_n int;
begin
  with dias as (
    select d, lag(d) over (order by d) as prev
    from (select snapshot_date as d from gold.deals_snapshot_datas
          union select distinct snapshot_date from gold.deals_snapshot) x
  ),
  s as (select snapshot_date, id, total_price, owner_id from gold.vw_deals_snapshot_completo where snapshot_date >= v_desde - 7),
  chg as (
    select a.id as deal_id, 'valor'::text as tipo, b.total_price::text as ant, a.total_price::text as novo, dd.d as detectado
    from dias dd join s a on a.snapshot_date = dd.d join s b on b.snapshot_date = dd.prev and b.id = a.id
    where dd.d > v_desde and a.total_price is distinct from b.total_price
    union all
    select a.id, 'gestor', b.owner_id, a.owner_id, dd.d
    from dias dd join s a on a.snapshot_date = dd.d join s b on b.snapshot_date = dd.prev and b.id = a.id
    where dd.d > v_desde and a.owner_id is distinct from b.owner_id
  )
  insert into gold.deals_historico_mudancas (deal_id, tipo_evento, valor_anterior, valor_novo, detectado_em)
  select deal_id, tipo, ant, novo, detectado from chg
  on conflict (deal_id, tipo_evento, detectado_em) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
comment on function gold.atualizar_historico_mudancas(date) is
  'DQ Hub: registra mudanças de valor e de gestor entre snapshots diários (lógica idêntica à do ETL, validada em 708/708 eventos). Executada a cada validação do Hub.';
revoke all on function gold.atualizar_historico_mudancas(date) from public, anon, authenticated;

-- Preenche o período parado (desde 23/09/2026)
select gold.atualizar_historico_mudancas();

update provenance.transformation_registry
set implemented_in = 'gold.atualizar_historico_mudancas() — executada pelo DQ Hub a cada validação (ETL parado desde 23/09/2026)'
where name = 'deteccao_mudancas';

-- -----------------------------------------------------------------------------
-- 4) View do escopo para o dashboard
-- -----------------------------------------------------------------------------
create or replace view hub.v_analysis_scope as
select p.id as pipeline_id, p.name as pipeline_name,
       (e.pipeline_id is not null) as in_scope,
       e.uso as scope_use,
       n.reason as exclusion_reason,
       (select count(*) from silver.deals d where d.pipeline_id = p.id)::int as deals
from silver.pipelines p
left join gold.pipelines_escopo e on e.pipeline_id = p.id
left join governance.scope_exclusion_note n on n.pipeline_id = p.id;

grant select on all tables in schema hub to hub_app;
