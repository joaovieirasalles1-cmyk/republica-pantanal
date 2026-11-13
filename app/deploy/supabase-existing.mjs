// Usa um projeto Supabase que já existe: cria um usuário de banco só para o app (senha própria)
// e grava tudo em .env.production.local. Uso: node deploy/supabase-existing.mjs <project-ref>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.join(import.meta.dirname, '..');
const readEnv = f => Object.fromEntries((fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '').split(/\r?\n/).filter(l => /^\w+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const TOKEN = readEnv(path.join(ROOT, '.env.supabase')).SUPABASE_ACCESS_TOKEN;
const ref = process.argv[2];
const OUT = path.join(ROOT, '.env.production.local');
const prev = readEnv(OUT);
const api = async (p, opts = {}) => {
  const r = await fetch(`https://api.supabase.com${p}`, { ...opts, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } });
  const t = await r.text(); if (!r.ok) throw new Error(`${p} → ${r.status}: ${t.slice(0, 300)}`);
  try { return JSON.parse(t); } catch { return t; }
};
const sql = q => api(`/v1/projects/${ref}/database/query`, { method: 'POST', body: JSON.stringify({ query: q }) });

const ROLE = 'republica_app';
const pass = prev.SUPABASE_DB_PASSWORD || crypto.randomBytes(18).toString('hex');
await sql(`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN CREATE ROLE ${ROLE} LOGIN PASSWORD '${pass}';
  ELSE ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${pass}'; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS republica;
GRANT USAGE, CREATE ON SCHEMA republica TO ${ROLE};
GRANT ALL ON ALL TABLES IN SCHEMA republica TO ${ROLE};
GRANT ALL ON ALL SEQUENCES IN SCHEMA republica TO ${ROLE};
ALTER ROLE ${ROLE} SET search_path = republica;`);
console.log('Usuário do banco pronto (schema "republica").');

const keys = await api(`/v1/projects/${ref}/api-keys?reveal=true`);
const service = keys.find(k => k.name === 'service_role')?.api_key;
const pool = await api(`/v1/projects/${ref}/config/database/pooler`);
const tr = (Array.isArray(pool) ? pool : [pool]).find(c => c.pool_mode === 'transaction');
const host = new URL(tr.connection_string.replace(/^postgres(ql)?:/, 'http:')).hostname;
// opção de search_path na URL: garante que as tabelas fiquem no schema "republica"
const dbUrl = `postgresql://${ROLE}.${ref}:${pass}@${host}:6543/postgres?options=-c%20search_path%3Drepublica`;

let vapid = prev.VAPID_PUBLIC_KEY ? { publicKey: prev.VAPID_PUBLIC_KEY, privateKey: prev.VAPID_PRIVATE_KEY } : null;
const vf = path.join(ROOT, 'data', 'vapid.json');
if (!vapid && fs.existsSync(vf)) vapid = JSON.parse(fs.readFileSync(vf, 'utf8'));
if (!vapid) vapid = (await import('web-push')).default.generateVAPIDKeys();
const env = {
  SUPABASE_PROJECT_REF: ref, SUPABASE_DB_PASSWORD: pass, DATABASE_URL: dbUrl,
  SUPABASE_URL: `https://${ref}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: service, SUPABASE_BUCKET: 'republica-arquivos',
  VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:notificacoes@republica-pantanal.app',
  CRON_SECRET: prev.CRON_SECRET || crypto.randomBytes(24).toString('hex'),
};
fs.writeFileSync(OUT, '# Gerado por deploy/supabase-existing.mjs — NÃO compartilhe nem envie para o GitHub\n' + Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
console.log(`Chaves salvas em .env.production.local (host do banco: ${host}).`);
