import "server-only";
import pg from "pg";
import { unstable_cache } from "next/cache";
import { databaseUrl } from "./env";

/** Tag de todas as leituras do Hub. Invalidada após validações e qualquer escrita. */
export const HUB_DATA_TAG = "hub-data";
/** Os dados mudam só a cada validação (diária/manual) ou escrita no Hub: 2 min de cache é seguro. */
const CACHE_SECONDS = Number(process.env.HUB_CACHE_SECONDS ?? 120);

// numeric/bigint → number; date → string (evita deslocamento de fuso)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1082, (v) => v);

const globalForPg = globalThis as unknown as { __hubPool?: pg.Pool };

function connectionString(): string {
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL não configurada");
  return url;
}

/**
 * Cada conexão nova assume o papel restrito hub_app uma única vez (nível de sessão).
 * Assim cada consulta custa UMA ida ao banco — antes eram 6 (begin, set role,
 * timeout, read only, consulta, commit), ~100 ms cada.
 * Em produção, o usuário hub_login já tem `ALTER ROLE ... SET role = hub_app`.
 */
function pool(): pg.Pool {
  if (!globalForPg.__hubPool) {
    const p = new pg.Pool({
      connectionString: connectionString(),
      ssl: { rejectUnauthorized: false },
      max: Number(process.env.DB_POOL_MAX ?? 10),
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 10_000,
      keepAlive: true,
    });
    p.on("error", () => undefined);
    globalForPg.__hubPool = p;
  }
  return globalForPg.__hubPool;
}

type HubClient = pg.PoolClient & { __hubReady?: boolean };

/** Obtém uma conexão já restrita ao papel hub_app (SET ROLE só na primeira vez de cada conexão). */
async function acquire(): Promise<HubClient> {
  const client = (await pool().connect()) as HubClient;
  if (!client.__hubReady) {
    try {
      await client.query("set role hub_app; set statement_timeout = 30000");
      client.__hubReady = true;
    } catch (err) {
      client.release(err as Error);
      throw err;
    }
  }
  return client;
}

async function queryDirect<T>(sql: string, params: unknown[]): Promise<T[]> {
  const client = await acquire();
  try {
    const res = await client.query(sql, params);
    return res.rows as T[];
  } finally {
    client.release();
  }
}

/**
 * Leitura com cache compartilhado (mesmo resultado para todos os usuários autorizados;
 * a autorização continua sendo verificada a cada requisição). Datas voltam como string ISO.
 */
export function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (CACHE_SECONDS <= 0) return queryDirect<T>(sql, params);
  return unstable_cache(() => queryDirect<T>(sql, params), ["hubq", sql, JSON.stringify(params)], {
    tags: [HUB_DATA_TAG],
    revalidate: CACHE_SECONDS,
  })();
}

export async function queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** Operações longas (ex.: executar validações): timeout estendido só nesta conexão. */
export async function execute<T = Record<string, unknown>>(sql: string, params: unknown[] = [], timeout = "120s"): Promise<T[]> {
  const client = await acquire();
  try {
    await client.query(`set statement_timeout = '${timeout.replace(/[^0-9a-z]/gi, "")}'`);
    const res = await client.query(sql, params);
    return res.rows as T[];
  } finally {
    await client.query("set statement_timeout = 30000").catch(() => undefined);
    client.release();
  }
}
