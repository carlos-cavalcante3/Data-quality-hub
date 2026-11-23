-- =============================================================================
-- 011 - Schema privado: remove escrita de usuários logados, mantendo o painel
--       de pré-vendas (anon key, sem login) funcionando.
--
-- Contexto: o painel lê privado.vw_oportunidades_prevendas, vw_prevendas_historico
-- e etl_sync_status com a anon key — esse acesso é MANTIDO.
-- Problema corrigido: "authenticated" (qualquer login em qualquer app deste
-- projeto Supabase) tinha INSERT/UPDATE/DELETE/TRUNCATE em privado.deals e
-- privado.etl_sync_log. O RLS bloqueia insert/update/delete, mas TRUNCATE
-- ignora RLS: um usuário logado podia apagar a tabela inteira.
-- A escrita continua com service_role (Edge Function rd-sync e ETL).
--
-- Reversão:
--   grant all on privado.deals, privado.etl_sync_log to authenticated;
--   grant all on privado.etl_sync_status, privado.vw_oportunidades_prevendas, privado.vw_prevendas_historico to authenticated;
--   alter default privileges for role postgres in schema privado grant all on tables to authenticated;
-- =============================================================================

do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'privado' and c.relkind in ('r','p','v','m') loop
    execute format('revoke insert, update, delete, truncate, references, trigger on privado.%I from authenticated, anon', r.relname);
  end loop;
end $$;

-- Leitura preservada (mesmo estado de antes)
grant select on privado.deals, privado.etl_sync_log to authenticated;
grant select on privado.etl_sync_status, privado.vw_oportunidades_prevendas, privado.vw_prevendas_historico to anon, authenticated;

-- Tabelas futuras do schema: authenticated só lê por padrão (antes: todos os privilégios)
alter default privileges for role postgres in schema privado revoke all on tables from authenticated;
alter default privileges for role postgres in schema privado grant select on tables to authenticated;

-- A política citava "anon", que não tem permissão na tabela (sem efeito). Fica explícito.
alter policy "Permitir leitura pública no front-end" on privado.deals to authenticated;
