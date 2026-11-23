"""
Registro de execuções do ETL no Data Quality Hub (control.pipeline_executions).

Uso no pipeline (GitHub Actions hoje, Airflow depois):

    from dq_hub_logger import PipelineRun

    with PipelineRun("etl-rd-principal", conn) as run:
        deals = extrair_deals()
        run.add(records_extracted=len(deals))
        inseridos, atualizados = gravar(deals)
        run.add(records_inserted=inseridos, records_updated=atualizados)

- `conn`: conexão psycopg2/psycopg já usada pelo ETL (service role / usuário do ETL).
- Em caso de exceção, a execução é gravada com status 'falha' e a mensagem de erro, e a exceção é relançada.
- O identificador usa GITHUB_RUN_ID (ou AIRFLOW_CTX_DAG_RUN_ID) quando disponível; o link do run vai em run_url.
- Nunca registre dados pessoais em `details`.
"""
from __future__ import annotations

import json
import os
import traceback
import uuid
from datetime import datetime, timezone


class PipelineRun:
    def __init__(self, pipeline_name: str, conn, source: str = "RD Station CRM API v1"):
        self.pipeline_name = pipeline_name
        self.conn = conn
        self.source = source
        self.counts = {"records_extracted": 0, "records_inserted": 0, "records_updated": 0, "records_rejected": 0}
        self.details: dict = {}
        gh_run = os.getenv("GITHUB_RUN_ID")
        attempt = os.getenv("GITHUB_RUN_ATTEMPT", "1")
        self.execution_id = (
            f"gh-{gh_run}-{attempt}" if gh_run else os.getenv("AIRFLOW_CTX_DAG_RUN_ID") or f"local-{uuid.uuid4()}"
        )
        self.run_url = (
            f"{os.getenv('GITHUB_SERVER_URL')}/{os.getenv('GITHUB_REPOSITORY')}/actions/runs/{gh_run}" if gh_run else None
        )
        self.code_version = os.getenv("GITHUB_SHA", "")[:12] or None

    def add(self, **kwargs: int) -> None:
        for k, v in kwargs.items():
            if k in self.counts and v is not None:
                self.counts[k] += int(v)

    def detail(self, key: str, value) -> None:
        self.details[key] = value

    def _write(self, status: str, error: str | None = None, finished: bool = True) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                insert into control.pipeline_executions
                  (pipeline_name, execution_id, started_at, finished_at, status, source,
                   records_extracted, records_inserted, records_updated, records_rejected,
                   error_message, code_version, run_url, details)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                on conflict (pipeline_name, execution_id) do update set
                  finished_at = excluded.finished_at, status = excluded.status,
                  records_extracted = excluded.records_extracted, records_inserted = excluded.records_inserted,
                  records_updated = excluded.records_updated, records_rejected = excluded.records_rejected,
                  error_message = excluded.error_message, details = excluded.details
                """,
                (
                    self.pipeline_name, self.execution_id, self.started_at,
                    datetime.now(timezone.utc) if finished else None, status, self.source,
                    self.counts["records_extracted"], self.counts["records_inserted"],
                    self.counts["records_updated"], self.counts["records_rejected"],
                    (error or "")[:2000] or None, self.code_version, self.run_url,
                    json.dumps(self.details, default=str),
                ),
            )
        self.conn.commit()

    def __enter__(self) -> "PipelineRun":
        self.started_at = datetime.now(timezone.utc)
        try:
            self._write("em_andamento", finished=False)
        except Exception:  # o log nunca deve derrubar o ETL
            self.conn.rollback()
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        try:
            if exc is None:
                self._write("sucesso")
            else:
                self.details["traceback"] = "".join(traceback.format_exception(exc_type, exc, tb))[-4000:]
                self._write("falha", error=f"{exc_type.__name__}: {exc}")
        except Exception:
            self.conn.rollback()
        return False
