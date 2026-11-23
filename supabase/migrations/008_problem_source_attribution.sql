-- =============================================================================
-- 008 - Origem do problema (CRM × Banco/ETL), novas regras de diagnóstico do
--       pipeline e atribuição de departamento pelo funil do negócio.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Atribuição de departamento por registro
--    Quando o responsável pertence a mais de uma equipe, vale a equipe ligada ao
--    funil do negócio (ex.: importação do funil MARKETING feita por alguém que
--    também é de Vendas fica com MARKETING). Sem vínculo de funil: regra de prioridade.
-- -----------------------------------------------------------------------------
create table if not exists governance.pipeline_department (
  pipeline_id   text primary key,
  department_id int  not null references governance.departments(id),
  notes         text
);
comment on table governance.pipeline_department is 'Equipe responsável por cada funil do RD. Usada como desempate quando o responsável está em mais de uma equipe.';

insert into governance.pipeline_department (pipeline_id, department_id, notes)
select p.id, d.id, 'mapeamento inicial por nome'
from silver.pipelines p
join (values
  ('MARKETING', 'MARKETING'),
  ('VENDAS PRIVADO', 'Vendas Privado'),
  ('VENDAS PÚBLICO/ELÉTRICO', 'Vendas Público / Elétrico'),
  ('ÁUDIO E VÍDEO', 'Audio e Video'),
  ('VENDAS BA', 'Vendas Bahia')
) m(pipeline_name, dept_name) on m.pipeline_name = p.name
join governance.departments d on d.name = m.dept_name
on conflict (pipeline_id) do nothing;

create or replace view governance.vw_user_teams as
select x.uid as user_id, d.id as department_id
from bronze.teams t
cross join lateral jsonb_array_elements_text(
    case jsonb_typeof(t.user_ids) when 'string' then (t.user_ids #>> '{}')::jsonb
                                  when 'array' then t.user_ids else '[]'::jsonb end) as x(uid)
join governance.departments d on d.source_ref = t.id and d.active;

create or replace view governance.vw_deal_department as
select d.id as deal_id,
       coalesce(
         (select o.department_id from governance.user_department_override o where o.user_id = d.owner_id),
         (select pd.department_id from governance.pipeline_department pd
            join governance.vw_user_teams ut on ut.department_id = pd.department_id and ut.user_id = d.owner_id
           where pd.pipeline_id = d.pipeline_id),
         ud.department_id) as department_id
from silver.deals d
left join governance.vw_user_department ud on ud.user_id = d.owner_id;

create or replace view governance.vw_org_department as
with main_pipeline as (
  select distinct on (organization_id) organization_id, pipeline_id
  from (select organization_id, pipeline_id, count(*) n from silver.deals where organization_id is not null group by 1, 2) x
  order by organization_id, n desc, pipeline_id
)
select o.id as organization_id,
       coalesce(
         (select ov.department_id from governance.user_department_override ov where ov.user_id = o.owner_id),
         (select pd.department_id from governance.pipeline_department pd
            join governance.vw_user_teams ut on ut.department_id = pd.department_id and ut.user_id = o.owner_id
           where pd.pipeline_id = mp.pipeline_id),
         ud.department_id) as department_id
from silver.organizations o
left join main_pipeline mp on mp.organization_id = o.id
left join governance.vw_user_department ud on ud.user_id = o.owner_id;

create or replace view quality.vw_deals_comerciais as
select d.*,
       p.name  as pipeline_nome,
       s.name  as stage_nome,
       dd.department_id
from silver.deals d
join gold.pipelines_escopo e on e.pipeline_id = d.pipeline_id and e.uso = 'comercial'
left join silver.pipelines p on p.id = d.pipeline_id
left join silver.stages s on s.id = d.stage_id
left join governance.vw_deal_department dd on dd.deal_id = d.id;

create or replace view quality.vw_orgs_clientes as
select o.*, od.department_id
from silver.organizations o
left join governance.vw_org_department od on od.organization_id = o.id
where exists (select 1 from quality.vw_deals_comerciais d where d.organization_id = o.id);

-- Regras existentes passam a usar a atribuição por registro (versão incrementa)
update quality.validation_rules set
  check_sql = replace(check_sql,
    'from bronze.deals b left join governance.vw_user_department ud on ud.user_id = b.owner_id',
    'from bronze.deals b left join governance.vw_deal_department ud on ud.deal_id = b.id'),
  version = version + 1, updated_at = now()
where code = 'BRONZE_SILVER_DEALS' and check_sql like '%vw_user_department ud on ud.user_id = b.owner_id%';

update quality.validation_rules set
  check_sql = replace(check_sql,
    'left join governance.vw_user_department ud on ud.user_id = d.owner_id',
    'left join governance.vw_deal_department ud on ud.deal_id = d.id'),
  version = version + 1, updated_at = now()
where check_sql like '%vw_user_department ud on ud.user_id = d.owner_id%';

update quality.validation_rules set
  check_sql = replace(check_sql,
    'left join governance.vw_user_department ud on ud.user_id = o.owner_id',
    'left join governance.vw_org_department ud on ud.organization_id = o.id'),
  version = version + 1, updated_at = now()
where check_sql like '%vw_user_department ud on ud.user_id = o.owner_id%';

update quality.validation_rules set
  check_sql = replace(check_sql,
    'left join governance.vw_user_department ud on ud.user_id = b.owner_id',
    'left join governance.vw_org_department ud on ud.organization_id = b.id'),
  version = version + 1, updated_at = now()
where code = 'ORG_CNPJ_UNICO' and check_sql like '%vw_user_department ud on ud.user_id = b.owner_id%';

-- -----------------------------------------------------------------------------
-- 2) Origem do problema
--    crm      = preenchimento/cadastro na origem (ação do departamento responsável)
--    pipeline = extração, transformação ou carga (ação da Engenharia de Dados)
-- -----------------------------------------------------------------------------
alter table quality.validation_rules add column if not exists problem_source text not null default 'crm'
  check (problem_source in ('crm','pipeline'));
alter table quality.validation_rules add column if not exists source_note text;
comment on column quality.validation_rules.problem_source is 'Onde o problema nasce: crm (cadastro na origem, ação do departamento) ou pipeline (ETL/banco, ação da Engenharia de Dados)';

-- -----------------------------------------------------------------------------
-- 3) Regras novas e regras redefinidas
-- -----------------------------------------------------------------------------
-- Segmento: separa o que é falta de preenchimento no RD do que é perda no ETL
select quality.upsert_rule('ORG_SEGMENTO', 'Empresa cliente com segmento no RD',
  'Empresas com negócios comerciais devem ter segmento preenchido no RD (segment_ids da bronze).',
  'silver.organizations', 'segment_ids', 'completude', 'empresa', 'Empresas com negócio comercial', 'media', 80,
  $q$ select o.id, o.department_id,
             coalesce(b.segment_ids::text, '') not in ('', 'null', '[]', '"[]"', '""'),
             o.name, null
      from quality.vw_orgs_clientes o
      left join bronze.organizations b on b.id = o.id $q$);

select quality.upsert_rule('ETL_SEGMENTO', 'Segmento do RD convertido na silver',
  'Empresas com segmento preenchido no RD (bronze.segment_ids) devem ter o nome do segmento em silver.organizations.segment_name.',
  'silver.organizations', 'segment_name', 'integridade', 'empresa', 'Empresas com segmento preenchido no RD', 'alta', 100,
  $q$ select b.id, od.department_id, nullif(btrim(s.segment_name), '') is not null, b.name, 'segment_ids preenchido na bronze'
      from bronze.organizations b
      join silver.organizations s on s.id = b.id
      left join governance.vw_org_department od on od.organization_id = b.id
      where coalesce(b.segment_ids::text, '') not in ('', 'null', '[]', '"[]"', '""') $q$);

select quality.upsert_rule('SILVER_ORG_SEM_BRONZE', 'Empresa da silver com origem na bronze',
  'Cada empresa de silver.organizations deve existir em bronze.organizations (rastreabilidade da carga).',
  'silver.organizations', 'id', 'integridade', 'empresa', 'Todas as empresas da silver', 'media', 100,
  $q$ select s.id, od.department_id, exists (select 1 from bronze.organizations b where b.id = s.id), s.name,
             'criada em ' || to_char(s.created_at, 'DD/MM/YYYY')
      from silver.organizations s
      left join governance.vw_org_department od on od.organization_id = s.id $q$);

select quality.upsert_rule('DEAL_DUPLICADO', 'Negócio não duplicado',
  'Negócios com o mesmo nome, empresa (nome normalizado), funil, valor e status indicam cadastro repetido (ex.: importação feita mais de uma vez).',
  'silver.deals', 'id', 'unicidade', 'negocio', 'Negócios com empresa vinculada', 'alta', 99,
  $q$ with base as (
        select d.id, d.name, d.pipeline_id, d.created_at,
               lower(regexp_replace(translate(btrim(d.name),'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç','AAAAEEIOOOUCaaaaeeiooouc'),'\s+',' ','g')) as nome,
               lower(regexp_replace(translate(btrim(o.name),'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç','AAAAEEIOOOUCaaaaeeiooouc'),'\s+',' ','g')) as emp,
               coalesce(d.total_price, 0) as valor, d.status
        from silver.deals d join silver.organizations o on o.id = d.organization_id),
      grp as (
        select nome, emp, pipeline_id, valor, status, count(*) n,
               string_agg(distinct to_char(created_at, 'DD/MM/YY'), ', ') as datas
        from base group by 1, 2, 3, 4, 5)
      select b.id, dd.department_id, g.n = 1, b.name,
             case when g.n > 1 then g.n || ' cópias (criadas em ' || g.datas || ')' end
      from base b
      join grp g on g.nome is not distinct from b.nome and g.emp = b.emp and g.pipeline_id is not distinct from b.pipeline_id
                and g.valor = b.valor and g.status is not distinct from b.status
      left join governance.vw_deal_department dd on dd.deal_id = b.id $q$);

-- Duplicidades: detalhe passa a mostrar as datas de criação dos cadastros (evidência de importação)
select quality.upsert_rule('ORG_NOME_UNICO', 'Nome de empresa não duplicado',
  'Empresas não devem ter o mesmo nome normalizado (sem acento, caixa e espaços). Indica possíveis cadastros duplicados.',
  'silver.organizations', 'name', 'unicidade', 'empresa', 'Empresas com nome preenchido', 'media', 95,
  $q$ with base as (
        select o.id, o.name, o.created_at,
               lower(regexp_replace(translate(btrim(o.name),'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç','AAAAEEIOOOUCaaaaeeiooouc'),'\s+',' ','g')) as k
        from silver.organizations o where nullif(btrim(o.name),'') is not null),
      dup as (select k, count(*) n, string_agg(distinct to_char(created_at, 'DD/MM/YY'), ', ') datas from base group by k)
      select b.id, od.department_id, dup.n = 1, b.name,
             case when dup.n > 1 then dup.n || ' cadastros com o mesmo nome (criados em ' || dup.datas || ')' end
      from base b join dup using (k)
      left join governance.vw_org_department od on od.organization_id = b.id $q$);

select quality.upsert_rule('CONTATO_EMAIL_UNICO', 'E-mail de contato não repetido',
  'O mesmo e-mail não deve aparecer em mais de um contato.',
  'silver.contacts', 'email_principal', 'unicidade', 'contato', 'Contatos com e-mail preenchido', 'baixa', 97,
  $q$ with base as (
        select c.id, c.organization_id, c.created_at, lower(btrim(c.email_principal)) as k
        from silver.contacts c where nullif(btrim(c.email_principal),'') is not null),
      dup as (select k, count(*) n, string_agg(distinct to_char(created_at, 'DD/MM/YY'), ', ') datas from base group by k)
      select b.id, od.department_id, dup.n = 1, 'Contato ' || right(b.id, 6),
             case when dup.n > 1 then dup.n || ' contatos com o mesmo e-mail (criados em ' || dup.datas || ')' end
      from base b join dup using (k)
      left join governance.vw_org_department od on od.organization_id = b.organization_id $q$);

-- Textos das regras novas/redefinidas
update quality.validation_rules r set problem_label = v.problem, impact = v.impact, recommendation = v.rec
from (values
  ('ORG_SEGMENTO', 'Empresas clientes sem segmento no RD', 'Impede análises por segmento de mercado.', 'Preencher o segmento da empresa no RD.'),
  ('ETL_SEGMENTO', 'Segmento preenchido no RD mas vazio na silver', 'Todas as análises por segmento ficam vazias, mesmo com o dado existindo no CRM.', 'Ajustar o ETL para converter segment_ids em nome do segmento (endpoint de segmentos da API do RD).'),
  ('SILVER_ORG_SEM_BRONZE', 'Empresas na silver sem origem na bronze', 'Registros sem rastreabilidade até a extração; podem ter sido gravados por outro processo.', 'Identificar qual processo grava essas empresas na silver e alinhar com a extração.'),
  ('DEAL_DUPLICADO', 'Negócios duplicados (mesmo nome, empresa, funil, valor e status)', 'Contagens de oportunidades, pipeline e conversão ficam infladas.', 'Excluir ou mesclar no RD os negócios repetidos; evitar reimportar planilhas já carregadas.'),
  ('ORG_NOME_UNICO', 'Empresas com nome duplicado (possível cadastro repetido)', 'Contagem de clientes e carteira ficam distorcidas e o histórico do cliente fica dividido.', 'Revisar os grupos de empresas com o mesmo nome e unificar os duplicados no RD. Datas de criação iguais indicam importação repetida.'),
  ('CONTATO_EMAIL_UNICO', 'Contatos com e-mail repetido (possível cadastro repetido)', 'Comunicação em duplicidade e histórico do contato dividido.', 'Unificar os contatos duplicados no RD. Datas de criação iguais indicam importação repetida.')
) as v(code, problem, impact, rec)
where r.code = v.code;

-- Origem de cada regra
update quality.validation_rules set problem_source = 'pipeline', source_note = v.note
from (values
  ('BRONZE_SILVER_DEALS', 'Perda de registros na transformação bronze → silver.'),
  ('SILVER_ORG_SEM_BRONZE', 'Registro na silver sem correspondente na extração.'),
  ('ETL_SEGMENTO', 'O dado existe no CRM, mas não é convertido pelo ETL.'),
  ('HIST_ETAPAS_COBERTURA', 'Carga incompleta do histórico de etapas (deal_stage_histories).'),
  ('DEAL_EMPRESA_EXISTE', 'A empresa não existe nem na bronze: exclusões no RD não são propagadas ou a extração falhou.'),
  ('DEAL_ETAPA_EXISTE', 'A etapa não existe nem na bronze: etapa excluída no RD ou carga de etapas incompleta.'),
  ('DEAL_FUNIL_EXISTE', 'Funil inexistente nas tabelas carregadas.'),
  ('DEAL_DONO_EXISTE', 'Usuário inexistente nas tabelas carregadas.'),
  ('TASK_NEGOCIO_EXISTE', 'O negócio não existe nem na bronze: exclusões no RD não são propagadas.'),
  ('CONTATO_EMPRESA_EXISTE', 'A empresa não existe nem na bronze: exclusões no RD não são propagadas.'),
  ('DEAL_ETAPA_DO_FUNIL', 'No RD a etapa sempre pertence ao funil; divergência indica carga desatualizada.'),
  ('DEAL_STATUS_DOMINIO', 'Mapeamento de status no ETL.'),
  ('TASK_STATUS_DOMINIO', 'Mapeamento de status no ETL.'),
  ('DATASET_NO_PRAZO', 'Atraso na execução do pipeline.'),
  ('SNAPSHOT_DIARIO', 'O ETL não gerou o snapshot do dia.')
) as v(code, note)
where quality.validation_rules.code = v.code;

update quality.validation_rules set source_note = 'Cadastro ou preenchimento feito no RD Station.'
where problem_source = 'crm' and source_note is null;

-- -----------------------------------------------------------------------------
-- 4) Views do Hub com a origem (colunas novas ao final)
-- -----------------------------------------------------------------------------
create or replace view hub.v_rules as
with cur as (
       select vr.* from quality.validation_results vr
       where vr.department_id is null and vr.run_id = (select id from hub.v_last_run)),
     prev as (
       select distinct on (vr.rule_id) vr.rule_id, vr.quality_score, dr.day
       from quality.validation_results vr
       join hub.v_daily_runs dr on dr.run_id = vr.run_id
       where vr.department_id is null and vr.status = 'ok'
         and dr.day <= (now() at time zone 'America/Sao_Paulo')::date - 1
       order by vr.rule_id, abs(dr.day - ((now() at time zone 'America/Sao_Paulo')::date - 30)), dr.day desc)
select r.id, r.code, r.name, r.problem_label, r.description, r.impact, r.recommendation,
       r.dataset_name, r.column_name, r.dimension, dm.name as dimension_name,
       r.entity, r.population, r.severity, r.expected_threshold, r.min_population, r.check_sql, r.version, r.active, r.updated_at,
       reg.layer, reg.criticality,
       cur.run_id as last_run_id, cur.evaluated_at as last_evaluated_at, cur.status as last_status, cur.error_message,
       cur.records_evaluated, cur.records_passed, cur.records_failed, cur.quality_score,
       case when cur.status is null or cur.status = 'erro' then 'validacao_nao_executada'
            when cur.records_evaluated < r.min_population then 'dados_insuficientes'
            else quality.fn_band(cur.quality_score) end as band,
       cur.quality_score >= r.expected_threshold as meets_threshold,
       prev.quality_score as previous_score, prev.day as previous_day,
       cur.quality_score - prev.quality_score as delta_score,
       r.problem_source, r.source_note
from quality.validation_rules r
join quality.dimensions dm on dm.code = r.dimension
left join provenance.dataset_registry reg on reg.dataset_name = r.dataset_name
left join cur on cur.rule_id = r.id
left join prev on prev.rule_id = r.id;

create or replace view hub.v_rule_results as
select vr.id, vr.run_id, ru.started_at as run_started_at,
       (ru.started_at at time zone 'America/Sao_Paulo')::date as day,
       r.id as rule_id, r.code as rule_code, r.name as rule_name, r.problem_label, r.severity, r.entity,
       r.dimension, r.dataset_name, r.column_name,
       vr.department_id, d.name as department_name,
       vr.records_evaluated, vr.records_passed, vr.records_failed, vr.quality_score, vr.status, vr.error_message,
       vr.rule_version, vr.evaluated_at,
       r.problem_source
from quality.validation_results vr
join quality.validation_rules r on r.id = vr.rule_id
join quality.validation_runs ru on ru.id = vr.run_id
left join governance.departments d on d.id = vr.department_id;

create or replace view hub.v_failures_latest as
select f.run_id, r.code as rule_code, r.name as rule_name, r.problem_label, r.dimension, r.dataset_name, r.entity,
       f.record_id, f.record_label, f.detail, f.department_id, d.name as department_name,
       r.problem_source
from quality.validation_failures f
join quality.validation_rules r on r.id = f.rule_id
left join governance.departments d on d.id = f.department_id
where f.run_id = (select id from hub.v_last_run);

create or replace view hub.v_department_pipelines as
select coalesce(dd.department_id, (select id from governance.departments where code = 'nao_identificado')) as department_id,
       p.name as pipeline_name, coalesce(e.uso, 'fora_do_escopo') as escopo, count(*)::int as deals
from silver.deals d
left join governance.vw_deal_department dd on dd.deal_id = d.id
left join silver.pipelines p on p.id = d.pipeline_id
left join gold.pipelines_escopo e on e.pipeline_id = d.pipeline_id
group by 1, 2, 3;

create or replace view hub.v_pipeline_departments as
select pd.pipeline_id, p.name as pipeline_name, pd.department_id, d.name as department_name, pd.notes
from governance.pipeline_department pd
join silver.pipelines p on p.id = pd.pipeline_id
join governance.departments d on d.id = pd.department_id;

grant select on all tables in schema hub to hub_app;
