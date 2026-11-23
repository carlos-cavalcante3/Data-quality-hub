# Arquitetura

## Camadas

| Camada | Onde | Responsabilidade |
|---|---|---|
| Dados operacionais/analíticos | `bronze`, `silver`, `gold`, `privado` | Inalterados pelo Hub (somente leitura) |
| Metadados e governança | `governance`, `provenance`, `control` | Departamentos, usuários, auditoria, datasets, linhagem, pipelines |
| Processamento de qualidade | `quality.run_all()` | Executa regras, coleta volume/atualidade/esquema/estatísticas |
| Resultados | `quality.validation_*`, `observability.*` | Histórico por `run_id` |
| Agregação | `hub.v_*`, `quality.fn_run_scores()` | Índices, séries, resumos, catálogo |
| Apresentação | Next.js (`src/app`) | Server Components; gráficos ECharts no cliente |

## Tabelas do Hub

- **governance**: `departments` (sincronizado de `bronze.teams`), `user_department_override`, `dataset_ownership`, `app_users`, `audit_log`.
- **provenance**: `dataset_registry` (camada, origem, SLA, criticidade, expressão de atualidade), `lineage_edges`, `transformation_registry`.
- **control**: `pipeline_registry`, `pipeline_executions` (alimentado pelo logger do ETL), `pipeline_alerts`, `schema_migrations`.
- **quality**: `dimensions` (pesos), `validation_rules`, `validation_runs`, `validation_results` (consolidado + por departamento), `validation_failures` (ids afetados, retenção de 45 dias), `quality_issues`, `issue_events`.
- **observability**: `dataset_metrics` (linhas, última atualização, atualidade, variação de volume), `schema_snapshots` (só quando o esquema muda), `column_stats` (pg_stats).

## Fluxo de uma validação

1. `governance.sync_departments()` incorpora novas equipes do RD.
2. Coleta de `count(*)` e da última atualização de cada dataset monitorado, com cálculo de atualidade × SLA e variação de volume.
3. Snapshot de esquema de todas as tabelas e views, gravado apenas quando a estrutura muda.
4. Estatísticas de coluna (`pg_stats`) para o catálogo.
5. Para cada regra ativa: executa `check_sql`, grava os agregados (consolidado e por departamento) e os ids afetados.
6. Com o volume atual (~150 mil verificações), termina em menos de 5 s.

## Fontes de execução de pipelines

| Pipeline | Evidência |
|---|---|
| `etl-rd-principal` | `control.pipeline_executions` (após instrumentar) + inferência por `gold.deals_snapshot_datas` |
| `etl-prevendas` | `privado.etl_sync_log` |
| `rd-sync-prevendas` | `privado.rd_sync_state` (somente último estado) |
| `dq-hub-validacoes` | `quality.validation_runs` |
