// Notificações: a central dentro do site é sempre gravada; o push no celular é um extra.
// Push no iPhone exige: site em HTTPS + app adicionado à Tela de Início (iOS 16.4+) + permissão dada de dentro do app.
import fs from 'node:fs';
import path from 'node:path';
import { all, one, run, DATA_DIR, isUniqueError, IS_PG } from './db.mjs';

let webpush = null;
let vapid = null;
try {
  webpush = (await import('web-push')).default;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  else if (!IS_PG) {
    const f = path.join(DATA_DIR, 'vapid.json');
    if (fs.existsSync(f)) vapid = JSON.parse(fs.readFileSync(f, 'utf8'));
    else { vapid = webpush.generateVAPIDKeys(); fs.writeFileSync(f, JSON.stringify(vapid)); }
  }
  if (!vapid) throw new Error('sem chaves VAPID');
  // A Apple recusa o push (BadJwtToken) se o "subject" for mailto:...@localhost. Precisa parecer um contato real.
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:notificacoes@republica-pantanal.app', vapid.publicKey, vapid.privateKey);
} catch { webpush = null; }

export const pushPublicKey = () => (webpush && vapid ? vapid.publicKey : null);
export const pushCount = async userId => (await one('SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?', userId)).n;

// Envios pendentes: na Vercel a função pode congelar logo depois da resposta,
// então o servidor espera estes envios terminarem (waitUntil) antes de encerrar.
export const pending = new Set();
const track = p => { pending.add(p); p.finally(() => pending.delete(p)); return p; };

export async function notify(houseId, memberId, { kind, title, body = '', link = '', dedupe = null }) {
  if (!memberId) return null;
  const m = await one('SELECT user_id, active FROM members WHERE id = ? AND house_id = ?', memberId, houseId);
  if (!m || !m.active) return null;
  try {
    const r = await run('INSERT INTO notifications (house_id, member_id, kind, title, body, link, dedupe_key, created_at) VALUES (?,?,?,?,?,?,?,?)',
      houseId, memberId, kind, title, body, link, dedupe, Date.now());
    const unread = (await one('SELECT COUNT(*) AS n FROM notifications WHERE member_id = ? AND read_at IS NULL', memberId)).n;
    track(sendPush(m.user_id, { title, body, url: `/?h=${houseId}#${link}`, house: houseId, tag: `${kind}-${r.lastInsertRowid}`, badge: unread }));
    return r.lastInsertRowid;
  } catch (e) {
    if (isUniqueError(e)) return null; // já avisado
    throw e;
  }
}

// devolve quantos aparelhos receberam (usado pelo botão "Testar notificação")
export async function sendPush(userId, payload) {
  if (!webpush) return { sent: 0, failed: 0, errors: [] };
  const subs = await all('SELECT * FROM push_subs WHERE user_id = ?', userId);
  const out = { sent: 0, failed: 0, errors: [] };
  await Promise.all(subs.map(s => webpush.sendNotification(JSON.parse(s.data), JSON.stringify(payload), { TTL: 60 * 60 * 24, urgency: 'high' })
    .then(() => { out.sent++; })
    .catch(async err => {
      out.failed++;
      out.errors.push(`${err.statusCode || ''} ${err.body || err.message}`.trim());
      if (err.statusCode === 404 || err.statusCode === 410) await run('DELETE FROM push_subs WHERE endpoint = ?', s.endpoint); // inscrição morta
      else console.error('push falhou:', err.statusCode, err.body || err.message);
    })));
  return out;
}
