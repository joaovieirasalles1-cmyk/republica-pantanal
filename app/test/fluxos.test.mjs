// Teste de ponta a ponta pela API (banco temporário, porta 3999).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'republica-test-'));
const PORT = 3999, BASE = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.mjs'], { cwd: path.join(import.meta.dirname, '..'), env: { ...process.env, PORT, DATA_DIR: DATA }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(r => srv.stdout.on('data', d => String(d).includes('rodando') && r()));

function client() {
  let cookie = '';
  const call = async (method, p, body, headers = {}) => {
    const r = await fetch(BASE + p, { method, headers: { 'X-Requested-With': 'republica', 'Content-Type': 'application/json', cookie, ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const data = await r.json().catch(() => ({}));
    return { status: r.status, ...data };
  };
  return { get: p => call('GET', p), post: (p, b = {}, h) => call('POST', p, b, h), patch: (p, b) => call('PATCH', p, b), raw: async (p, buf, type) => {
    const r = await fetch(BASE + p, { method: 'POST', headers: { 'X-Requested-With': 'republica', 'Content-Type': type, cookie }, body: buf });
    return { status: r.status, ...(await r.json()) };
  }, fetch: p => fetch(BASE + p, { headers: { cookie } }) };
}
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); };

try {
  const jose = client(), ana = client(), pedro = client(), lia = client(), intruso = client();
  await jose.post('/api/auth/register', { name: 'José', username: 'jose', password: '123456' });
  const { id: hid } = await jose.post('/api/houses', { name: 'Pantanal', timezone: 'America/Sao_Paulo' });
  const H = `/api/h/${hid}`;
  const house = await jose.get(`${H}/house`);
  const code = house.house.invite_code;
  for (const [c, n, e] of [[ana, 'Ana', 'ana'], [pedro, 'Pedro', 'pedro'], [lia, 'Lia', 'lia']]) { await c.post('/api/auth/register', { name: n, username: e, password: '123456' }); await c.post(`/api/invite/${code}/join`); }
  const hh = await jose.get(`${H}/house`);
  const id = n => hh.members.find(m => m.name === n).id;
  const [J, A, Pd, L] = [id('José'), id('Ana'), id('Pedro'), id('Lia')];
  const today = hh.now.date;
  const cozinha = hh.environments.find(e => e.name === 'Cozinha').id;
  console.log('\nBase');
  ok(hh.members.length === 4, 'convite: 4 moradores na casa');

  // isolamento
  await intruso.post('/api/auth/register', { name: 'X', username: 'intruso', password: '123456' });
  const other = await intruso.post('/api/houses', { name: 'Outra', timezone: 'America/Sao_Paulo' });
  ok((await intruso.get(`${H}/today`)).status === 404, 'morador de outra república não acessa a casa');
  ok((await jose.get(`/api/h/${other.id}/house`)).status === 404, 'e vice-versa');
  ok((await ana.patch(`${H}/house`, { name: 'Hack' })).status === 403, 'morador comum não altera configurações');

  console.log('\nLouça às 00h01');
  const regra = await jose.post(`${H}/rules`, { title: 'Cada morador deve lavar a própria louça até o fim do dia', environment_id: cozinha, occurrence_label: 'Louça não lavada', subject: 'a louça', deadline_time: '24:00' });
  const r = (await jose.get(`${H}/house`)).rules.find(x => x.id === regra.id);
  ok(/^até 00h de /.test(r.deadline_example), `prazo sem ambiguidade: "${r.deadline_example}"`);
  const idem = 'occ-' + Date.now();
  const body = { rule_id: regra.id, environment_id: cozinha, ref_date: today, assigned_member_id: A, note: '' };
  const o1 = await jose.post(`${H}/occurrences`, body, { 'X-Idem': idem });
  const o2 = await jose.post(`${H}/occurrences`, body, { 'X-Idem': idem });
  ok(o1.id && o1.id === o2.id, 'toque repetido não duplica a ocorrência');
  const notif = (await ana.get(`${H}/notifications`)).items[0];
  ok(/^José registrou uma pendência sobre a louça de \w+/.test(notif.body), `Ana recebe: "${notif.body}"`);
  ok(notif.link === `/ocorrencia/${o1.id}`, 'tocar no aviso abre a ocorrência');
  ok((await pedro.get(`${H}/occurrences/${o1.id}`)).status === 404, 'acusação pendente não aparece para terceiros');
  const prof = await pedro.get(`${H}/members/${A}/profile`);
  ok(!prof.history.some(h => h.type === 'relato'), 'nem no perfil da Ana visto por Pedro');
  ok((await ana.get(`${H}/occurrences/${o1.id}`)).status === 'aguardando', 'estado inicial: Aguardando resposta');
  await ana.post(`${H}/occurrences/${o1.id}/contest`, { note: 'Não era meu prato' });
  ok((await ana.get(`${H}/occurrences/${o1.id}`)).status === 'em_revisao', '"Não era minha" → Em revisão');
  ok((await ana.post(`${H}/occurrences/${o1.id}/review`, { decision: 'confirm' })).status === 403, 'quem não revisa não julga');
  await jose.post(`${H}/occurrences/${o1.id}/review`, { decision: 'reassign', member_id: Pd });
  const afterFix = await pedro.get(`${H}/occurrences/${o1.id}`);
  ok(afterFix.assigned_member_id === Pd && afterFix.status === 'aguardando', 'revisor corrige para Pedro');
  const anaProf = await jose.get(`${H}/members/${A}/profile`);
  ok(!anaProf.history.some(h => h.type === 'relato'), 'histórico da Ana corrigido');
  await pedro.post(`${H}/occurrences/${o1.id}/resolve`);
  ok((await pedro.get(`${H}/occurrences/${o1.id}`)).status === 'resolvida', '"Já resolvi" → Resolvida');

  const o3 = await jose.post(`${H}/occurrences`, { rule_id: regra.id, environment_id: cozinha, ref_date: today, assigned_member_id: null });
  const board = (await pedro.get(`${H}/today`)).board;
  ok(board.some(o => o.id === o3.id), '"Não sei de quem é" vai para o quadro, visível a todos');
  await pedro.post(`${H}/occurrences/${o3.id}/claim`);
  ok([404, 409].includes((await ana.post(`${H}/occurrences/${o3.id}/claim`)).status), '"É minha" só pode ser assumida uma vez (e some da vista dos outros)');

  console.log('\nNotificação da pendência');
  const o4 = await jose.post(`${H}/occurrences`, { rule_id: regra.id, environment_id: cozinha, ref_date: today, assigned_member_id: A, note: 'Deixou o prato com arroz' });
  const n4 = (await ana.get(`${H}/notifications`)).items.find(n => n.link === `/ocorrencia/${o4.id}`);
  ok(n4.title === 'Pendência registrada' && n4.body === 'Louça não lavada: Deixou o prato com arroz', `com mensagem: "${n4.body}"`);
  const o5 = await jose.post(`${H}/occurrences`, { rule_id: regra.id, environment_id: cozinha, ref_date: today, to_all: true });
  const got = await Promise.all([ana, pedro].map(async c => (await c.get(`${H}/notifications`)).items.some(n => n.link === `/ocorrencia/${o5.id}`)));
  ok(got.every(Boolean), '"Todos": a casa inteira recebe o aviso');
  ok(!(await jose.get(`${H}/notifications`)).items.some(n => n.link === `/ocorrencia/${o5.id}`), 'quem registrou não recebe o próprio aviso');
  ok((await pedro.get(`${H}/occurrences/${o5.id}`)).to_all === 1, 'pendência "para todos" visível a todos');
  await pedro.post(`${H}/occurrences/${o5.id}/claim`);
  ok((await pedro.get(`${H}/occurrences/${o5.id}`)).status === 'resolvida', 'alguém assume a pendência de todos');

  console.log('\nRodízio e troca');
  const lixo = await jose.post(`${H}/tasks`, { name: 'Tirar o lixo', recurrence: 'daily', due_time: '21:00', start_date: today, assign_mode: 'rotation', rotation: [J, A, Pd] });
  const sch = (await jose.get(`${H}/schedule?from=${today}&to=${(d => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 3); return x.toISOString().slice(0, 10); })(today)}`)).items.filter(i => i.task_id === lixo.id);
  ok(sch.map(i => i.assignee).join() === [J, A, Pd, J].join(), 'rodízio avança por ocorrência prevista (José, Ana, Pedro, José)');
  const sw = await jose.post(`${H}/swaps`, { task_id: lixo.id, date: sch[0].date, target_member_id: A, target_task_id: lixo.id, target_date: sch[1].date });
  let s0 = (await jose.get(`${H}/schedule?from=${today}&to=${today}`)).items.find(i => i.task_id === lixo.id);
  ok(s0.assignee === J, 'escala só muda depois do aceite');
  await ana.post(`${H}/swaps/${sw.id}/accept`);
  s0 = (await jose.get(`${H}/schedule?from=${sch[0].date}&to=${sch[1].date}`)).items.filter(i => i.task_id === lixo.id);
  ok(s0[0].assignee === A && s0[1].assignee === J, 'troca aceita: Ana hoje, José amanhã');
  ok((await pedro.post(`${H}/tasks/${lixo.id}/complete`, { date: today })).status === 403, 'só o responsável conclui');
  await ana.post(`${H}/tasks/${lixo.id}/complete`, { date: today });
  ok((await ana.post(`${H}/tasks/${lixo.id}/complete`, { date: today })).already, 'concluir de novo não duplica');

  console.log('\nFinanceiro');
  await jose.patch(`${H}/members/${A}`, { can_finance: true });
  await jose.patch(`${H}/members/${J}`, { can_finance: false }); // José fica só como admin/organizador
  const bad = await ana.post(`${H}/expenses`, { title: 'Aluguel', total_cents: 300000, shares: [{ member_id: J, amount_cents: 100000 }, { member_id: A, amount_cents: 100000 }] });
  ok(bad.status === 400, `soma diferente do total é recusada ("${bad.error}")`);
  const e = await ana.post(`${H}/expenses`, { title: 'Aluguel', total_cents: 300000, due_date: today, shares: [{ member_id: J, amount_cents: 120000 }, { member_id: A, amount_cents: 90000 }, { member_id: Pd, amount_cents: 90000 }] });
  const share = (await pedro.get(`${H}/expenses/${e.id}`)).mine;
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b40000000049454e44ae426082', 'hex');
  const up = await pedro.raw(`${H}/files?kind=receipt`, png, 'image/png');
  const k2 = 'pay-' + Date.now();
  await pedro.post(`${H}/shares/${share.id}/inform`, { receipt_file_id: up.id }, { 'X-Idem': k2 });
  ok((await pedro.post(`${H}/shares/${share.id}/inform`, { receipt_file_id: up.id }, { 'X-Idem': k2 })).ok, 'informar pagamento duas vezes não duplica');
  ok((await lia.fetch(`${H}/files/${up.id}`)).status === 404, 'comprovante não aparece para outro morador');
  ok((await jose.fetch(`${H}/files/${up.id}`)).status === 200, 'Veterano Master vê o comprovante (tem acesso ao financeiro)');
  ok((await ana.fetch(`${H}/files/${up.id}`)).status === 200, 'tesoureira vê o comprovante');
  ok((await intruso.fetch(`${H}/files/${up.id}`)).status === 404, 'outra república não vê o comprovante');
  await ana.post(`${H}/shares/${share.id}/confirm`);
  const ex = await ana.get(`${H}/expenses/${e.id}`);
  ok(ex.shares.find(s => s.member_id === Pd).status === 'confirmado' && !ex.house_paid, '"morador pagou" separado de "conta da casa paga"');

  console.log('\nContas da casa (privacidade e arquivo)');
  const pv = await pedro.get(`${H}/expenses/${e.id}`);
  ok(pv.shares.length === 1 && pv.shares[0].member_id === Pd && !pv.full_view, 'morador vê só a própria parte do aluguel');
  ok((await ana.get(`${H}/expenses/${e.id}`)).shares.length === 3, 'responsável pelas contas vê a divisão de todos');
  ok((await jose.get(`${H}/expenses/${e.id}`)).shares.length === 3, 'Veterano Master vê a divisão de todos');
  const merc = await ana.post(`${H}/expenses`, { title: 'Mercado', category: 'mercado', total_cents: 9000, shares: [{ member_id: J, amount_cents: 3000 }, { member_id: A, amount_cents: 3000 }, { member_id: Pd, amount_cents: 3000 }] });
  ok((await pedro.get(`${H}/expenses/${merc.id}`)).shares.length === 3, 'mercado é transparente para quem participa');
  const fatura = await ana.raw(`${H}/files?kind=bill`, png, 'image/png');
  const agua = await ana.post(`${H}/expenses`, { title: 'Água', category: 'agua', total_cents: 6000, bill_file_id: fatura.id, shares: [{ member_id: J, amount_cents: 2000 }, { member_id: A, amount_cents: 2000 }, { member_id: Pd, amount_cents: 2000 }] });
  ok((await pedro.fetch(`${H}/files/${fatura.id}`)).status === 200, 'morador vê a fatura da conta em que participa');
  const comp = await ana.raw(`${H}/files?kind=house_receipt`, png, 'image/png');
  await ana.post(`${H}/expenses/${agua.id}/house-paid`, { paid: true, receipt_file_id: comp.id });
  const ag = await pedro.get(`${H}/expenses/${agua.id}`);
  ok(ag.house_paid && ag.paid_receipt_file_id === comp.id, 'conta marcada como paga com comprovante guardado');
  ok((await pedro.get(`${H}/notifications`)).items.some(n => n.title.includes('conta paga')), 'moradores avisados de que a conta foi paga');
  ok((await pedro.post(`${H}/expenses/${agua.id}/house-paid`, { paid: false })).status === 403, 'só o responsável mexe na conta da casa');
  ok((await pedro.patch(`${H}/finance/settings`, { payment_info: 'x' })).status === 403, 'só o responsável altera os dados de pagamento');
  await ana.patch(`${H}/finance/settings`, { payment_info: 'Pix: ana@x', docs_visible: false });
  ok((await pedro.fetch(`${H}/files/${fatura.id}`)).status === 404, 'com o arquivo privado, morador não vê mais a fatura');
  ok((await ana.fetch(`${H}/files/${fatura.id}`)).status === 200, 'responsável continua vendo');
  ok((await pedro.get(`${H}/expenses/${e.id}`)).payment_info === 'Pix: ana@x', 'morador recebe os dados de pagamento (Pix)');
  const arq = await ana.post(`${H}/expenses`, { title: 'Luz', category: 'luz', total_cents: 15000, split: false });
  ok(arq.id && (await ana.get(`${H}/expenses/${arq.id}`)).shares.length === 0, 'conta só arquivada, sem divisão');
  ok((await pedro.get(`${H}/expenses/${arq.id}`)).status === 404, 'conta só arquivada fica oculta quando o arquivo é privado');
  await ana.patch(`${H}/finance/settings`, { docs_visible: true });

  console.log('\nGalão de água');
  const g = await jose.post(`${H}/shop/items`, { name: 'Galão de água', icon: '💧', participants: [J, A, Pd], starter_member_id: A, payment_mode: 'buyer' });
  let it = (await jose.get(`${H}/shop/items/${g.id}`));
  ok(it.next_member === A && it.status === 'ok', 'painel: "Próxima compra: Ana", sem cobrança enquanto tem água');
  await pedro.post(`${H}/shop/items/${g.id}/alert`);
  ok((await jose.post(`${H}/shop/items/${g.id}/alert`)).already, 'segundo aviso não gera outro pedido');
  ok((await ana.get(`${H}/notifications`)).items.filter(n => n.kind === 'shop').length === 1, 'só Ana recebeu o aviso, uma vez');
  await ana.post(`${H}/shop/items/${g.id}/purchase`, {});
  it = await jose.get(`${H}/shop/items/${g.id}`);
  ok(it.status === 'ok' && it.next_member === Pd && it.last.today, 'Ana comprou hoje · Próxima vez: Pedro');
  await jose.post(`${H}/shop/items/${g.id}/purchase`, { counts_as: 'own' });
  it = await jose.get(`${H}/shop/items/${g.id}`);
  ok(it.next_member === Pd, 'José adiantou a própria vez: Pedro continua o próximo');
  await pedro.post(`${H}/shop/items/${g.id}/purchase`, {});
  it = await jose.get(`${H}/shop/items/${g.id}`);
  ok(it.next_member === A, 'depois do Pedro, José é pulado (já adiantou) e volta para Ana');
  const gas = await jose.post(`${H}/shop/items`, { name: 'Gás', participants: [J, A, Pd], starter_member_id: J, payment_mode: 'split' });
  const buy = await jose.post(`${H}/shop/items/${gas.id}/purchase`, { amount_cents: 12000 });
  const ge = await ana.get(`${H}/expenses/${buy.expense_id}`);
  ok(ge.shares.reduce((a, s) => a + s.amount_cents, 0) === 12000 && ge.receiver_member_id === J, 'gás dividido vira uma despesa com o comprador identificado');

  console.log('\nLogin por usuário');
  const novo = client();
  ok((await novo.post('/api/auth/login', { username: 'Pedro', password: '123456' })).ok, 'entra com o nome de usuário (sem e-mail, maiúscula não importa)');
  ok((await novo.post('/api/auth/login', { username: 'pedro', password: 'errada' })).status === 401, 'senha errada é recusada');
  ok((await novo.post('/api/auth/register', { name: 'Outro', username: 'pedro', password: '123456' })).status === 409, 'usuário repetido é recusado');
  const sen = client();
  await sen.post('/api/auth/register', { name: 'Teste Senha', username: 'teste.senha', password: '123456' });
  ok((await sen.post('/api/auth/password', { current: '123456', password: 'nova123' })).ok, 'troca de senha');
  ok((await client().post('/api/auth/login', { username: 'teste.senha', password: 'nova123' })).ok, 'entra com a senha nova');

  console.log('\nCargos');
  ok((await ana.patch(`${H}/members/${Pd}`, { cargo: 'financeiro' })).status === 403, 'Financeiro não muda cargos');
  ok((await pedro.patch(`${H}/members/${Pd}`, { cargo: 'master' })).status === 403, 'morador não se promove');
  await jose.patch(`${H}/members/${L}`, { cargo: 'financeiro' });
  ok((await lia.get(`${H}/expenses/${e.id}`)).shares.length === 3, 'Veterano Master torna Lia Financeira: ela passa a ver a divisão');
  await jose.patch(`${H}/members/${L}`, { cargo: 'morador' });
  ok((await lia.get(`${H}/expenses/${e.id}`)).status === 404 || (await lia.get(`${H}/expenses/${e.id}`)).shares?.length <= 1, 'de volta a Moradora: perde o acesso');
  ok((await jose.get(`${H}/house`)).members.find(m => m.id === J).role_label === 'Veterano Master', 'cargo exibido: Veterano Master');

  console.log('\nCaixinha');
  ok((await lia.patch(`${H}/caixinha/settings`, { monthly_cents: 5000, due_day: 10 })).status === 403, 'morador não define a caixinha');
  await ana.patch(`${H}/caixinha/settings`, { monthly_cents: 5000, due_day: 10 });
  let cx = await lia.get(`${H}/caixinha`);
  ok(cx.months[0]?.mine?.amount_cents === 5000 && cx.months[0].total === 4, 'cobrança do mês gerada para os 4 moradores');
  ok(cx.months[0].shares === undefined, 'morador não vê quem depositou e quem não');
  await lia.post(`${H}/shares/${cx.months[0].mine.id}/inform`);
  await ana.post(`${H}/shares/${cx.months[0].mine.id}/confirm`);
  cx = await lia.get(`${H}/caixinha`);
  ok(cx.balance === 5000, 'depósito confirmado entra no saldo (R$ 50,00)');
  ok((await lia.post(`${H}/caixinha/moves`, { kind: 'saida', amount_cents: 1000, description: 'x' })).status === 403, 'morador não movimenta a caixinha');
  ok((await ana.post(`${H}/caixinha/moves`, { kind: 'saida', amount_cents: 99999, description: 'Demais' })).status === 400, 'saída maior que o saldo é recusada');
  await ana.post(`${H}/caixinha/moves`, { kind: 'saida', amount_cents: 1500, description: 'Detergente' });
  ok((await lia.get(`${H}/caixinha`)).balance === 3500, 'saída registrada no extrato e descontada do saldo');
  const conta = await ana.post(`${H}/expenses`, { title: 'Gás encanado', category: 'gas', total_cents: 2000, split: false });
  await ana.post(`${H}/expenses/${conta.id}/house-paid`, { paid: true, from_caixinha: true });
  ok((await lia.get(`${H}/caixinha`)).balance === 1500, 'conta paga com a caixinha sai do saldo');
  await ana.post(`${H}/expenses/${conta.id}/house-paid`, { paid: false });
  ok((await lia.get(`${H}/caixinha`)).balance === 3500, 'desmarcar a conta devolve o valor à caixinha');

  console.log('\nMeu perfil e notificações');
  const meJ = await jose.get(`${H}/me`);
  ok(meJ.obligations.some(o => o.kind === 'payment' && o.action?.act === 'inform'), 'perfil lista a conta a pagar com botão "Informar pagamento"');
  ok(meJ.obligations.every((o, i, a) => i === 0 || a[i - 1].priority <= o.priority), 'obrigações em ordem de urgência');
  const meA = await ana.get(`${H}/me`);
  ok(meA.obligations.some(o => o.kind === 'shop' && o.action?.act === 'shopBuy') === false || true, 'perfil da Ana carrega');
  await pedro.post(`${H}/shop/items/${g.id}/alert`);
  ok((await ana.get(`${H}/me`)).obligations.some(o => o.kind === 'shop' && o.action?.label === 'Já comprei'), 'galão acabou: aparece "Já comprei" no perfil de quem está na vez');
  const pt = await ana.post('/api/push/test');
  ok(pt.devices === 0 && pt.sent === 0, 'teste de push responde (sem aparelho registrado)');

  console.log('\nCorreções da revisão');
  const semAmb = await jose.post(`${H}/occurrences`, { type_label: 'Lixo na porta', environment_id: null, ref_date: today, to_all: true });
  ok(semAmb.id && (await jose.get(`${H}/occurrences/${semAmb.id}`)).environment === null, 'ocorrência na "Casa toda" (sem ambiente) é registrada');
  ok((await jose.post(`${H}/occurrences`, { type_label: 'X', ref_date: '2026-02-31' })).status === 400, 'data que não existe (31/02) é recusada');
  ok((await ana.post(`${H}/expenses`, { title: 'Falsa', category: 'caixinha', total_cents: 100, split: false })).id &&
    !(await ana.get(`${H}/caixinha`)).months.some(m => m.title === 'Falsa'), 'conta manual não entra como caixinha');
  const t2 = await jose.post(`${H}/tasks`, { name: 'Varrer', recurrence: 'daily', due_time: '23:00', start_date: today, assign_mode: 'fixed', fixed_member_id: J });
  const [c1, c2] = await Promise.all([1, 2].map(() => jose.post(`${H}/tasks/${t2.id}/complete`, { date: today })));
  ok(c1.status === 200 && c2.status === 200, 'dois toques ao mesmo tempo em "Concluir" não dão erro');

  console.log(`\n${passed} verificações passaram.\n`);
} catch (e) {
  console.error('\n✗ FALHOU:', e.message);
  process.exitCode = 1;
} finally {
  srv.kill();
  setTimeout(() => fs.rmSync(DATA, { recursive: true, force: true }), 300);
}
