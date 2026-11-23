# Segurança e LGPD

## Modelo de acesso

- **Autenticação**: Supabase Auth com e-mail e senha ou link mágico. Os hooks existentes já restringem os domínios corporativos e a aplicação valida o domínio de novo.
- **Autorização**: papel `viewer`, `analyst` ou `admin`, definido em `governance.app_users` (ou `HUB_ADMIN_EMAILS` para bootstrap). Sem papel, o acesso é negado.
- **Banco**: toda consulta da aplicação roda em transação com `SET LOCAL ROLE hub_app`. O papel `hub_app` só tem `USAGE` no schema `hub`, `SELECT` nas views `hub.v_*` e `EXECUTE` nas funções `hub.fn_*`. Escritas ocorrem apenas por essas funções (`SECURITY DEFINER`, com `search_path` fixo), que validam o papel e gravam auditoria.
- **Nada de `service_role` no frontend.** A anon key é usada apenas para o login. Os dados vêm do servidor.
- **Cabeçalhos**: CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `noindex`, `Cache-Control: no-store`.
- **Cron**: `/api/cron/run-quality` exige `Authorization: Bearer CRON_SECRET`, com comparação em tempo constante.
- **Auditoria**: execuções, exportações CSV, geração de relatórios, alterações de issues, usuários e pesos ficam em `governance.audit_log`.

## Usuário de banco dedicado para produção (recomendado)

O `.env.local` atual usa o usuário `postgres`. A aplicação se restringe sozinha via `SET ROLE`, mas em produção use um login com o mínimo de privilégios. Execute no SQL Editor do Supabase, definindo você mesmo a senha:

```sql
create role hub_login login password '<defina uma senha forte>' in role hub_app;
alter role hub_login set statement_timeout = '30s';
alter role hub_login set idle_in_transaction_session_timeout = '30s';
alter role hub_login connection limit 10;
```

Na Vercel: `DATABASE_URL=postgresql://hub_login.<ref>:<senha>@aws-1-sa-east-1.pooler.supabase.com:6543/postgres`.

## LGPD

- `validation_failures` guarda apenas o **id** do registro e um rótulo não sensível (nome do negócio ou da empresa). Contatos aparecem como “Contato ######”. E-mail, telefone e CPF nunca são gravados nem exibidos.
- O CNPJ é mascarado nos detalhes (`12.***.***/****-34`).
- Exportação CSV restrita a `analyst+`, auditada e com proteção contra injeção de fórmulas.
- Retenção: ids afetados por 45 dias. Resultados agregados ficam por tempo indeterminado, sem dado pessoal.

## Riscos herdados do banco (fora do escopo do Hub, recomendação)

A documentação do banco aponta riscos que **não foram alterados** pelo Hub e precisam de decisão:

1. `privado.vw_*` legíveis por `anon` (CNPJ e valores expostos com a anon key). **Alta.**
2. `public.gerar_snapshot_deals()` é `SECURITY DEFINER` e executável por `anon`. **Alta.**
3. `anon` e `authenticated` têm todos os privilégios em `bronze`/`silver`, incluindo `silver.api_auth` (token do RD).
4. A variável `DATABASE_URL_READONLY` aponta para o usuário `postgres`, ou seja, não é somente leitura.
