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

const globalForPg = globalThis as unknown as { __hubPool?: pg.Pool; __hubMode?: Mode };

/**
 * Dois modos de conexão:
 *  - "transacao" (serverless/Vercel): pooler Supavisor na porta 6543. Não prende conexões
 *    entre requisições — o modo sessão (5432) aceita só 15 clientes e instâncias serverless
 *    congeladas esgotavam o pool compartilhado com ETL e outros apps.
 *    Cada consulta roda em transação curta com SET LOCAL ROLE hub_app.
 *  - "sessao" (desenvolvimento local): SET ROLE uma vez por conexão; 1 ida ao banco por consulta.
 */
type Mode = "transacao" | "sessao";

function resolveConnection(): { url: string; mode: Mode } {
  const raw = databaseUrl();
  if (!raw) throw new Error("DATABASE_URL não configurada");
  const u = new URL(raw);
  const serverless = !!process.env.VERCEL || process.env.HUB_DB_MODE === "transacao";
  if (serverless && u.hostname.endsWith("pooler.supabase.com") && u.port !== "6543") u.port = "6543";
  const mode: Mode = u.port === "6543" ? "transacao" : "sessao";
  return { url: u.toString(), mode };
}

function pool(): pg.Pool {
  if (!globalForPg.__hubPool) {
    const { url, mode } = resolveConnection();
    const p = new pg.Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: Number(process.env.DB_POOL_MAX ?? (mode === "transacao" ? 2 : 8)),
      idleTimeoutMillis: mode === "transacao" ? 5_000 : 60_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
    });
    p.on("error", () => undefined);
    globalForPg.__hubPool = p;
    globalForPg.__hubMode = mode;
  }
  return globalForPg.__hubPool;
}

type HubClient = pg.PoolClient & { __hubReady?: boolean };

async function withClient<T>(fn: (c: HubClient) => Promise<T>, timeoutMs = 30_000): Promise<T> {
  const p = pool();
  const client = (await p.connect()) as HubClient;
  const mode = globalForPg.__hubMode;
  try {
    if (mode === "transacao") {
      await client.query(`begin; set local role hub_app; set local statement_timeout = ${Math.floor(timeoutMs)}`);
      try {
        const out = await fn(client);
        await client.query("commit");
        return out;
      } catch (err) {
        await client.query("rollback").catch(() => undefined);
        throw err;
      }
    }
    if (!client.__hubReady) {
      await client.query("set role hub_app; set statement_timeout = 30000");
      client.__hubReady = true;
    }
    if (timeoutMs !== 30_000) await client.query(`set statement_timeout = ${Math.floor(timeoutMs)}`);
    try {
      return await fn(client);
    } finally {
      if (timeoutMs !== 30_000) await client.query("set statement_timeout = 30000").catch(() => undefined);
    }
  } catch (err) {
    client.release(err as Error);
    throw err;
  } finally {
    // release só se ainda não foi liberado com erro
    try {
      client.release();
    } catch {
      /* já liberado */
    }
  }
}

async function queryDirect<T>(sql: string, params: unknown[]): Promise<T[]> {
  return withClient(async (c) => (await c.query(sql, params)).rows as T[]);
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

/** Escritas e operações longas (ex.: executar validações), sem cache. */
export async function execute<T = Record<string, unknown>>(sql: string, params: unknown[] = [], timeout = "120s"): Promise<T[]> {
  const n = Number(timeout.replace(/[^0-9]/g, "")) || 120;
  const ms = /ms$/.test(timeout) ? n : n * 1000;
  return withClient(async (c) => (await c.query(sql, params)).rows as T[], ms);
}
