// Cria (ou reaproveita) o projeto "republica-pantanal" no Supabase, em São Paulo, e grava as chaves
// em .env.production.local (nunca vai para o GitHub). Uso: node deploy/supabase-setup.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.join(import.meta.dirname, '..');
const readEnv = f => Object.fromEntries((fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '').split(/\r?\n/).filter(l => /^\w+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const TOKEN = readEnv(path.join(ROOT, '.env.supabase')).SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('Cole o token em .env.supabase (SUPABASE_ACCESS_TOKEN=...)'); process.exit(1); }
const OUT = path.join(ROOT, '.env.production.local');
const prev = readEnv(OUT);
const NAME = 'republica-pantanal';

const api = async (p, opts = {}) => {
  const r = await fetch(`https://api.supabase.com${p}`, { ...opts, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) throw new Error(`${opts.method || 'GET'} ${p} → ${r.status}: ${text.slice(0, 300)}`);
  return data;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const orgs = await api('/v1/organizations');
if (!orgs.length) throw new Error('Nenhuma organização no Supabase. Entre no painel uma vez para criar a sua.');
let project = (await api('/v1/projects')).find(p => p.name === NAME);
let dbPass = prev.SUPABASE_DB_PASSWORD;
if (!project) {
  dbPass = crypto.randomBytes(18).toString('base64url');
  console.log(`Criando o projeto ${NAME} em São Paulo (organização: ${orgs[0].name})…`);
  project = await api('/v1/projects', { method: 'POST', body: JSON.stringify({ name: NAME, organization_id: orgs[0].id, db_pass: dbPass, region: 'sa-east-1' }) });
} else console.log(`Projeto ${NAME} já existe (${project.id}).`);
if (!dbPass) throw new Error('O projeto já existia mas a senha do banco não está salva em .env.production.local.');
const ref = project.id || project.ref;

process.stdout.write('Aguardando o banco ficar pronto');
for (let i = 0; i < 90; i++) {
  const p = await api(`/v1/projects/${ref}`);
  if (p.status === 'ACTIVE_HEALTHY') break;
  process.stdout.write('.'); await sleep(5000);
}
console.log(' pronto.');

const keys = await api(`/v1/projects/${ref}/api-keys?reveal=true`);
const service = keys.find(k => k.name === 'service_role')?.api_key || keys.find(k => /secret/i.test(k.type || ''))?.api_key;
if (!service) throw new Error('Chave service_role não encontrada.');

let dbUrl = null;
try {
  const pool = await api(`/v1/projects/${ref}/config/database/pooler`);
  const tr = (Array.isArray(pool) ? pool : [pool]).find(c => c.pool_mode === 'transaction') || (Array.isArray(pool) ? pool[0] : pool);
  if (tr?.connection_string) dbUrl = tr.connection_string.replace('[YOUR-PASSWORD]', encodeURIComponent(dbPass));
  if (dbUrl && tr.db_port && !/:6543\//.test(dbUrl) && tr.pool_mode === 'transaction') dbUrl = dbUrl.replace(/:(\d+)\//, ':6543/');
} catch (e) { console.log('Aviso:', e.message); }
if (!dbUrl) dbUrl = `postgresql://postgres.${ref}:${encodeURIComponent(dbPass)}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`;

// chaves de notificação: reaproveita as atuais (mesma chave = celulares já inscritos continuam valendo)
let vapid = prev.VAPID_PUBLIC_KEY ? { publicKey: prev.VAPID_PUBLIC_KEY, privateKey: prev.VAPID_PRIVATE_KEY } : null;
const vf = path.join(ROOT, 'data', 'vapid.json');
if (!vapid && fs.existsSync(vf)) vapid = JSON.parse(fs.readFileSync(vf, 'utf8'));
if (!vapid) vapid = (await import('web-push')).default.generateVAPIDKeys();

const env = {
  SUPABASE_PROJECT_REF: ref,
  SUPABASE_DB_PASSWORD: dbPass,
  DATABASE_URL: dbUrl,
  SUPABASE_URL: `https://${ref}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: service,
  SUPABASE_BUCKET: 'arquivos',
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: 'mailto:notificacoes@republica-pantanal.app',
  CRON_SECRET: prev.CRON_SECRET || crypto.randomBytes(24).toString('hex'),
};
fs.writeFileSync(OUT, '# Gerado por deploy/supabase-setup.mjs — NÃO compartilhe nem envie para o GitHub\n' + Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
console.log(`Chaves salvas em .env.production.local (projeto ${ref}).`);
