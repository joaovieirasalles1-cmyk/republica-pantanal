// Banco de dados com dois motores e a mesma interface assíncrona:
//  - DATABASE_URL definido  → Postgres (Supabase), usado na Vercel
//  - sem DATABASE_URL        → SQLite local (desenvolvimento e testes)
// one/all/run aceitam "?" como parâmetro; para o Postgres viram $1, $2...
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

export const IS_PG = !!process.env.DATABASE_URL;
export const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp/republica' : path.join(import.meta.dirname, '..', 'data'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
if (!IS_PG) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  name TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS houses (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, timezone TEXT NOT NULL,
  photo_file_id INTEGER, accent TEXT DEFAULT '#2f7d5b',
  home_title TEXT, shop_title TEXT,
  invite_code TEXT UNIQUE NOT NULL, invite_active INTEGER NOT NULL DEFAULT 1,
  show_confirmed INTEGER NOT NULL DEFAULT 0,
  notify_defaults TEXT NOT NULL DEFAULT '{"assign":true,"before":true,"after":true}',
  role_names TEXT NOT NULL DEFAULT '{}',
  payment_info TEXT, docs_visible INTEGER NOT NULL DEFAULT 1,
  caixinha_cents INTEGER NOT NULL DEFAULT 0, caixinha_day INTEGER NOT NULL DEFAULT 10,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY, house_id INTEGER NOT NULL REFERENCES houses(id), user_id INTEGER NOT NULL REFERENCES users(id),
  nickname TEXT, photo_file_id INTEGER,
  is_admin INTEGER NOT NULL DEFAULT 0, can_schedule INTEGER NOT NULL DEFAULT 0,
  can_review INTEGER NOT NULL DEFAULT 0, can_finance INTEGER NOT NULL DEFAULT 0,
  role_label TEXT, active INTEGER NOT NULL DEFAULT 1, joined_at INTEGER NOT NULL, left_at INTEGER,
  UNIQUE(house_id, user_id)
);
CREATE TABLE IF NOT EXISTS environments (
  id INTEGER PRIMARY KEY, house_id INTEGER NOT NULL REFERENCES houses(id), name TEXT NOT NULL, icon TEXT DEFAULT 'home'
);
CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY, house_id INTEGER NOT NULL REFERENCES houses(id), title TEXT NOT NULL, description TEXT,
  environment_id INTEGER REFERENCES environments(id), occurrence_label TEXT, subject TEXT,
  deadline_time TEXT, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, house_id INTEGER NOT NULL REFERENCES houses(id), name TEXT NOT NULL,
  environment_id INTEGER REFERENCES environments(id),
  recurrence TEXT NOT NULL, weekdays TEXT NOT NULL DEFAULT '[]', due_time TEXT NOT NULL,
  start_date TEXT NOT NULL, end_date TEXT,
  assign_mode TEXT NOT NULL, fixed_member_id INTEGER, rotation TEXT NOT NULL DEFAULT '[]', rotation_offset INTEGER NOT NULL DEFAULT 0,
  require_photo INTEGER NOT NULL DEFAULT 0, notify TEXT,
  created_by INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS task_overrides (
  task_id INTEGER NOT NULL REFERENCES tasks(id), date TEXT NOT NULL,
  assignee_member_id INTEGER, skipped INTEGER NOT NULL DEFAULT 0, due_time TEXT,
  PRIMARY KEY(task_id, date)
);
CREATE TABLE IF NOT EXISTS task_completions (
  task_id INTEGER NOT NULL REFERENCES tasks(id), date TEXT NOT NULL, member_id INTEGER NOT NULL,
  completed_at INTEGER NOT NULL, photo_file_id INTEGER,
  PRIMARY KEY(task_id, date)
);
CREATE TABLE IF NOT EXISTS swaps (
  id INTEGER PRIMARY KEY, house_id INTEGER NOT NULL, requester_id INTEGER NOT NULL,
  req_task_id INTEGER NOT NULL, req_date TEXT NOT NULL,
  target_id INTEGER NOT NULL, target_task_id INTEGER NOT NULL, target_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente', created_at INTEGER NOT NULL, resolved_at INTEGER
);
CREATE TABLE IF NOT EXISTS occurrences (
  id INTEGER PRIMARY KEY, house_id INTEGER NOT NULL, rule_id INTEGER, environment_id INTEGER,
  type_label TEXT NOT NULL, ref_date TEXT NOT NULL, reported_by INTEGER NOT NULL,
  assigned_member_id INTEGER, note TEXT, photo_file_id INTEGER,
  status TEXT NOT NULL, response TEXT, to_all INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS occurrence_events (
  id INTEGER PRIMARY KEY, occurrence_id INTEGER NOT NULL REFERENCES occurrences(id), actor_id INTEGER NOT NULL,
  action TEXT NOT NULL, from_status TEXT, to_status TEXT, from_member INTEGER, to_member INTEGER,
  note TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, house_id INTEGER NOT NULL, member_id INTEGER NOT NULL,
  kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT,
  dedupe_key TEXT UNIQUE, read_at INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_member ON notifications(member_id, read_at);
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY, user_id INTEGER NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY, house_id INTEGER NOT NULL, uploader_id INTEGER NOT NULL,
  kind TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, disk_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY, house_id INTEGER NOT NULL, title TEXT NOT NULL, total_cents INTEGER NOT NULL,
  due_date TEXT, created_by INTEGER NOT NULL, receiver_member_id INTEGER,
  house_paid INTEGER NOT NULL DEFAULT 0, house_paid_at INTEGER, note TEXT,
  source TEXT, category TEXT NOT NULL DEFAULT 'outro', bill_file_id INTEGER, paid_receipt_file_id INTEGER, paid_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS expense_shares (
  id INTEGER PRIMARY KEY, expense_id INTEGER NOT NULL REFERENCES expenses(id), member_id INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pendente',
  informed_at INTEGER, receipt_file_id INTEGER, confirmed_by INTEGER, confirmed_at INTEGER
);
CREATE TABLE IF NOT EXISTS shop_items (
  id INTEGER PRIMARY KEY, house_id INTEGER NOT NULL, name TEXT NOT NULL, icon TEXT DEFAULT 'cart',
  participants TEXT NOT NULL DEFAULT '[]', next_index INTEGER NOT NULL DEFAULT 0, credits TEXT NOT NULL DEFAULT '{}',
  payment_mode TEXT NOT NULL DEFAULT 'buyer', notify_mode TEXT NOT NULL DEFAULT 'turn',
  status TEXT NOT NULL DEFAULT 'ok', alerted_by INTEGER, alerted_at INTEGER,
  active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shop_purchases (
  id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES shop_items(id), buyer_id INTEGER NOT NULL,
  turn_of INTEGER NOT NULL, counts_as TEXT NOT NULL, amount_cents INTEGER, receipt_file_id INTEGER,
  expense_id INTEGER, created_by INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cash_moves (
  id INTEGER PRIMARY KEY, house_id INTEGER NOT NULL, kind TEXT NOT NULL, amount_cents INTEGER NOT NULL,
  description TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', ref_id INTEGER, file_id INTEGER,
  created_by INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT NOT NULL, user_id INTEGER NOT NULL, status INTEGER, body TEXT, created_at INTEGER NOT NULL,
  PRIMARY KEY(key, user_id)
);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`;
// tabelas com coluna id (para devolver o id criado)
const ID_TABLES = new Set(['users', 'houses', 'members', 'environments', 'rules', 'tasks', 'swaps', 'occurrences', 'occurrence_events',
  'notifications', 'files', 'expenses', 'expense_shares', 'shop_items', 'shop_purchases', 'cash_moves']);
export const TABLES = ['users', 'sessions', 'houses', 'members', 'environments', 'rules', 'tasks', 'task_overrides', 'task_completions', 'swaps',
  'occurrences', 'occurrence_events', 'notifications', 'push_subs', 'files', 'expenses', 'expense_shares', 'shop_items', 'shop_purchases',
  'cash_moves', 'idempotency', 'kv'];
export const pgSchema = () => SCHEMA.replace(/INTEGER PRIMARY KEY/g, 'BIGSERIAL PRIMARY KEY').replace(/\bINTEGER\b/g, 'BIGINT');

const txStore = new AsyncLocalStorage();
let impl;

if (IS_PG) {
  const pg = (await import('pg')).default;
  pg.types.setTypeParser(20, v => (v === null ? null : Number(v)));   // bigint
  pg.types.setTypeParser(1700, v => (v === null ? null : Number(v))); // numeric (SUM)
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3, ssl: { rejectUnauthorized: false }, idleTimeoutMillis: 10000 });
  const conv = sql => { let n = 0; return sql.replace(/'(?:[^']|'')*'|\?/g, m => (m === '?' ? `$${++n}` : m)); };
  const client = () => txStore.getStore() || pool;
  let ready = null;
  // colunas novas em bancos que já existem
  const PG_MIGRATIONS = 'ALTER TABLE occurrences ADD COLUMN IF NOT EXISTS to_all BIGINT NOT NULL DEFAULT 0;';
  const ensure = () => (ready ||= pool.query(pgSchema() + PG_MIGRATIONS).catch(e => { ready = null; throw e; }));
  impl = {
    async one(sql, p) { await ensure(); const r = await client().query(conv(sql), p); return r.rows[0]; },
    async all(sql, p) { await ensure(); const r = await client().query(conv(sql), p); return r.rows; },
    async run(sql, p) {
      await ensure();
      const m = /^\s*INSERT\s+INTO\s+(\w+)/i.exec(sql);
      let q = conv(sql);
      if (m && ID_TABLES.has(m[1]) && !/RETURNING/i.test(q)) q += ' RETURNING id';
      const r = await client().query(q, p);
      return { lastInsertRowid: r.rows?.[0]?.id ?? null, changes: r.rowCount };
    },
    async tx(fn) {
      if (txStore.getStore()) return fn(); // já dentro de uma transação
      await ensure();
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await txStore.run(c, fn);
        await c.query('COMMIT');
        return r;
      } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
      finally { c.release(); }
    },
    pool,
  };
} else {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(DATA_DIR, 'republica.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  // migrações de bancos antigos: colunas novas
  const addColumn = (table, col, def) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  };
  addColumn('expenses', 'category', "TEXT NOT NULL DEFAULT 'outro'");
  addColumn('expenses', 'bill_file_id', 'INTEGER');
  addColumn('expenses', 'paid_receipt_file_id', 'INTEGER');
  addColumn('expenses', 'paid_by', 'INTEGER');
  addColumn('houses', 'payment_info', 'TEXT');
  addColumn('houses', 'docs_visible', 'INTEGER NOT NULL DEFAULT 1');
  addColumn('houses', 'caixinha_cents', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('houses', 'caixinha_day', 'INTEGER NOT NULL DEFAULT 10');
  addColumn('occurrences', 'to_all', 'INTEGER NOT NULL DEFAULT 0');
  const plain = r => (r ? { ...r } : r);
  let depth = 0;
  impl = {
    async one(sql, p) { return plain(db.prepare(sql).get(...p)); },
    async all(sql, p) { return db.prepare(sql).all(...p).map(plain); },
    async run(sql, p) { const r = db.prepare(sql).run(...p); return { lastInsertRowid: Number(r.lastInsertRowid), changes: r.changes }; },
    async tx(fn) {
      if (depth > 0) return fn();
      db.exec('BEGIN'); depth = 1;
      try { const r = await fn(); db.exec('COMMIT'); return r; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
      finally { depth = 0; }
    },
    db,
  };
}

export const one = (sql, ...p) => impl.one(sql, p);
export const all = (sql, ...p) => impl.all(sql, p);
export const run = (sql, ...p) => impl.run(sql, p);
export const tx = fn => impl.tx(fn);
export const isUniqueError = e => e && (e.code === '23505' || /UNIQUE|duplicate key/i.test(String(e.message)));
