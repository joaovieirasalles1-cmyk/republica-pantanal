// Leva os dados do banco local (data/republica.db) e os anexos (data/uploads) para o Supabase.
// Apaga o que houver lá antes. Uso: node deploy/migrate.mjs
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.join(import.meta.dirname, '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env.production.local'), 'utf8').split(/\r?\n/).filter(l => /^\w+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
Object.assign(process.env, env);
const { default: pg } = await import('pg');
const { pgSchema, TABLES } = await import('../lib/db.mjs').catch(async () => {
  // lib/db.mjs com DATABASE_URL já tenta conectar; só precisamos do schema
  return import('../lib/db.mjs');
});
const { ensureBucket, putFile } = await import('../lib/storage.mjs');

const SRC = process.env.SRC_DIR || path.join(ROOT, 'data');
const local = new DatabaseSync(path.join(SRC, 'republica.db'), { readOnly: true });
const client = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log('Conectado ao Supabase.');
await client.query(pgSchema());
await client.query('BEGIN');
await client.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
// ordem que respeita as chaves estrangeiras
const ORDER = ['users', 'houses', 'members', 'sessions', 'environments', 'rules', 'tasks', 'task_overrides', 'task_completions', 'swaps', 'occurrences',
  'occurrence_events', 'notifications', 'push_subs', 'files', 'expenses', 'expense_shares', 'shop_items', 'shop_purchases', 'cash_moves', 'idempotency', 'kv'];
for (const t of ORDER) {
  let rows = [];
  try { rows = local.prepare(`SELECT * FROM ${t}`).all(); } catch { continue; }
  for (const r of rows) {
    const cols = Object.keys(r);
    await client.query(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')})`, cols.map(c => (typeof r[c] === 'bigint' ? Number(r[c]) : r[c])));
  }
  console.log(`  ${t}: ${rows.length}`);
}
// sequências continuam depois do maior id copiado
for (const t of ORDER) {
  const has = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = 'id'`, [t]);
  if (has.rowCount) await client.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${t}), 0), 1), (SELECT COUNT(*) > 0 FROM ${t}))`);
}
await client.query('COMMIT');
await client.end();

await ensureBucket();
const files = local.prepare('SELECT disk_name, mime FROM files').all();
for (const f of files) {
  const p = path.join(SRC, 'uploads', f.disk_name);
  if (fs.existsSync(p)) await putFile(f.disk_name, fs.readFileSync(p), f.mime);
}
console.log(`  anexos enviados: ${files.length}`);
console.log('Migração concluída.');
process.exit(0);
