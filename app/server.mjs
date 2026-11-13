// Servidor da República: API JSON + arquivos estáticos do app. Sem framework.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { AsyncLocalStorage } from 'node:async_hooks';
import { one, all, run as dbRun, tx, DATA_DIR, isUniqueError } from './lib/db.mjs';
import { localNow, zonedToUtc, addDays, weekday, isDate, isTime, isValidTz, WEEKDAYS_SHORT, deadlineLabel } from './lib/time.mjs';
import { instancesInRange, getInstance, occurrenceIndex, occursOn } from './lib/schedule.mjs';
import { notify, pushPublicKey, sendPush, pushCount, pending } from './lib/notify.mjs';
import { putFile, getFile } from './lib/storage.mjs';

const reqStore = new AsyncLocalStorage();
// filter/every que esperam uma condição assíncrona
const filterAsync = async (arr, fn) => { const ok = await Promise.all(arr.map(fn)); return arr.filter((_, i) => ok[i]); };
const everyAsync = async (arr, fn) => (await Promise.all(arr.map(fn))).every(Boolean);
// toda escrita em moradores limpa o cache da requisição
const run = async (sql, ...p) => {
  const st = reqStore.getStore();
  if (/\bmembers\b/i.test(sql)) st?.members?.clear();
  if (/\b(environments|rules)\b/i.test(sql)) st?.memo?.clear();
  return await dbRun(sql, ...p);
};
// guarda o resultado durante a requisição (ambientes e regras se repetem em cada cartão)
const memo = async (key, fn) => {
  const st = reqStore.getStore();
  if (!st) return fn();
  const m = (st.memo ||= new Map());
  if (!m.has(key)) m.set(key, fn().catch(e => { m.delete(key); throw e; }));
  return m.get(key);
};
const ON_VERCEL = !!process.env.VERCEL;

const PORT = +process.env.PORT || 3000;
let QR = null;
try { QR = (await import('qrcode')).default; } catch { QR = null; }
// endereços desta máquina na rede local (para abrir no celular no mesmo Wi-Fi)
function lanUrls() {
  const ips = Object.entries(os.networkInterfaces())
    .filter(([name]) => !/vethernet|virtualbox|vmware|wsl|docker|loopback/i.test(name))
    .flatMap(([, list]) => list || []).filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);
  ips.sort((a, b) => (/^192\.168\./.test(b) - /^192\.168\./.test(a)));
  return [...new Set(ips)].map(ip => `http://${ip}:${PORT}`);
}
// endereço HTTPS do túnel (npm run https), se estiver aberto
function publicUrl() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  try { const u = fs.readFileSync(path.join(DATA_DIR, 'public-url.txt'), 'utf8').trim(); return /^https:\/\//.test(u) ? u : null; } catch { return null; }
}
const shareUrls = () => [publicUrl(), ...(ON_VERCEL ? [] : lanUrls())].filter(Boolean);
const PUBLIC_DIR = path.join(import.meta.dirname, 'public');

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };
const need = (cond, msg = 'Você não tem permissão para isso.', status = 403) => { if (!cond) fail(status, msg); };
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const now = () => Date.now();
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = v => (Number.isInteger(+v) && v !== '' && v !== null && v !== undefined ? +v : null);

// ---------- auth ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex'), b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function newSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await run('INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)', token, userId, now());
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 180}${ON_VERCEL ? '; Secure' : ''}`);
}
function cookies(req) {
  const out = {};
  for (const p of (req.headers.cookie || '').split(';')) { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }
  return out;
}

// ---------- visão de morador / casa ----------
// Cargos: Veterano Master (admin geral, tem tudo, único que mexe em cargos) · Financeiro (contas, anexos, confirma
// pagamentos e caixinha) · Morador. "Organização" (escala + revisar ocorrências) é um extra que o Master pode dar.
const DEFAULT_ROLES = { admin: 'Veterano Master', schedule: 'Organização', finance: 'Financeiro', member: 'Morador' };
function roleNames(house) { return { ...DEFAULT_ROLES, ...parse(house.role_names, {}) }; }
const cargoOf = m => (m.is_admin ? 'master' : m.can_finance ? 'financeiro' : 'morador');
// o Veterano Master tem todos os acessos, inclusive o financeiro
const effective = m => (m && m.is_admin ? { ...m, can_schedule: 1, can_review: 1, can_finance: 1 } : m);
function memberView(m, house) {
  const rn = roleNames(house);
  const e = effective(m);
  const roles = [];
  if (m.is_admin) roles.push(rn.admin);
  else {
    if (m.can_finance) roles.push(rn.finance);
    if (m.can_schedule || m.can_review) roles.push(rn.schedule);
    if (!roles.length) roles.push(rn.member);
  }
  return {
    id: m.id, user_id: m.user_id, name: m.nickname || m.user_name, full_name: m.user_name, nickname: m.nickname,
    photo_file_id: m.photo_file_id, is_admin: !!m.is_admin, can_schedule: !!e.can_schedule,
    can_review: !!e.can_review, can_finance: !!e.can_finance, cargo: cargoOf(m), organiza: !!(m.can_schedule || m.can_review),
    role_label: m.role_label || roles.join(' · '),
    active: !!m.active, joined_at: m.joined_at, left_at: m.left_at,
  };
}
const MEMBER_SQL = 'SELECT m.*, u.name AS user_name FROM members m JOIN users u ON u.id = m.user_id';
async function membersOf(houseId) { return await all(`${MEMBER_SQL} WHERE m.house_id = ? ORDER BY m.active DESC, u.name`, houseId); }
// cache dos moradores durante uma requisição (evita dezenas de consultas pela rede)
async function houseMembers(houseId) {
  const st = reqStore.getStore();
  if (st?.members?.has(houseId)) return st.members.get(houseId);
  const rows = await all(`${MEMBER_SQL} WHERE m.house_id = ?`, houseId);
  if (st) (st.members ||= new Map()).set(houseId, rows);
  return rows;
}
async function memberName(houseId, mid) {
  const id = int(mid);
  const m = (await houseMembers(houseId)).find(x => x.id === id);
  return m ? (m.nickname || m.user_name) : 'Alguém';
}
async function activeMember(houseId, mid) {
  const id = int(mid);
  return (await houseMembers(houseId)).find(x => x.id === id && x.active) || null;
}
const canSchedule = me => me.is_admin || me.can_schedule;
const reviewers = async houseId => (await all('SELECT id FROM members WHERE house_id = ? AND active = 1 AND (can_review = 1 OR is_admin = 1)', houseId)).map(r => r.id);
// quem recebe avisos de pagamento: o Financeiro (se não houver, o Master)
const financers = async houseId => {
  const f = (await all('SELECT id FROM members WHERE house_id = ? AND active = 1 AND can_finance = 1 AND is_admin = 0', houseId)).map(r => r.id);
  return f.length ? f : (await all('SELECT id FROM members WHERE house_id = ? AND active = 1 AND is_admin = 1', houseId)).map(r => r.id);
};
const schedulers = async houseId => (await all('SELECT id FROM members WHERE house_id = ? AND active = 1 AND (can_schedule = 1 OR is_admin = 1)', houseId)).map(r => r.id);

function houseView(h, me) {
  return {
    id: h.id, name: h.name, timezone: h.timezone, photo_file_id: h.photo_file_id, accent: h.accent,
    home_title: h.home_title || `Painel ${h.name}`, shop_title: h.shop_title || `Compras da ${h.name}`,
    invite_code: h.invite_code, invite_active: !!h.invite_active, show_confirmed: !!h.show_confirmed,
    notify_defaults: parse(h.notify_defaults, {}), role_names: roleNames(h), custom_role_names: parse(h.role_names, {}),
  };
}

// arquivo enviado por mim, desta casa, do tipo certo, ainda livre pra anexar
async function ownFile(ctx, fid, kinds) {
  if (fid === null || fid === undefined || fid === '') return null;
  const f = await one('SELECT * FROM files WHERE id = ? AND house_id = ?', int(fid), ctx.house.id);
  need(f && f.uploader_id === ctx.me.id && kinds.includes(f.kind), 'Anexo inválido.', 400);
  return f.id;
}

// ---------- ocorrências: visibilidade ----------
async function occParties(occId) {
  return new Set((await all('SELECT actor_id, from_member, to_member FROM occurrence_events WHERE occurrence_id = ?', occId))
    .flatMap(e => [e.actor_id, e.from_member, e.to_member]).filter(Boolean));
}
async function canSeeOcc(occ, me, house) {
  if (me.can_review) return true;
  if (occ.reported_by === me.id || occ.assigned_member_id === me.id) return true;
  if (!occ.assigned_member_id) return true; // no quadro do ambiente, sem acusar ninguém
  if ((await occParties(occ.id)).has(me.id)) return true; // ex.: indicado por engano e depois corrigido
  return !!house.show_confirmed && occ.status === 'resolvida';
}
async function canSeeOccPhoto(occ, me) {
  return me.can_review || occ.reported_by === me.id || occ.assigned_member_id === me.id || !occ.assigned_member_id || (await occParties(occ.id)).has(me.id);
}
async function occView(occ, ctx) {
  const env = occ.environment_id ? (await envMap(ctx.house.id)).get(occ.environment_id) || null : null;
  const rule = occ.rule_id ? await ruleById(occ.rule_id) : null;
  const v = {
    ...occ, environment: env, rule,
    deadline: rule?.deadline_time ? deadlineLabel(occ.ref_date, rule.deadline_time) : null,
    ref_label: WEEKDAYS_SHORT[weekday(occ.ref_date)],
    reporter_name: await memberName(ctx.house.id, occ.reported_by),
    assigned_name: occ.assigned_member_id ? await memberName(ctx.house.id, occ.assigned_member_id) : null,
  };
  if (!await canSeeOccPhoto(occ, ctx.me)) v.photo_file_id = null;
  return v;
}
async function occEvent(occId, actor, action, fromS, toS, extra = {}) {
  await run('INSERT INTO occurrence_events (occurrence_id, actor_id, action, from_status, to_status, from_member, to_member, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    occId, actor, action, fromS, toS, extra.from_member ?? null, extra.to_member ?? null, extra.note ?? null, now());
}
const ruleById = id => memo(`rule:${id}`, () => one('SELECT id, title, deadline_time, subject FROM rules WHERE id = ?', id));
const occSubject = async occ => {
  const rule = occ.rule_id ? await ruleById(occ.rule_id) : null;
  return `${rule?.subject || occ.type_label.toLowerCase()} de ${WEEKDAYS_SHORT[weekday(occ.ref_date)]}`;
};

// ---------- compras: fila ----------
const activeIds = async houseId => new Set((await houseMembers(houseId)).filter(m => m.active).map(m => m.id));
async function shopNext(item, houseId) {
  const parts = parse(item.participants, []);
  if (!parts.length) return null;
  const active = await activeIds(houseId);
  for (let i = 0; i < parts.length; i++) {
    const mid = parts[(item.next_index + i) % parts.length];
    if (active.has(mid)) return mid;
  }
  return null;
}
async function shopAdvance(item, houseId) {
  const parts = parse(item.participants, []);
  const credits = parse(item.credits, {});
  const active = await activeIds(houseId);
  let idx = item.next_index;
  // pula quem está inativo e quem adiantou a própria vez (consome o crédito)
  for (let guard = 0; guard < parts.length * 3; guard++) {
    idx = (idx + 1) % parts.length;
    const mid = parts[idx];
    if (!active.has(mid)) continue;
    if (credits[mid] > 0) { credits[mid]--; if (!credits[mid]) delete credits[mid]; continue; }
    break;
  }
  return { next_index: idx, credits };
}
async function shopView(item, ctx) {
  const last = await one('SELECT * FROM shop_purchases WHERE item_id = ? ORDER BY id DESC LIMIT 1', item.id);
  const next = await shopNext(item, ctx.house.id);
  const today = localNow(ctx.house.timezone).date;
  const parts = parse(item.participants, []);
  return {
    id: item.id, name: item.name, icon: item.icon, participants: parts, credits: parse(item.credits, {}),
    payment_mode: item.payment_mode, notify_mode: item.notify_mode, status: item.status,
    next_member: next, next_name: next ? await memberName(ctx.house.id, next) : null,
    alerted_by: item.alerted_by, alerted_by_name: item.alerted_by ? await memberName(ctx.house.id, item.alerted_by) : null, alerted_at: item.alerted_at,
    last: last ? { ...last, buyer_name: await memberName(ctx.house.id, last.buyer_id), turn_name: await memberName(ctx.house.id, last.turn_of), today: localNow(ctx.house.timezone, last.created_at).date === today } : null,
    i_participate: parts.includes(ctx.me.id),
  };
}

// ---------- tarefas: helpers ----------
async function instView(inst, ctx, envs) {
  const env = envs.get(inst.environment_id);
  return {
    ...inst, task: undefined, environment: env || null,
    assignee_name: inst.assignee ? await memberName(ctx.house.id, inst.assignee) : null,
    assignee_active: inst.assignee ? !!await activeMember(ctx.house.id, inst.assignee) : false,
    deadline: deadlineLabel(inst.date, inst.due_time),
    weekday: WEEKDAYS_SHORT[weekday(inst.date)],
  };
}
const envMap = houseId => memo(`env:${houseId}`, async () => new Map((await all('SELECT id, name, icon FROM environments WHERE house_id = ?', houseId)).map(e => [e.id, e])));

async function validateTask(b, ctx) {
  const t = {
    name: str(b.name, 80), environment_id: int(b.environment_id), recurrence: b.recurrence,
    weekdays: JSON.stringify((Array.isArray(b.weekdays) ? b.weekdays : []).map(Number).filter(n => n >= 0 && n <= 6)),
    due_time: b.due_time, start_date: b.start_date, assign_mode: b.assign_mode,
    fixed_member_id: int(b.fixed_member_id), rotation: JSON.stringify((Array.isArray(b.rotation) ? b.rotation : []).map(Number)),
    require_photo: b.require_photo ? 1 : 0,
    notify: b.notify && typeof b.notify === 'object' ? JSON.stringify({ assign: !!b.notify.assign, before: !!b.notify.before, after: !!b.notify.after }) : null,
  };
  need(t.name, 'Dê um nome para a tarefa.', 400);
  need(['once', 'daily', 'weekdays', 'weekly'].includes(t.recurrence), 'Escolha quando a tarefa acontece.', 400);
  need(t.recurrence !== 'weekdays' || JSON.parse(t.weekdays).length, 'Escolha pelo menos um dia da semana.', 400);
  need(isTime(t.due_time), 'Horário limite inválido.', 400);
  need(isDate(t.start_date), 'Data de início inválida.', 400);
  if (t.environment_id) need(await one('SELECT 1 FROM environments WHERE id = ? AND house_id = ?', t.environment_id, ctx.house.id), 'Ambiente inválido.', 400);
  else t.environment_id = null;
  need(['fixed', 'rotation'].includes(t.assign_mode), 'Escolha quem faz.', 400);
  if (t.assign_mode === 'fixed') { need(await activeMember(ctx.house.id, t.fixed_member_id), 'Escolha o responsável.', 400); t.rotation = '[]'; }
  else {
    const rot = JSON.parse(t.rotation);
    need(rot.length && new Set(rot).size === rot.length && (await everyAsync(rot, async id => await activeMember(ctx.house.id, id))), 'Escolha os participantes do rodízio.', 400);
    t.fixed_member_id = null;
  }
  return t;
}
async function insertTask(t, ctx, extra = {}) {
  const r = await run(`INSERT INTO tasks (house_id, name, environment_id, recurrence, weekdays, due_time, start_date, end_date, assign_mode, fixed_member_id, rotation, rotation_offset, require_photo, notify, created_by, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ctx.house.id, t.name, t.environment_id, t.recurrence, t.weekdays, t.due_time, t.start_date,
    extra.end_date ?? null, t.assign_mode, t.fixed_member_id, t.rotation, extra.rotation_offset ?? 0, t.require_photo, t.notify, ctx.me.id, now());
  return Number(r.lastInsertRowid);
}
async function notifyNewTask(taskId, ctx) {
  const t = await one('SELECT * FROM tasks WHERE id = ?', taskId);
  const who = t.assign_mode === 'fixed' ? [t.fixed_member_id] : parse(t.rotation, []);
  const notif = { ...parse(ctx.house.notify_defaults, {}), ...parse(t.notify, {}) };
  if (!notif.assign) return;
  for (const mid of who) {
    if (mid === ctx.me.id) continue;
    await notify(ctx.house.id, mid, {
      kind: 'task', title: t.assign_mode === 'fixed' ? `Nova tarefa: ${t.name}` : `Você entrou no rodízio: ${t.name}`,
      body: `${await memberName(ctx.house.id, ctx.me.id)} colocou você na escala.`, link: `/quadro`,
    });
  }
}

// ---------- rotas ----------
const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, opts });
};

// Auth
// Login por nome de usuário (sem e-mail). A coluna "email" do banco guarda o usuário.
const toUsername = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, '.');
const validUsername = u => /^[a-z0-9._-]{3,30}$/.test(u);
route('POST', '/api/auth/register', async ctx => {
  const b = ctx.body;
  const name = str(b.name, 60), username = toUsername(b.username || b.name), pw = typeof b.password === 'string' ? b.password : '';
  need(name, 'Informe seu nome.', 400);
  need(validUsername(username), 'Usuário inválido: use de 3 a 30 letras, números, ponto ou traço.', 400);
  need(pw.length >= 6, 'A senha precisa ter pelo menos 6 caracteres.', 400);
  need(!await one('SELECT 1 FROM users WHERE email = ?', username), 'Esse usuário já existe. Escolha outro ou entre com a sua senha.', 409);
  const r = await run('INSERT INTO users (email, password_hash, name, created_at) VALUES (?,?,?,?)', username, hashPassword(pw), name, now());
  await newSession(ctx.res, Number(r.lastInsertRowid));
  return { ok: true, username };
}, { public: true });

route('POST', '/api/auth/login', async ctx => {
  const username = toUsername(ctx.body.username ?? ctx.body.email);
  const u = await one('SELECT * FROM users WHERE email = ?', username);
  need(u && checkPassword(String(ctx.body.password || ''), u.password_hash), 'Usuário ou senha incorretos.', 401);
  await newSession(ctx.res, u.id);
  return { ok: true };
}, { public: true });

route('POST', '/api/auth/password', async ctx => {
  const u = await one('SELECT * FROM users WHERE id = ?', ctx.user.id);
  need(checkPassword(String(ctx.body.current || ''), u.password_hash), 'Senha atual incorreta.', 400);
  const pw = String(ctx.body.password || '');
  need(pw.length >= 6, 'A nova senha precisa ter pelo menos 6 caracteres.', 400);
  await run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(pw), u.id);
  // derruba as outras sessões (ex.: celular de outra pessoa que sabia a senha antiga)
  await run('DELETE FROM sessions WHERE user_id = ? AND token != ?', u.id, cookies(ctx.req).sid || '');
  return { ok: true };
});

route('POST', '/api/auth/logout', async ctx => {
  await run('DELETE FROM sessions WHERE token = ?', cookies(ctx.req).sid || '');
  ctx.res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  return { ok: true };
});

route('GET', '/api/me', async ctx => {
  const houses = await all('SELECT h.id, h.name, h.accent, h.photo_file_id FROM members m JOIN houses h ON h.id = m.house_id WHERE m.user_id = ? AND m.active = 1 ORDER BY m.joined_at', ctx.user.id);
  return { user: { id: ctx.user.id, name: ctx.user.name, username: ctx.user.email }, houses, push_key: pushPublicKey() };
});

// Link para o celular (rede local)
route('GET', '/api/local-links', () => ({ urls: shareUrls(), https: publicUrl(), qr: !!QR }), { public: true });

// Criar casa e convites
route('POST', '/api/houses', async ctx => {
  const name = str(ctx.body.name, 60);
  const tz = ctx.body.timezone || 'America/Sao_Paulo';
  need(name, 'Dê um nome para a república.', 400);
  need(isValidTz(tz), 'Fuso horário inválido.', 400);
  return await tx(async () => {
    const h = await run('INSERT INTO houses (name, timezone, invite_code, created_at) VALUES (?,?,?,?)', name, tz, crypto.randomBytes(9).toString('base64url'), now());
    const hid = Number(h.lastInsertRowid);
    await run('INSERT INTO members (house_id, user_id, is_admin, can_schedule, can_review, can_finance, joined_at) VALUES (?,?,1,1,1,1,?)', hid, ctx.user.id, now());
    for (const [n, i] of [['Cozinha', 'kitchen'], ['Banheiro', 'bath'], ['Sala', 'sofa'], ['Área de serviço', 'laundry'], ['Quintal', 'leaf']])
      await run('INSERT INTO environments (house_id, name, icon) VALUES (?,?,?)', hid, n, i);
    return { id: hid };
  });
});

route('GET', '/api/invite/:code', async ctx => {
  const h = await one('SELECT id, name, photo_file_id, invite_active FROM houses WHERE invite_code = ?', ctx.params.code);
  need(h, 'Convite não encontrado.', 404);
  need(h.invite_active, 'Este convite foi desativado. Peça um link novo para a casa.', 410);
  return { name: h.name, members: (await one('SELECT COUNT(*) AS n FROM members WHERE house_id = ? AND active = 1', h.id)).n };
}, { public: true });

route('POST', '/api/invite/:code/join', async ctx => {
  const h = await one('SELECT * FROM houses WHERE invite_code = ?', ctx.params.code);
  need(h, 'Convite não encontrado.', 404);
  need(h.invite_active, 'Este convite foi desativado. Peça um link novo para a casa.', 410);
  const m = await one('SELECT * FROM members WHERE house_id = ? AND user_id = ?', h.id, ctx.user.id);
  if (m && m.active) return { id: h.id };
  if (m) await run('UPDATE members SET active = 1, left_at = NULL, joined_at = ? WHERE id = ?', now(), m.id);
  else await run('INSERT INTO members (house_id, user_id, joined_at) VALUES (?,?,?)', h.id, ctx.user.id, now());
  const mine = (await one('SELECT id FROM members WHERE house_id = ? AND user_id = ?', h.id, ctx.user.id)).id;
  for (const a of await all('SELECT id FROM members WHERE house_id = ? AND is_admin = 1 AND active = 1', h.id))
    await notify(h.id, a.id, { kind: 'house', title: 'Morador novo', body: `${ctx.user.name} entrou na ${h.name}.`, link: `/morador/${mine}` });
  return { id: h.id };
});

// ---------- rotas da casa (/api/h/:hid/...) — exigem ser morador ativo ----------
route('GET', '/api/h/:hid/house', async ctx => {
  const { house, me } = ctx;
  const tz = house.timezone, n = localNow(tz);
  const rules = (await all('SELECT * FROM rules WHERE house_id = ? AND active = 1 ORDER BY title', house.id)).map(r => {
    // referência sugerida: o dia mais recente cujo prazo já passou (às 00h01 de terça, a louça de segunda)
    let suggested = n.date;
    if (r.deadline_time && now() < zonedToUtc(n.date, r.deadline_time, tz)) suggested = addDays(n.date, -1);
    return { ...r, suggested_ref: suggested, deadline_example: r.deadline_time ? deadlineLabel(suggested, r.deadline_time) : null };
  });
  return {
    house: houseView(house, me), me: memberView(await one(`${MEMBER_SQL} WHERE m.id = ?`, me.id), house),
    members: (await membersOf(house.id)).map(m => memberView(m, house)),
    environments: await all('SELECT * FROM environments WHERE house_id = ? ORDER BY id', house.id),
    rules, now: n,
  };
});

route('PATCH', '/api/h/:hid/house', async ctx => {
  need(ctx.me.is_admin);
  const b = ctx.body, h = ctx.house;
  const name = b.name !== undefined ? str(b.name, 60) : h.name;
  need(name, 'O nome da casa não pode ficar vazio.', 400);
  const tz = b.timezone ?? h.timezone;
  need(isValidTz(tz), 'Fuso horário inválido.', 400);
  const accent = b.accent !== undefined ? (/^#[0-9a-f]{6}$/i.test(b.accent) ? b.accent : h.accent) : h.accent;
  const photo = b.photo_file_id !== undefined ? (b.photo_file_id ? await ownFile(ctx, b.photo_file_id, ['house']) : null) : h.photo_file_id;
  const nd = b.notify_defaults ? JSON.stringify({ assign: !!b.notify_defaults.assign, before: !!b.notify_defaults.before, after: !!b.notify_defaults.after }) : h.notify_defaults;
  const rn = b.role_names ? JSON.stringify(Object.fromEntries(Object.entries(b.role_names).filter(([k, v]) => k in DEFAULT_ROLES && str(v, 40)).map(([k, v]) => [k, str(v, 40)]))) : h.role_names;
  await run('UPDATE houses SET name=?, timezone=?, accent=?, photo_file_id=?, home_title=?, shop_title=?, show_confirmed=?, notify_defaults=?, role_names=? WHERE id=?',
    name, tz, accent, photo,
    b.home_title !== undefined ? (str(b.home_title, 60) || null) : h.home_title,
    b.shop_title !== undefined ? (str(b.shop_title, 60) || null) : h.shop_title,
    b.show_confirmed !== undefined ? (b.show_confirmed ? 1 : 0) : h.show_confirmed, nd, rn, h.id);
  return { ok: true };
});

route('POST', '/api/h/:hid/invite/regenerate', async ctx => {
  need(ctx.me.is_admin);
  const code = crypto.randomBytes(9).toString('base64url');
  await run('UPDATE houses SET invite_code = ?, invite_active = 1 WHERE id = ?', code, ctx.house.id);
  return { invite_code: code };
});
route('POST', '/api/h/:hid/invite/toggle', async ctx => {
  need(ctx.me.is_admin);
  await run('UPDATE houses SET invite_active = ? WHERE id = ?', ctx.body.active ? 1 : 0, ctx.house.id);
  return { ok: true };
});

route('PATCH', '/api/h/:hid/members/:mid', async ctx => {
  const target = await one('SELECT * FROM members WHERE id = ? AND house_id = ?', int(ctx.params.mid), ctx.house.id);
  need(target, 'Morador não encontrado.', 404);
  const b = ctx.body, self = target.id === ctx.me.id;
  need(self || ctx.me.is_admin);
  const touchesRole = ['cargo', 'organiza', 'can_schedule', 'can_review', 'can_finance', 'is_admin', 'role_label'].some(k => b[k] !== undefined);
  need(!touchesRole || ctx.me.is_admin, 'Só o Veterano Master altera cargos.');
  const sets = {};
  if (b.nickname !== undefined) sets.nickname = str(b.nickname, 40) || null;
  if (b.photo_file_id !== undefined) { need(self, 'Só o próprio morador troca a foto.'); sets.photo_file_id = b.photo_file_id ? await ownFile(ctx, b.photo_file_id, ['avatar']) : null; }
  if (ctx.me.is_admin) {
    if (b.cargo !== undefined) {
      need(['master', 'financeiro', 'morador'].includes(b.cargo), 'Cargo inválido.', 400);
      sets.is_admin = b.cargo === 'master' ? 1 : 0;
      sets.can_finance = b.cargo === 'master' || b.cargo === 'financeiro' ? 1 : 0;
    }
    if (b.organiza !== undefined) sets.can_schedule = sets.can_review = b.organiza ? 1 : 0;
    for (const k of ['can_schedule', 'can_review', 'can_finance', 'is_admin']) if (b[k] !== undefined) sets[k] = b[k] ? 1 : 0;
    if (b.role_label !== undefined) sets.role_label = str(b.role_label, 60) || null;
    if (sets.is_admin === 0 && target.is_admin) {
      const admins = (await one('SELECT COUNT(*) AS n FROM members WHERE house_id = ? AND is_admin = 1 AND active = 1', ctx.house.id)).n;
      need(admins > 1, 'A casa precisa de pelo menos um Veterano Master. Passe o cargo para outra pessoa antes.', 400);
    }
  }
  const keys = Object.keys(sets);
  if (keys.length) await run(`UPDATE members SET ${keys.map(k => k + ' = ?').join(', ')} WHERE id = ?`, ...keys.map(k => sets[k]), target.id);
  return { ok: true };
});

route('POST', '/api/h/:hid/transfer-admin', async ctx => {
  need(ctx.me.is_admin);
  const t = await activeMember(ctx.house.id, ctx.body.member_id);
  need(t && t.id !== ctx.me.id, 'Escolha outro morador.', 400);
  await tx(async () => {
    await run('UPDATE members SET is_admin = 1 WHERE id = ?', t.id);
    await run('UPDATE members SET is_admin = 0 WHERE id = ?', ctx.me.id);
  });
  await notify(ctx.house.id, t.id, { kind: 'house', title: 'Você agora administra a casa', body: `${await memberName(ctx.house.id, ctx.me.id)} transferiu a administração para você.`, link: '/casa' });
  return { ok: true };
});

route('POST', '/api/h/:hid/members/:mid/leave', async ctx => {
  const t = await activeMember(ctx.house.id, ctx.params.mid);
  need(t, 'Morador não encontrado.', 404);
  need(t.id === ctx.me.id || ctx.me.is_admin);
  if (t.is_admin) {
    const admins = (await one('SELECT COUNT(*) AS n FROM members WHERE house_id = ? AND is_admin = 1 AND active = 1', ctx.house.id)).n;
    need(admins > 1, 'Transfira a administração para outro morador antes de sair.', 400);
  }
  await run('UPDATE members SET active = 0, left_at = ? WHERE id = ?', now(), t.id);
  // histórico fica; tarefas futuras ficam marcadas como "sem responsável" até alguém redistribuir
  const today = localNow(ctx.house.timezone).date;
  const future = (await instancesInRange(ctx.house, today, addDays(today, 30))).filter(i => i.assignee === t.id && !i.completion);
  const name = await memberName(ctx.house.id, t.id);
  for (const mid of await schedulers(ctx.house.id))
    await notify(ctx.house.id, mid, { kind: 'house', title: `${name} saiu da casa`, body: future.length ? `Redistribua ${future.length} tarefa(s) futura(s) que estavam com ${name}.` : 'Nenhuma tarefa futura precisa ser redistribuída.', link: '/quadro' });
  return { ok: true, future_tasks: future.length };
});

route('POST', '/api/h/:hid/environments', async ctx => {
  need(canSchedule(ctx.me));
  const name = str(ctx.body.name, 40);
  need(name, 'Dê um nome ao ambiente.', 400);
  const r = await run('INSERT INTO environments (house_id, name, icon) VALUES (?,?,?)', ctx.house.id, name, str(ctx.body.icon, 20) || 'home');
  return { id: Number(r.lastInsertRowid) };
});

// ---------- Hoje ----------
route('GET', '/api/h/:hid/today', async ctx => {
  const { house, me } = ctx;
  const n = localNow(house.timezone), today = n.date;
  const envs = await envMap(house.id);
  const insts = (await Promise.all((await instancesInRange(house, addDays(today, -7), addDays(today, 14))).map(async i => await instView(i, ctx, envs))));
  const mineToday = insts.filter(i => i.assignee === me.id && i.date === today);
  const mineOverdue = insts.filter(i => i.assignee === me.id && i.date < today && i.status === 'atrasada');
  const next = insts.find(i => i.assignee === me.id && i.date > today && !i.completion) || null;
  const houseToday = insts.filter(i => i.date === today && i.assignee !== me.id);
  const unassignedFuture = insts.filter(i => i.date >= today && !i.completion && (!i.assignee || !i.assignee_active));

  const occMine = (await Promise.all((await all("SELECT * FROM occurrences WHERE house_id = ? AND assigned_member_id = ? AND status = 'aguardando' ORDER BY id DESC", house.id, me.id)).map(async o => await occView(o, ctx))));
  const occReview = me.can_review ? (await Promise.all((await all("SELECT * FROM occurrences WHERE house_id = ? AND status = 'em_revisao' ORDER BY id DESC", house.id)).map(async o => await occView(o, ctx)))) : [];
  const board = (await Promise.all((await all("SELECT * FROM occurrences WHERE house_id = ? AND assigned_member_id IS NULL AND status = 'aguardando' ORDER BY id DESC", house.id)).map(async o => await occView(o, ctx))));
  const swaps = (await Promise.all((await all("SELECT * FROM swaps WHERE house_id = ? AND target_id = ? AND status = 'pendente' ORDER BY id DESC", house.id, me.id)).map(async s => await swapView(s, ctx))));
  const shares = await all(`SELECT s.*, e.title, e.due_date, e.category FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
    WHERE e.house_id = ? AND s.member_id = ? AND s.status = 'pendente' AND e.due_date IS NOT NULL AND e.due_date <= ? ORDER BY e.due_date`, house.id, me.id, addDays(today, 7));
  const toConfirm = (await Promise.all((await all(`SELECT s.*, e.title, e.due_date FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
    WHERE e.house_id = ? AND s.status = 'informado' AND (? = 1 OR e.receiver_member_id = ?) AND s.member_id != ?`, house.id, me.can_finance ? 1 : 0, me.id, me.id))
    .map(async s => ({ ...s, member_name: await memberName(house.id, s.member_id) }))));
  const shop = (await Promise.all((await all('SELECT * FROM shop_items WHERE house_id = ? AND active = 1 ORDER BY id', house.id)).map(async i => await shopView(i, ctx))));
  return {
    now: n, mine_today: mineToday, mine_overdue: mineOverdue, next, house_today: houseToday,
    unassigned_count: canSchedule(me) ? unassignedFuture.length : 0,
    occ_mine: occMine, occ_review: occReview, board, swaps, shares_due: shares, to_confirm: toConfirm, shop,
    unread: (await one('SELECT COUNT(*) AS n FROM notifications WHERE member_id = ? AND read_at IS NULL', me.id)).n,
  };
});

// ---------- Meu perfil: tudo o que é meu, em ordem de urgência ----------
route('GET', '/api/h/:hid/me', async ctx => {
  const { house, me } = ctx;
  const n = localNow(house.timezone), today = n.date, t = now();
  const envs = await envMap(house.id);
  const insts = (await Promise.all((await instancesInRange(house, addDays(today, -7), addDays(today, 7))).map(async i => await instView(i, ctx, envs))));
  const ob = [];
  const add = o => ob.push(o);
  // prioridade: 0 = atrasado, 1 = hoje / precisa de resposta, 2 = em breve, 3 = informativo
  for (const i of insts.filter(i => i.assignee === me.id && !i.completion && i.date <= today)) add({
    kind: 'task', priority: i.status === 'atrasada' ? 0 : 1, icon: i.environment?.icon || 'broom', sort: i.due_ts,
    title: i.name, subtitle: i.date < today ? `Atrasada · era ${i.deadline}` : i.status === 'atrasada' ? `Atrasada · ${i.deadline}` : cap(i.deadline),
    action: { act: 'complete', label: 'Concluir', data: { tid: i.task_id, date: i.date, photo: i.require_photo ? 1 : 0 } }, link: `/tarefa/${i.task_id}/${i.date}`,
  });
  for (const o of await all("SELECT * FROM occurrences WHERE house_id = ? AND assigned_member_id = ? AND status = 'aguardando'", house.id, me.id)) add({
    kind: 'occurrence', priority: 1, icon: 'flag', sort: o.created_at,
    title: `Responder: ${o.type_label}`, subtitle: `${await memberName(house.id, o.reported_by)} registrou · referente a ${WEEKDAYS_SHORT[weekday(o.ref_date)]}`,
    action: { go: `/ocorrencia/${o.id}`, label: 'Responder' }, link: `/ocorrencia/${o.id}`,
  });
  for (const s of await all("SELECT * FROM swaps WHERE house_id = ? AND target_id = ? AND status = 'pendente'", house.id, me.id)) add({
    kind: 'swap', priority: 1, icon: 'swap', sort: s.created_at,
    title: `${await memberName(house.id, s.requester_id)} pediu uma troca`, subtitle: 'A escala só muda se você aceitar',
    action: { go: `/troca/${s.id}`, label: 'Ver pedido' }, link: `/troca/${s.id}`,
  });
  if (me.can_review) for (const o of await all("SELECT * FROM occurrences WHERE house_id = ? AND status = 'em_revisao'", house.id)) add({
    kind: 'review', priority: 1, icon: 'scale', sort: o.updated_at,
    title: `Revisar: ${o.type_label}`, subtitle: `${await memberName(house.id, o.assigned_member_id)} contestou`,
    action: { go: `/ocorrencia/${o.id}`, label: 'Revisar' }, link: `/ocorrencia/${o.id}`,
  });
  for (const s of await all(`SELECT s.*, e.title, e.due_date, e.category FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
    WHERE e.house_id = ? AND s.member_id = ? AND s.status = 'pendente'`, house.id, me.id)) {
    const late = s.due_date && s.due_date < today, soon = s.due_date && s.due_date <= addDays(today, 3);
    add({
      kind: 'payment', priority: late ? 0 : soon ? 1 : 2, icon: { aluguel: 'home', agua: 'droplet', luz: 'bulb', internet: 'wifi', gas: 'flame', condominio: 'building', mercado: 'cart', compra: 'cart', caixinha: 'coins' }[s.category] || 'wallet',
      sort: s.due_date ? zonedToUtc(s.due_date, '23:59', house.timezone) : t + 9e12, amount_cents: s.amount_cents,
      title: s.title, subtitle: s.due_date ? `${late ? 'Venceu' : 'Vence'} ${s.due_date.split('-').reverse().slice(0, 2).join('/')}` : 'Sem vencimento',
      action: { act: 'inform', label: 'Já paguei', data: { sid: s.id, amount: s.amount_cents, title: s.title, eid: s.expense_id } }, link: `/despesa/${s.expense_id}`,
    });
  }
  const toConfirm = await all(`SELECT s.*, e.title FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
    WHERE e.house_id = ? AND s.status = 'informado' AND (? = 1 OR e.receiver_member_id = ?) AND s.member_id != ?`, house.id, me.can_finance ? 1 : 0, me.id, me.id);
  if (toConfirm.length) add({
    kind: 'confirm', priority: 1, icon: 'receipt', sort: t,
    title: `${toConfirm.length} pagamento(s) para conferir`, subtitle: (await Promise.all(toConfirm.slice(0, 3).map(async s => await memberName(house.id, s.member_id)))).join(', '),
    action: { go: '/financeiro', label: 'Conferir' }, link: '/financeiro',
  });
  for (const it of await all('SELECT * FROM shop_items WHERE house_id = ? AND active = 1', house.id)) {
    const v = await shopView(it, ctx);
    if (v.next_member !== me.id) continue;
    if (v.status === 'acabou') add({
      kind: 'shop', priority: 1, icon: iconOf(it.icon), sort: it.alerted_at || t,
      title: `Comprar: ${it.name}`, subtitle: `${v.alerted_by_name || 'Alguém'} avisou que acabou. É a sua vez.`,
      action: { act: 'shopBuy', label: 'Já comprei', data: { id: it.id } }, link: `/compras/${it.id}`,
    });
    else add({
      kind: 'shop_next', priority: 3, icon: iconOf(it.icon), sort: t + 8e12,
      title: `Você é o próximo: ${it.name}`, subtitle: 'Só precisa comprar quando avisarem que acabou',
      action: null, link: `/compras/${it.id}`,
    });
  }
  ob.sort((a, b) => a.priority - b.priority || a.sort - b.sort);
  const upcoming = insts.filter(i => i.assignee === me.id && !i.completion && i.date > today);
  const week = addDays(today, -6);
  const doneWeek = (await one(`SELECT COUNT(*) AS n FROM task_completions WHERE member_id = ? AND date >= ? AND task_id IN (SELECT id FROM tasks WHERE house_id = ?)`, me.id, week, house.id)).n;
  const lateWeek = insts.filter(i => i.assignee === me.id && i.date >= week && i.date < today && (i.status === 'atrasada' || i.status === 'concluida_atrasada')).length;
  return {
    member: memberView(await one(`${MEMBER_SQL} WHERE m.id = ?`, me.id), house), now: n,
    obligations: ob, upcoming, stats: { done_week: doneWeek, late_week: lateWeek, open: ob.filter(o => o.priority <= 2).length },
    push: { enabled: !!pushPublicKey(), devices: await pushCount(ctx.user.id) },
  };
});
const ICON_FALLBACK = { '💧': 'droplet', '🔥': 'flame', '🧻': 'roll', '☕': 'coffee', '🛒': 'cart' };
const iconOf = v => ICON_FALLBACK[v] || v || 'cart';
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- Quadro: escala ----------
route('GET', '/api/h/:hid/schedule', async ctx => {
  const from = isDate(ctx.query.from) ? ctx.query.from : localNow(ctx.house.timezone).date;
  const to = isDate(ctx.query.to) && ctx.query.to >= from ? ctx.query.to : from;
  need(Math.abs(Date.parse(to) - Date.parse(from)) <= 62 * 86400000, 'Intervalo grande demais.', 400);
  const envs = await envMap(ctx.house.id);
  return { items: (await Promise.all((await instancesInRange(ctx.house, from, to)).map(async i => await instView(i, ctx, envs)))) };
});

route('GET', '/api/h/:hid/tasks/:tid', async ctx => {
  const t = await one('SELECT * FROM tasks WHERE id = ? AND house_id = ?', int(ctx.params.tid), ctx.house.id);
  need(t, 'Tarefa não encontrada.', 404);
  const date = ctx.query.date;
  let inst = null;
  if (isDate(date)) {
    const i = await getInstance(ctx.house, t.id, date);
    if (i) inst = await instView(i, ctx, await envMap(ctx.house.id));
  }
  const recent = (await Promise.all((await all('SELECT * FROM task_completions WHERE task_id = ? ORDER BY date DESC LIMIT 10', t.id))
    .map(async c => ({ ...c, member_name: await memberName(ctx.house.id, c.member_id) }))));
  return { task: { ...t, weekdays: parse(t.weekdays, []), rotation: parse(t.rotation, []), notify: parse(t.notify, null) }, instance: inst, recent };
});

route('POST', '/api/h/:hid/tasks', async ctx => {
  need(canSchedule(ctx.me), 'Só quem gerencia a escala pode criar tarefas.');
  const t = await validateTask(ctx.body, ctx);
  const id = await insertTask(t, ctx);
  await notifyNewTask(id, ctx);
  return { id };
});

// Editar: scope 'one' (só esta data: responsável, horário ou pular) ou 'future' (esta e as próximas)
route('PATCH', '/api/h/:hid/tasks/:tid', async ctx => {
  need(canSchedule(ctx.me), 'Só quem gerencia a escala pode editar tarefas.');
  const old = await one('SELECT * FROM tasks WHERE id = ? AND house_id = ?', int(ctx.params.tid), ctx.house.id);
  need(old, 'Tarefa não encontrada.', 404);
  const b = ctx.body, date = b.date;
  need(isDate(date), 'Data inválida.', 400);
  if (b.scope === 'one') {
    need(occursOn(old, date), 'A tarefa não acontece nesta data.', 400);
    const cur = await one('SELECT * FROM task_overrides WHERE task_id = ? AND date = ?', old.id, date) || {};
    const assignee = b.assignee_member_id !== undefined ? (b.assignee_member_id ? (await activeMember(ctx.house.id, b.assignee_member_id))?.id : null) : cur.assignee_member_id ?? null;
    need(b.assignee_member_id === undefined || !b.assignee_member_id || assignee, 'Morador inválido.', 400);
    const due = b.due_time !== undefined ? (b.due_time ? (isTime(b.due_time) ? b.due_time : fail(400, 'Horário inválido.')) : null) : cur.due_time ?? null;
    await run('INSERT INTO task_overrides (task_id, date, assignee_member_id, skipped, due_time) VALUES (?,?,?,?,?) ON CONFLICT(task_id, date) DO UPDATE SET assignee_member_id = excluded.assignee_member_id, skipped = excluded.skipped, due_time = excluded.due_time',
      old.id, date, assignee, b.skip ? 1 : 0, due);
    if (assignee && assignee !== ctx.me.id)
      await notify(ctx.house.id, assignee, { kind: 'task', title: `Tarefa atribuída: ${old.name}`, body: deadlineLabel(date, due || old.due_time), link: `/tarefa/${old.id}/${date}` });
    return { id: old.id };
  }
  need(b.scope === 'future', 'Escolha se altera só esta data ou esta e as próximas.', 400);
  if (b.delete) {
    await run('UPDATE tasks SET end_date = ? WHERE id = ?', addDays(date, -1), old.id);
    return { ok: true };
  }
  const t = await validateTask({ ...b, start_date: date <= old.start_date ? old.start_date : date }, ctx);
  const sameRotation = t.rotation === old.rotation && t.assign_mode === old.assign_mode;
  if (date <= old.start_date) {
    await run('UPDATE tasks SET name=?, environment_id=?, recurrence=?, weekdays=?, due_time=?, assign_mode=?, fixed_member_id=?, rotation=?, rotation_offset=?, require_photo=?, notify=? WHERE id=?',
      t.name, t.environment_id, t.recurrence, t.weekdays, t.due_time, t.assign_mode, t.fixed_member_id, t.rotation, sameRotation ? old.rotation_offset : 0, t.require_photo, t.notify, old.id);
    return { id: old.id };
  }
  // divide a série: a antiga termina ontem, a nova começa na data — o rodízio continua de onde estava
  const id = await tx(async () => {
    await run('UPDATE tasks SET end_date = ? WHERE id = ?', addDays(date, -1), old.id);
    const nid = await insertTask(t, ctx, { end_date: old.end_date, rotation_offset: sameRotation ? occurrenceIndex(old, date) : 0 });
    await run('UPDATE task_overrides SET task_id = ? WHERE task_id = ? AND date >= ?', nid, old.id, date);
    await run('UPDATE task_completions SET task_id = ? WHERE task_id = ? AND date >= ?', nid, old.id, date);
    await run("UPDATE swaps SET req_task_id = ? WHERE req_task_id = ? AND req_date >= ? AND status = 'pendente'", nid, old.id, date);
    await run("UPDATE swaps SET target_task_id = ? WHERE target_task_id = ? AND target_date >= ? AND status = 'pendente'", nid, old.id, date);
    return nid;
  });
  if (!sameRotation) await notifyNewTask(id, ctx);
  return { id };
});

route('POST', '/api/h/:hid/tasks/:tid/complete', async ctx => {
  const date = ctx.body.date;
  need(isDate(date), 'Data inválida.', 400);
  const inst = await getInstance(ctx.house, int(ctx.params.tid), date);
  need(inst, 'Tarefa não encontrada.', 404);
  need(inst.assignee === ctx.me.id || canSchedule(ctx.me), 'Só o responsável pode concluir esta tarefa.');
  need(date <= localNow(ctx.house.timezone).date, 'Ainda não chegou o dia desta tarefa.', 400);
  if (inst.completion) return { ok: true, already: true };
  const photo = await ownFile(ctx, ctx.body.photo_file_id, ['task']);
  need(!inst.require_photo || photo, 'Esta tarefa pede uma foto para concluir.', 400);
  try {
    await run('INSERT INTO task_completions (task_id, date, member_id, completed_at, photo_file_id) VALUES (?,?,?,?,?)', inst.task_id, date, inst.assignee || ctx.me.id, now(), photo);
  } catch (e) {
    if (isUniqueError(e)) return { ok: true, already: true }; // dois toques ao mesmo tempo
    throw e;
  }
  return { ok: true };
});

route('POST', '/api/h/:hid/tasks/:tid/uncomplete', async ctx => {
  const c = await one('SELECT c.* FROM task_completions c JOIN tasks t ON t.id = c.task_id WHERE c.task_id = ? AND c.date = ? AND t.house_id = ?', int(ctx.params.tid), ctx.body.date, ctx.house.id);
  need(c, 'Conclusão não encontrada.', 404);
  need(c.member_id === ctx.me.id || canSchedule(ctx.me));
  await run('DELETE FROM task_completions WHERE task_id = ? AND date = ?', c.task_id, c.date);
  return { ok: true };
});

// ---------- Trocas ----------
async function swapView(s, ctx) {
  const envs = await envMap(ctx.house.id);
  const a = await getInstance(ctx.house, s.req_task_id, s.req_date), b = await getInstance(ctx.house, s.target_task_id, s.target_date);
  return {
    ...s, requester_name: await memberName(ctx.house.id, s.requester_id), target_name: await memberName(ctx.house.id, s.target_id),
    req: a ? await instView(a, ctx, envs) : null, target: b ? await instView(b, ctx, envs) : null,
  };
}
route('POST', '/api/h/:hid/swaps', async ctx => {
  const b = ctx.body;
  const mine = await getInstance(ctx.house, int(b.task_id), b.date);
  need(mine && mine.assignee === ctx.me.id && !mine.completion, 'Você só pode trocar uma tarefa sua que ainda não foi concluída.', 400);
  const target = await activeMember(ctx.house.id, b.target_member_id);
  need(target && target.id !== ctx.me.id, 'Escolha outro morador.', 400);
  const theirs = await getInstance(ctx.house, int(b.target_task_id), b.target_date);
  need(theirs && theirs.assignee === target.id && !theirs.completion, 'Escolha uma tarefa pendente dessa pessoa.', 400);
  need(!await one("SELECT 1 FROM swaps WHERE house_id = ? AND status = 'pendente' AND req_task_id = ? AND req_date = ?", ctx.house.id, mine.task_id, b.date), 'Você já pediu troca desta tarefa. Aguarde a resposta.', 409);
  const r = await run('INSERT INTO swaps (house_id, requester_id, req_task_id, req_date, target_id, target_task_id, target_date, created_at) VALUES (?,?,?,?,?,?,?,?)',
    ctx.house.id, ctx.me.id, mine.task_id, b.date, target.id, theirs.task_id, b.target_date, now());
  const id = Number(r.lastInsertRowid);
  await notify(ctx.house.id, target.id, {
    kind: 'swap', title: 'Pedido de troca',
    body: `${await memberName(ctx.house.id, ctx.me.id)} quer trocar: ${mine.name} (${WEEKDAYS_SHORT[weekday(b.date)]}) pela sua ${theirs.name} (${WEEKDAYS_SHORT[weekday(b.target_date)]}).`,
    link: `/troca/${id}`,
  });
  return { id };
});
route('GET', '/api/h/:hid/swaps/:id', async ctx => {
  const s = await one('SELECT * FROM swaps WHERE id = ? AND house_id = ?', int(ctx.params.id), ctx.house.id);
  need(s, 'Troca não encontrada.', 404);
  return await swapView(s, ctx);
});
route('POST', '/api/h/:hid/swaps/:id/:action', async ctx => {
  const s = await one('SELECT * FROM swaps WHERE id = ? AND house_id = ?', int(ctx.params.id), ctx.house.id);
  need(s, 'Troca não encontrada.', 404);
  const action = ctx.params.action;
  if (s.status !== 'pendente') return { ok: true, status: s.status, already: true };
  if (action === 'cancel') {
    need(s.requester_id === ctx.me.id);
    await run("UPDATE swaps SET status = 'cancelada', resolved_at = ? WHERE id = ?", now(), s.id);
    return { ok: true };
  }
  need(s.target_id === ctx.me.id, 'Só quem recebeu o pedido pode responder.');
  if (action === 'decline') {
    await run("UPDATE swaps SET status = 'recusada', resolved_at = ? WHERE id = ?", now(), s.id);
    await notify(ctx.house.id, s.requester_id, { kind: 'swap', title: 'Troca recusada', body: `${await memberName(ctx.house.id, ctx.me.id)} recusou a troca.`, link: `/troca/${s.id}` });
    return { ok: true };
  }
  need(action === 'accept', 'Ação inválida.', 400);
  const a = await getInstance(ctx.house, s.req_task_id, s.req_date), b = await getInstance(ctx.house, s.target_task_id, s.target_date);
  need(a && b && a.assignee === s.requester_id && b.assignee === s.target_id && !a.completion && !b.completion, 'A escala mudou desde o pedido. A troca não pode mais ser feita.', 409);
  const setAssignee = async (tid, date, mid) => await run('INSERT INTO task_overrides (task_id, date, assignee_member_id) VALUES (?,?,?) ON CONFLICT(task_id, date) DO UPDATE SET assignee_member_id = excluded.assignee_member_id', tid, date, mid);
  await tx(async () => {
    await setAssignee(s.req_task_id, s.req_date, s.target_id);
    await setAssignee(s.target_task_id, s.target_date, s.requester_id);
    await run("UPDATE swaps SET status = 'aceita', resolved_at = ? WHERE id = ?", now(), s.id);
  });
  await notify(ctx.house.id, s.requester_id, { kind: 'swap', title: 'Troca aceita', body: `${await memberName(ctx.house.id, ctx.me.id)} aceitou. A escala já foi atualizada.`, link: `/tarefa/${s.target_task_id}/${s.target_date}` });
  return { ok: true };
});

// ---------- Regras ----------
async function validateRule(b, ctx) {
  const r = {
    title: str(b.title, 140), description: str(b.description, 600) || null, environment_id: int(b.environment_id),
    occurrence_label: str(b.occurrence_label, 60) || null, subject: str(b.subject, 40) || null,
    deadline_time: b.deadline_time ? b.deadline_time : null,
  };
  need(r.title, 'Escreva a regra.', 400);
  if (r.deadline_time) need(isTime(r.deadline_time), 'Prazo inválido.', 400);
  if (r.environment_id) need(await one('SELECT 1 FROM environments WHERE id = ? AND house_id = ?', r.environment_id, ctx.house.id), 'Ambiente inválido.', 400);
  else r.environment_id = null;
  return r;
}
route('POST', '/api/h/:hid/rules', async ctx => {
  need(canSchedule(ctx.me), 'Só quem gerencia a escala pode criar regras.');
  const r = await validateRule(ctx.body, ctx);
  const x = await run('INSERT INTO rules (house_id, title, description, environment_id, occurrence_label, subject, deadline_time, created_at) VALUES (?,?,?,?,?,?,?,?)',
    ctx.house.id, r.title, r.description, r.environment_id, r.occurrence_label, r.subject, r.deadline_time, now());
  return { id: Number(x.lastInsertRowid) };
});
route('PATCH', '/api/h/:hid/rules/:id', async ctx => {
  need(canSchedule(ctx.me));
  const rule = await one('SELECT * FROM rules WHERE id = ? AND house_id = ?', int(ctx.params.id), ctx.house.id);
  need(rule, 'Regra não encontrada.', 404);
  if (ctx.body.archive) { await run('UPDATE rules SET active = 0 WHERE id = ?', rule.id); return { ok: true }; }
  const r = await validateRule(ctx.body, ctx);
  await run('UPDATE rules SET title=?, description=?, environment_id=?, occurrence_label=?, subject=?, deadline_time=? WHERE id=?',
    r.title, r.description, r.environment_id, r.occurrence_label, r.subject, r.deadline_time, rule.id);
  return { ok: true };
});

// ---------- Ocorrências ----------
route('POST', '/api/h/:hid/occurrences', async ctx => {
  const b = ctx.body, h = ctx.house;
  const rule = b.rule_id ? await one('SELECT * FROM rules WHERE id = ? AND house_id = ? AND active = 1', int(b.rule_id), h.id) : null;
  need(!b.rule_id || rule, 'Regra inválida.', 400);
  const envId = int(b.environment_id) ?? rule?.environment_id ?? null;
  if (envId) need(await one('SELECT 1 FROM environments WHERE id = ? AND house_id = ?', envId, h.id), 'Ambiente inválido.', 400);
  const label = rule ? (rule.occurrence_label || rule.title) : str(b.type_label, 80);
  need(label, 'Escolha o que aconteceu.', 400);
  need(isDate(b.ref_date) && b.ref_date <= localNow(h.timezone).date, 'Escolha a qual dia se refere.', 400);
  let assigned = null;
  const toAll = !!b.to_all; // "Todos": avisa a casa inteira, sem indicar ninguém
  if (b.assigned_member_id && !toAll) {
    const m = await activeMember(h.id, b.assigned_member_id);
    need(m, 'Morador inválido.', 400);
    assigned = m.id;
  }
  const photo = await ownFile(ctx, b.photo_file_id, ['occurrence']);
  const t = now();
  const id = await tx(async () => {
    const r = await run('INSERT INTO occurrences (house_id, rule_id, environment_id, type_label, ref_date, reported_by, assigned_member_id, note, photo_file_id, status, to_all, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      h.id, rule?.id ?? null, envId, label, b.ref_date, ctx.me.id, assigned, str(b.note, 500) || null, photo, 'aguardando', toAll ? 1 : 0, t, t);
    const oid = Number(r.lastInsertRowid);
    await occEvent(oid, ctx.me.id, toAll ? 'registrou_para_todos' : assigned ? 'registrou' : 'registrou_sem_atribuicao', null, 'aguardando', { to_member: assigned });
    return oid;
  });
  const occ = await one('SELECT * FROM occurrences WHERE id = ?', id);
  // título fixo; embaixo, "o que foi: mensagem" — sem mensagem, o texto padrão
  const rep = await memberName(h.id, ctx.me.id);
  const body = occ.note ? `${label}: ${occ.note}`
    : `${rep} registrou uma pendência ${toAll ? 'para todos ' : ''}sobre ${await occSubject(occ)}.`;
  const to = toAll ? (await houseMembers(h.id)).filter(m => m.active && m.id !== ctx.me.id).map(m => m.id) : assigned && assigned !== ctx.me.id ? [assigned] : [];
  for (const mid of to) await notify(h.id, mid, { kind: 'occurrence', title: 'Pendência registrada', body, link: `/ocorrencia/${id}` });
  return { id };
});

route('GET', '/api/h/:hid/occurrences', async ctx => {
  const { me, house } = ctx;
  const f = ctx.query.filter;
  let rows;
  if (f === 'review') { need(me.can_review); rows = await all("SELECT * FROM occurrences WHERE house_id = ? AND status = 'em_revisao' ORDER BY id DESC", house.id); }
  else if (f === 'mine') rows = await all('SELECT * FROM occurrences WHERE house_id = ? AND (reported_by = ? OR assigned_member_id = ?) ORDER BY id DESC LIMIT 100', house.id, me.id, me.id);
  else rows = await filterAsync(await all('SELECT * FROM occurrences WHERE house_id = ? ORDER BY id DESC LIMIT 200', house.id), async o => await canSeeOcc(o, me, house));
  return { items: (await Promise.all(rows.map(async o => await occView(o, ctx)))) };
});

route('GET', '/api/h/:hid/occurrences/:id', async ctx => {
  const occ = await one('SELECT * FROM occurrences WHERE id = ? AND house_id = ?', int(ctx.params.id), ctx.house.id);
  need(occ && await canSeeOcc(occ, ctx.me, ctx.house), 'Ocorrência não encontrada.', 404);
  const showEvents = ctx.me.can_review || occ.reported_by === ctx.me.id || occ.assigned_member_id === ctx.me.id || (await occParties(occ.id)).has(ctx.me.id);
  const events = showEvents ? (await Promise.all((await all('SELECT * FROM occurrence_events WHERE occurrence_id = ? ORDER BY id', occ.id)).map(async e => ({
    ...e, actor_name: await memberName(ctx.house.id, e.actor_id),
    from_name: e.from_member ? await memberName(ctx.house.id, e.from_member) : null, to_name: e.to_member ? await memberName(ctx.house.id, e.to_member) : null,
  })))) : [];
  return { ...await occView(occ, ctx), events };
});

route('POST', '/api/h/:hid/occurrences/:id/:action', async ctx => {
  const { me, house } = ctx;
  const occ = await one('SELECT * FROM occurrences WHERE id = ? AND house_id = ?', int(ctx.params.id), house.id);
  need(occ && await canSeeOcc(occ, me, house), 'Ocorrência não encontrada.', 404);
  const a = ctx.params.action, note = str(ctx.body.note, 500) || null, me_name = await memberName(house.id, me.id);
  const subj = await occSubject(occ);
  const setStatus = async (status, extra = {}) => await run('UPDATE occurrences SET status = ?, assigned_member_id = ?, response = ?, updated_at = ? WHERE id = ?',
    status, extra.assigned !== undefined ? extra.assigned : occ.assigned_member_id, extra.response ?? occ.response, now(), occ.id);

  if (a === 'resolve') { // "Já resolvi"
    need(occ.assigned_member_id === me.id && occ.status === 'aguardando', 'Esta pendência não está aguardando sua resposta.', 409);
    await tx(async () => { await setStatus('resolvida', { response: 'resolvi' }); await occEvent(occ.id, me.id, 'resolveu', 'aguardando', 'resolvida', { note }); });
    await notify(house.id, occ.reported_by, { kind: 'occurrence', title: 'Pendência resolvida', body: `${me_name} resolveu: ${subj}.`, link: `/ocorrencia/${occ.id}` });
  } else if (a === 'contest') { // "Não era minha"
    need(occ.assigned_member_id === me.id && occ.status === 'aguardando', 'Esta pendência não está aguardando sua resposta.', 409);
    await tx(async () => { await setStatus('em_revisao', { response: 'nao_era_minha' }); await occEvent(occ.id, me.id, 'contestou', 'aguardando', 'em_revisao', { note }); });
    for (const r of await reviewers(house.id)) if (r !== me.id)
      await notify(house.id, r, { kind: 'occurrence', title: 'Ocorrência contestada', body: `${me_name} disse que não era dele(a): ${subj}. Analise.`, link: `/ocorrencia/${occ.id}` });
    await notify(house.id, occ.reported_by, { kind: 'occurrence', title: 'Ocorrência em revisão', body: `${me_name} contestou: ${subj}. Um responsável vai revisar.`, link: `/ocorrencia/${occ.id}` });
  } else if (a === 'claim') { // "É minha, vou resolver"
    need(!occ.assigned_member_id && occ.status === 'aguardando', 'Alguém já assumiu esta pendência.', 409);
    await tx(async () => { await setStatus('resolvida', { assigned: me.id, response: 'assumiu' }); await occEvent(occ.id, me.id, 'assumiu', 'aguardando', 'resolvida', { to_member: me.id, note }); });
    if (occ.reported_by !== me.id) await notify(house.id, occ.reported_by, { kind: 'occurrence', title: 'Pendência assumida', body: `${me_name} assumiu: ${subj}.`, link: `/ocorrencia/${occ.id}` });
  } else if (a === 'review') {
    need(me.can_review, 'Só quem revisa ocorrências pode fazer isso.');
    need(['aguardando', 'em_revisao'].includes(occ.status), 'Esta ocorrência já foi encerrada.', 409);
    const decision = ctx.body.decision;
    const parties = new Set([occ.reported_by, occ.assigned_member_id].filter(Boolean));
    if (decision === 'confirm') {
      need(occ.assigned_member_id, 'Não há morador indicado para confirmar.', 400);
      await tx(async () => { await setStatus('resolvida', { response: 'confirmada' }); await occEvent(occ.id, me.id, 'confirmou', occ.status, 'resolvida', { note }); });
    } else if (decision === 'reassign') {
      const m = await activeMember(house.id, ctx.body.member_id);
      need(m && m.id !== occ.assigned_member_id, 'Escolha outro morador.', 400);
      await tx(async () => {
        await setStatus('aguardando', { assigned: m.id, response: null });
        await occEvent(occ.id, me.id, 'corrigiu', occ.status, 'aguardando', { from_member: occ.assigned_member_id, to_member: m.id, note });
      });
      parties.add(m.id);
      await notify(house.id, m.id, { kind: 'occurrence', title: 'Pendência registrada', body: `${me_name} revisou e indicou você: ${subj}. Toque para ver.`, link: `/ocorrencia/${occ.id}` });
    } else if (decision === 'close') {
      await tx(async () => { await setStatus('encerrada', { assigned: null, response: 'sem_atribuicao' }); await occEvent(occ.id, me.id, 'encerrou_sem_atribuicao', occ.status, 'encerrada', { from_member: occ.assigned_member_id, note }); });
    } else fail(400, 'Decisão inválida.');
    for (const p of parties) if (p !== me.id && !(decision === 'reassign' && p === int(ctx.body.member_id)))
      await notify(house.id, p, { kind: 'occurrence', title: 'Ocorrência revisada', body: `${me_name} revisou: ${subj}.`, link: `/ocorrencia/${occ.id}` });
  } else fail(400, 'Ação inválida.');
  return { ok: true };
});

// ---------- Perfil ----------
route('GET', '/api/h/:hid/members/:mid/profile', async ctx => {
  const { house, me } = ctx;
  const m = await one(`${MEMBER_SQL} WHERE m.id = ? AND m.house_id = ?`, int(ctx.params.mid), house.id);
  need(m, 'Morador não encontrado.', 404);
  const today = localNow(house.timezone).date;
  const envs = await envMap(house.id);
  const tasksById = new Map((await all('SELECT id, name FROM tasks WHERE house_id = ?', house.id)).map(t => [t.id, t]));
  const upcoming = (await Promise.all((await instancesInRange(house, today, addDays(today, 7))).filter(i => i.assignee === m.id && !i.completion).map(async i => await instView(i, ctx, envs))));
  const history = [];
  for (const c of await all('SELECT * FROM task_completions WHERE member_id = ? AND task_id IN (SELECT id FROM tasks WHERE house_id = ?) ORDER BY completed_at DESC LIMIT 60', m.id, house.id)) {
    const t = tasksById.get(c.task_id);
    const at = localNow(house.timezone, c.completed_at);
    history.push({ type: 'sistema', kind: 'concluida', date: c.date, at: c.completed_at, text: `${t?.name || 'Tarefa'} de ${WEEKDAYS_SHORT[weekday(c.date)]} concluída às ${at.time.replace(':', 'h')}${at.date !== c.date ? ` (${WEEKDAYS_SHORT[weekday(at.date)]})` : ''}`, link: `/tarefa/${c.task_id}/${c.date}`, photo: !!c.photo_file_id });
  }
  for (const i of (await instancesInRange(house, addDays(today, -30), today)).filter(i => i.assignee === m.id && i.status === 'atrasada'))
    history.push({ type: 'sistema', kind: 'atrasada', date: i.date, at: i.due_ts, text: `${i.name} de ${WEEKDAYS_SHORT[weekday(i.date)]} não concluída no prazo (${deadlineLabel(i.date, i.due_time)})`, link: `/tarefa/${i.task_id}/${i.date}` });
  for (const o of await filterAsync(await all('SELECT * FROM occurrences WHERE house_id = ? AND assigned_member_id = ? ORDER BY id DESC LIMIT 60', house.id, m.id), async o => await canSeeOcc(o, me, house)))
    history.push({ type: 'relato', kind: o.status, date: o.ref_date, at: o.created_at, text: `${o.type_label} (${WEEKDAYS_SHORT[weekday(o.ref_date)]}) · relatado por ${await memberName(house.id, o.reported_by)}`, status: o.status, link: `/ocorrencia/${o.id}` });
  history.sort((a, b) => b.at - a.at);
  return { member: memberView(m, house), upcoming, history };
});

// ---------- Notificações ----------
route('GET', '/api/h/:hid/notifications', async ctx => {
  if (ctx.query.count) return { unread: (await one('SELECT COUNT(*) AS n FROM notifications WHERE member_id = ? AND read_at IS NULL', ctx.me.id)).n };
  return {
    items: await all('SELECT * FROM notifications WHERE member_id = ? ORDER BY id DESC LIMIT 100', ctx.me.id),
    unread: (await one('SELECT COUNT(*) AS n FROM notifications WHERE member_id = ? AND read_at IS NULL', ctx.me.id)).n,
  };
});
route('POST', '/api/h/:hid/notifications/read', async ctx => {
  if (ctx.body.all) await run('UPDATE notifications SET read_at = ? WHERE member_id = ? AND read_at IS NULL', now(), ctx.me.id);
  else await run('UPDATE notifications SET read_at = ? WHERE member_id = ? AND id = ? AND read_at IS NULL', now(), ctx.me.id, int(ctx.body.id));
  return { ok: true };
});
route('POST', '/api/push/subscribe', async ctx => {
  const s = ctx.body.subscription;
  need(s && typeof s.endpoint === 'string' && s.keys, 'Inscrição inválida.', 400);
  await run('INSERT INTO push_subs (endpoint, user_id, data, created_at) VALUES (?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, data = excluded.data', s.endpoint, ctx.user.id, JSON.stringify(s), now());
  return { ok: true };
});
route('POST', '/api/push/test', async ctx => {
  const r = await sendPush(ctx.user.id, { title: 'Notificações ativadas', body: 'É assim que os avisos da casa vão chegar no seu celular.', url: '/#/perfil', tag: 'teste' });
  return { ...r, devices: await pushCount(ctx.user.id), enabled: !!pushPublicKey() };
});
route('GET', '/api/push/status', async ctx => ({ enabled: !!pushPublicKey(), devices: await pushCount(ctx.user.id) }));

// ---------- Arquivos (privados) ----------
const KINDS = { task: 'img', occurrence: 'img', house: 'img', avatar: 'img', receipt: 'img+pdf', purchase: 'img+pdf', bill: 'img+pdf', house_receipt: 'img+pdf', cash: 'img+pdf' };
function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.slice(0, 3).toString() === 'GIF') return 'image/gif';
  if (buf.slice(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (buf.slice(4, 8).toString() === 'ftyp' && /hei|mif|avif/.test(buf.slice(8, 12).toString())) return 'image/heic';
  return null;
}
route('POST', '/api/h/:hid/files', async ctx => {
  const kind = ctx.query.kind;
  need(KINDS[kind], 'Tipo de anexo inválido.', 400);
  const buf = ctx.raw;
  need(buf && buf.length, 'Arquivo vazio.', 400);
  const mime = sniff(buf);
  need(mime, 'Formato não suportado. Envie uma foto (JPG, PNG, WEBP, HEIC)' + (KINDS[kind].includes('pdf') ? ' ou PDF.' : '.'), 415);
  need(mime !== 'application/pdf' || KINDS[kind].includes('pdf'), 'Aqui só aceitamos imagens.', 415);
  const disk = crypto.randomBytes(16).toString('hex');
  await putFile(disk, buf, mime);
  const r = await run('INSERT INTO files (house_id, uploader_id, kind, mime, size, disk_name, created_at) VALUES (?,?,?,?,?,?,?)', ctx.house.id, ctx.me.id, kind, mime, buf.length, disk, now());
  return { id: Number(r.lastInsertRowid), mime };
}, { raw: true });

async function canSeeFile(f, ctx) {
  const { me, house } = ctx;
  if (f.uploader_id === me.id) return true;
  switch (f.kind) {
    case 'house': case 'avatar': case 'task': case 'purchase': case 'cash': return true;
    case 'occurrence': {
      const o = await one('SELECT * FROM occurrences WHERE photo_file_id = ? AND house_id = ?', f.id, house.id);
      return !!o && await canSeeOcc(o, me, house) && await canSeeOccPhoto(o, me);
    }
    case 'receipt': {
      const s = await one('SELECT s.member_id, e.receiver_member_id FROM expense_shares s JOIN expenses e ON e.id = s.expense_id WHERE s.receipt_file_id = ? AND e.house_id = ?', f.id, house.id);
      return !!s && (s.member_id === me.id || me.can_finance || s.receiver_member_id === me.id);
    }
    case 'bill': case 'house_receipt': {
      const e = await one('SELECT * FROM expenses WHERE house_id = ? AND (bill_file_id = ? OR paid_receipt_file_id = ?)', house.id, f.id, f.id);
      return !!e && (await expenseAccess(e, ctx)).docs;
    }
  }
  return false;
}
route('GET', '/api/h/:hid/files/:fid', async ctx => {
  const f = await one('SELECT * FROM files WHERE id = ? AND house_id = ?', int(ctx.params.fid), ctx.house.id);
  need(f && await canSeeFile(f, ctx), 'Arquivo não encontrado.', 404);
  const buf = await getFile(f.disk_name);
  ctx.res.writeHead(200, { 'Content-Type': f.mime, 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
  ctx.res.end(buf);
  return undefined;
});

// ---------- Financeiro ----------
// Contas da casa (aluguel, água, luz, internet...) são administradas por uma pessoa só (quem tem a conta no banco):
// ela vê a divisão de todo mundo; cada morador vê só a própria parte. Mercado/compras da casa são transparentes.
const CATEGORIES = { aluguel: 'Aluguel', agua: 'Água', luz: 'Luz', internet: 'Internet', gas: 'Gás', condominio: 'Condomínio', mercado: 'Mercado', compra: 'Compra da casa', caixinha: 'Caixinha', outro: 'Outra conta' };
const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// ---------- Caixinha: cada morador deposita um valor fixo por mês; o saldo é o caixa da rep ----------
// Gera (uma vez por mês) a cobrança da caixinha para todos os moradores ativos.
async function ensureCaixinha(house) {
  if (!house.caixinha_cents) return null;
  const n = localNow(house.timezone);
  const key = n.date.slice(0, 7);
  const src = `caixinha:${key}`;
  const ex = await one('SELECT id FROM expenses WHERE house_id = ? AND source = ?', house.id, src);
  if (ex) return ex.id;
  const day = String(Math.min(Math.max(house.caixinha_day || 10, 1), 28)).padStart(2, '0');
  const members = await all('SELECT id FROM members WHERE house_id = ? AND active = 1', house.id);
  if (!members.length) return null;
  const creator = (await financers(house.id))[0] || members[0].id;
  const eid = await tx(async () => {
    const r = await run('INSERT INTO expenses (house_id, title, total_cents, due_date, created_by, category, source, created_at) VALUES (?,?,?,?,?,?,?,?)',
      house.id, `Caixinha de ${MONTHS_PT[+key.slice(5) - 1]}`, house.caixinha_cents * members.length, `${key}-${day}`, creator, 'caixinha', src, now());
    const id = Number(r.lastInsertRowid);
    for (const m of members) await run('INSERT INTO expense_shares (expense_id, member_id, amount_cents) VALUES (?,?,?)', id, m.id, house.caixinha_cents);
    return id;
  });
  for (const m of members) await notify(house.id, m.id, { kind: 'expense', title: `Caixinha de ${MONTHS_PT[+key.slice(5) - 1]}`, body: `Sua contribuição: R$ ${(house.caixinha_cents / 100).toFixed(2).replace('.', ',')} até dia ${+day}.`, link: '/financeiro?aba=caixinha', dedupe: `cx:${house.id}:${key}:${m.id}` });
  return eid;
}
async function caixinhaBalance(houseId) {
  const contrib = (await one(`SELECT COALESCE(SUM(s.amount_cents), 0) AS v FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
    WHERE e.house_id = ? AND e.category = 'caixinha' AND s.status = 'confirmado'`, houseId)).v;
  const ins = (await one("SELECT COALESCE(SUM(amount_cents), 0) AS v FROM cash_moves WHERE house_id = ? AND kind = 'entrada'", houseId)).v;
  const outs = (await one("SELECT COALESCE(SUM(amount_cents), 0) AS v FROM cash_moves WHERE house_id = ? AND kind = 'saida'", houseId)).v;
  return { balance: contrib + ins - outs, contributions: contrib, entradas: ins, saidas: outs };
}
route('GET', '/api/h/:hid/caixinha', async ctx => {
  const h = ctx.house, me = ctx.me;
  await ensureCaixinha(h);
  const n = localNow(h.timezone), key = n.date.slice(0, 7);
  const months = (await Promise.all((await all(`SELECT * FROM expenses WHERE house_id = ? AND category = 'caixinha' ORDER BY due_date DESC LIMIT 12`, h.id)).map(async e => {
    const shares = (await Promise.all((await all('SELECT * FROM expense_shares WHERE expense_id = ? ORDER BY id', e.id)).map(async s => ({ ...s, member_name: await memberName(h.id, s.member_id) }))));
    return {
      id: e.id, title: e.title, due_date: e.due_date, month: (e.due_date || '').slice(0, 7), per_member: shares[0]?.amount_cents || 0,
      paid: shares.filter(s => s.status === 'confirmado').length, total: shares.length,
      collected: shares.filter(s => s.status === 'confirmado').reduce((a, s) => a + s.amount_cents, 0),
      mine: shares.find(s => s.member_id === me.id) || null,
      shares: me.can_finance ? shares.map(s => ({ ...s, receipt_file_id: s.receipt_file_id })) : undefined,
    };
  })));
  // extrato: depósitos confirmados + entradas/saídas avulsas
  // depósitos agrupados por mês: o extrato mostra o total, não quem pagou (isso fica com o Financeiro)
  const deposits = (await all(`SELECT e.title, COUNT(*) AS n, SUM(s.amount_cents) AS amount_cents, MAX(s.confirmed_at) AS last_ts FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
    WHERE e.house_id = ? AND e.category = 'caixinha' AND s.status = 'confirmado' GROUP BY e.id, e.title ORDER BY last_ts DESC LIMIT 24`, h.id))
    .map(d => ({ kind: 'entrada', amount_cents: d.amount_cents, at: d.last_ts, description: `Depósitos · ${d.title} (${d.n})`, source: 'contribuicao' }));
  const moves = (await Promise.all((await all('SELECT * FROM cash_moves WHERE house_id = ? ORDER BY created_at DESC LIMIT 100', h.id))
    .map(async m => ({ ...m, at: m.created_at, by: await memberName(h.id, m.created_by) }))));
  const extrato = [...deposits, ...moves].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 100);
  return {
    ...await caixinhaBalance(h.id), monthly_cents: h.caixinha_cents, due_day: h.caixinha_day, current_month: key,
    months, extrato, can_manage: !!me.can_finance, payers: (await Promise.all((await financers(h.id)).map(async id => await memberName(h.id, id)))), payment_info: h.payment_info || '',
  };
});
route('PATCH', '/api/h/:hid/caixinha/settings', async ctx => {
  need(ctx.me.can_finance, 'Só o Financeiro ou o Veterano Master define a caixinha.');
  const cents = int(ctx.body.monthly_cents), day = int(ctx.body.due_day);
  need(cents !== null && cents >= 0, 'Valor inválido.', 400);
  need(day >= 1 && day <= 28, 'Escolha um dia entre 1 e 28.', 400);
  await run('UPDATE houses SET caixinha_cents = ?, caixinha_day = ? WHERE id = ?', cents, day, ctx.house.id);
  // se o mês atual ainda não foi cobrado, já gera; se foi e ninguém pagou ainda, atualiza o valor
  const h = await one('SELECT * FROM houses WHERE id = ?', ctx.house.id);
  const key = localNow(h.timezone).date.slice(0, 7);
  const cur = await one('SELECT * FROM expenses WHERE house_id = ? AND source = ?', h.id, `caixinha:${key}`);
  if (cur && !await one("SELECT 1 FROM expense_shares WHERE expense_id = ? AND status != 'pendente'", cur.id)) {
    const cnt = (await one('SELECT COUNT(*) AS n FROM expense_shares WHERE expense_id = ?', cur.id)).n;
    await run('UPDATE expense_shares SET amount_cents = ? WHERE expense_id = ?', cents, cur.id);
    await run('UPDATE expenses SET total_cents = ?, due_date = ? WHERE id = ?', cents * cnt, `${key}-${String(day).padStart(2, '0')}`, cur.id);
  } else await ensureCaixinha(h);
  return { ok: true };
});
route('POST', '/api/h/:hid/caixinha/moves', async ctx => {
  need(ctx.me.can_finance, 'Só o Financeiro ou o Veterano Master movimenta a caixinha.');
  const b = ctx.body;
  need(['entrada', 'saida'].includes(b.kind), 'Escolha entrada ou saída.', 400);
  const amount = int(b.amount_cents);
  need(amount > 0, 'Informe o valor.', 400);
  const desc = str(b.description, 120);
  need(desc, 'Descreva a movimentação.', 400);
  if (b.kind === 'saida') need((await caixinhaBalance(ctx.house.id)).balance >= amount, 'A caixinha não tem saldo para essa saída.', 400);
  const file = await ownFile(ctx, b.file_id, ['cash']);
  const r = await run('INSERT INTO cash_moves (house_id, kind, amount_cents, description, source, file_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)',
    ctx.house.id, b.kind, amount, desc, 'manual', file, ctx.me.id, now());
  return { id: Number(r.lastInsertRowid), ...await caixinhaBalance(ctx.house.id) };
});
const isMarket = e => e.category === 'mercado' || e.category === 'compra';
async function expenseAccess(e, ctx) {
  const me = ctx.me;
  const mineShare = await one('SELECT id FROM expense_shares WHERE expense_id = ? AND member_id = ?', e.id, me.id);
  const hasShares = !!await one('SELECT 1 FROM expense_shares WHERE expense_id = ? LIMIT 1', e.id);
  const full = !!me.can_finance || e.receiver_member_id === me.id || (isMarket(e) && !!mineShare);
  const visible = full || !!mineShare || (!hasShares && !!ctx.house.docs_visible);
  const docs = !!me.can_finance || (!!ctx.house.docs_visible && visible);
  return { full, visible, docs };
}
async function expenseView(e, ctx) {
  const acc = await expenseAccess(e, ctx);
  let shares = (await Promise.all((await all('SELECT * FROM expense_shares WHERE expense_id = ? ORDER BY id', e.id)).map(async s => {
    const canReceipt = s.member_id === ctx.me.id || ctx.me.can_finance || e.receiver_member_id === ctx.me.id;
    return { ...s, member_name: await memberName(ctx.house.id, s.member_id), receipt_file_id: canReceipt ? s.receipt_file_id : null, has_receipt: !!s.receipt_file_id };
  })));
  const totals = { count: shares.length, confirmed: shares.filter(s => s.status === 'confirmado').length };
  if (!acc.full) shares = shares.filter(s => s.member_id === ctx.me.id);
  return {
    ...e, shares, totals, full_view: acc.full, category_label: CATEGORIES[e.category] || 'Conta', is_market: isMarket(e),
    bill_file_id: acc.docs ? e.bill_file_id : null, paid_receipt_file_id: acc.docs ? e.paid_receipt_file_id : null,
    has_bill: !!e.bill_file_id, has_paid_receipt: !!e.paid_receipt_file_id,
    created_by_name: await memberName(ctx.house.id, e.created_by),
    paid_by_name: e.paid_by ? await memberName(ctx.house.id, e.paid_by) : null,
    receiver_name: e.receiver_member_id ? await memberName(ctx.house.id, e.receiver_member_id) : null,
    mine: shares.find(s => s.member_id === ctx.me.id) || null,
    can_confirm: !!ctx.me.can_finance || e.receiver_member_id === ctx.me.id,
  };
}
route('GET', '/api/h/:hid/finance', async ctx => {
  const visible = await filterAsync(await all(`SELECT * FROM expenses WHERE house_id = ? ORDER BY COALESCE(due_date, '9999') DESC, id DESC LIMIT 300`, ctx.house.id), async e => (await expenseAccess(e, ctx)).visible);
  const items = await Promise.all(visible.map(e => expenseView(e, ctx)));
  const payers = (await Promise.all((await financers(ctx.house.id)).map(async id => await memberName(ctx.house.id, id))));
  return {
    items, now: localNow(ctx.house.timezone), categories: CATEGORIES,
    payment_info: ctx.house.payment_info || '', docs_visible: !!ctx.house.docs_visible, payers,
    can_manage: !!ctx.me.can_finance, can_settings: !!(ctx.me.can_finance || ctx.me.is_admin),
  };
});
route('PATCH', '/api/h/:hid/finance/settings', async ctx => {
  need(ctx.me.can_finance || ctx.me.is_admin, 'Só o responsável pelas contas altera isso.');
  const b = ctx.body;
  if (b.payment_info !== undefined) await run('UPDATE houses SET payment_info = ? WHERE id = ?', str(b.payment_info, 300) || null, ctx.house.id);
  if (b.docs_visible !== undefined) await run('UPDATE houses SET docs_visible = ? WHERE id = ?', b.docs_visible ? 1 : 0, ctx.house.id);
  return { ok: true };
});
route('GET', '/api/h/:hid/expenses/:id', async ctx => {
  const e = await one('SELECT * FROM expenses WHERE id = ? AND house_id = ?', int(ctx.params.id), ctx.house.id);
  need(e && (await expenseAccess(e, ctx)).visible, 'Despesa não encontrada.', 404);
  return { ...await expenseView(e, ctx), payment_info: ctx.house.payment_info || '' };
});
async function createExpense(ctx, { title, total, due, shares, receiver = null, source = null, housePaid = false, autoConfirm = null, category = 'outro', bill = null }) {
  return await tx(async () => {
    const r = await run('INSERT INTO expenses (house_id, title, total_cents, due_date, created_by, receiver_member_id, house_paid, house_paid_at, source, category, bill_file_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      ctx.house.id, title, total, due, ctx.me.id, receiver, housePaid ? 1 : 0, housePaid ? now() : null, source, category, bill, now());
    const eid = Number(r.lastInsertRowid);
    for (const s of shares) {
      const auto = autoConfirm === s.member_id;
      await run('INSERT INTO expense_shares (expense_id, member_id, amount_cents, status, confirmed_by, confirmed_at) VALUES (?,?,?,?,?,?)',
        eid, s.member_id, s.amount_cents, auto ? 'confirmado' : 'pendente', auto ? ctx.me.id : null, auto ? now() : null);
    }
    return eid;
  });
}
route('POST', '/api/h/:hid/expenses', async ctx => {
  need(ctx.me.can_finance, 'Só quem gerencia o financeiro pode lançar despesas.');
  const b = ctx.body;
  const title = str(b.title, 80), total = int(b.total_cents);
  need(title, 'Dê um nome à despesa.', 400);
  need(total > 0, 'Informe o valor total.', 400);
  need(!b.due_date || isDate(b.due_date), 'Vencimento inválido.', 400);
  // "compra" e "caixinha" são geradas pelo próprio app (uma conta manual de caixinha bagunçaria o saldo)
  const category = b.category in CATEGORIES && !['compra', 'caixinha'].includes(b.category) ? b.category : 'outro';
  const shares = (Array.isArray(b.shares) ? b.shares : []).map(s => ({ member_id: int(s.member_id), amount_cents: int(s.amount_cents) }));
  // sem divisão = só arquivar a conta (ex.: luz paga pelo caixa) — com fatura e comprovante
  if (b.split !== false) {
    need(shares.length, 'Escolha os participantes.', 400);
    need(new Set(shares.map(s => s.member_id)).size === shares.length, 'Morador repetido na divisão.', 400);
    need((await everyAsync(shares, async s => !!(await activeMember(ctx.house.id, s.member_id)) && s.amount_cents >= 0)), 'Divisão inválida.', 400);
    const sum = shares.reduce((a, s) => a + s.amount_cents, 0);
    need(sum === total, `A soma das partes (R$ ${(sum / 100).toFixed(2).replace('.', ',')}) precisa ser igual ao total (R$ ${(total / 100).toFixed(2).replace('.', ',')}).`, 400);
  } else shares.length = 0;
  const bill = await ownFile(ctx, b.bill_file_id, ['bill']);
  const id = await createExpense(ctx, { title, total, due: b.due_date || null, shares, category, bill });
  for (const s of shares) if (s.member_id !== ctx.me.id)
    await notify(ctx.house.id, s.member_id, { kind: 'expense', title: `Nova conta: ${title}`, body: `Sua parte: R$ ${(s.amount_cents / 100).toFixed(2).replace('.', ',')}${b.due_date ? ` · vence ${b.due_date.split('-').reverse().slice(0, 2).join('/')}` : ''}.`, link: `/despesa/${id}` });
  return { id };
});
// marcar a conta da casa como paga (com comprovante) — "morador pagou a parte dele" continua separado
route('POST', '/api/h/:hid/expenses/:id/house-paid', async ctx => {
  need(ctx.me.can_finance, 'Só o responsável pelas contas marca a conta como paga.');
  const e = await one('SELECT * FROM expenses WHERE id = ? AND house_id = ?', int(ctx.params.id), ctx.house.id);
  need(e, 'Despesa não encontrada.', 404);
  const paid = !!ctx.body.paid;
  const rec = paid ? (await ownFile(ctx, ctx.body.receipt_file_id, ['house_receipt']) ?? e.paid_receipt_file_id) : e.paid_receipt_file_id;
  await tx(async () => {
    await run('UPDATE expenses SET house_paid = ?, house_paid_at = ?, paid_by = ?, paid_receipt_file_id = ? WHERE id = ?', paid ? 1 : 0, paid ? now() : null, paid ? ctx.me.id : null, rec, e.id);
    // pago com dinheiro da caixinha: vira uma saída no extrato (e sai de lá se desmarcar)
    await run("DELETE FROM cash_moves WHERE house_id = ? AND source = 'conta' AND ref_id = ?", ctx.house.id, e.id);
    if (paid && ctx.body.from_caixinha) {
      need((await caixinhaBalance(ctx.house.id)).balance >= e.total_cents, 'A caixinha não tem saldo para pagar essa conta.', 400);
      await run('INSERT INTO cash_moves (house_id, kind, amount_cents, description, source, ref_id, file_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        ctx.house.id, 'saida', e.total_cents, `Pagamento: ${e.title}`, 'conta', e.id, null, ctx.me.id, now());
    }
  });
  if (paid && !e.house_paid && ctx.house.docs_visible)
    for (const s of await all('SELECT member_id FROM expense_shares WHERE expense_id = ?', e.id)) if (s.member_id !== ctx.me.id)
      await notify(ctx.house.id, s.member_id, { kind: 'expense', title: `${e.title}: conta paga`, body: rec ? 'O comprovante está guardado no Financeiro.' : `${await memberName(ctx.house.id, ctx.me.id)} pagou a conta da casa.`, link: `/despesa/${e.id}` });
  return { ok: true };
});
// anexar / trocar a fatura e o comprovante depois
route('POST', '/api/h/:hid/expenses/:id/documents', async ctx => {
  need(ctx.me.can_finance, 'Só o responsável pelas contas anexa documentos.');
  const e = await one('SELECT * FROM expenses WHERE id = ? AND house_id = ?', int(ctx.params.id), ctx.house.id);
  need(e, 'Despesa não encontrada.', 404);
  const b = ctx.body;
  const bill = b.bill_file_id !== undefined ? await ownFile(ctx, b.bill_file_id, ['bill']) : e.bill_file_id;
  const rec = b.paid_receipt_file_id !== undefined ? await ownFile(ctx, b.paid_receipt_file_id, ['house_receipt']) : e.paid_receipt_file_id;
  await run('UPDATE expenses SET bill_file_id = ?, paid_receipt_file_id = ? WHERE id = ?', bill, rec, e.id);
  return { ok: true };
});
route('POST', '/api/h/:hid/shares/:sid/:action', async ctx => {
  const s = await one('SELECT s.*, e.house_id, e.title, e.receiver_member_id, e.id AS eid FROM expense_shares s JOIN expenses e ON e.id = s.expense_id WHERE s.id = ? AND e.house_id = ?', int(ctx.params.sid), ctx.house.id);
  need(s, 'Parcela não encontrada.', 404);
  const a = ctx.params.action, me = ctx.me, name = await memberName(ctx.house.id, me.id);
  if (a === 'inform') {
    need(s.member_id === me.id, 'Só o próprio morador informa o pagamento dele.');
    if (s.status === 'informado' || s.status === 'confirmado') return { ok: true, already: true };
    const rec = await ownFile(ctx, ctx.body.receipt_file_id, ['receipt']);
    await run("UPDATE expense_shares SET status = 'informado', informed_at = ?, receipt_file_id = ? WHERE id = ?", now(), rec, s.id);
    const to = new Set([...await financers(ctx.house.id), s.receiver_member_id].filter(Boolean));
    to.delete(me.id);
    for (const mid of to) await notify(ctx.house.id, mid, { kind: 'expense', title: 'Pagamento informado', body: `${name} informou o pagamento de ${s.title} (R$ ${(s.amount_cents / 100).toFixed(2).replace('.', ',')}). Confira.`, link: `/despesa/${s.eid}` });
  } else if (a === 'confirm' || a === 'reject') {
    need(me.can_finance || s.receiver_member_id === me.id, 'Só o responsável pelas contas confirma pagamentos.');
    if (a === 'confirm') {
      if (s.status === 'confirmado') return { ok: true, already: true };
      await run("UPDATE expense_shares SET status = 'confirmado', confirmed_by = ?, confirmed_at = ? WHERE id = ?", me.id, now(), s.id);
      await notify(ctx.house.id, s.member_id, { kind: 'expense', title: 'Pagamento confirmado', body: `${name} confirmou seu pagamento de ${s.title}.`, link: `/despesa/${s.eid}` });
    } else {
      need(s.status === 'informado', 'Só dá para recusar um pagamento informado.', 400);
      await run("UPDATE expense_shares SET status = 'pendente', informed_at = NULL WHERE id = ?", s.id);
      await notify(ctx.house.id, s.member_id, { kind: 'expense', title: 'Pagamento não confirmado', body: `${name} não encontrou seu pagamento de ${s.title}.${ctx.body.note ? ' ' + str(ctx.body.note, 200) : ''}`, link: `/despesa/${s.eid}` });
    }
  } else fail(400, 'Ação inválida.');
  return { ok: true };
});

// ---------- Compras da casa ----------
async function validateItem(b, ctx) {
  const parts = (Array.isArray(b.participants) ? b.participants : []).map(Number);
  const it = {
    name: str(b.name, 40), icon: str(b.icon, 20) || 'cart', participants: parts,
    payment_mode: b.payment_mode, notify_mode: b.notify_mode === 'all' ? 'all' : 'turn',
  };
  need(it.name, 'Dê um nome ao item.', 400);
  need(parts.length && new Set(parts).size === parts.length && (await everyAsync(parts, async id => await activeMember(ctx.house.id, id))), 'Escolha quem participa.', 400);
  need(['buyer', 'split', 'house'].includes(it.payment_mode), 'Escolha como funciona o pagamento.', 400);
  const starter = int(b.starter_member_id);
  it.next_index = starter && parts.includes(starter) ? parts.indexOf(starter) : 0;
  return it;
}
route('GET', '/api/h/:hid/shop', async ctx => ({
  items: (await Promise.all((await all('SELECT * FROM shop_items WHERE house_id = ? AND active = 1 ORDER BY id', ctx.house.id)).map(async i => await shopView(i, ctx)))),
}));
route('POST', '/api/h/:hid/shop/items', async ctx => {
  need(canSchedule(ctx.me), 'Só quem organiza a casa pode criar itens.');
  const it = await validateItem(ctx.body, ctx);
  const r = await run('INSERT INTO shop_items (house_id, name, icon, participants, next_index, payment_mode, notify_mode, created_at) VALUES (?,?,?,?,?,?,?,?)',
    ctx.house.id, it.name, it.icon, JSON.stringify(it.participants), it.next_index, it.payment_mode, it.notify_mode, now());
  return { id: Number(r.lastInsertRowid) };
});
route('GET', '/api/h/:hid/shop/items/:id', async ctx => {
  const item = await one('SELECT * FROM shop_items WHERE id = ? AND house_id = ?', int(ctx.params.id), ctx.house.id);
  need(item, 'Item não encontrado.', 404);
  const history = (await Promise.all((await all('SELECT * FROM shop_purchases WHERE item_id = ? ORDER BY id DESC LIMIT 50', item.id)).map(async p => ({
    ...p, buyer_name: await memberName(ctx.house.id, p.buyer_id), turn_name: await memberName(ctx.house.id, p.turn_of),
  }))));
  return { ...await shopView(item, ctx), history };
});
route('PATCH', '/api/h/:hid/shop/items/:id', async ctx => {
  need(canSchedule(ctx.me), 'Só quem organiza a casa pode editar itens.');
  const item = await one('SELECT * FROM shop_items WHERE id = ? AND house_id = ?', int(ctx.params.id), ctx.house.id);
  need(item, 'Item não encontrado.', 404);
  if (ctx.body.archive) { await run('UPDATE shop_items SET active = 0 WHERE id = ?', item.id); return { ok: true }; }
  const it = await validateItem(ctx.body, ctx);
  await run('UPDATE shop_items SET name=?, icon=?, participants=?, next_index=?, payment_mode=?, notify_mode=?, credits=? WHERE id=?',
    it.name, it.icon, JSON.stringify(it.participants), it.next_index, it.payment_mode, it.notify_mode, '{}', item.id);
  return { ok: true };
});
route('POST', '/api/h/:hid/shop/items/:id/alert', async ctx => {
  const item = await one('SELECT * FROM shop_items WHERE id = ? AND house_id = ? AND active = 1', int(ctx.params.id), ctx.house.id);
  need(item, 'Item não encontrado.', 404);
  if (item.status === 'acabou') return { ok: true, already: true, item: await shopView(item, ctx) }; // ninguém gera pedido duplicado
  const next = await shopNext(item, ctx.house.id);
  await run("UPDATE shop_items SET status = 'acabou', alerted_by = ?, alerted_at = ? WHERE id = ? AND status = 'ok'", ctx.me.id, now(), item.id);
  const who = item.notify_mode === 'all' ? parse(item.participants, []) : [next];
  for (const mid of who) if (mid && mid !== ctx.me.id)
    await notify(ctx.house.id, mid, { kind: 'shop', title: `${item.name} acabou`, body: mid === next ? `${await memberName(ctx.house.id, ctx.me.id)} avisou. É a sua vez de comprar.` : `É a vez de ${await memberName(ctx.house.id, next)} comprar.`, link: `/compras/${item.id}` });
  return { ok: true, item: await shopView(await one('SELECT * FROM shop_items WHERE id = ?', item.id), ctx) };
});
route('POST', '/api/h/:hid/shop/items/:id/purchase', async ctx => {
  const item = await one('SELECT * FROM shop_items WHERE id = ? AND house_id = ? AND active = 1', int(ctx.params.id), ctx.house.id);
  need(item, 'Item não encontrado.', 404);
  const b = ctx.body, me = ctx.me, h = ctx.house;
  const next = await shopNext(item, h.id);
  const parts = parse(item.participants, []);
  // "Essa compra conta como a vez de quem?" — só pergunta quando quem compra não é o da vez
  let countsAs = 'turn';
  if (me.id !== next && b.counts_as === 'own' && parts.includes(me.id)) countsAs = 'own';
  const amount = b.amount_cents ? int(b.amount_cents) : null;
  need(amount === null || amount > 0, 'Valor inválido.', 400);
  const receipt = await ownFile(ctx, b.receipt_file_id, ['purchase']);
  const turnOf = countsAs === 'own' ? me.id : next;
  need(turnOf, 'Ninguém da fila deste item está na casa. Edite os participantes antes.', 400);
  const result = await tx(async () => {
    let state;
    if (countsAs === 'turn') state = await shopAdvance(item, h.id);
    else { const c = parse(item.credits, {}); c[me.id] = (c[me.id] || 0) + 1; state = { next_index: item.next_index, credits: c }; }
    await run("UPDATE shop_items SET next_index = ?, credits = ?, status = 'ok', alerted_by = NULL, alerted_at = NULL WHERE id = ?", state.next_index, JSON.stringify(state.credits), item.id);
    let expenseId = null;
    if (amount && item.payment_mode !== 'buyer') {
      const title = `${item.name} · comprado por ${await memberName(h.id, me.id)}`;
      if (item.payment_mode === 'split') {
        const base = Math.floor(amount / parts.length), rest = amount - base * parts.length;
        const shares = await filterAsync(parts.map((mid, i) => ({ member_id: mid, amount_cents: base + (i < rest ? 1 : 0) })), async s => !!(await activeMember(h.id, s.member_id)));
        const fix = amount - shares.reduce((a, s) => a + s.amount_cents, 0);
        if (shares.length) shares[0].amount_cents += fix;
        expenseId = await createExpense(ctx, { title, total: amount, due: localNow(h.timezone).date, shares, receiver: me.id, source: 'compra', housePaid: true, autoConfirm: me.id, category: 'compra' });
      } else {
        // pago com a caixinha: sai do caixa da rep
        await run('INSERT INTO cash_moves (house_id, kind, amount_cents, description, source, ref_id, file_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
          h.id, 'saida', amount, `${item.name} · comprado por ${await memberName(h.id, me.id)}`, 'compra', item.id, receipt, me.id, now());
      }
    }
    const r = await run('INSERT INTO shop_purchases (item_id, buyer_id, turn_of, counts_as, amount_cents, receipt_file_id, expense_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      item.id, me.id, turnOf, countsAs, amount, receipt, expenseId, me.id, now());
    return { purchase_id: Number(r.lastInsertRowid), expense_id: expenseId };
  });
  const after = await one('SELECT * FROM shop_items WHERE id = ?', item.id);
  const view = await shopView(after, ctx);
  const myName = await memberName(h.id, me.id);
  if (item.alerted_by && item.alerted_by !== me.id)
    await notify(h.id, item.alerted_by, { kind: 'shop', title: `${item.name} comprado`, body: view.next_name ? `${myName} comprou. Próxima vez: ${view.next_name}.` : `${myName} comprou.`, link: `/compras/${item.id}` });
  if (next && next !== me.id && countsAs === 'turn')
    await notify(h.id, next, { kind: 'shop', title: `${myName} comprou por você`, body: `A compra contou como a sua vez de ${item.name}.`, link: `/compras/${item.id}` });
  if (result.expense_id && item.payment_mode === 'split')
    for (const mid of parts) if (mid !== me.id)
      await notify(h.id, mid, { kind: 'expense', title: `Divisão: ${item.name}`, body: `${myName} comprou. Veja sua parte no Financeiro.`, link: `/despesa/${result.expense_id}` });
  return { ok: true, ...result, item: view };
});

// ---------- lembretes automáticos (a cada minuto) ----------
async function tick() {
  try {
    for (const house of await all('SELECT * FROM houses')) {
      const n = localNow(house.timezone), t = Date.now();
      const defaults = parse(house.notify_defaults, {});
      const tasks = new Map((await all('SELECT id, notify FROM tasks WHERE house_id = ?', house.id)).map(x => [x.id, parse(x.notify, null)]));
      for (const i of await instancesInRange(house, addDays(n.date, -1), n.date)) {
        if (i.completion || !i.assignee) continue;
        const cfg = { ...defaults, ...(tasks.get(i.task_id) || {}) };
        const link = `/tarefa/${i.task_id}/${i.date}`;
        if (cfg.assign && i.date === n.date && n.time >= '07:00' && t < i.due_ts)
          await notify(house.id, i.assignee, { kind: 'task', title: `Hoje é sua vez: ${i.name}`, body: deadlineLabel(i.date, i.due_time) + '.', link, dedupe: `a:${i.task_id}:${i.date}:${i.assignee}` });
        if (cfg.before && t >= i.due_ts - 2 * 3600e3 && t < i.due_ts)
          await notify(house.id, i.assignee, { kind: 'task', title: `Faltam menos de 2h: ${i.name}`, body: deadlineLabel(i.date, i.due_time) + '.', link, dedupe: `b:${i.task_id}:${i.date}:${i.assignee}` });
        if (cfg.after && t >= i.due_ts && t < i.due_ts + 12 * 3600e3)
          await notify(house.id, i.assignee, { kind: 'task', title: `Atrasada: ${i.name}`, body: `O prazo era ${deadlineLabel(i.date, i.due_time)}.`, link, dedupe: `o:${i.task_id}:${i.date}:${i.assignee}` });
      }
      for (const s of await all(`SELECT s.*, e.title, e.due_date FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
        WHERE e.house_id = ? AND s.status = 'pendente' AND e.due_date BETWEEN ? AND ?`, house.id, n.date, addDays(n.date, 3))) {
        const today = s.due_date === n.date;
        await notify(house.id, s.member_id, {
          kind: 'expense', title: today ? `Vence hoje: ${s.title}` : `Vence em breve: ${s.title}`,
          body: `Sua parte: R$ ${(s.amount_cents / 100).toFixed(2).replace('.', ',')}. Toque para informar o pagamento.`,
          link: `/despesa/${s.expense_id}`, dedupe: `d:${s.id}:${today ? 'hoje' : 'breve'}`,
        });
      }
    }
    for (const house of await all('SELECT * FROM houses WHERE caixinha_cents > 0')) await ensureCaixinha(house);
    await run('DELETE FROM idempotency WHERE created_at < ?', Date.now() - 86400e3);
  } catch (e) { console.error('tick', e); }
}

// ---------- servidor HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError(413, `Arquivo grande demais (máximo ${Math.round(limit / 1048576)} MB).`)); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function sendJson(res, status, obj) {
  if (res.headersSent) return;
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function serveStatic(req, res, pathname) {
  let p = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) p = '/index.html';
  const target = p === '/index.html' ? path.join(PUBLIC_DIR, 'index.html') : file;
  res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(target).pipe(res);
}

// Processa uma requisição. Localmente roda no http.createServer; na Vercel é a função api/index.mjs.
let waitUntil = p => p;
if (ON_VERCEL) { try { ({ waitUntil } = await import('@vercel/functions')); } catch {} }
let lastTick = 0;
export function handler(req, res) {
  return reqStore.run({}, async () => {
    try { await handle(req, res); }
    finally {
      // garante que as notificações saiam antes da função "dormir"
      if (pending.size) waitUntil(Promise.allSettled([...pending]));
      // lembretes por horário: também roda de carona nas visitas (no máximo a cada 2 min)
      if (ON_VERCEL && Date.now() - lastTick > 120e3) { lastTick = Date.now(); waitUntil(reqStore.run({}, () => tick())); }
    }
  });
}
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/cron') {
    // chamado pelo agendador (Supabase pg_cron / Vercel Cron) para enviar lembretes
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.authorization !== `Bearer ${secret}` && url.searchParams.get('key') !== secret) { res.writeHead(401); return res.end(); }
    lastTick = Date.now();
    await tick();
    if (pending.size) await Promise.allSettled([...pending]);
    return sendJson(res, 200, { ok: true, at: new Date().toISOString() });
  }
  if (url.pathname === '/qr.svg') {
    // QR só de endereços deste próprio servidor
    const u = url.searchParams.get('u') || '';
    const okUrl = QR && shareUrls().some(base => u === base || u.startsWith(base + '/'));
    if (!okUrl) { res.writeHead(404); return res.end(); }
    const svg = await QR.toString(u, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0e4d1f', light: '#ffffff' } });
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    return res.end(svg);
  }
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
  let idemKey = null, userId = null;
  try {
    const r = routes.find(r => r.method === req.method && r.re.test(url.pathname));
    if (!r) fail(404, 'Rota não encontrada.');
    if (req.method !== 'GET') need(req.headers['x-requested-with'] === 'republica', 'Requisição recusada.', 403);
    const ctx = { req, res, query: Object.fromEntries(url.searchParams), params: {}, body: {} };
    const m = url.pathname.match(r.re);
    r.keys.forEach((k, i) => (ctx.params[k] = decodeURIComponent(m[i + 1])));
    const sid = cookies(req).sid;
    const sess = sid ? await one('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?', sid) : null;
    if (!r.opts.public) need(sess, 'Entre na sua conta.', 401);
    ctx.user = sess;
    if (ctx.params.hid) {
      // isolamento entre repúblicas: só morador ativo da casa acessa qualquer coisa dela
      ctx.house = await one('SELECT * FROM houses WHERE id = ?', int(ctx.params.hid));
      ctx.me = effective(ctx.house && await one('SELECT * FROM members WHERE house_id = ? AND user_id = ? AND active = 1', ctx.house.id, sess.id));
      need(ctx.house && ctx.me, 'Casa não encontrada.', 404);
    }
    if (req.method !== 'GET') {
      const buf = await readBody(req, r.opts.raw ? (ON_VERCEL ? 4 * 1024 * 1024 : 10 * 1024 * 1024) : 1024 * 1024);
      if (r.opts.raw) ctx.raw = buf;
      else if (buf.length) { try { ctx.body = JSON.parse(buf.toString('utf8')); } catch { fail(400, 'JSON inválido.'); } }
      if (!ctx.body || typeof ctx.body !== 'object') ctx.body = {};
      // toque repetido / reenvio por conexão ruim: mesma chave devolve a mesma resposta
      const k = req.headers['x-idem'];
      if (k && sess && req.method === 'POST') {
        userId = sess.id;
        const prev = await one('SELECT * FROM idempotency WHERE key = ? AND user_id = ?', String(k).slice(0, 80), userId);
        if (prev) {
          if (prev.status === null) return sendJson(res, 409, { error: 'Essa ação ainda está sendo processada.' });
          return sendJson(res, prev.status, JSON.parse(prev.body));
        }
        try { await run('INSERT INTO idempotency (key, user_id, created_at) VALUES (?,?,?)', String(k).slice(0, 80), userId, now()); }
        catch (e) { if (isUniqueError(e)) return sendJson(res, 409, { error: 'Essa ação ainda está sendo processada.' }); throw e; }
        idemKey = String(k).slice(0, 80);
      }
    }
    const out = await r.handler(ctx);
    if (out !== undefined) {
      if (idemKey) await run('UPDATE idempotency SET status = 200, body = ? WHERE key = ? AND user_id = ?', JSON.stringify(out), idemKey, userId);
      sendJson(res, 200, out);
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    const body = { error: status === 500 ? 'Algo deu errado no servidor. Tente de novo.' : e.message };
    if (idemKey) {
      if (status >= 500) await run('DELETE FROM idempotency WHERE key = ? AND user_id = ?', idemKey, userId);
      else await run('UPDATE idempotency SET status = ?, body = ? WHERE key = ? AND user_id = ?', status, JSON.stringify(body), idemKey, userId);
    }
    sendJson(res, status, body);
  }
}

if (!ON_VERCEL) http.createServer(handler).listen(PORT, '0.0.0.0', async () => {
  const urls = lanUrls();
  console.log(`\n  República rodando:\n  - neste computador: http://localhost:${PORT}`);
  for (const u of urls) console.log(`  - no celular (mesmo Wi-Fi): ${u}`);
  console.log(pushPublicKey() ? '  - push no celular: ativado (precisa de HTTPS fora do localhost)' : '  - push no celular: desativado (rode "npm install" para ativar)');
  if (QR && urls[0]) {
    console.log('\n  Aponte a câmera do celular para abrir:\n');
    console.log((await QR.toString(urls[0], { type: 'terminal', small: true })).replace(/^/gm, '    '));
  }
  console.log('');
  await tick();
  setInterval(tick, 60e3);
});
