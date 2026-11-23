-- =============================================================================
-- 007 - Semântica das regras (problema, impacto, ação), população mínima por
--       regra e views de composição dos departamentos.
-- =============================================================================

alter table quality.validation_rules add column if not exists problem_label  text;
alter table quality.validation_rules add column if not exists impact         text;
alter table quality.validation_rules add column if not exists recommendation text;
alter table quality.validation_rules add column if not exists min_population int not null default 20;

comment on column quality.validation_rules.name          is 'Expectativa da regra (o que deveria ser verdade)';
comment on column quality.validation_rules.problem_label is 'Nome do problema quando a regra falha (usado em listas de problemas e relatórios)';
comment on column quality.validation_rules.min_population is 'Mínimo de registros avaliados para o score ser considerado (abaixo disso: dados insuficientes)';

update quality.validation_rules r set
  problem_label  = v.problem,
  impact         = v.impact,
  recommendation = v.rec
from (values
  ('DEAL_EMPRESA', 'Negócios sem empresa vinculada', 'O negócio não entra na carteira do cliente nem nos rankings por empresa.', 'Vincular cada negócio à empresa correspondente no RD.'),
  ('DEAL_VALOR', 'Negócios abertos ou ganhos sem valor', 'Pipeline, previsão de vendas e ticket médio ficam subestimados.', 'Preencher o valor total do negócio no RD.'),
  ('DEAL_PREVISAO', 'Negócios abertos sem previsão de fechamento', 'O negócio fica fora da previsão de vendas mensal.', 'Informar a data prevista de fechamento no RD.'),
  ('DEAL_TIPO_CONTRATO', 'Negócios sem tipo de contrato', 'Impede segmentar vendas e pipeline por tipo de contrato ou projeto.', 'Preencher o campo "Tipo de contrato" no RD.'),
  ('DEAL_MOTIVO_PERDA', 'Negócios perdidos sem motivo da perda', 'Impede a análise dos motivos de perda.', 'Registrar o motivo ao marcar o negócio como perdido.'),
  ('DEAL_DATA_PROPOSTA', 'Propostas entregues sem data de entrega', 'A data da proposta passa a ser estimada, distorcendo a conversão por período.', 'Preencher "Data de entrega da proposta" no RD.'),
  ('ORG_CNPJ', 'Empresas clientes sem CNPJ', 'Impede identificar a empresa com segurança, deduplicar cadastros e integrar com outros sistemas.', 'Completar o CNPJ das empresas listadas no RD.'),
  ('ORG_UF', 'Empresas clientes sem estado (UF)', 'Impede análises regionais de clientes e vendas.', 'Preencher o estado da empresa no RD.'),
  ('ORG_CIDADE', 'Empresas clientes sem cidade', 'Impede análises regionais de clientes e vendas.', 'Preencher a cidade da empresa no RD.'),
  ('ORG_SEGMENTO', 'Empresas clientes sem segmento', 'Impede análises por segmento de mercado.', 'Confirmar se o segmento está preenchido no RD; se estiver, revisar a extração no ETL (o campo chega vazio em todas as empresas).'),
  ('CONTATO_MEIO', 'Contatos sem e-mail e sem telefone', 'O contato não pode ser acionado pelo time comercial.', 'Completar ao menos um meio de contato no RD.'),
  ('CONTATO_EMPRESA', 'Contatos sem empresa vinculada', 'O contato não aparece no relacionamento com o cliente.', 'Vincular o contato à empresa no RD.'),
  ('HIST_ETAPAS_COBERTURA', 'Negócios sem histórico de etapas', 'Funil de conversão, primeira passagem por etapa e linha do tempo ficam incompletos.', 'Revisar a carga de deal_stage_histories no ETL.'),
  ('ORG_CNPJ_VALIDO', 'Empresas com CNPJ inválido', 'CNPJ inválido impede consultas e integrações.', 'Corrigir o CNPJ no RD.'),
  ('CONTATO_EMAIL_VALIDO', 'Contatos com e-mail em formato inválido', 'O contato não recebe comunicações por e-mail.', 'Corrigir o e-mail do contato no RD.'),
  ('DEAL_VALOR_NAO_NEGATIVO', 'Negócios com valor negativo', 'Valores negativos distorcem receita e pipeline.', 'Corrigir o valor no RD.'),
  ('DEAL_STATUS_DOMINIO', 'Negócios com status desconhecido', 'O negócio não é classificado como aberto, ganho ou perdido.', 'Revisar o mapeamento de status no ETL.'),
  ('TASK_STATUS_DOMINIO', 'Tarefas com status desconhecido', 'A tarefa não entra nos indicadores de visitas e reuniões.', 'Revisar o mapeamento de status no ETL.'),
  ('ORG_CNPJ_UNICO', 'Empresas com CNPJ repetido em outro cadastro', 'A mesma empresa aparece em mais de um cadastro, dividindo histórico e valores.', 'Unificar os cadastros com o mesmo CNPJ no RD.'),
  ('ORG_NOME_UNICO', 'Empresas com nome duplicado (possível cadastro repetido)', 'Contagem de clientes e carteira ficam distorcidas e o histórico do cliente fica dividido.', 'Revisar os grupos de empresas com o mesmo nome e unificar os duplicados no RD.'),
  ('CONTATO_EMAIL_UNICO', 'Contatos com e-mail repetido (possível cadastro repetido)', 'Comunicação em duplicidade e histórico do contato dividido.', 'Revisar os contatos com o mesmo e-mail e unificar os duplicados no RD.'),
  ('BRONZE_SILVER_DEALS', 'Negócios extraídos que não chegaram à silver', 'Negócios do RD não chegam às camadas analíticas e somem dos painéis.', 'Investigar a transformação bronze → silver no ETL.'),
  ('DEAL_FECHADO_COM_DATA', 'Negócios ganhos/perdidos sem data de fechamento', 'O negócio não entra nos indicadores por período.', 'Revisar o fechamento do negócio no RD.'),
  ('DEAL_FECHAMENTO_APOS_CRIACAO', 'Negócios com fechamento anterior à criação', 'Indica negócio importado ou data incorreta; ciclo de vendas e métricas por data de criação ficam distorcidos.', 'Corrigir as datas no RD ou confirmar que são negócios importados.'),
  ('DEAL_GANHO_COM_VALOR', 'Negócios ganhos sem valor', 'A receita do período fica subestimada.', 'Preencher o valor dos negócios ganhos no RD.'),
  ('DEAL_ABERTO_FORA_ENCERRADO', 'Negócios abertos na etapa "Encerrado"', 'Status e etapa contraditórios geram números diferentes entre painéis.', 'Marcar o negócio como ganho/perdido ou movê-lo para a etapa correta.'),
  ('DEAL_ETAPA_DO_FUNIL', 'Negócios com etapa de outro funil', 'O negócio aparece no funil errado.', 'Revisar a etapa do negócio no RD.'),
  ('TASK_CONCLUIDA_COM_DATA', 'Tarefas concluídas sem data de conclusão', 'A tarefa não entra nos rankings de visitas e reuniões.', 'Revisar a conclusão da tarefa no RD.'),
  ('DEAL_EMPRESA_EXISTE', 'Negócios ligados a empresa inexistente', 'O negócio perde o vínculo com o cliente nos relatórios.', 'Verificar se a empresa foi excluída no RD ou se a carga falhou.'),
  ('DEAL_DONO_EXISTE', 'Negócios com responsável inexistente', 'O negócio fica sem gestor nos painéis.', 'Reatribuir o negócio a um usuário ativo.'),
  ('DEAL_ETAPA_EXISTE', 'Negócios com etapa inexistente', 'O negócio desaparece do funil.', 'Verificar etapas excluídas no RD ou recarregar as etapas no ETL.'),
  ('DEAL_FUNIL_EXISTE', 'Negócios com funil inexistente', 'O negócio fica fora de todos os painéis.', 'Verificar funis excluídos no RD ou recarregar os funis no ETL.'),
  ('TASK_NEGOCIO_EXISTE', 'Tarefas ligadas a negócio inexistente', 'A tarefa perde o vínculo com o negócio.', 'Verificar negócios excluídos no RD ou a carga de negócios.'),
  ('CONTATO_EMPRESA_EXISTE', 'Contatos ligados a empresa inexistente', 'O contato perde o vínculo com o cliente.', 'Verificar empresas excluídas no RD ou a carga de empresas.'),
  ('DATASET_NO_PRAZO', 'Datasets desatualizados (fora do SLA)', 'Painéis e relatórios mostram informação antiga.', 'Verificar a execução do pipeline responsável pelo dataset.'),
  ('DEAL_ABERTO_MOVIMENTADO', 'Negócios abertos parados há mais de 90 dias', 'O pipeline aberto inclui oportunidades possivelmente encerradas, inflando valores e previsões.', 'Atualizar ou encerrar os negócios parados no RD.'),
  ('SNAPSHOT_DIARIO', 'Dias sem snapshot diário de negócios', 'O histórico diário de negócios fica com lacunas.', 'Verificar se o ETL rodou nesses dias e reprocessar se necessário.')
) as v(code, problem, impact, rec)
where r.code = v.code;

-- Regras sobre datasets/dias avaliam poucos itens por natureza.
update quality.validation_rules set min_population = 1 where entity = 'dataset';

-- -----------------------------------------------------------------------------
-- Índice: respeita a população mínima de cada regra
-- -----------------------------------------------------------------------------
create or replace function quality.fn_run_scores(p_run bigint, p_department int default null)
returns table (
  level text, dataset_name text, dimension text, score numeric,
  records_evaluated bigint, records_passed bigint, rules_count int, status text
)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
with res as (
  select r.dataset_name, r.dimension, r.min_population, vr.records_evaluated, vr.records_passed
  from quality.validation_results vr
  join quality.validation_rules r on r.id = vr.rule_id
  where vr.run_id = p_run and vr.status = 'ok' and vr.records_evaluated > 0
    and ((p_department is null and vr.department_id is null) or vr.department_id = p_department)
),
dd_all as (
  select dataset_name, dimension,
         sum(records_evaluated)::bigint ev, sum(records_passed)::bigint ps, count(*)::int n,
         min(min_population) mp,
         100.0 * sum(records_passed) / sum(records_evaluated) sc
  from res group by dataset_name, dimension
),
dd as (select * from dd_all where ev >= mp),
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
       case when ev < mp then 'dados_insuficientes' else 'ok' end
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

-- -----------------------------------------------------------------------------
-- Views recriadas com as novas colunas
-- -----------------------------------------------------------------------------
drop view if exists hub.v_rules;
create view hub.v_rules as
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
       cur.quality_score - prev.quality_score as delta_score
from quality.validation_rules r
join quality.dimensions dm on dm.code = r.dimension
left join provenance.dataset_registry reg on reg.dataset_name = r.dataset_name
left join cur on cur.rule_id = r.id
left join prev on prev.rule_id = r.id;

drop view if exists hub.v_rule_results;
create view hub.v_rule_results as
select vr.id, vr.run_id, ru.started_at as run_started_at,
       (ru.started_at at time zone 'America/Sao_Paulo')::date as day,
       r.id as rule_id, r.code as rule_code, r.name as rule_name, r.problem_label, r.severity, r.entity,
       r.dimension, r.dataset_name, r.column_name,
       vr.department_id, d.name as department_name,
       vr.records_evaluated, vr.records_passed, vr.records_failed, vr.quality_score, vr.status, vr.error_message,
       vr.rule_version, vr.evaluated_at
from quality.validation_results vr
join quality.validation_rules r on r.id = vr.rule_id
join quality.validation_runs ru on ru.id = vr.run_id
left join governance.departments d on d.id = vr.department_id;

drop view if exists hub.v_failures_latest;
create view hub.v_failures_latest as
select f.run_id, r.code as rule_code, r.name as rule_name, r.problem_label, r.dimension, r.dataset_name, r.entity,
       f.record_id, f.record_label, f.detail, f.department_id, d.name as department_name
from quality.validation_failures f
join quality.validation_rules r on r.id = f.rule_id
left join governance.departments d on d.id = f.department_id
where f.run_id = (select id from hub.v_last_run);

-- -----------------------------------------------------------------------------
-- Composição dos departamentos (de onde vêm os registros)
-- -----------------------------------------------------------------------------
create or replace view hub.v_department_members as
with tm as (
  select t.name as team_name, x.uid as user_id
  from bronze.teams t
  cross join lateral jsonb_array_elements_text(
      case jsonb_typeof(t.user_ids) when 'string' then (t.user_ids #>> '{}')::jsonb
                                    when 'array' then t.user_ids else '[]'::jsonb end) as x(uid)
),
teams_of as (select user_id, string_agg(team_name, ', ' order by team_name) as teams, count(*)::int as n from tm group by user_id),
assigned as (
  select ud.user_id, ud.department_id, ud.rule from governance.vw_user_department ud
  union all
  select u.id, (select id from governance.departments where code = 'nao_identificado'), 'sem_equipe'
  from silver.users u where not exists (select 1 from governance.vw_user_department ud where ud.user_id = u.id)
)
select a.department_id, a.user_id,
       case when u.name like '%@%' then split_part(u.name, '@', 1) else coalesce(u.name, 'Usuário ' || right(a.user_id, 6)) end as user_name,
       a.rule, t.teams as all_teams, coalesce(t.n, 0) as teams_count,
       (select count(*) from silver.deals d where d.owner_id = a.user_id)::int as deals_total,
       (select count(*) from quality.vw_deals_comerciais d where d.owner_id = a.user_id)::int as deals_comerciais,
       (select count(*) from silver.organizations o where o.owner_id = a.user_id)::int as empresas
from assigned a
left join silver.users u on u.id = a.user_id
left join teams_of t on t.user_id = a.user_id;

create or replace view hub.v_department_pipelines as
select coalesce(ud.department_id, (select id from governance.departments where code = 'nao_identificado')) as department_id,
       p.name as pipeline_name, coalesce(e.uso, 'fora_do_escopo') as escopo, count(*)::int as deals
from silver.deals d
left join governance.vw_user_department ud on ud.user_id = d.owner_id
left join silver.pipelines p on p.id = d.pipeline_id
left join gold.pipelines_escopo e on e.pipeline_id = d.pipeline_id
group by 1, 2, 3;

create or replace view hub.v_department_entities as
select vr.department_id, r.entity,
       count(distinct r.id)::int as rules,
       sum(vr.records_evaluated)::bigint as checks_evaluated,
       sum(vr.records_failed)::bigint as occurrences
from quality.validation_results vr
join quality.validation_rules r on r.id = vr.rule_id
where vr.run_id = (select id from hub.v_last_run) and vr.department_id is not null and vr.status = 'ok'
group by vr.department_id, r.entity;

grant select on all tables in schema hub to hub_app;
