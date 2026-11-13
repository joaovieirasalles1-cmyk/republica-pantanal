// Arquivos (fotos, faturas, comprovantes): disco local ou Supabase Storage (bucket privado).
// O acesso continua sempre passando pelo servidor, que confere quem pode ver cada arquivo.
import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR } from './db.mjs';

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || 'arquivos';
export const REMOTE = !!(URL_ && KEY);
const auth = { Authorization: `Bearer ${KEY}`, apikey: KEY };

export async function putFile(name, buf, mime) {
  if (!REMOTE) { fs.writeFileSync(path.join(UPLOAD_DIR, name), buf); return; }
  const r = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${name}`, { method: 'POST', headers: { ...auth, 'Content-Type': mime, 'x-upsert': 'true' }, body: buf });
  if (!r.ok) throw new Error(`Falha ao guardar o arquivo (${r.status}): ${await r.text()}`);
}

export async function getFile(name) {
  if (!REMOTE) return fs.readFileSync(path.join(UPLOAD_DIR, name));
  const r = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${name}`, { headers: auth });
  if (!r.ok) throw new Error(`Arquivo indisponível (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

// cria o bucket privado se ainda não existir (usado no deploy)
export async function ensureBucket() {
  if (!REMOTE) return;
  const r = await fetch(`${URL_}/storage/v1/bucket`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: 10 * 1024 * 1024 }) });
  if (!r.ok && r.status !== 409 && !/already exists/i.test(await r.text())) throw new Error('Não foi possível criar o bucket');
}
