// Grava as variáveis de .env.production.local na Vercel (produção) pela API, sem passar pelo terminal.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.join(import.meta.dirname, '..');
const KEYS = ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_BUCKET', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'CRON_SECRET'];
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env.production.local'), 'utf8').split(/\r?\n/).filter(l => /^\w+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const proj = JSON.parse(fs.readFileSync(path.join(ROOT, '.vercel', 'project.json'), 'utf8'));
const authFile = [path.join(process.env.APPDATA || '', 'com.vercel.cli', 'Data', 'auth.json'), path.join(os.homedir(), '.local', 'share', 'com.vercel.cli', 'auth.json')].find(f => fs.existsSync(f));
const token = JSON.parse(fs.readFileSync(authFile, 'utf8')).token;
const q = `teamId=${proj.orgId}`;
const api = async (p, opts = {}) => {
  const r = await fetch(`https://api.vercel.com${p}${p.includes('?') ? '&' : '?'}${q}`, { ...opts, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  const t = await r.text(); if (!r.ok) throw new Error(`${p} → ${r.status}: ${t.slice(0, 200)}`); return t ? JSON.parse(t) : {};
};
// apaga as versões anteriores (com valor corrompido)
const existing = (await api(`/v9/projects/${proj.projectId}/env`)).envs || [];
for (const e of existing) if (KEYS.includes(e.key)) await api(`/v9/projects/${proj.projectId}/env/${e.id}`, { method: 'DELETE' });
for (const k of KEYS) {
  if (!env[k]) throw new Error(`falta ${k}`);
  await api(`/v10/projects/${proj.projectId}/env`, { method: 'POST', body: JSON.stringify({ key: k, value: env[k], type: 'encrypted', target: ['production'] }) });
  console.log(`  ${k}: gravada (${env[k].length} caracteres)`);
}
