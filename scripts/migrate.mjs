// Aplica as migrations de supabase/migrations em ordem, uma transação por arquivo.
// Uso: npm run db:migrate            (usa DATABASE_URL_ADMIN do .env.local)
//      npm run db:migrate -- --dry   (só lista o que seria aplicado)
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env.local"), quiet: true });

const url = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL_READONLY;
// Pooler em modo transação (6543): o modo sessão (5432) aceita poucos clientes e é compartilhado.
const toTransactionPooler = (raw) => { if (!raw) return raw; const u = new URL(raw); if (u.hostname.endsWith('pooler.supabase.com')) u.port = '6543'; return u.toString(); };
if (!url) {
  console.error("Defina DATABASE_URL_ADMIN no .env.local (usuário com permissão de DDL).");
  process.exit(1);
}
const dry = process.argv.includes("--dry");
const dir = path.join(root, "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const client = new pg.Client({ connectionString: toTransactionPooler(url), ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(`
  create schema if not exists control;
  create table if not exists control.schema_migrations (
    filename   text primary key,
    checksum   text not null,
    applied_at timestamptz not null default now()
  );`);

const applied = new Map(
  (await client.query("select filename, checksum from control.schema_migrations")).rows.map((r) => [r.filename, r.checksum]),
);

for (const file of files) {
  const sql = readFileSync(path.join(dir, file), "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  const prev = applied.get(file);
  if (prev === checksum) {
    console.log(`= ${file} (já aplicada)`);
    continue;
  }
  console.log(`${prev ? "~" : "+"} ${file}${prev ? " (alterada, reaplicando)" : ""}`);
  if (dry) continue;
  try {
    await client.query("begin");
    await client.query("set local statement_timeout = '300s'");
    await client.query(sql);
    await client.query(
      `insert into control.schema_migrations (filename, checksum) values ($1, $2)
       on conflict (filename) do update set checksum = excluded.checksum, applied_at = now()`,
      [file, checksum],
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    console.error(`ERRO em ${file}: ${err.message}`);
    if (err.position) console.error(`  posição ${err.position}: ...${sql.slice(Math.max(0, err.position - 120), Number(err.position) + 80)}...`);
    await client.end();
    process.exit(1);
  }
}
await client.end();
console.log(dry ? "Dry-run concluído." : "Migrations aplicadas.");
