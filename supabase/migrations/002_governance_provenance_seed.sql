-- =============================================================================
-- 002 - Departamentos, atribuição de responsáveis, cadastro de datasets,
--       pipelines e linhagem declarada.
-- =============================================================================

-- Sincroniza departamentos a partir das equipes do RD (bronze.teams).
create or replace function governance.sync_departments()
returns int
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare v int;
begin
  insert into governance.departments (code, name, source, source_ref, priority)
  select lower(regexp_replace(translate(t.name,
           'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç', 'AAAAEEIOOOUCaaaaeeiooouc'), '[^A-Za-z0-9]+', '_', 'g')),
         t.name, 'rd_team', t.id,
         case
           when t.name ilike '%backoffice%' then 50
           when t.name ilike '%marketing%'  then 60
           when t.name ilike '%vendas%'     then 10
           else 20
         end
  from bronze.teams t
  on conflict (source_ref) do update set name = excluded.name;
  get diagnostics v = row_count;
  return v;
end $$;

select governance.sync_departments();

-- Usuário do RD → departamento.
-- Regra documentada (docs/METRICAS.md):
--   1) override manual (governance.user_department_override);
--   2) equipe do RD em que o usuário está; se estiver em mais de uma, a de menor prioridade
--      (equipes de Vendas antes de Áudio e Vídeo, Backoffice e Marketing);
--   3) sem equipe → "Não identificado" (tratado nas regras via coalesce).
create or replace view governance.vw_user_department as
with team_members as (
  select x.uid as user_id, d.id as department_id, d.priority
  from bronze.teams t
  cross join lateral jsonb_array_elements_text(
      case jsonb_typeof(t.user_ids)
        when 'string' then (t.user_ids #>> '{}')::jsonb
        when 'array'  then t.user_ids
        else '[]'::jsonb end) as x(uid)
  join governance.departments d on d.source_ref = t.id and d.active
),
ranked as (
  select distinct on (user_id) user_id, department_id, 'equipe_rd'::text as rule
  from team_members order by user_id, priority, department_id
)
select o.user_id, o.department_id, 'override_manual'::text as rule
from governance.user_department_override o
union all
select r.user_id, r.department_id, r.rule
from ranked r
where not exists (select 1 from governance.user_department_override o where o.user_id = r.user_id);

create or replace function governance.fn_unassigned_department()
returns int language sql stable
set search_path = pg_catalog, pg_temp
as $$ select id from governance.departments where code = 'nao_identificado' $$;

-- -----------------------------------------------------------------------------
-- Cadastro de datasets
-- -----------------------------------------------------------------------------
insert into provenance.dataset_registry
  (dataset_name, layer, object_type, source_system, source_dataset, description, pipeline_name,
   update_frequency, expected_interval, freshness_expr, criticality, contains_personal_data, monitored)
values
  ('rd.api',                      'origem','api',  'RD Station CRM', null, 'API v1 do RD Station CRM (extração paginada) e webhooks', null, 'contínua', null, null, 5, true, false),
  ('bronze.deals',                'bronze','table','RD Station CRM','deals','Negócios brutos da API','etl-rd-principal','várias vezes ao dia','1 day','max(updated_at)',4,false,true),
  ('bronze.deal_stage_histories', 'bronze','table','RD Station CRM','deal_stage_histories','Passagens dos negócios pelas etapas','etl-rd-principal','várias vezes ao dia',null,'max(coalesce(end_date,start_date))',3,false,true),
  ('bronze.deal_stage_histories_sync','bronze','table','ETL','controle','Controle de busca do histórico de etapas','etl-rd-principal','várias vezes ao dia','1 day','max(buscado_em)',2,false,true),
  ('bronze.organizations',        'bronze','table','RD Station CRM','organizations','Empresas brutas','etl-rd-principal','várias vezes ao dia','2 days','max(updated_at)',3,true,true),
  ('bronze.contacts',             'bronze','table','RD Station CRM','contacts','Contatos brutos (dados pessoais)','etl-rd-principal','várias vezes ao dia','2 days','max(updated_at)',2,true,true),
  ('bronze.tasks',                'bronze','table','RD Station CRM','tasks','Tarefas brutas','etl-rd-principal','várias vezes ao dia','2 days','max(updated_at)',2,false,true),
  ('bronze.users',                'bronze','table','RD Station CRM','users','Usuários do RD','etl-rd-principal','várias vezes ao dia',null,'max(updated_at)',2,true,true),
  ('bronze.teams',                'bronze','table','RD Station CRM','teams','Equipes do RD','etl-rd-principal','várias vezes ao dia',null,'max(updated_at)',2,false,true),
  ('bronze.pipelines',            'bronze','table','RD Station CRM','pipelines','Funis','etl-rd-principal','várias vezes ao dia',null,'max(updated_at)',2,false,true),
  ('bronze.stages',               'bronze','table','RD Station CRM','stages','Etapas','etl-rd-principal','várias vezes ao dia',null,'max(updated_at)',2,false,true),
  ('silver.deals',                'silver','table','RD Station CRM','bronze.deals','Negócios tratados','etl-rd-principal','várias vezes ao dia','1 day','max(updated_at)',5,false,true),
  ('silver.deal_etapas',          'silver','table','RD Station CRM','bronze.deal_stage_histories','Histórico consolidado de etapas (negócio × etapa)','etl-rd-principal','várias vezes ao dia',null,'max(coalesce(saida,ultima_entrada))',3,false,true),
  ('silver.deals_historico',      'silver','table','ETL','silver.deals','Trocas de etapa detectadas entre cargas (legado)','etl-rd-principal','várias vezes ao dia','2 days','max(changed_at)',2,false,true),
  ('silver.organizations',        'silver','table','RD Station CRM','bronze.organizations','Empresas tratadas','etl-rd-principal','várias vezes ao dia','2 days','max(updated_at)',4,false,true),
  ('silver.contacts',             'silver','table','RD Station CRM','bronze.contacts','Contatos tratados (dados pessoais)','etl-rd-principal','várias vezes ao dia','2 days','max(updated_at)',2,true,true),
  ('silver.tasks',                'silver','table','RD Station CRM','bronze.tasks','Tarefas tratadas','etl-rd-principal','várias vezes ao dia','2 days','max(updated_at)',3,false,true),
  ('silver.users',                'silver','table','RD Station CRM','bronze.users','Usuários (vendedores)','etl-rd-principal','várias vezes ao dia',null,'max(updated_at)',3,true,true),
  ('silver.teams',                'silver','table','RD Station CRM','bronze.teams','Equipes','etl-rd-principal','várias vezes ao dia',null,'max(updated_at)',2,false,true),
  ('silver.pipelines',            'silver','table','RD Station CRM','bronze.pipelines','Funis','etl-rd-principal','várias vezes ao dia',null,'max(updated_at)',3,false,true),
  ('silver.stages',               'silver','table','RD Station CRM','bronze.stages','Etapas','etl-rd-principal','várias vezes ao dia',null,'max(updated_at)',3,false,true),
  ('silver.log_notificacoes_email','silver','table','Trigger Pré-Venda','silver.deals_historico','Fila de e-mails de alerta lida pelo n8n','etl-rd-principal','eventual',null,'max(atualizado_em)',2,false,true),
  ('gold.deals_snapshot',         'gold','table','ETL','silver.deals','Foto diária de silver.deals (7 dias)','etl-rd-principal','diária','1 day 6 hours','max(snapshot_date)::timestamptz + interval ''3 hours''',4,false,true),
  ('gold.deals_snapshot_historico','gold','table','ETL','gold.deals_snapshot','Snapshot compactado em faixas (dias com mais de 7 dias)','etl-rd-principal','diária','9 days','max(valido_ate)::timestamptz + interval ''3 hours''',3,false,true),
  ('gold.deals_historico_mudancas','gold','table','ETL','gold.deals_snapshot','Mudanças de valor e de gestor entre snapshots','etl-rd-principal','diária','2 days','max(detectado_em)::timestamptz + interval ''3 hours''',3,false,true),
  ('gold.vw_deals_base',          'gold','view','Regra de negócio','silver.deals','Base única de negócios (escopo, fuso, status)',null,'tempo real',null,null,5,false,false),
  ('gold.vw_propostas_validas',   'gold','view','Regra de negócio','gold.vw_deals_base','Regra única de proposta',null,'tempo real',null,null,4,false,false),
  ('gold.mv_kpis_gerais',         'gold','materialized_view','Regra de negócio','gold.vw_deals_base','KPIs gerais dos painéis','etl-rd-principal','após cada carga',null,null,5,false,false),
  ('privado.deals',               'privado','table','RD Station CRM (webhook)','deals','Negócios atualizados por webhook (pré-vendas)','rd-sync-prevendas','quase tempo real','1 day','max(processado_em)',3,false,true),
  ('privado.deal_etapas',         'privado','table','RD Station CRM (webhook)','deal_stage_histories','Histórico de etapas (pré-vendas)','rd-sync-prevendas','quase tempo real','1 day','max(atualizado_em)',2,false,true),
  ('privado.etl_sync_log',        'privado','table','ETL pré-vendas','controle','Log de execuções do ETL do schema privado','etl-prevendas','várias vezes ao dia','12 hours','max(executado_em)',3,false,true),
  ('painel.insight_hub',          'consumo','dashboard','Painéis comerciais',null,'insight-hub-web / avantia-insight-hub (MVs da gold)',null,null,null,null,4,false,false),
  ('painel.prevendas',            'consumo','dashboard','Painel de pré-vendas',null,'Painel de pré-vendas (views do privado)',null,null,null,null,3,false,false),
  ('n8n.relatorios_whatsapp',     'consumo','automation','n8n',null,'Relatórios comerciais via WhatsApp',null,null,null,null,3,false,false),
  ('n8n.email_prevenda',          'consumo','automation','n8n',null,'E-mails de alerta de Pré-Venda',null,null,null,null,2,false,false)
on conflict (dataset_name) do update set
  layer = excluded.layer, object_type = excluded.object_type, source_system = excluded.source_system,
  source_dataset = excluded.source_dataset, description = excluded.description, pipeline_name = excluded.pipeline_name,
  update_frequency = excluded.update_frequency, expected_interval = excluded.expected_interval,
  freshness_expr = excluded.freshness_expr, criticality = excluded.criticality,
  contains_personal_data = excluded.contains_personal_data, monitored = excluded.monitored;

-- -----------------------------------------------------------------------------
-- Pipelines
-- -----------------------------------------------------------------------------
insert into control.pipeline_registry (name, display_name, description, orchestrator, schedule_desc, expected_interval, source_system, repository, evidence_source) values
  ('etl-rd-principal', 'ETL RD → Bronze/Silver/Gold', 'Extração paginada da API do RD, transformação para silver, snapshot diário, compactação e refresh das MVs da gold', 'GitHub Actions (migração para Airflow planejada)', 'Várias vezes ao dia', '1 day', 'RD Station CRM', null,
     'control.pipeline_executions (quando instrumentado) + evidência indireta: dias gravados em gold.deals_snapshot_datas/deals_snapshot'),
  ('etl-prevendas', 'ETL Pré-vendas (privado)', 'ETL com credencial própria que alimenta o schema privado', 'GitHub Actions', '~3 vezes ao dia', '12 hours', 'RD Station CRM', null, 'privado.etl_sync_log'),
  ('rd-sync-prevendas', 'Edge Function rd-sync (webhooks)', 'Sincronização quase em tempo real via webhooks do RD', 'Supabase Edge Function', 'Por evento + incremental', '1 day', 'RD Station CRM (webhook)', null, 'privado.rd_sync_state (último estado)'),
  ('dq-hub-validacoes', 'DQ Hub — validações de qualidade', 'Execução das regras de qualidade e coleta de métricas do Hub (quality.run_all)', 'Vercel Cron / manual', 'Diária', '1 day 6 hours', 'Supabase', 'Data-quality-hub', 'quality.validation_runs')
on conflict (name) do update set display_name = excluded.display_name, description = excluded.description,
  orchestrator = excluded.orchestrator, schedule_desc = excluded.schedule_desc, expected_interval = excluded.expected_interval,
  evidence_source = excluded.evidence_source;

-- -----------------------------------------------------------------------------
-- Transformações e linhagem declarada
-- -----------------------------------------------------------------------------
insert into provenance.transformation_registry (name, description, pipeline_name, implemented_in, rule_summary) values
  ('extracao_rd', 'Extração paginada da API do RD e upsert por id', 'etl-rd-principal', 'Python (GitHub Actions)', 'Upsert em bronze.* por id'),
  ('normalizacao_silver', 'Achata JSON, renomeia campos personalizados, normaliza tipos', 'etl-rd-principal', 'Python (GitHub Actions)', 'bronze.* → silver.*'),
  ('consolidacao_etapas', 'Uma linha por negócio e etapa (primeira/última entrada, saída)', 'etl-rd-principal', 'Python (GitHub Actions)', 'bronze.deal_stage_histories → silver.deal_etapas'),
  ('snapshot_diario', 'Foto diária de silver.deals', 'etl-rd-principal', 'public.gerar_snapshot_deals()', 'Apaga o dia corrente e regrava'),
  ('compactacao_snapshot', 'Dias antigos viram faixas valido_de–valido_ate', 'etl-rd-principal', 'gold.compactar_deals_snapshot()', 'Confere a reconstrução antes de apagar'),
  ('deteccao_mudancas', 'Mudanças de valor e gestor entre snapshots', 'etl-rd-principal', 'Python (GitHub Actions)', 'Uma mudança por tipo/negócio/dia'),
  ('regras_gold', 'Escopo de funis, fuso, status, importados, propostas', null, 'gold.vw_deals_base / gold.vw_propostas_validas', 'Ver DOCUMENTACAO_BANCO_COMPLETA.md §3'),
  ('refresh_gold', 'REFRESH das materializadas da gold', 'etl-rd-principal', 'public.atualizar_camada_gold()', 'Sem CONCURRENTLY, timeout 10 min'),
  ('webhook_rd_sync', 'Aplicação de eventos de webhook do RD', 'rd-sync-prevendas', 'Edge Function rd-sync', 'Ignora versões antigas (trigger)')
on conflict (name) do update set description = excluded.description, implemented_in = excluded.implemented_in, rule_summary = excluded.rule_summary;

insert into provenance.lineage_edges (source_dataset, destination_dataset, pipeline_name, transformation_name, edge_type) values
  ('rd.api','bronze.deals','etl-rd-principal','extracao_rd','etl'),
  ('rd.api','bronze.deal_stage_histories','etl-rd-principal','extracao_rd','etl'),
  ('rd.api','bronze.organizations','etl-rd-principal','extracao_rd','etl'),
  ('rd.api','bronze.contacts','etl-rd-principal','extracao_rd','etl'),
  ('rd.api','bronze.tasks','etl-rd-principal','extracao_rd','etl'),
  ('rd.api','bronze.users','etl-rd-principal','extracao_rd','etl'),
  ('rd.api','bronze.teams','etl-rd-principal','extracao_rd','etl'),
  ('rd.api','bronze.pipelines','etl-rd-principal','extracao_rd','etl'),
  ('rd.api','bronze.stages','etl-rd-principal','extracao_rd','etl'),
  ('bronze.deals','silver.deals','etl-rd-principal','normalizacao_silver','etl'),
  ('bronze.deal_stage_histories','silver.deal_etapas','etl-rd-principal','consolidacao_etapas','etl'),
  ('bronze.organizations','silver.organizations','etl-rd-principal','normalizacao_silver','etl'),
  ('bronze.contacts','silver.contacts','etl-rd-principal','normalizacao_silver','etl'),
  ('bronze.tasks','silver.tasks','etl-rd-principal','normalizacao_silver','etl'),
  ('bronze.users','silver.users','etl-rd-principal','normalizacao_silver','etl'),
  ('bronze.teams','silver.teams','etl-rd-principal','normalizacao_silver','etl'),
  ('bronze.pipelines','silver.pipelines','etl-rd-principal','normalizacao_silver','etl'),
  ('bronze.stages','silver.stages','etl-rd-principal','normalizacao_silver','etl'),
  ('silver.deals','silver.deals_historico','etl-rd-principal','normalizacao_silver','etl'),
  ('silver.deals_historico','silver.log_notificacoes_email','etl-rd-principal','trg_insere_fila_prevenda','funcao'),
  ('silver.deals','gold.deals_snapshot','etl-rd-principal','snapshot_diario','funcao'),
  ('gold.deals_snapshot','gold.deals_snapshot_historico','etl-rd-principal','compactacao_snapshot','funcao'),
  ('gold.deals_snapshot','gold.deals_historico_mudancas','etl-rd-principal','deteccao_mudancas','etl'),
  ('rd.api','privado.deals','rd-sync-prevendas','webhook_rd_sync','webhook'),
  ('rd.api','privado.deal_etapas','rd-sync-prevendas','webhook_rd_sync','webhook'),
  ('gold.mv_kpis_gerais','painel.insight_hub',null,null,'consumo'),
  ('gold.mv_performance_gestor','painel.insight_hub',null,null,'consumo'),
  ('gold.mv_pipeline_funil','painel.insight_hub',null,null,'consumo'),
  ('gold.mv_oportunidades_geradas_mes','painel.insight_hub',null,null,'consumo'),
  ('gold.mv_ranking_movimentacoes','painel.insight_hub',null,null,'consumo'),
  ('gold.mv_ranking_visitas','painel.insight_hub',null,null,'consumo'),
  ('privado.vw_oportunidades_prevendas','painel.prevendas',null,null,'consumo'),
  ('privado.vw_prevendas_historico','painel.prevendas',null,null,'consumo'),
  ('gold.vw_n8n_comercial_negocios','n8n.relatorios_whatsapp',null,null,'consumo'),
  ('silver.log_notificacoes_email','n8n.email_prevenda',null,null,'consumo')
on conflict (source_dataset, destination_dataset, edge_type) do nothing;
