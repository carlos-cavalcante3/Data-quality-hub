-- =============================================================================
-- 010 - Correções de permissão apontadas em DOCUMENTACAO_BANCO_COMPLETA.md §12
--       Somente revogações que não afetam os consumidores atuais:
--       ETL/Edge Function usam service_role; n8n usa leitor_n8n; painéis leem gold.
--       NÃO inclui o acesso de anon às views privado.vw_* (painel de pré-vendas
--       pode depender dele — aguardando confirmação).
--
-- Reversão (se necessário):
--   grant execute on function public.gerar_snapshot_deals() to anon, authenticated;
--   grant all on all tables in schema bronze, silver to anon, authenticated;
--   grant execute on function public.refresh_gold_mvs(), public.update_log_notificacoes() to anon, authenticated;
--   grant select on gold.vw_n8n_comercial_negocios to public;
-- =============================================================================

do $$
declare r record;
begin
  -- Risco #2 (alta): qualquer cliente da API apagava e regravava o snapshot do dia
  for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('gerar_snapshot_deals','refresh_gold_mvs','update_log_notificacoes') loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.f);
    execute format('grant execute on function %s to service_role', r.f);
  end loop;

  -- Risco #3 (média): anon/authenticated com todos os privilégios em bronze/silver
  -- (inclusive silver.api_auth com o token do RD). RLS sem política já bloqueava
  -- leitura; TRUNCATE não passa por RLS.
  for r in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname in ('bronze','silver') and c.relkind in ('r','p','v','m') loop
    execute format('revoke all on %I.%I from anon, authenticated', r.nspname, r.relname);
  end loop;

  -- Risco #6 (média): view dos relatórios do n8n legível por qualquer usuário logado
  if to_regclass('gold.vw_n8n_comercial_negocios') is not null then
    execute 'revoke select on gold.vw_n8n_comercial_negocios from public';
    if exists (select 1 from pg_roles where rolname = 'leitor_n8n') then
      execute 'grant select on gold.vw_n8n_comercial_negocios to leitor_n8n';
    end if;
    execute 'grant select on gold.vw_n8n_comercial_negocios to service_role';
  end if;
end $$;
