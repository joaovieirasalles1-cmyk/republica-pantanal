// Cria a República Pantanal (apaga os dados atuais).
// Uso: npm run demo
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA = process.env.DATA_DIR || path.join(import.meta.dirname, 'data');
// mantém as chaves de push (senão os celulares inscritos param de receber)
const vapidFile = path.join(DATA, 'vapid.json');
const vapid = fs.existsSync(vapidFile) ? fs.readFileSync(vapidFile) : null;
fs.rmSync(DATA, { recursive: true, force: true });
if (vapid) { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(vapidFile, vapid); }
const { run, one } = await import('./lib/db.mjs');
const { localNow, addDays, weekday, zonedToUtc } = await import('./lib/time.mjs');

// --limpo: só o que é real (casa, moradores, cargos, ambientes, regras, escala a partir de hoje e itens de compra)
const LIMPO = process.argv.includes('--limpo');
const TZ = 'America/Sao_Paulo';
const now = Date.now();
const today = localNow(TZ).date;
const hash = pw => { const s = crypto.randomBytes(16).toString('hex'); return s + ':' + crypto.scryptSync(pw, s, 64).toString('hex'); };
const id = r => Number(r.lastInsertRowid);

// casa (caixinha: R$ 50 por morador, vence dia 10)
const hid = id(await run(`INSERT INTO houses (name, timezone, accent, home_title, shop_title, invite_code, payment_info, caixinha_cents, caixinha_day, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  'República Pantanal', TZ, '#1b7f2a', 'Painel Pantanal', 'Compras da Pantanal', 'pantanal-demo',
  LIMPO ? null : 'Pix: (o Passa cadastra a chave em Contas → Dados para pagamento)\nConta da rep no nome do Passa', LIMPO ? 0 : 5000, 10, now));

// moradores (senha de todos: 123456)
//   Veterano Master: Faiska (tudo, inclusive financeiro e cargos)
//   Financeiro: Passa (contas, anexos, confirma pagamentos, caixinha)
//   Moradores: Zago, Zara, Paviu, Sedex, Pegada
const people = [
  ['Faiska', 'faiska', { is_admin: 1, can_schedule: 1, can_review: 1, can_finance: 1 }],
  ['Passa', 'passa', { can_finance: 1 }],
  ['Zago', 'zago', {}],
  ['Zara', 'zara', {}],
  ['Paviu', 'paviu', {}],
  ['Sedex', 'sedex', {}],
  ['Pegada', 'pegada', {}],
];
const M = {};
for (const [name, email, p] of people) {
  const uid = id(await run('INSERT INTO users (email, password_hash, name, created_at) VALUES (?,?,?,?)', email, hash('123456'), name, now));
  M[name] = id(await run('INSERT INTO members (house_id, user_id, is_admin, can_schedule, can_review, can_finance, joined_at) VALUES (?,?,?,?,?,?,?)',
    hid, uid, p.is_admin || 0, p.can_schedule || 0, p.can_review || 0, p.can_finance || 0, now - 60 * 864e5));
}
const ALL = Object.values(M);

// foto da casa = selo da Pantanal (vai para a pasta privada de anexos, como um upload normal)
{
  const { UPLOAD_DIR } = await import('./lib/db.mjs');
  const src = path.join(import.meta.dirname, 'public', 'brand', 'badge.webp');
  if (fs.existsSync(src)) {
    const disk = crypto.randomBytes(16).toString('hex');
    fs.copyFileSync(src, path.join(UPLOAD_DIR, disk));
    const fid = id(await run('INSERT INTO files (house_id, uploader_id, kind, mime, size, disk_name, created_at) VALUES (?,?,?,?,?,?,?)', hid, M.Faiska, 'house', 'image/webp', fs.statSync(src).size, disk, now));
    await run('UPDATE houses SET photo_file_id = ? WHERE id = ?', fid, hid);
  }
}

// ambientes
const E = {};
for (const [n, i] of [['Cozinha', 'kitchen'], ['Banheiro', 'bath'], ['Sala', 'sofa'], ['Área de serviço', 'laundry'], ['Quintal', 'leaf']])
  E[n] = id(await run('INSERT INTO environments (house_id, name, icon) VALUES (?,?,?)', hid, n, i));

// regras da casa
const rule = async (title, env, label, subject, dl, desc = null) =>
  id(await run('INSERT INTO rules (house_id, title, description, environment_id, occurrence_label, subject, deadline_time, created_at) VALUES (?,?,?,?,?,?,?,?)', hid, title, desc, env, label, subject, dl, now));
await rule('Cada morador deve lavar a própria louça até o fim do dia', E['Cozinha'], 'Louça não lavada', 'a louça', '24:00',
  'Vale para prato, copo e talher de uso pessoal. A louça do jantar coletivo é tarefa de quem está escalado.');
await rule('Não deixar panela suja no fogão de um dia para o outro', E['Cozinha'], 'Panela suja no fogão', 'a panela no fogão', '24:00');
await rule('Roupa no varal comum por no máximo 2 dias', E['Área de serviço'], 'Roupa esquecida no varal', 'a roupa no varal', null);
await rule('Silêncio depois das 23h em dias de semana', E['Sala'], 'Barulho depois das 23h', 'o barulho na sala', null);
const banho = await rule('Recolher o próprio cabelo do ralo após o banho', E['Banheiro'], 'Cabelo no ralo', 'o cabelo no ralo', null);

// tarefas — começam na segunda passada
const wd = weekday(today);
const lastMonday = LIMPO ? today : addDays(today, -((wd + 6) % 7) - 7);
const task = async (name, env, rec, days, due, mode, who, photo = 0) =>
  id(await run(`INSERT INTO tasks (house_id, name, environment_id, recurrence, weekdays, due_time, start_date, assign_mode, fixed_member_id, rotation, require_photo, created_by, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, hid, name, env, rec, JSON.stringify(days), due, lastMonday, mode,
    mode === 'fixed' ? who : null, mode === 'rotation' ? JSON.stringify(who) : '[]', photo, M.Faiska, now));
await task('Lavar a louça do jantar', E['Cozinha'], 'daily', [], '23:00', 'rotation', [M.Zago, M.Zara, M.Paviu, M.Sedex, M.Pegada, M.Passa, M.Faiska]);
await task('Tirar o lixo', E['Quintal'], 'weekdays', [1, 3, 5], '21:00', 'rotation', [M.Pegada, M.Sedex, M.Zago, M.Zara, M.Paviu]);
await task('Limpar o banheiro', E['Banheiro'], 'weekly', [], '18:00', 'rotation', [M.Paviu, M.Zara, M.Sedex, M.Zago, M.Pegada], 1);
await task('Lavar panos de prato e toalhas da casa', E['Área de serviço'], 'weekdays', [0], '20:00', 'fixed', M.Zara);
await task('Limpar a cozinha (fogão e bancada)', E['Cozinha'], 'weekdays', [2, 6], '20:00', 'rotation', [M.Sedex, M.Pegada, M.Zago, M.Paviu]);

// conclusões do passado (alguns atrasos de propósito)
if (!LIMPO) {
const { instancesInRange } = await import('./lib/schedule.mjs');
const house = await one('SELECT * FROM houses WHERE id = ?', hid);
let k = 0;
for (const i of await instancesInRange(house, lastMonday, addDays(today, -1))) {
  k++;
  if (k % 7 === 3) continue; // esquecida: fica atrasada no nome da pessoa
  const late = k % 5 === 0 ? 45 * 60e3 : -(30 + (k % 4) * 20) * 60e3;
  await run('INSERT INTO task_completions (task_id, date, member_id, completed_at) VALUES (?,?,?,?)', i.task_id, i.date, i.assignee, i.due_ts + late);
}

// uma ocorrência contestada, esperando revisão (o Faiska revisa)
const y = addDays(today, -1);
const created = zonedToUtc(today, '00:15', TZ);
const occ = id(await run(`INSERT INTO occurrences (house_id, rule_id, environment_id, type_label, ref_date, reported_by, assigned_member_id, note, status, response, created_at, updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, hid, banho, E['Banheiro'], 'Cabelo no ralo', y, M.Zago, M.Sedex, 'Depois do banho das 22h.', 'em_revisao', 'nao_era_minha', created, created + 3600e3));
await run('INSERT INTO occurrence_events (occurrence_id, actor_id, action, from_status, to_status, to_member, created_at) VALUES (?,?,?,?,?,?,?)', occ, M.Zago, 'registrou', null, 'aguardando', M.Sedex, created);
await run('INSERT INTO occurrence_events (occurrence_id, actor_id, action, from_status, to_status, note, created_at) VALUES (?,?,?,?,?,?,?)', occ, M.Sedex, 'contestou', 'aguardando', 'em_revisao', 'Ontem eu tomei banho de manhã, não à noite.', created + 3600e3);
await run('INSERT INTO notifications (house_id, member_id, kind, title, body, link, created_at) VALUES (?,?,?,?,?,?,?)', hid, M.Faiska, 'occurrence', 'Ocorrência contestada',
  'Sedex disse que não era dele(a): o cabelo no ralo de ' + ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][weekday(y)] + '. Analise.', `/ocorrencia/${occ}`, created + 3600e3);
}

// compras da casa
const item = async (name, icon, parts, next, pay, notifyMode = 'turn') =>
  id(await run('INSERT INTO shop_items (house_id, name, icon, participants, next_index, payment_mode, notify_mode, created_at) VALUES (?,?,?,?,?,?,?,?)',
    hid, name, icon, JSON.stringify(parts), parts.indexOf(next), pay, notifyMode, now));
const agua = await item('Galão de água', 'droplet', ALL, M.Zara, 'buyer');
await item('Gás', 'flame', ALL, M.Paviu, 'split');
await item('Papel higiênico', 'roll', ALL, M.Pegada, 'house');
await item('Café', 'coffee', [M.Faiska, M.Zago, M.Sedex, M.Pegada], M.Sedex, 'buyer');
if (!LIMPO) await run('INSERT INTO shop_purchases (item_id, buyer_id, turn_of, counts_as, created_by, created_at) VALUES (?,?,?,?,?,?)', agua, M.Zago, M.Zago, 'turn', M.Zago, now - 4 * 864e5);

if (LIMPO) {
  console.log('\nRepública Pantanal criada (versão limpa).');
  for (const [n, e, p] of people) console.log(`  ${n.padEnd(7)} usuário: ${e.padEnd(8)} ${p.is_admin ? 'Veterano Master' : p.can_finance ? 'Financeiro' : 'Morador'}`);
  process.exit(0);
}

// financeiro (lançado pelo Passa)
const ym = today.slice(0, 7);
const mes = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(new Date(ym + '-15T12:00:00Z'));
const exp = async (title, total, due, shares, category = 'outro', paid = false, source = null) => {
  const eid = id(await run('INSERT INTO expenses (house_id, title, total_cents, due_date, created_by, category, house_paid, house_paid_at, paid_by, source, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    hid, title, total, due, M.Passa, category, paid ? 1 : 0, paid ? now - 3 * 864e5 : null, paid ? M.Passa : null, source, now - 10 * 864e5));
  for (const [m, v, st] of shares)
    await run('INSERT INTO expense_shares (expense_id, member_id, amount_cents, status, informed_at, confirmed_by, confirmed_at) VALUES (?,?,?,?,?,?,?)',
      eid, m, v, st, st !== 'pendente' ? now - 2 * 864e5 : null, st === 'confirmado' ? M.Passa : null, st === 'confirmado' ? now - 864e5 : null);
  return eid;
};
// aluguel com quartos de valores diferentes (total R$ 3.500)
await exp(`Aluguel de ${mes}`, 350000, addDays(today, 3), [
  [M.Faiska, 55000, 'confirmado'], [M.Passa, 50000, 'confirmado'], [M.Zago, 50000, 'informado'], [M.Zara, 50000, 'pendente'],
  [M.Paviu, 50000, 'confirmado'], [M.Sedex, 50000, 'pendente'], [M.Pegada, 45000, 'pendente']], 'aluguel');
await exp(`Internet de ${mes}`, 14000, addDays(today, 10), ALL.map(m => [m, 2000, m === M.Passa ? 'confirmado' : 'pendente']), 'internet');
await exp(`Água de ${mes}`, 21000, addDays(today, -2), ALL.map(m => [m, 3000, 'confirmado']), 'agua', true);
await exp(`Luz de ${mes}`, 38500, addDays(today, 6), ALL.map(m => [m, 5500, m === M.Passa || m === M.Faiska ? 'confirmado' : 'pendente']), 'luz');
await exp('Mercado da semana', 24000, addDays(today, -1), [[M.Zago, 8000, 'confirmado'], [M.Zara, 8000, 'pendente'], [M.Pegada, 8000, 'informado']], 'mercado');

// caixinha: mês passado fechado, mês atual em andamento + alguns gastos
const prev = addDays(ym + '-01', -1).slice(0, 7);
const prevName = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(new Date(prev + '-15T12:00:00Z'));
await exp(`Caixinha de ${prevName}`, 5000 * ALL.length, `${prev}-10`, ALL.map(m => [m, 5000, 'confirmado']), 'caixinha', false, `caixinha:${prev}`);
await exp(`Caixinha de ${mes}`, 5000 * ALL.length, `${ym}-10`, ALL.map(m => [m, 5000, [M.Faiska, M.Passa, M.Zago, M.Paviu].includes(m) ? 'confirmado' : m === M.Zara ? 'informado' : 'pendente']), 'caixinha', false, `caixinha:${ym}`);
const move = async (kind, cents, desc, daysAgo) => await run('INSERT INTO cash_moves (house_id, kind, amount_cents, description, source, created_by, created_at) VALUES (?,?,?,?,?,?,?)', hid, kind, cents, desc, 'manual', M.Passa, now - daysAgo * 864e5);
await move('saida', 8900, 'Produtos de limpeza', 12);
await move('saida', 4500, 'Lâmpadas da sala e do quintal', 6);
await move('entrada', 3000, 'Sobra da vaquinha do churrasco', 5);

console.log(`\nRepública Pantanal criada.\nEntre com qualquer morador (senha 123456):`);
for (const [n, e, p] of people) console.log(`  ${n.padEnd(7)} ${('usuário: ' + e).padEnd(20)} ${p.is_admin ? 'Veterano Master' : p.can_finance ? 'Financeiro' : 'Morador'}`);
console.log(`\nLink de convite: /#/convite/pantanal-demo\n`);
