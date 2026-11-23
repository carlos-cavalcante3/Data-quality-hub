import "server-only";
import pg from "pg";

// numeric/bigint → number; date → string (evita deslocamento de fuso)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1082, (v) => v);

const globalForPg = globalThis as unknown as { __hubPool?: pg.Pool };

function connectionString(): string {
  const url = process.env.DATABASE_URL || process.env.DATABASE_URL_READONLY;
  if (!url) throw new Error("DATABASE_URL não configurada");
  return url;
}

function pool(): pg.Pool {
  if (!globalForPg.__hubPool) {
    globalForPg.__hubPool = new pg.Pool({
      connectionString: connectionString(),
      // Supabase exige TLS. O certificado do pooler é validado pela cadeia pública quando disponível.
      ssl: { rejectUnauthorized: false },
      max: Number(process.env.DB_POOL_MAX ?? 4),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return globalForPg.__hubPool;
}

/**
 * Toda consulta roda numa transação com SET LOCAL ROLE hub_app:
 * mesmo que a credencial configurada seja mais ampla, a aplicação só
 * enxerga o schema hub (views e funções do Hub).
 */
async function run<T>(sql: string, params: unknown[], readOnly: boolean, timeout = "20s"): Promise<T[]> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    await client.query("set local role hub_app");
    await client.query(`set local statement_timeout = '${timeout}'`);
    if (readOnly) await client.query("set transaction read only");
    const res = await client.query(sql, params);
    await client.query("commit");
    return res.rows as T[];
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return run<T>(sql, params, true);
}

export async function queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await run<T>(sql, params, true);
  return rows[0] ?? null;
}

export function execute<T = Record<string, unknown>>(sql: string, params: unknown[] = [], timeout = "120s"): Promise<T[]> {
  return run<T>(sql, params, false, timeout);
}
