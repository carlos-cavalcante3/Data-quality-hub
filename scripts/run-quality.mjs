// Executa as validações de qualidade (quality.run_all) com o papel da aplicação.
// Uso: npm run db:run-quality
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env.local"), quiet: true });
const url = process.env.DATABASE_URL || process.env.DATABASE_URL_READONLY;
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
const t0 = Date.now();
await client.query("begin");
await client.query("set local role hub_app");
const { rows } = await client.query("select hub.fn_run_quality($1, 'admin') as run_id", ["script:run-quality"]);
await client.query("commit");
const run = (await client.query("select * from quality.validation_runs where id = $1", [rows[0].run_id])).rows[0];
console.log(run, `${Date.now() - t0} ms`);
const errs = (await client.query(
  "select r.code, vr.error_message from quality.validation_results vr join quality.validation_rules r on r.id = vr.rule_id where vr.run_id = $1 and vr.status = 'erro'",
  [run.id])).rows;
if (errs.length) console.table(errs);
await client.end();
