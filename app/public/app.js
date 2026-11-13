import { I, iconKey, ENV_ICONS, SHOP_ICONS } from './icons.js';
import {
  $, $$, esc, uid, api, act, toast, sheet, confirmSheet, uploader, setUnauthorized, viewFile,
  WD, WDS, WDN, wdOf, addDays, fmtDate, fmtHour, money, parseMoney, fmtTime, fmtDateTime, relDay, initials,
} from './ui.js';

// ---------- estado ----------
const S = { me: null, houses: [], hid: null, H: null, pushKey: null, tok: 0, unread: 0 };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
const ss = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} },
};
const P = p => `/api/h/${S.hid}${p}`;
const go = p => { if (location.hash === '#' + p) render(); else location.hash = '#' + p; };
const meId = () => S.H?.me.id;
const member = id => S.H?.members.find(m => m.id === id);
const activeMembers = () => S.H.members.filter(m => m.active);
const canSchedule = () => S.H.me.is_admin || S.H.me.can_schedule;
const today = () => S.H.now.date;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const fileUrl = id => P(`/files/${id}`);
const deadlineLabel = (d, t) => (t === '24:00' ? `até 00h de ${WD[wdOf(addDays(d, 1))]}` : `até ${fmtHour(t)} de ${WD[wdOf(d)]}`);
const avatar = (m, cls = '') => `<span class="avatar ${cls}">${m?.photo_file_id ? `<img src="${fileUrl(m.photo_file_id)}" alt="">` : esc(initials(m?.name))}</span>`;
const nameOrYou = (id, name) => (id === meId() ? 'você' : esc(name));

setUnauthorized(() => { S.me = null; go('/entrar'); });

// ---------- delegação de cliques ----------
function bindActs(el, map = {}) {
  el.onclick = e => {
    const b = e.target.closest('[data-act]');
    if (!b || !el.contains(b)) return;
    const fn = map[b.dataset.act] || COMMON[b.dataset.act];
    if (fn) { e.preventDefault(); e.stopPropagation(); fn(b, b.dataset); }
  };
}
// anexos (comprovantes, faturas, fotos) abrem no visualizador com botão de fechar
document.addEventListener('click', e => {
  const a = e.target.closest('a[href*="/files/"]');
  const img = !a && e.target.closest('img.photo');
  if (!a && !img) return;
  e.preventDefault(); e.stopPropagation();
  const label = a ? (a.textContent.trim() || 'Anexo') : (img.alt || 'Foto');
  viewFile(a ? a.getAttribute('href') : img.getAttribute('src'), label);
}, true);
document.addEventListener('click', e => {
  if (e.target.closest('[data-act]')) return;
  const g = e.target.closest('[data-go]');
  if (g) { e.preventDefault(); go(g.dataset.go); }
});

// ---------- textos de situação ----------
const TASK_ST = { pendente: 'Pendente', atrasada: 'Atrasada', concluida: 'Feita', concluida_atrasada: 'Feita com atraso' };
const OCC_ST = o => ({ aguardando: o.assigned_member_id ? 'Aguardando resposta' : o.to_all ? 'Para todos' : 'No quadro, sem atribuição', resolvida: 'Resolvida', em_revisao: 'Em revisão', encerrada: 'Encerrada sem atribuição' }[o.status]);
const SHARE_ST = { pendente: 'Pendente', informado: 'Aguardando confirmação', confirmado: 'Confirmado' };
function recurrenceText(t) {
  switch (t.recurrence) {
    case 'once': return `Uma vez, em ${fmtDate(t.start_date)}`;
    case 'daily': return 'Todos os dias';
    case 'weekly': return `Toda ${WDN[wdOf(t.start_date)]}`;
    case 'weekdays': return 'Às ' + (t.weekdays || []).slice().sort().map(d => WDS[d]).join(', ');
  }
  return '';
}

// ---------- cartão de tarefa ----------
function taskCard(i, { compact = false } = {}) {
  const mine = i.assignee === meId();
  const env = i.environment ? `${I(i.environment.icon)}${esc(i.environment.name)}` : `${I('home')}Casa`;
  const who = !i.assignee ? '<b>Sem responsável</b>' : (i.assignee_active ? nameOrYou(i.assignee, i.assignee_name) : `<b>${esc(i.assignee_name)} saiu da casa</b>`);
  const done = i.completion ? `Concluída ${i.completion.completed_at ? 'às ' + fmtTime(i.completion.completed_at, S.H.house.timezone) : ''}`
    : i.date < today() ? `De ${WDN[wdOf(i.date)]} (${fmtDate(i.date)}) · prazo era ${i.deadline}` : cap(i.deadline);
  const acts = [];
  if (!i.completion && mine && i.date <= today()) acts.push(`<button class="btn primary" data-act="complete" data-tid="${i.task_id}" data-date="${i.date}" data-photo="${i.require_photo ? 1 : 0}">${i.require_photo ? I('camera') : I('check')}Concluir</button>`);
  if (!i.completion && mine) acts.push(`<button class="btn" data-act="swap" data-tid="${i.task_id}" data-date="${i.date}">Pedir troca</button>`);
  if (!compact) acts.push(`<button class="btn ghost" data-go="/tarefa/${i.task_id}/${i.date}">Ver detalhes</button>`);
  return `<div class="card ${mine && !i.completion ? 'accent' : ''} ${(!i.assignee || !i.assignee_active) && !i.completion ? 'warn' : ''}">
    <div class="row"><span class="env">${env}</span><span class="chip ${i.status}">${TASK_ST[i.status]}</span></div>
    <h3>${esc(i.name)}${i.swapped ? ' <span class="small muted">· trocada</span>' : ''}</h3>
    <p class="muted">${who} · ${esc(done)}</p>
    ${acts.length ? `<div class="actions">${acts.join('')}</div>` : ''}
  </div>`;
}

// ---------- ações comuns ----------
const COMMON = {
  complete(btn, d) {
    if (d.photo === '1') return completeWithPhoto(d.tid, d.date);
    act(btn, () => api(P(`/tasks/${d.tid}/complete`), { method: 'POST', body: { date: d.date } })).then(() => {
      toast('Tarefa concluída. Valeu!', { action: 'Desfazer', onAction: () => api(P(`/tasks/${d.tid}/uncomplete`), { method: 'POST', body: { date: d.date } }).then(render) });
      render();
    }).catch(() => {});
  },
  swap(btn, d) { swapFlow(+d.tid, d.date); },
  occ() { occurrenceFlow(); },
  shopAlert(btn, d) { shopAlert(+d.id); },
  shopBuy(btn, d) { buyFlow(+d.id); },
  shopOrder(btn, d) { orderSheet(+d.id); },
  claim(btn, d) {
    act(btn, () => api(P(`/occurrences/${d.id}/claim`), { method: 'POST', body: {} }), { ok: 'Você assumiu. Obrigado!' }).then(render).catch(() => {});
  },
  inform(btn, d) { informFlow(+d.sid, +d.amount, d.title, d.eid ? +d.eid : null); },
};

function completeWithPhoto(tid, date) {
  sheet(sh => {
    const idem = uid();
    sh.render(`<h2>Concluir tarefa</h2><p class="muted">Esta tarefa pede uma foto mostrando que foi feita.</p>
      <div id="up"></div><div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Concluir</button></div>`);
    const up = uploader($('#up', sh.el), { hid: S.hid, kind: 'task', required: true, label: 'a foto' });
    $('#ok', sh.el).onclick = e => act(e.target, () => api(P(`/tasks/${tid}/complete`), { method: 'POST', idem, body: { date, photo_file_id: up.check() } }), { ok: 'Tarefa concluída. Valeu!' })
      .then(() => { sh.close(); render(); }).catch(() => {});
  });
}

// ---------- troca de tarefa ----------
function swapFlow(tid, date) {
  const st = { target: null, theirs: null };
  const idem = uid();
  sheet(sh => {
    const step1 = () => {
      const others = activeMembers().filter(m => m.id !== meId());
      sh.render(`<h2>Pedir troca</h2><p class="muted">Com quem você quer trocar?</p>
        <div class="opts one">${others.map(m => `<button class="opt" data-act="pick" data-id="${m.id}">${avatar(m, 'sm')} ${esc(m.name)}</button>`).join('') || '<p class="empty">Ninguém mais na casa.</p>'}</div>
        <div class="actions"><button class="btn" data-close>Cancelar</button></div>`);
    };
    const step2 = async () => {
      sh.render('<p class="empty">Carregando a escala…</p>');
      const d = await api(P(`/schedule?from=${today()}&to=${addDays(today(), 14)}`));
      const items = d.items.filter(i => i.assignee === st.target.id && !i.completion);
      sh.render(`<div class="crumbs">Troca com ${esc(st.target.name)}</div><h2>Qual tarefa dele(a) você assume?</h2>
        <div class="opts one">${items.map((i, n) => `<button class="opt" data-act="task" data-n="${n}"><span class="ico">${I(i.environment?.icon || 'home')}</span><span>${esc(i.name)}<small>${esc(cap(relDay(i.date, today())))} · ${esc(i.deadline)}</small></span></button>`).join('') || '<p class="empty">Essa pessoa não tem tarefas pendentes nos próximos 14 dias.</p>'}</div>
        <div class="actions"><button class="btn" data-act="back">Voltar</button></div>`);
      st.items = items;
    };
    const step3 = () => {
      sh.render(`<h2>Confirmar pedido</h2>
        <div class="card"><p class="muted small">Você passa</p><h3>Sua tarefa de ${esc(relDay(date, today()))}</h3>
        <p class="muted small" style="margin-top:10px">e assume</p><h3>${esc(st.theirs.name)} · ${esc(relDay(st.theirs.date, today()))}</h3></div>
        <p class="muted">A escala só muda depois que ${esc(st.target.name)} aceitar.</p>
        <div class="actions"><button class="btn" data-act="back2">Voltar</button><button class="btn primary" data-act="send">Enviar pedido</button></div>`);
    };
    bindActs(sh.el, {
      pick(b) { st.target = member(+b.dataset.id); step2().catch(e => toast(e.message, { error: true })); },
      task(b) { st.theirs = st.items[+b.dataset.n]; step3(); },
      back: step1, back2: () => step2(),
      send(b) {
        act(b, () => api(P('/swaps'), { method: 'POST', idem, body: { task_id: tid, date, target_member_id: st.target.id, target_task_id: st.theirs.task_id, target_date: st.theirs.date } }), { ok: `Pedido enviado para ${st.target.name}.` })
          .then(() => { sh.close(); render(); }).catch(() => {});
      },
    });
    step1();
  });
}

// ---------- registrar ocorrência (o fluxo da louça) ----------
function occurrenceFlow() {
  const st = { env: null, rule: null, label: '', ref: null, who: undefined };
  const idem = uid();
  sheet(sh => {
    const crumbs = () => [st.env && st.env.name, st.label, st.ref && `referente a ${relDay(st.ref, today())}`, st.who === 'todos' ? 'para todos' : st.who === null ? 'sem atribuição' : st.who && member(st.who)?.name].filter(Boolean).map(esc).join(' → ');
    const stepEnv = () => sh.render(`<h2>Registrar ocorrência</h2><p class="muted">Onde foi?</p>
      <div class="opts">${S.H.environments.map(e => `<button class="opt" data-act="env" data-id="${e.id}"><span class="ico">${I(e.icon)}</span>${esc(e.name)}</button>`).join('')}<button class="opt" data-act="env" data-id=""><span class="ico">${I('home')}</span>Casa toda</button></div>
      <div class="actions"><button class="btn" data-close>Cancelar</button></div>`);
    const stepWhat = () => {
      const rules = S.H.rules.filter(r => r.environment_id === st.env.id || !r.environment_id);
      sh.render(`<div class="crumbs">${crumbs()}</div><h2>O que aconteceu?</h2>
        <div class="opts one">${rules.map(r => `<button class="opt" data-act="rule" data-id="${r.id}"><span>${esc(r.occurrence_label || r.title)}<small>Regra: ${esc(r.title)}</small></span></button>`).join('')}
        <button class="opt" data-act="other"><span>Outra coisa<small>Escrever o que foi</small></span></button></div>
        <div id="other" hidden><label class="f" for="ot">O que aconteceu?</label><input id="ot" type="text" maxlength="80" placeholder="Ex.: Fogão sujo"><div class="actions"><button class="btn primary" data-act="otherok">Continuar</button></div></div>
        <div class="actions"><button class="btn" data-act="back-env">Voltar</button></div>`);
    };
    const stepDay = () => {
      const t = today(), y = addDays(t, -1);
      const r = st.rule;
      const days = r?.deadline_time ? [...new Set([r.suggested_ref, t, y])] : [t, y];
      const lbl = d => `${cap(WD[wdOf(d)])} (${fmtDate(d)})${d === t ? ' · hoje' : d === y ? ' · ontem' : ''}`;
      sh.render(`<div class="crumbs">${crumbs()}</div><h2>Referente a qual dia?</h2>
        <div class="opts one">${days.map((d, n) => `<button class="opt ${n === 0 && r?.deadline_time ? 'on' : ''}" data-act="day" data-d="${d}"><span>${esc(lbl(d))}${r?.deadline_time ? `<small>Prazo: ${esc(deadlineLabel(d, r.deadline_time))}${now_passed(d, r.deadline_time) ? ' · já venceu' : ' · ainda não venceu'}</small>` : ''}</span></button>`).join('')}</div>
        <div class="actions"><button class="btn" data-act="back-what">Voltar</button></div>`);
    };
    // prazo vencido? compara com a hora local da casa vinda do servidor
    const now_passed = (d, dl) => {
      const end = dl === '24:00' ? addDays(d, 1) + ' 00:00' : `${d} ${dl}`;
      return `${S.H.now.date} ${S.H.now.time}` >= end;
    };
    const stepWho = () => {
      const others = activeMembers().filter(m => m.id !== meId());
      sh.render(`<div class="crumbs">${crumbs()}</div><h2>De quem é?</h2>
        <div class="opts one">${others.map(m => `<button class="opt" data-act="who" data-id="${m.id}">${avatar(m, 'sm')} ${esc(m.name)}</button>`).join('')}
        <button class="opt" data-act="who" data-id="todos"><span class="ico">${I('users')}</span><span>Todos<small>Avisa a casa inteira. Qualquer um pode assumir.</small></span></button>
        <button class="opt" data-act="who" data-id=""><span class="ico">${I('help')}</span><span>Não sei de quem é<small>O aviso vai para o quadro da ${esc(st.env.name)}, sem atribuir a ninguém.</small></span></button></div>
        <div class="actions"><button class="btn" data-act="back-day">Voltar</button></div>`);
    };
    let up;
    const stepSend = () => {
      sh.render(`<div class="crumbs">${crumbs()}</div><h2>Enviar aviso</h2>
        ${st.who === 'todos' ? '<p class="muted">Todos os moradores recebem o aviso. Quem for o dono pode tocar em “É minha, vou resolver”.</p>' : st.who ? `<p class="muted">${esc(member(st.who).name)} vai receber o aviso e poderá responder “Já resolvi” ou “Não era minha”.</p>` : `<p class="muted">Vai aparecer no quadro da ${esc(st.env.name)}. Quem for o dono pode tocar em “É minha, vou resolver”.</p>`}
        <label class="f">Foto (opcional)</label><div id="up"></div>
        <label class="f" for="note">Observação (opcional)</label><textarea id="note" maxlength="500" placeholder="Não precisa escrever nada."></textarea>
        <div class="actions"><button class="btn" data-act="back-who">Voltar</button><button class="btn primary" data-act="send">Enviar aviso</button></div>`);
      up = uploader($('#up', sh.el), { hid: S.hid, kind: 'occurrence' });
    };
    bindActs(sh.el, {
      // "Casa toda" (ou casa sem ambientes cadastrados): a ocorrência fica sem ambiente
      env(b) { st.env = S.H.environments.find(e => e.id === +b.dataset.id) || { id: null, name: 'casa' }; stepWhat(); },
      rule(b) { st.rule = S.H.rules.find(r => r.id === +b.dataset.id); st.label = st.rule.occurrence_label || st.rule.title; stepDay(); },
      other() { $('#other', sh.el).hidden = false; $('#ot', sh.el).focus(); },
      otherok() { const v = $('#ot', sh.el).value.trim(); if (!v) return toast('Escreva o que aconteceu.', { error: true }); st.rule = null; st.label = v; stepDay(); },
      day(b) { st.ref = b.dataset.d; stepWho(); },
      who(b) { st.who = b.dataset.id === 'todos' ? 'todos' : b.dataset.id ? +b.dataset.id : null; stepSend(); },
      'back-env': stepEnv, 'back-what': stepWhat, 'back-day': stepDay, 'back-who': stepWho,
      send(b) {
        act(b, () => api(P('/occurrences'), {
          method: 'POST', idem, body: {
            rule_id: st.rule?.id || null, environment_id: st.env.id, type_label: st.label, ref_date: st.ref,
            assigned_member_id: st.who === 'todos' ? null : st.who, to_all: st.who === 'todos', note: $('#note', sh.el).value, photo_file_id: up.check(),
          },
        })).then(r => {
          sh.close();
          toast(st.who === 'todos' ? 'Aviso enviado para todos os moradores.' : st.who ? `Aviso enviado para ${member(st.who).name}.` : `Aviso colocado no quadro da ${st.env.name}.`, { action: 'Ver', onAction: () => go(`/ocorrencia/${r.id}`) });
          render();
        }).catch(() => {});
      },
    });
    stepEnv();
  });
}

// ---------- compras da casa ----------
function shopRow(it) {
  const next = it.next_member ? nameOrYou(it.next_member, it.next_name) : 'ninguém';
  let state, btn;
  if (it.status === 'acabou') {
    state = `<span class="state">${it.next_member === meId() ? 'É a sua vez de comprar' : `É a vez ${it.next_member ? 'de ' + esc(it.next_name) : ''} comprar`}</span>`;
    btn = it.next_member === meId() ? `<button class="btn primary" data-act="shopBuy" data-id="${it.id}">Já comprei</button>` : `<button class="btn" data-act="shopOrder" data-id="${it.id}">Ver pedido</button>`;
  } else if (it.last?.today) {
    state = `${nameOrYou(it.last.buyer_id, it.last.buyer_name)} comprou hoje · Próxima vez: ${next}`;
    btn = `<button class="btn ghost" data-go="/compras/${it.id}">Ver histórico</button>`;
  } else {
    state = `Próxima compra: ${next}`;
    btn = `<button class="btn" data-act="shopAlert" data-id="${it.id}" aria-label="Avisar que acabou">Acabou</button>`;
  }
  return `<div class="shop-row ${it.status === 'acabou' ? 'waiting' : ''}"><span class="ico">${I(iconKey(it.icon, 'cart'))}</span>
    <div class="grow" data-go="/compras/${it.id}" style="cursor:pointer"><b>${esc(it.name)}</b><div class="small muted">${state}</div></div>${btn}</div>`;
}
async function getItem(id) { return api(P(`/shop/items/${id}`)); }
async function shopAlert(id) {
  const it = await getItem(id).catch(e => toast(e.message, { error: true }));
  if (!it) return;
  if (it.status === 'acabou') { toast(`${it.next_name} já foi avisado(a). Aguardando compra.`); return render(); }
  const self = it.next_member === meId();
  const ok = await confirmSheet({
    title: self ? `Marcar que ${it.name.toLowerCase()} acabou?` : `Avisar ${it.next_name} que ${it.name.toLowerCase()} acabou?`,
    text: self ? 'É a sua vez de comprar. A casa vai ver “Aguardando compra”.' : `${esc(it.next_name)} recebe uma notificação e a casa passa a ver “Aguardando compra”.`,
    yes: self ? 'Marcar' : 'Avisar',
  });
  if (!ok) return;
  try {
    const r = await api(P(`/shop/items/${id}/alert`), { method: 'POST', body: {} });
    toast(r.already ? `${it.next_name} já tinha sido avisado(a).` : (self ? 'Marcado. Quando comprar, toque em “Já comprei”.' : `${it.next_name} foi avisado(a).`));
  } catch (e) { toast(e.message, { error: true }); }
  render();
}
async function orderSheet(id) {
  const it = await getItem(id).catch(e => toast(e.message, { error: true }));
  if (!it) return;
  sheet(sh => {
    sh.render(`<h2>${esc(it.name)}</h2>
      <div class="card warn"><b>Aguardando compra</b><p class="muted">${esc(it.alerted_by_name || 'Alguém')} avisou ${it.alerted_at ? 'em ' + fmtDateTime(it.alerted_at, S.H.house.timezone) : ''}. É a vez de ${nameOrYou(it.next_member, it.next_name)} comprar.</p></div>
      <p class="muted">Passou no mercado e comprou? Registre aqui — você escolhe se conta como a vez de ${esc(it.next_name)} ou se adiantou a sua.</p>
      <div class="actions"><button class="btn" data-go="/compras/${it.id}" data-close>Ver histórico</button><button class="btn primary" id="buy">Comprei no lugar</button></div>`);
    $('#buy', sh.el).onclick = () => { sh.close(); buyFlow(id); };
  });
}
async function buyFlow(id) {
  const it = await getItem(id).catch(e => toast(e.message, { error: true }));
  if (!it) return;
  const idem = uid();
  const notTurn = it.next_member !== meId();
  const ask = notTurn && it.i_participate;
  const st = { counts: 'turn' };
  const n = it.participants.length;
  const valLabel = { buyer: 'Valor (opcional, só para registro)', split: `Valor da compra (para dividir entre ${n} pessoas)`, house: 'Valor (sai da caixinha)' }[it.payment_mode];
  sheet(sh => {
    const draw = () => {
      const keep = { v: $('#val', sh.el)?.value || '', note: null };
      sh.render(`<h2>Confirmar compra: ${esc(it.name)}</h2>
        ${ask ? `<p class="f" style="font-weight:700">Essa compra conta como a vez de quem?</p>
          <div class="opts one">
            <button class="opt ${st.counts === 'turn' ? 'on' : ''}" data-act="c" data-v="turn"><span>Vez de ${esc(it.next_name)}<small>Comprei por ${esc(it.next_name)}. A fila anda normalmente.</small></span></button>
            <button class="opt ${st.counts === 'own' ? 'on' : ''}" data-act="c" data-v="own"><span>Adiantei a minha vez<small>${esc(it.next_name)} continua sendo a próxima e eu não compro de novo nesta rodada.</small></span></button>
          </div>` : notTurn ? `<p class="muted">Vai contar como a vez de ${esc(it.next_name)}.</p>` : ''}
        <label class="f" for="val">${valLabel}</label><input id="val" inputmode="decimal" placeholder="R$ 0,00" value="${esc(keep.v)}">
        <label class="f">Foto da nota (opcional)</label><div id="up"></div>
        <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" data-act="ok">Confirmar compra</button></div>`);
      up = uploader($('#up', sh.el), { hid: S.hid, kind: 'purchase', pdf: true });
    };
    let up;
    bindActs(sh.el, {
      c(b) { st.counts = b.dataset.v; draw(); },
      ok(b) {
        const raw = $('#val', sh.el).value;
        const cents = raw ? parseMoney(raw) : null;
        if (raw && !cents) return toast('Valor inválido.', { error: true });
        act(b, () => api(P(`/shop/items/${id}/purchase`), { method: 'POST', idem, body: { counts_as: st.counts, amount_cents: cents, receipt_file_id: up.check() } }))
          .then(r => { sh.close(); toast(`Compra registrada. Próxima vez: ${r.item.next_member === meId() ? 'você' : r.item.next_name}.`); render(); }).catch(() => {});
      },
    });
    draw();
  });
}

// ---------- financeiro: informar pagamento ----------
async function informFlow(sid, amount, title, eid) {
  const idem = uid();
  let e = null;
  if (eid) e = await api(P(`/expenses/${eid}`)).catch(() => null);
  const payTo = e?.receiver_name || (S.fin?.payers || []).join(', ') || 'o responsável pelas contas';
  sheet(sh => {
    sh.render(`<h2>Informar pagamento</h2><p class="muted">${esc(title)} · sua parte <span class="money">${money(amount)}</span></p>
      ${e?.payment_info && !e.is_market ? `<div class="card"><span class="label">Pague para ${esc(payTo)}</span><p class="small" style="white-space:pre-line">${esc(e.payment_info)}</p><div class="actions"><button class="btn" id="cp">Copiar dados</button></div></div>` : ''}
      <p class="muted small">Você paga por fora do app (Pix, dinheiro…) e avisa aqui. ${esc(cap(payTo))} confere e confirma.</p>
      <label class="f">Comprovante (opcional)</label><div id="up"></div>
      <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Informar pagamento</button></div>`);
    $('#cp', sh.el)?.addEventListener('click', () => copyText(e.payment_info));
    const up = uploader($('#up', sh.el), { hid: S.hid, kind: 'receipt', pdf: true });
    $('#ok', sh.el).onclick = ev => act(ev.target, () => api(P(`/shares/${sid}/inform`), { method: 'POST', idem, body: { receipt_file_id: up.check() } }), { ok: `Pagamento informado. Agora é com ${payTo}.` })
      .then(() => { sh.close(); render(); }).catch(() => {});
  });
}

// ======================================================================
// TELAS
// ======================================================================

async function vHoje() {
  const d = await api(P('/today'));
  setBell(d.unread);
  const H = S.H, t = d.now.date;
  const me = H.me;
  const needs = [];
  for (const o of d.occ_mine) needs.push(`<div class="card warn tap" data-go="/ocorrencia/${o.id}"><div class="row"><span class="env">${o.environment ? I(o.environment.icon) + esc(o.environment.name) : ''}</span><span class="chip aguardando">Aguardando você</span></div>
    <h3>${esc(o.reporter_name)} registrou: ${esc(o.type_label)}</h3><p class="muted">Referente a ${esc(o.ref_label)}${o.deadline ? ' · prazo ' + esc(o.deadline) : ''}</p>
    <div class="actions"><button class="btn primary" data-go="/ocorrencia/${o.id}">Ver e responder</button></div></div>`);
  for (const s of d.swaps) needs.push(`<div class="card warn tap" data-go="/troca/${s.id}"><h3>${esc(s.requester_name)} pediu uma troca</h3>
    <p class="muted">${esc(s.req?.name || '')} (${esc(s.req ? relDay(s.req.date, t) : '')}) pela sua ${esc(s.target?.name || '')} (${esc(s.target ? relDay(s.target.date, t) : '')})</p>
    <div class="actions"><button class="btn primary" data-go="/troca/${s.id}">Responder</button></div></div>`);
  for (const o of d.occ_review) needs.push(`<div class="card tap" data-go="/ocorrencia/${o.id}"><div class="row"><h3>Revisar: ${esc(o.type_label)}</h3><span class="chip em_revisao">Em revisão</span></div>
    <p class="muted">${esc(o.assigned_name)} contestou o relato de ${esc(o.reporter_name)}.</p></div>`);
  for (const s of d.shares_due) needs.push(`<div class="card tap" data-go="/despesa/${s.expense_id}"><div class="row"><h3>${esc(s.title)}</h3><span class="money">${money(s.amount_cents)}</span></div>
    <p class="muted">${s.due_date < t ? 'Venceu' : 'Vence'} ${esc(relDay(s.due_date, t))}</p><div class="actions"><button class="btn primary" data-act="inform" data-sid="${s.id}" data-amount="${s.amount_cents}" data-title="${esc(s.title)}" data-eid="${s.expense_id}">Informar pagamento</button></div></div>`);
  if (d.to_confirm.length) needs.push(`<div class="card tap" data-go="/financeiro"><h3>${d.to_confirm.length} pagamento(s) para conferir</h3><p class="muted">${d.to_confirm.map(s => esc(s.member_name) + ' · ' + esc(s.title)).slice(0, 3).join('<br>')}</p></div>`);

  const mine = d.mine_today;
  const folga = d.next ? `Você está de folga hoje. Sua próxima tarefa é ${esc(d.next.name.toLowerCase())} ${d.next.date === addDays(t, 1) ? 'amanhã' : 'na ' + WDN[wdOf(d.next.date)]}.` : 'Você está de folga hoje e não tem tarefas marcadas nos próximos dias.';
  const others = d.house_today;
  const pendOthers = others.filter(i => !i.completion);
  return {
    html: `
      <section class="hello">
        <span class="eyebrow">${esc(H.house.home_title)} · ${cap(WD[wdOf(t)])}, ${fmtDate(t)}</span>
        <h1>Oi, ${esc(me.name)}</h1>
        <p class="muted">${summaryLine(d, needs.length)}</p>
      </section>
      <button class="btn big occ-btn" data-act="occ">${I('flag')}Registrar ocorrência</button>
      ${needs.length ? `<h2>Precisa da sua resposta</h2>${needs.join('')}` : ''}
      <h2>Suas tarefas de hoje</h2>
      ${mine.length ? mine.map(i => taskCard(i)).join('') : `<div class="card"><p class="folga">${folga}</p></div>`}
      ${d.mine_overdue.length ? `<h2>Ficaram para trás</h2>${d.mine_overdue.map(i => taskCard(i)).join('')}` : ''}
      ${d.unassigned_count ? `<div class="card warn tap" data-go="/quadro"><b>${d.unassigned_count} tarefa(s) sem responsável</b><p class="muted">Alguém saiu da casa ou o rodízio ficou vazio. Toque para redistribuir.</p></div>` : ''}
      ${d.shop.length ? `<h2>De quem é a vez?</h2><div class="card">${d.shop.map(shopRow).join('')}
        <div class="actions"><button class="btn ghost block" data-go="/compras">Ver todas as compras</button></div></div>` : (canSchedule() ? `<h2>De quem é a vez?</h2><div class="card"><p class="muted">Cadastre os itens que a casa compra em rodízio (galão de água, gás, papel higiênico…).</p><div class="actions"><button class="btn" data-go="/novo-item">+ Adicionar item</button></div></div>` : '')}
      ${d.board.length ? `<h2>Quadro da casa</h2>${d.board.map(o => `<div class="card"><div class="row"><span class="env">${o.environment ? I(o.environment.icon) + esc(o.environment.name) : ''}</span><span class="chip">Sem dono</span></div>
        <h3>${esc(o.type_label)} · ${esc(o.ref_label)}</h3><p class="muted">Registrado ${fmtDateTime(o.created_at, H.house.timezone)}</p>
        <div class="actions"><button class="btn primary" data-act="claim" data-id="${o.id}">É minha, vou resolver</button><button class="btn ghost" data-go="/ocorrencia/${o.id}">Ver</button></div></div>`).join('')}` : ''}
      <h2>Resto da casa hoje</h2>
      ${others.length ? `<p class="muted">${others.length - pendOthers.length} de ${others.length} feitas.</p>${others.map(i => taskCard(i, { compact: false })).join('')}` : '<p class="muted">Ninguém mais tem tarefa hoje.</p>'}
    `,
  };
}

// ---------- Quadro ----------
function weekStart(d) { const w = wdOf(d); return addDays(d, w === 0 ? -6 : 1 - w); }
async function vQuadro(_, q) {
  const t = today();
  const date = q.get('d') || t;
  const fm = q.get('m') ? +q.get('m') : null, fe = q.get('e') ? +q.get('e') : null;
  const ws = weekStart(date);
  const d = await api(P(`/schedule?from=${ws}&to=${addDays(ws, 6)}`));
  let items = d.items.filter(i => i.date === date);
  if (fm) items = items.filter(i => i.assignee === fm);
  if (fe) items = items.filter(i => i.environment_id === fe);
  const problems = d.items.filter(i => !i.completion && i.date >= t && (!i.assignee || !i.assignee_active));
  const qs = (o) => { const p = new URLSearchParams({ d: date, ...(fm ? { m: fm } : {}), ...(fe ? { e: fe } : {}), ...o }); for (const [k, v] of [...p]) if (!v) p.delete(k); return '/quadro?' + p; };
  return {
    html: `
      <div class="row"><h1>Quadro</h1>${canSchedule() ? `<button class="btn primary sm" data-go="/nova-tarefa">${I('plus')}Tarefa</button>` : ''}</div>
      <div class="tabbar"><a class="on" href="#/quadro">Escala</a><a href="#/regras">Regras da casa</a></div>
      <div class="week">
        <button class="nav" data-go="${qs({ d: addDays(ws, -7) })}" aria-label="Semana anterior">${I('left')}</button>
        ${[0, 1, 2, 3, 4, 5, 6].map(n => { const x = addDays(ws, n); const c = d.items.filter(i => i.date === x).length; return `<button class="day ${x === date ? 'on' : ''} ${x === t ? 'today' : ''}" data-go="${qs({ d: x })}">${WDS[wdOf(x)]}<b>${+x.slice(8)}</b>${c ? '•'.repeat(Math.min(c, 3)) : '&nbsp;'}</button>`; }).join('')}
        <button class="nav" data-go="${qs({ d: addDays(ws, 7) })}" aria-label="Próxima semana">${I('right')}</button>
      </div>
      ${date !== t ? `<button class="btn ghost" data-go="/quadro">Voltar para hoje</button>` : ''}
      <div class="filters">
        <select id="fm" aria-label="Filtrar por morador"><option value="">Todos os moradores</option>${activeMembers().map(m => `<option value="${m.id}" ${fm === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
        <select id="fe" aria-label="Filtrar por ambiente"><option value="">Todos os ambientes</option>${S.H.environments.map(e => `<option value="${e.id}" ${fe === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
      </div>
      ${problems.length && canSchedule() ? `<div class="card warn"><b>${problems.length} tarefa(s) desta semana sem responsável ativo</b><p class="muted">Abra a tarefa e use “Editar” para redistribuir.</p></div>` : ''}
      <h2>${cap(relDay(date, t))}</h2>
      ${items.length ? items.map(i => taskCard(i)).join('') : '<p class="empty">Nenhuma tarefa neste dia.</p>'}
    `,
    bind(el) {
      $('#fm', el).onchange = e => go(qs({ m: e.target.value }));
      $('#fe', el).onchange = e => go(qs({ e: e.target.value }));
    },
  };
}

function ruleDeadlineText(r) {
  if (!r.deadline_time) return 'Sem prazo';
  return r.deadline_time === '24:00' ? 'Até o fim do dia (00h do dia seguinte)' : `Até ${fmtHour(r.deadline_time)} do mesmo dia`;
}
async function vRegras() {
  const rules = S.H.rules;
  const env = id => S.H.environments.find(e => e.id === id);
  return {
    html: `
      <div class="row"><h1>Quadro</h1>${canSchedule() ? '<button class="btn primary" data-act="new">+ Nova regra</button>' : ''}</div>
      <div class="tabbar"><a href="#/quadro">Escala</a><a class="on" href="#/regras">Regras da casa</a></div>
      <p class="muted small">Regra vale para todo mundo (ex.: cada um lava o próprio prato). Tarefa é de quem está escalado (ex.: louça do jantar). As duas convivem.</p>
      ${rules.length ? rules.map(r => `<div class="card tap" data-act="open" data-id="${r.id}">
        <span class="env">${env(r.environment_id) ? I(env(r.environment_id).icon) + esc(env(r.environment_id).name) : I('home') + 'Casa toda'}</span>
        <h3>${esc(r.title)}</h3><p class="muted">${ruleDeadlineText(r)}${r.deadline_example ? ` · ex.: ${esc(r.deadline_example)}` : ''}</p>
        ${r.description ? `<p class="small">${esc(r.description)}</p>` : ''}</div>`).join('') : '<p class="empty">Nenhuma regra cadastrada ainda.</p>'}
    `,
    bind(el) { bindActs(el, { new: () => ruleEditor(null), open: (b) => ruleEditor(rules.find(r => r.id === +b.dataset.id)) }); },
  };
}
function ruleEditor(rule) {
  const editable = canSchedule();
  const st = { dl: rule ? (rule.deadline_time ? (rule.deadline_time === '24:00' ? 'eod' : 'time') : 'none') : 'eod' };
  sheet(sh => {
    if (!editable) {
      sh.render(`<h2>${esc(rule.title)}</h2><p class="muted">${ruleDeadlineText(rule)}</p>${rule.description ? `<p>${esc(rule.description)}</p>` : ''}<div class="actions"><button class="btn" data-close>Fechar</button></div>`);
      return;
    }
    const idem = uid();
    const draw = () => {
      const keep = rule && !$('#rt', sh.el) ? rule : {
        title: $('#rt', sh.el)?.value ?? rule?.title, environment_id: +($('#re', sh.el)?.value || rule?.environment_id || 0) || null,
        occurrence_label: $('#rl', sh.el)?.value ?? rule?.occurrence_label, subject: $('#rs', sh.el)?.value ?? rule?.subject,
        description: $('#rd', sh.el)?.value ?? rule?.description, deadline_time: $('#rh', sh.el)?.value || (rule?.deadline_time !== '24:00' ? rule?.deadline_time : ''),
      };
      sh.render(`<h2>${rule ? 'Editar regra' : 'Nova regra'}</h2>
        <label class="f" for="rt">Regra</label><textarea id="rt" maxlength="140" placeholder="Ex.: Cada morador deve lavar a própria louça até o fim do dia">${esc(keep.title || '')}</textarea>
        <label class="f" for="re">Onde</label><select id="re"><option value="">Casa toda</option>${S.H.environments.map(e => `<option value="${e.id}" ${keep.environment_id === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
        <label class="f">Prazo</label>
        <div class="seg"><button data-act="dl" data-v="none" class="${st.dl === 'none' ? 'on' : ''}">Sem prazo</button><button data-act="dl" data-v="eod" class="${st.dl === 'eod' ? 'on' : ''}">Até o fim do dia (00h)</button><button data-act="dl" data-v="time" class="${st.dl === 'time' ? 'on' : ''}">Horário</button></div>
        ${st.dl === 'time' ? `<input id="rh" type="time" value="${esc(keep.deadline_time && keep.deadline_time !== '24:00' ? keep.deadline_time : '22:00')}" style="margin-top:8px">` : ''}
        ${st.dl === 'eod' ? '<p class="muted small">A louça de segunda vence às 00h de terça-feira.</p>' : ''}
        <label class="f" for="rl">Como aparece ao registrar ocorrência</label><input id="rl" type="text" maxlength="60" placeholder="Ex.: Louça não lavada" value="${esc(keep.occurrence_label || '')}">
        <label class="f" for="rs">Como chamar no aviso</label><input id="rs" type="text" maxlength="40" placeholder="Ex.: a louça" value="${esc(keep.subject || '')}">
        <p class="muted small">Fica: “José registrou uma pendência sobre <b>a louça</b> de segunda.”</p>
        <label class="f" for="rd">Detalhes (opcional)</label><textarea id="rd" maxlength="600">${esc(keep.description || '')}</textarea>
        <div class="actions">${rule ? '<button class="btn danger" data-act="archive">Arquivar</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" data-act="save">Salvar</button></div>`);
    };
    bindActs(sh.el, {
      dl(b) { st.dl = b.dataset.v; draw(); },
      save(b) {
        const body = {
          title: $('#rt', sh.el).value, environment_id: $('#re', sh.el).value || null, occurrence_label: $('#rl', sh.el).value,
          subject: $('#rs', sh.el).value, description: $('#rd', sh.el).value,
          deadline_time: st.dl === 'none' ? null : st.dl === 'eod' ? '24:00' : $('#rh', sh.el).value,
        };
        act(b, () => rule ? api(P(`/rules/${rule.id}`), { method: 'PATCH', body }) : api(P('/rules'), { method: 'POST', idem, body }), { ok: 'Regra salva.' })
          .then(() => { sh.close(); render(); }).catch(() => {});
      },
      async archive(b) {
        act(b, () => api(P(`/rules/${rule.id}`), { method: 'PATCH', body: { archive: true } }), { ok: 'Regra arquivada.' }).then(() => { sh.close(); render(); }).catch(() => {});
      },
    });
    draw();
  });
}

// ---------- detalhe da tarefa ----------
async function vTarefa([tid, date]) {
  const d = await api(P(`/tasks/${tid}?date=${date}`));
  const t = d.task, i = d.instance;
  if (!i) return { html: `<h1>${esc(t.name)}</h1><p class="empty">Esta tarefa não acontece em ${fmtDate(date)}.</p><button class="btn" data-go="/quadro">Voltar ao quadro</button>` };
  const rot = t.assign_mode === 'rotation' ? t.rotation.map(id => member(id)).filter(Boolean) : [];
  return {
    html: `
      <button class="btn ghost" data-go="/quadro?d=${date}">${I('left')}Quadro</button>
      ${taskCard(i, { compact: true })}
      <div class="card stack">
        <div class="row"><span class="muted">Quando</span><b>${esc(recurrenceText(t))}</b></div>
        <div class="row"><span class="muted">Prazo</span><b>${esc(cap(i.deadline))}</b></div>
        <div class="row"><span class="muted">Quem faz</span><b>${t.assign_mode === 'fixed' ? esc(member(t.fixed_member_id)?.name || '—') : 'Rodízio'}</b></div>
        ${rot.length ? `<div><span class="muted small">Ordem do rodízio (avança a cada ocorrência, mesmo se alguém atrasar)</span><ol class="small">${rot.map(m => `<li>${esc(m.name)}${m.active ? '' : ' (saiu)'}</li>`).join('')}</ol></div>` : ''}
        <div class="row"><span class="muted">Para concluir</span><b>${t.require_photo ? 'Tocar + foto' : 'Só tocar em Concluir'}</b></div>
      </div>
      ${i.completion?.photo_file_id ? `<div class="card"><b>Foto da conclusão</b><img class="photo" src="${fileUrl(i.completion.photo_file_id)}" alt="Foto da tarefa concluída"></div>` : ''}
      ${i.completion && (i.completion.member_id === meId() || canSchedule()) ? `<button class="btn block" data-act="undo">Desfazer conclusão</button>` : ''}
      ${canSchedule() ? `<button class="btn block" data-act="edit" style="margin-top:8px">${I('pencil')}Editar tarefa</button>` : ''}
      ${d.recent.length ? `<h2>Últimas conclusões</h2><div class="card">${d.recent.map(c => `<div class="list-item"><div class="grow">${esc(c.member_name)} · ${WDN[wdOf(c.date)]} ${fmtDate(c.date)}</div><span class="small muted">${fmtTime(c.completed_at, S.H.house.timezone)}</span></div>`).join('')}</div>` : ''}
    `,
    bind(el) {
      bindActs(el, {
        undo(b) { act(b, () => api(P(`/tasks/${t.id}/uncomplete`), { method: 'POST', body: { date } }), { ok: 'Conclusão desfeita.' }).then(render).catch(() => {}); },
        async edit() {
          if (t.recurrence === 'once') return go(`/editar-tarefa/${t.id}/${date}`);
          sheet(sh => {
            sh.render(`<h2>Alterar só esta data ou esta e as próximas?</h2>
              <div class="opts one"><button class="opt" data-act="one"><span>Só esta data<small>${cap(relDay(date, today()))}: trocar responsável, horário ou cancelar</small></span></button>
              <button class="opt" data-act="future"><span>Esta e as próximas<small>Muda a tarefa a partir de ${fmtDate(date)}</small></span></button></div>
              <div class="actions"><button class="btn" data-close>Cancelar</button></div>`);
            bindActs(sh.el, { one() { sh.close(); editOne(t, i, date); }, future() { sh.close(); go(`/editar-tarefa/${t.id}/${date}`); } });
          });
        },
      });
    },
  };
}
function timeField(id, value) {
  const eod = value === '24:00';
  return `<label class="check"><input type="checkbox" id="${id}-eod" ${eod ? 'checked' : ''}> Até o fim do dia (00h do dia seguinte)</label>
    <input type="time" id="${id}" value="${eod ? '22:00' : esc(value || '22:00')}" ${eod ? 'hidden' : ''}>`;
}
function bindTimeField(el, id) {
  const cb = $(`#${id}-eod`, el), inp = $(`#${id}`, el);
  cb.onchange = () => { inp.hidden = cb.checked; };
  return () => (cb.checked ? '24:00' : inp.value);
}
function editOne(t, i, date) {
  sheet(sh => {
    sh.render(`<h2>Só ${esc(relDay(date, today()))}</h2><p class="muted">${esc(t.name)}</p>
      <label class="f" for="who">Responsável</label><select id="who">${activeMembers().map(m => `<option value="${m.id}" ${i.assignee === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
      <label class="f">Horário limite</label>${timeField('due', i.due_time)}
      <label class="check"><input type="checkbox" id="skip"> Não acontece nesta data</label>
      <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Salvar</button></div>`);
    const due = bindTimeField(sh.el, 'due');
    $('#ok', sh.el).onclick = e => act(e.target, () => api(P(`/tasks/${t.id}`), { method: 'PATCH', body: { scope: 'one', date, assignee_member_id: +$('#who', sh.el).value, due_time: due(), skip: $('#skip', sh.el).checked } }), { ok: 'Alterado só nesta data.' })
      .then(() => { sh.close(); render(); }).catch(() => {});
  });
}

// ---------- criar / editar tarefa ----------
const SUGGESTIONS = [['Lavar a louça', 'dish'], ['Tirar o lixo', 'trash'], ['Limpar o banheiro', 'bath'], ['Lavar roupa de uso comum', 'laundry'], ['Limpar a cozinha', 'kitchen']];
async function vTaskEditor(params) {
  const [tid, date] = params || [];
  let t;
  if (tid) {
    const d = await api(P(`/tasks/${tid}?date=${date}`));
    t = { ...d.task };
  } else {
    t = { name: '', environment_id: null, recurrence: 'daily', weekdays: [], due_time: '22:00', start_date: today(), assign_mode: 'rotation', fixed_member_id: null, rotation: [], require_photo: 0, notify: null };
  }
  const st = { ...t, useDefault: !t.notify, notify: t.notify || { ...S.H.house.notify_defaults } };
  const idem = uid();
  const isEdit = !!tid;
  return {
    html: '<div id="form"></div>',
    bind(el) {
      const f = $('#form', el);
      const read = () => {
        if ($('#tn', f)) st.name = $('#tn', f).value;
        if ($('#sd', f)) st.start_date = $('#sd', f).value;
        if ($('#due-eod', f)) st.due_time = $('#due-eod', f).checked ? '24:00' : $('#due', f).value;
      };
      const draw = () => {
        const ms = activeMembers();
        f.innerHTML = `
          <button class="btn ghost" data-go="${isEdit ? `/tarefa/${tid}/${date}` : '/quadro'}">${I('left')}Voltar</button>
          <h1>${isEdit ? 'Editar tarefa' : 'Nova tarefa'}</h1>
          ${isEdit && t.recurrence !== 'once' ? `<p class="muted">Vale para esta data e as próximas, a partir de ${fmtDate(date)}.</p>` : ''}
          <label class="f" for="tn">O que fazer</label>
          <div class="seg" style="margin-bottom:8px">${SUGGESTIONS.map(([s, i]) => `<button data-act="sug" data-v="${esc(s)}" class="${st.name === s ? 'on' : ''}">${I(i)}${esc(s)}</button>`).join('')}</div>
          <input id="tn" type="text" maxlength="80" placeholder="Ou escreva um nome próprio" value="${esc(st.name)}">
          <label class="f">Onde</label>
          <div class="seg">${S.H.environments.map(e => `<button data-act="env" data-v="${e.id}" class="${st.environment_id === e.id ? 'on' : ''}">${I(e.icon)}${esc(e.name)}</button>`).join('')}<button data-act="newenv">+ Outro</button></div>
          <label class="f">Quando</label>
          <div class="seg">${[['once', 'Uma vez'], ['daily', 'Todos os dias'], ['weekdays', 'Dias específicos'], ['weekly', 'Semanalmente']].map(([v, l]) => `<button data-act="rec" data-v="${v}" class="${st.recurrence === v ? 'on' : ''}">${l}</button>`).join('')}</div>
          ${st.recurrence === 'weekdays' ? `<div class="seg" style="margin-top:8px">${[1, 2, 3, 4, 5, 6, 0].map(n => `<button data-act="wd" data-v="${n}" class="${st.weekdays.includes(n) ? 'on' : ''}">${WDS[n]}</button>`).join('')}</div>` : ''}
          <label class="f" for="sd">${st.recurrence === 'once' ? 'Data' : 'Começa em'}${st.recurrence === 'weekly' ? ' (repete nesse dia da semana)' : ''}</label>
          <input id="sd" type="date" value="${esc(st.start_date)}" ${isEdit && date > t.start_date ? 'disabled' : ''}>
          <label class="f">Horário limite</label>${timeField('due', st.due_time)}
          <label class="f">Quem faz</label>
          <div class="seg"><button data-act="mode" data-v="fixed" class="${st.assign_mode === 'fixed' ? 'on' : ''}">Responsável fixo</button><button data-act="mode" data-v="rotation" class="${st.assign_mode === 'rotation' ? 'on' : ''}">Rodízio</button></div>
          ${st.assign_mode === 'fixed' ? `<div class="opts one" style="margin-top:8px">${ms.map(m => `<button class="opt ${st.fixed_member_id === m.id ? 'on' : ''}" data-act="fixed" data-v="${m.id}">${avatar(m, 'sm')} ${esc(m.name)}</button>`).join('')}</div>` : `
            <p class="muted small">Toque para incluir. Use as setas para ordenar: o primeiro faz a próxima ocorrência.</p>
            <div class="seg">${ms.map(m => `<button data-act="rot" data-v="${m.id}" class="${st.rotation.includes(m.id) ? 'on' : ''}">${esc(m.name)}</button>`).join('')}</div>
            <ol class="order">${st.rotation.map((id, n) => `<li><span class="n">${n + 1}.</span><span class="grow">${esc(member(id)?.name || '?')}</span>
              <button class="icon-btn" data-act="up" data-n="${n}" ${n === 0 ? 'disabled' : ''} aria-label="Subir">${I('up')}</button><button class="icon-btn" data-act="down" data-n="${n}" ${n === st.rotation.length - 1 ? 'disabled' : ''} aria-label="Descer">${I('down')}</button></li>`).join('')}</ol>`}
          <label class="f">Como concluir</label>
          <div class="seg"><button data-act="photo" data-v="0" class="${!st.require_photo ? 'on' : ''}">Só tocar em Concluir</button><button data-act="photo" data-v="1" class="${st.require_photo ? 'on' : ''}">Tocar + foto</button></div>
          <label class="f">Quando avisar</label>
          <label class="check"><input type="checkbox" id="nd" ${st.useDefault ? 'checked' : ''}> Usar o padrão da casa</label>
          ${st.useDefault ? '' : `<label class="check"><input type="checkbox" data-n="assign" ${st.notify.assign ? 'checked' : ''}> Ao atribuir (de manhã, no dia)</label>
            <label class="check"><input type="checkbox" data-n="before" ${st.notify.before ? 'checked' : ''}> 2h antes do prazo</label>
            <label class="check"><input type="checkbox" data-n="after" ${st.notify.after ? 'checked' : ''}> Depois do vencimento</label>`}
          <div class="actions" style="margin-top:20px">${isEdit ? '<button class="btn danger" data-act="del">Remover</button>' : ''}<button class="btn primary big" data-act="save">${isEdit ? 'Salvar alterações' : 'Criar tarefa'}</button></div>`;
        bindTimeField(f, 'due');
        $('#nd', f).onchange = e => { read(); st.useDefault = e.target.checked; draw(); };
        for (const c of $$('[data-n]', f)) if (c.type === 'checkbox') c.onchange = () => { st.notify[c.dataset.n] = c.checked; };
      };
      bindActs(f, {
        sug(b) { read(); st.name = b.dataset.v; draw(); },
        env(b) { read(); st.environment_id = st.environment_id === +b.dataset.v ? null : +b.dataset.v; draw(); },
        newenv() { read(); newEnvSheet(() => draw()); },
        rec(b) { read(); st.recurrence = b.dataset.v; draw(); },
        wd(b) { read(); const n = +b.dataset.v; st.weekdays = st.weekdays.includes(n) ? st.weekdays.filter(x => x !== n) : [...st.weekdays, n]; draw(); },
        mode(b) { read(); st.assign_mode = b.dataset.v; draw(); },
        fixed(b) { read(); st.fixed_member_id = +b.dataset.v; draw(); },
        rot(b) { read(); const id = +b.dataset.v; st.rotation = st.rotation.includes(id) ? st.rotation.filter(x => x !== id) : [...st.rotation, id]; draw(); },
        up(b) { read(); const n = +b.dataset.n; [st.rotation[n - 1], st.rotation[n]] = [st.rotation[n], st.rotation[n - 1]]; draw(); },
        down(b) { read(); const n = +b.dataset.n; [st.rotation[n + 1], st.rotation[n]] = [st.rotation[n], st.rotation[n + 1]]; draw(); },
        photo(b) { read(); st.require_photo = +b.dataset.v; draw(); },
        save(b) {
          read();
          const body = {
            name: st.name, environment_id: st.environment_id, recurrence: st.recurrence, weekdays: st.weekdays, due_time: st.due_time,
            start_date: st.start_date, assign_mode: st.assign_mode, fixed_member_id: st.fixed_member_id, rotation: st.rotation,
            require_photo: !!st.require_photo, notify: st.useDefault ? null : st.notify,
          };
          act(b, () => isEdit ? api(P(`/tasks/${tid}`), { method: 'PATCH', body: { ...body, scope: 'future', date } }) : api(P('/tasks'), { method: 'POST', idem, body }), { ok: isEdit ? 'Tarefa atualizada.' : 'Tarefa criada.' })
            .then(() => go(`/quadro?d=${isEdit ? date : st.start_date}`)).catch(() => {});
        },
        async del(b) {
          const ok = await confirmSheet({ title: 'Remover esta e as próximas?', text: `A tarefa deixa de acontecer a partir de ${fmtDate(date)}. O histórico continua salvo.`, yes: 'Remover', danger: true });
          if (ok) act(b, () => api(P(`/tasks/${tid}`), { method: 'PATCH', body: { scope: 'future', date, delete: true } }), { ok: 'Tarefa removida.' }).then(() => go('/quadro')).catch(() => {});
        },
      });
      draw();
    },
  };
}
function newEnvSheet(after) {
  const ICONS = ENV_ICONS;
  sheet(sh => {
    let icon = 'home';
    const draw = () => {
      const v = $('#en', sh.el)?.value || '';
      sh.render(`<h2>Novo ambiente</h2><label class="f" for="en">Nome</label><input id="en" type="text" maxlength="40" value="${esc(v)}" placeholder="Ex.: Varanda">
        <label class="f">Ícone</label><div class="seg">${ICONS.map(i => `<button class="icon-pick ${i === icon ? 'on' : ''}" data-act="ic" data-v="${i}" aria-label="${i}">${I(i)}</button>`).join('')}</div>
        <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" data-act="ok">Adicionar</button></div>`);
    };
    bindActs(sh.el, {
      ic(b) { icon = b.dataset.v; draw(); },
      ok(b) { act(b, () => api(P('/environments'), { method: 'POST', body: { name: $('#en', sh.el).value, icon } }), { ok: 'Ambiente adicionado.' }).then(async () => { await loadHouse(); sh.close(); after?.(); }).catch(() => {}); },
    });
    draw();
  });
}

// ---------- troca ----------
async function vTroca([id]) {
  const s = await api(P(`/swaps/${id}`));
  const t = today();
  const ST = { pendente: 'Aguardando resposta', aceita: 'Aceita', recusada: 'Recusada', cancelada: 'Cancelada' };
  return {
    html: `<button class="btn ghost" data-go="/hoje">${I('left')}Hoje</button><h1>Pedido de troca</h1>
      <p><span class="chip ${s.status === 'aceita' ? 'concluida' : s.status === 'pendente' ? 'pendente' : ''}">${ST[s.status]}</span></p>
      <div class="card"><p class="muted small">${esc(s.requester_name)} passa</p><h3>${esc(s.req?.name || 'Tarefa')} · ${esc(relDay(s.req_date, t))}</h3>
      <p class="muted small" style="margin-top:12px">e assume a de ${esc(s.target_name)}</p><h3>${esc(s.target?.name || 'Tarefa')} · ${esc(relDay(s.target_date, t))}</h3></div>
      ${s.status === 'pendente' && s.target_id === meId() ? `<p class="muted">Se aceitar, a escala muda na hora para os dois.</p><div class="actions"><button class="btn" data-act="decline">Recusar</button><button class="btn primary" data-act="accept">Aceitar troca</button></div>` : ''}
      ${s.status === 'pendente' && s.requester_id === meId() ? `<div class="actions"><button class="btn danger" data-act="cancel">Cancelar pedido</button></div>` : ''}`,
    bind(el) {
      const doIt = (a, msg) => b => act(b, () => api(P(`/swaps/${id}/${a}`), { method: 'POST', body: {} }), { ok: msg }).then(render).catch(() => {});
      bindActs(el, { accept: doIt('accept', 'Troca aceita. A escala foi atualizada.'), decline: doIt('decline', 'Troca recusada.'), cancel: doIt('cancel', 'Pedido cancelado.') });
    },
  };
}

// ---------- ocorrência ----------
const EVT = {
  registrou: e => `${e.actor_name} registrou${e.to_name ? ` e indicou ${e.to_name}` : ''}`,
  registrou_sem_atribuicao: e => `${e.actor_name} registrou sem atribuir a ninguém`,
  registrou_para_todos: e => `${e.actor_name} registrou e avisou todos os moradores`,
  resolveu: e => `${e.actor_name} respondeu “Já resolvi”`,
  contestou: e => `${e.actor_name} respondeu “Não era minha” — foi para revisão`,
  assumiu: e => `${e.actor_name} assumiu: “É minha, vou resolver”`,
  confirmou: e => `${e.actor_name} revisou e confirmou a indicação`,
  corrigiu: e => `${e.actor_name} corrigiu: de ${e.from_name || '—'} para ${e.to_name}`,
  encerrou_sem_atribuicao: e => `${e.actor_name} encerrou sem atribuição`,
};
async function vOcorrencia([id]) {
  const o = await api(P(`/occurrences/${id}`));
  const me = S.H.me, tz = S.H.house.timezone;
  const mine = o.assigned_member_id === me.id && o.status === 'aguardando';
  const canReview = me.can_review && ['aguardando', 'em_revisao'].includes(o.status);
  return {
    html: `<button class="btn ghost" data-go="/hoje">${I('left')}Hoje</button>
      <div class="row"><span class="env">${o.environment ? I(o.environment.icon) + esc(o.environment.name) : ''}</span><span class="chip ${o.status}">${OCC_ST(o)}</span></div>
      <h1>${esc(o.type_label)}</h1>
      <p class="muted"><span class="tag relato">Relato</span> registrado por ${esc(o.reporter_name)} em ${fmtDateTime(o.created_at, tz)}</p>
      <div class="card stack">
        ${o.rule ? `<div><span class="muted small">Regra</span><p><b>${esc(o.rule.title)}</b></p></div>` : ''}
        <div><span class="muted small">Referente a</span><p><b>${cap(WD[wdOf(o.ref_date)])} (${fmtDate(o.ref_date)})</b>${o.deadline ? ` · prazo ${esc(o.deadline)}` : ''}</p></div>
        <div><span class="muted small">Indicado</span><p><b>${o.assigned_member_id ? nameOrYou(o.assigned_member_id, o.assigned_name) : o.to_all ? 'Todos os moradores' : `Ninguém (quadro da ${esc(o.environment?.name || 'casa')})`}</b></p></div>
        ${o.note ? `<div><span class="muted small">Observação</span><p>${esc(o.note)}</p></div>` : ''}
        ${o.photo_file_id ? `<img class="photo" src="${fileUrl(o.photo_file_id)}" alt="Foto anexada à ocorrência">` : ''}
      </div>
      ${o.status === 'aguardando' && o.assigned_member_id ? '<p class="muted small">Isto é um relato de outro morador. Só vira falta confirmada se a pessoa resolver ou um responsável confirmar.</p>' : ''}
      ${mine ? `<div class="actions"><button class="btn" data-act="contest">Não era minha</button><button class="btn primary" data-act="resolve">Já resolvi</button></div>` : ''}
      ${!o.assigned_member_id && o.status === 'aguardando' ? `<div class="actions"><button class="btn primary" data-act="claim" data-id="${o.id}">É minha, vou resolver</button></div>` : ''}
      ${canReview ? `<h2>Revisão</h2><div class="card"><p class="muted">${o.status === 'em_revisao' ? `${esc(o.assigned_name)} contestou. Decida:` : 'Você pode revisar este registro:'}</p>
        <div class="opts one">${o.assigned_member_id ? `<button class="opt" data-act="rv" data-d="confirm"><span>Confirmar a indicação<small>Fica como resolvida no histórico de ${esc(o.assigned_name)}</small></span></button>` : ''}
        <button class="opt" data-act="rv" data-d="reassign"><span>Corrigir: indicar outro morador<small>Sai do histórico de quem foi indicado por engano</small></span></button>
        <button class="opt" data-act="rv" data-d="close"><span>Encerrar sem atribuição<small>Ninguém fica com o registro</small></span></button></div></div>` : ''}
      ${o.events.length ? `<h2>Histórico do registro</h2><ul class="timeline">${o.events.map(e => `<li><b>${esc((EVT[e.action] || (x => x.action))(e))}</b>${e.note ? `<br><span class="small">“${esc(e.note)}”</span>` : ''}<br><span class="small muted">${fmtDateTime(e.created_at, tz)}</span></li>`).join('')}</ul>` : ''}`,
    bind(el) {
      const post = (a, body, msg) => b => act(b, () => api(P(`/occurrences/${id}/${a}`), { method: 'POST', body }), { ok: msg }).then(render).catch(() => {});
      bindActs(el, {
        resolve: post('resolve', {}, 'Marcado como resolvido.'),
        contest() {
          sheet(sh => {
            sh.render(`<h2>Não era minha</h2><p class="muted">O registro vai para revisão de um responsável. Enquanto isso, não conta como falta sua.</p>
              <label class="f" for="cn">Quer explicar? (opcional)</label><textarea id="cn" maxlength="500"></textarea>
              <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Enviar para revisão</button></div>`);
            $('#ok', sh.el).onclick = e => act(e.target, () => api(P(`/occurrences/${id}/contest`), { method: 'POST', body: { note: $('#cn', sh.el).value } }), { ok: 'Enviado para revisão.' }).then(() => { sh.close(); render(); }).catch(() => {});
          });
        },
        rv(b) {
          const d = b.dataset.d;
          sheet(sh => {
            const others = activeMembers().filter(m => m.id !== o.assigned_member_id);
            sh.render(`<h2>${{ confirm: 'Confirmar a indicação', reassign: 'Indicar outro morador', close: 'Encerrar sem atribuição' }[d]}</h2>
              ${d === 'reassign' ? `<label class="f" for="rm">Quem é o responsável?</label><select id="rm">${others.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>` : ''}
              <label class="f" for="rn">Observação (opcional)</label><textarea id="rn" maxlength="500"></textarea>
              <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Concluir revisão</button></div>`);
            $('#ok', sh.el).onclick = e => act(e.target, () => api(P(`/occurrences/${id}/review`), { method: 'POST', body: { decision: d, member_id: d === 'reassign' ? +$('#rm', sh.el).value : undefined, note: $('#rn', sh.el).value } }), { ok: 'Revisão registrada.' })
              .then(() => { sh.close(); render(); }).catch(() => {});
          });
        },
      });
    },
  };
}
async function vOcorrencias() {
  const d = await api(P('/occurrences'));
  const tz = S.H.house.timezone;
  return {
    html: `<button class="btn ghost" data-go="/casa">${I('left')}Casa</button><h1>Ocorrências</h1>
      <p class="muted small">Você vê os registros em que está envolvido${S.H.me.can_review ? ' e todos os que pode revisar' : ''}${S.H.house.show_confirmed ? ', além dos resolvidos da casa' : ''}.</p>
      <button class="btn big occ-btn" data-act="occ">${I('flag')}Registrar ocorrência</button>
      ${d.items.length ? `<div class="card">${d.items.map(o => `<div class="list-item" data-go="/ocorrencia/${o.id}"><span class="li-ico">${I(o.environment?.icon || 'flag')}</span><div class="grow"><b>${esc(o.type_label)}</b> · ${esc(o.ref_label)}<div class="small muted">${o.assigned_name ? esc(o.assigned_name) : 'Sem atribuição'} · por ${esc(o.reporter_name)} · ${fmtDateTime(o.created_at, tz)}</div></div><span class="chip ${o.status}">${OCC_ST(o)}</span></div>`).join('')}</div>` : '<p class="empty">Nenhuma ocorrência por aqui.</p>'}`,
  };
}

// ---------- perfil do morador ----------
async function vMorador([mid]) {
  const d = await api(P(`/members/${mid}/profile`));
  const m = d.member, me = S.H.me, self = m.id === me.id, t = today();
  const groups = {};
  for (const h of d.history) (groups[h.date] ||= []).push(h);
  const dates = Object.keys(groups).sort().reverse();
  return {
    html: `<button class="btn ghost" data-go="/casa">${I('left')}Casa</button>
      <div class="row start" style="gap:16px;margin:8px 0">${avatar(m, 'lg')}<div><h1>${esc(m.name)}</h1><p class="muted">${esc(m.role_label)}${m.nickname ? ` · ${esc(m.full_name)}` : ''}</p>${m.active ? '' : '<span class="chip">Saiu da casa</span>'}</div></div>
      ${self ? '<button class="btn" data-act="editme">Editar apelido e foto</button>' : ''}
      ${me.is_admin && !self && m.active ? `<h2>Cargo</h2>
        <div class="opts one">${[
          ['master', S.H.house.role_names.admin, 'Administra tudo, inclusive o financeiro. Único que muda cargos.'],
          ['financeiro', S.H.house.role_names.finance, 'Lança e anexa as contas, confirma pagamentos e cuida da caixinha.'],
          ['morador', S.H.house.role_names.member, 'Usa o app: tarefas, ocorrências, compras e a própria parte das contas.'],
        ].map(([v, l, d]) => `<button class="opt ${m.cargo === v ? 'on' : ''}" data-act="cargo" data-v="${v}"><span class="ico">${I(v === 'master' ? 'scale' : v === 'financeiro' ? 'wallet' : 'user')}</span><span>${esc(l)}<small>${d}</small></span></button>`).join('')}</div>
        ${m.cargo !== 'master' ? `<label class="check"><input type="checkbox" id="org" ${m.organiza ? 'checked' : ''}> Também organiza a escala e revisa ocorrências</label>` : ''}` : ''}
      <h2>Próximas responsabilidades</h2>
      ${d.upcoming.length ? `<div class="card">${d.upcoming.map(i => `<div class="list-item" data-go="/tarefa/${i.task_id}/${i.date}"><span class="li-ico">${I(i.environment?.icon || 'home')}</span><div class="grow"><b>${esc(i.name)}</b><div class="small muted">${esc(cap(relDay(i.date, t)))} · ${esc(i.deadline)}</div></div><span class="chip ${i.status}">${TASK_ST[i.status]}</span></div>`).join('')}</div>` : '<p class="muted">Nada nos próximos 7 dias.</p>'}
      <h2>Histórico</h2>
      <p class="muted small"><span class="tag sistema">Sistema</span> é fato registrado pelo app. <span class="tag relato">Relato</span> é o que outro morador contou e pode precisar de confirmação.</p>
      ${dates.length ? dates.map(dt => `<h3 class="muted" style="margin-top:14px">${esc(cap(relDay(dt, t)))}</h3><div class="card">${groups[dt].map(h => `<div class="list-item" data-go="${h.link}"><span class="tag ${h.type}">${h.type === 'sistema' ? 'Sistema' : 'Relato'}</span><div class="grow small">${esc(h.text)}</div>${h.type === 'relato' ? `<span class="chip ${h.status}">${OCC_ST({ status: h.status, assigned_member_id: 1 })}</span>` : h.kind === 'atrasada' ? '<span class="chip atrasada">Atraso</span>' : ''}</div>`).join('')}</div>`).join('') : '<p class="muted">Sem registros ainda.</p>'}
      ${me.is_admin && !self && m.active ? `<h2>Administração</h2><div class="actions">${!m.is_admin ? `<button class="btn" data-act="transfer">Passar meu cargo de ${esc(S.H.house.role_names.admin)}</button>` : ''}<button class="btn danger" data-act="remove">Remover da casa</button></div>` : ''}
      ${self ? `<hr><button class="btn danger block" data-act="leave">Sair da casa</button>` : ''}`,
    bind(el) {
      const org = $('#org', el);
      if (org) org.onchange = () => api(P(`/members/${m.id}`), { method: 'PATCH', body: { organiza: org.checked } }).then(() => { toast('Atualizado.'); loadHouse(); }).catch(e => { org.checked = !org.checked; toast(e.message, { error: true }); });
      bindActs(el, {
        async cargo(b) {
          const v = b.dataset.v;
          if (v === m.cargo) return;
          const label = { master: S.H.house.role_names.admin, financeiro: S.H.house.role_names.finance, morador: S.H.house.role_names.member }[v];
          if (v === 'master' && !(await confirmSheet({ title: `Tornar ${m.name} ${label}?`, text: 'Essa pessoa vai ter todos os acessos, inclusive mudar cargos e ver todo o financeiro.', yes: 'Confirmar' }))) return;
          act(b, () => api(P(`/members/${m.id}`), { method: 'PATCH', body: { cargo: v } }), { ok: `${m.name} agora é ${label}.` }).then(async () => { await loadHouse(); render(); }).catch(() => {});
        },
        editme() {
          sheet(sh => {
            sh.render(`<h2>Seu perfil nesta casa</h2><label class="f" for="nn">Apelido</label><input id="nn" type="text" maxlength="40" value="${esc(m.nickname || '')}" placeholder="${esc(m.full_name)}">
              <label class="f">Foto</label><div id="up"></div><div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Salvar</button></div>`);
            const up = uploader($('#up', sh.el), { hid: S.hid, kind: 'avatar' });
            $('#ok', sh.el).onclick = e => act(e.target, () => { const body = { nickname: $('#nn', sh.el).value }; const f = up.check(); if (f) body.photo_file_id = f; return api(P(`/members/${m.id}`), { method: 'PATCH', body }); }, { ok: 'Perfil atualizado.' })
              .then(async () => { sh.close(); await loadHouse(); render(); }).catch(() => {});
          });
        },
        async transfer(b) {
          if (await confirmSheet({ title: `Transferir a administração para ${m.name}?`, text: 'Você deixa de ser administrador.', yes: 'Transferir' }))
            act(b, () => api(P('/transfer-admin'), { method: 'POST', body: { member_id: m.id } }), { ok: 'Administração transferida.' }).then(async () => { await loadHouse(); render(); }).catch(() => {});
        },
        async remove(b) {
          if (await confirmSheet({ title: `Remover ${m.name} da casa?`, text: 'O histórico fica guardado. O acesso é retirado e as tarefas futuras ficam marcadas para redistribuir.', yes: 'Remover', danger: true }))
            act(b, () => api(P(`/members/${m.id}/leave`), { method: 'POST', body: {} })).then(async r => { toast(r.future_tasks ? `Removido. Redistribua ${r.future_tasks} tarefa(s) no Quadro.` : 'Removido.'); await loadHouse(); go('/casa'); }).catch(() => {});
        },
        async leave(b) {
          if (await confirmSheet({ title: 'Sair da casa?', text: 'Seu histórico fica guardado para a casa, mas você perde o acesso.', yes: 'Sair', danger: true }))
            act(b, () => api(P(`/members/${m.id}/leave`), { method: 'POST', body: {} }), { ok: 'Você saiu da casa.' }).then(async () => { S.hid = null; store.set('hid', null); await boot(); }).catch(() => {});
        },
      });
    },
  };
}

// ---------- notificações ----------
async function vNotif() {
  const d = await api(P('/notifications'));
  setBell(d.unread);
  const tz = S.H.house.timezone;
  const KIND = { occurrence: 'flag', task: 'broom', swap: 'swap', expense: 'wallet', shop: 'cart', house: 'home' };
  return {
    html: `<div class="page-head"><h1>Notificações</h1>${d.unread ? '<button class="btn ghost sm" data-act="all">Marcar como lidas</button>' : ''}</div>
      <div id="push-slot"></div>
      ${d.items.length ? `<div class="list">${d.items.map(n => `<button class="list-item ${n.read_at ? 'read' : 'unread'}" data-act="open" data-id="${n.id}" data-link="${esc(n.link)}">
        <span class="li-ico">${I(KIND[n.kind] || 'bell')}</span>
        <span class="grow"><span class="li-title">${esc(n.title)}</span><span class="li-sub">${esc(n.body)}</span><span class="li-meta">${fmtDateTime(n.created_at, tz)}</span></span>
        ${n.read_at ? '' : '<span class="dot" aria-label="não lida"></span>'}</button>`).join('')}</div>` : emptyState('bell', 'Nenhuma notificação ainda', 'Quando alguém precisar de você, aparece aqui.')}`,
    bind(el) {
      pushPanel($('#push-slot', el), { compact: true });
      bindActs(el, {
        open(b) { api(P('/notifications/read'), { method: 'POST', body: { id: +b.dataset.id } }).catch(() => {}); go(b.dataset.link || '/hoje'); },
        all(b) { act(b, () => api(P('/notifications/read'), { method: 'POST', body: { all: true } })).then(render).catch(() => {}); },
      });
    },
  };
}

// ---------- notificações no celular (push) ----------
// iPhone: só recebe com o app fechado se (1) o site estiver em HTTPS, (2) o app tiver sido adicionado à
// Tela de Início e aberto por lá, (3) a permissão for dada tocando num botão dentro do app.
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function pushState() {
  if (!window.isSecureContext) return 'insecure';
  if (isIOS() && !isStandalone()) return 'ios-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (!S.pushKey) return 'server-off';
  return Notification.permission; // default | granted | denied
}
const b64ToBytes = k => Uint8Array.from(atob(k.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - k.length % 4) % 4)), c => c.charCodeAt(0));
async function subscribePush() {
  const reg = await navigator.serviceWorker.ready;
  const key = b64ToBytes(S.pushKey);
  let sub = await reg.pushManager.getSubscription();
  // inscrição antiga feita com outra chave do servidor: refaz
  if (sub && sub.options?.applicationServerKey) {
    const old = new Uint8Array(sub.options.applicationServerKey);
    if (old.length !== key.length || old.some((v, i) => v !== key[i])) { await sub.unsubscribe().catch(() => {}); sub = null; }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
  return sub;
}
// toda vez que o app abre com permissão dada, garante que o servidor tem a inscrição deste aparelho
async function syncPush() { if (pushState() === 'granted') await subscribePush().catch(() => {}); }
navigator.serviceWorker?.addEventListener('message', e => { if (e.data?.type === 'resubscribe') syncPush(); });

async function pushPanel(slot, { compact = false } = {}) {
  if (!slot) return;
  const st = pushState();
  const steps = (items) => `<ol class="steps">${items.map(t => `<li>${t}</li>`).join('')}</ol>`;
  const box = (tone, icon, title, body) => `<div class="notice ${tone}"><span class="notice-ico">${I(icon)}</span><div class="grow"><b>${title}</b>${body}</div></div>`;
  let html = '';
  if (st === 'granted') {
    const s = await api('/api/push/status').catch(() => ({ devices: 0 }));
    html = compact ? '' : box('ok', 'checkCircle', 'Notificações ativadas neste celular', `<p class="muted small">Os avisos chegam mesmo com o app fechado.</p><div class="actions"><button class="btn sm" data-act="ptest">Enviar notificação de teste</button></div>`);
    if (!s.devices) html = box('warn', 'alert', 'Falta registrar este celular', `<div class="actions"><button class="btn primary sm" data-act="pon">Registrar agora</button></div>`);
  } else if (st === 'default') {
    html = box('info', 'bell', 'Receber avisos no celular', `<p class="muted small">Tarefas, pendências e contas chegam mesmo com o app fechado.</p><div class="actions"><button class="btn primary sm" data-act="pon">Ativar notificações</button></div>`);
  } else if (st === 'ios-install') {
    html = box('info', 'phone', 'Para receber avisos no iPhone', `<p class="muted small">O iPhone só mostra notificações de apps adicionados à Tela de Início.</p>
      ${steps([`Toque em <b>Compartilhar</b> ${I('share', 'inline')} na barra do Safari`, 'Escolha <b>Adicionar à Tela de Início</b>', 'Abra o app pelo ícone <b>Pantanal</b>', 'Volte aqui e toque em <b>Ativar notificações</b>'])}`);
  } else if (st === 'insecure') {
    html = box('warn', 'lock', 'Notificações precisam de endereço seguro', `<p class="muted small">Pelo endereço da rede local (http://192.168…) o celular não deixa o app mandar notificações. Abra o app pelo endereço <b>https://</b> que aparece no computador quando o modo seguro está ligado.</p>`);
  } else if (st === 'denied') {
    html = box('warn', 'bell', 'Notificações bloqueadas', `<p class="muted small">${isIOS() ? 'Libere em Ajustes → Notificações → Pantanal.' : 'Libere nas configurações do navegador para este site.'} Enquanto isso, tudo continua chegando no sino.</p>`);
  } else if (st === 'server-off') {
    html = box('warn', 'alert', 'Push desligado no servidor', '<p class="muted small">Rode <b>npm install</b> na pasta do app e reinicie.</p>');
  } else {
    html = box('warn', 'alert', 'Este navegador não recebe notificações', '<p class="muted small">Tudo continua chegando no sino, dentro do app.</p>');
  }
  slot.innerHTML = html;
  bindActs(slot, {
    pon(b) { act(b, async () => {
      const p = await Notification.requestPermission(); // precisa vir direto do toque (exigência do iPhone)
      if (p !== 'granted') { toast('Tudo bem. Os avisos continuam chegando no sino.'); return; }
      await subscribePush();
      const r = await api('/api/push/test', { method: 'POST', body: {} });
      toast(r.sent ? 'Pronto! Enviamos uma notificação de teste.' : 'Ativado, mas o teste não chegou: ' + (r.errors?.[0] || 'sem resposta'));
    }).then(() => pushPanel(slot, { compact })).catch(() => {}); },
    ptest(b) { act(b, async () => {
      await subscribePush();
      const r = await api('/api/push/test', { method: 'POST', body: {} });
      toast(r.sent ? 'Enviada. Bloqueie a tela para ver ela chegar.' : 'Não chegou: ' + (r.errors?.[0] || 'nenhum aparelho registrado'), { error: !r.sent });
    }).catch(() => {}); },
  });
}

// ---------- Meu perfil: entrar e já ver as obrigações ----------
async function vPerfil() {
  const d = await api(P('/me'));
  const m = d.member;
  const now = d.obligations.filter(o => o.priority <= 1), soon = d.obligations.filter(o => o.priority >= 2);
  const ob = o => {
    const a = o.action;
    const btn = !a ? '' : a.go ? `<button class="btn sm" data-go="${a.go}">${esc(a.label)}</button>`
      : `<button class="btn primary sm" data-act="${a.act}" ${Object.entries(a.data || {}).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${esc(a.label)}</button>`;
    return `<div class="ob ${o.priority === 0 ? 'late' : ''}">
      <button class="ob-main" data-go="${o.link}"><span class="li-ico ${o.priority === 0 ? 'late' : ''}">${I(o.icon)}</span>
        <span class="grow"><span class="li-title">${esc(o.title)}</span><span class="li-sub">${esc(o.subtitle)}${o.amount_cents ? ` · <b>${money(o.amount_cents)}</b>` : ''}</span></span></button>
      ${btn ? `<div class="ob-act">${btn}</div>` : ''}</div>`;
  };
  const t = d.now.date;
  return {
    html: `
      <div class="profile-head">
        ${avatar(m, 'lg')}
        <div class="grow"><h1>${esc(m.name)}</h1><p class="muted">${esc(m.role_label)}</p></div>
        <button class="icon-btn" data-act="editme" aria-label="Editar perfil">${I('pencil')}</button>
      </div>
      <div class="stats">
        <div><b>${d.stats.open}</b><span>pendência${d.stats.open === 1 ? '' : 's'}</span></div>
        <div><b>${d.stats.done_week}</b><span>feitas na semana</span></div>
        <div><b>${d.stats.late_week}</b><span>atrasos na semana</span></div>
      </div>
      <h2>Agora</h2>
      ${now.length ? `<div class="list">${now.map(ob).join('')}</div>` : emptyState('checkCircle', 'Tudo em dia', 'Nada esperando por você agora.')}
      ${soon.length ? `<h2>Em breve</h2><div class="list">${soon.map(ob).join('')}</div>` : ''}
      <h2>Próximos 7 dias</h2>
      ${d.upcoming.length ? `<div class="list">${d.upcoming.map(i => `<button class="list-item" data-go="/tarefa/${i.task_id}/${i.date}"><span class="li-ico">${I(i.environment?.icon || 'broom')}</span>
        <span class="grow"><span class="li-title">${esc(i.name)}</span><span class="li-sub">${esc(cap(relDay(i.date, t)))} · ${esc(i.deadline)}</span></span>${I('right', 'chev')}</button>`).join('')}</div>` : '<p class="muted">Nenhuma tarefa marcada para você.</p>'}
      <h2>Notificações</h2>
      <div id="push-slot"></div>
      <h2>Conta</h2>
      <div class="list">
        <button class="list-item" data-go="/morador/${m.id}"><span class="li-ico">${I('list')}</span><span class="grow"><span class="li-title">Meu histórico na casa</span></span>${I('right', 'chev')}</button>
        <button class="list-item" data-go="/notificacoes"><span class="li-ico">${I('bell')}</span><span class="grow"><span class="li-title">Todas as notificações</span></span>${I('right', 'chev')}</button>
        <button class="list-item" data-act="pwd"><span class="li-ico">${I('lock')}</span><span class="grow"><span class="li-title">Trocar senha</span></span>${I('right', 'chev')}</button>
        <button class="list-item" data-act="logout"><span class="li-ico">${I('logout')}</span><span class="grow"><span class="li-title">Sair da conta</span><span class="li-sub">@${esc(S.me.username)}</span></span></button>
      </div>`,
    bind(el) {
      pushPanel($('#push-slot', el));
      bindActs(el, {
        pwd() {
          sheet(sh => {
            sh.render(`<h2>Trocar senha</h2>
              <label class="f" for="p0">Senha atual</label><input id="p0" type="password" autocomplete="current-password">
              <label class="f" for="p1">Nova senha (mínimo 6 caracteres)</label><input id="p1" type="password" autocomplete="new-password">
              <label class="f" for="p2">Repita a nova senha</label><input id="p2" type="password" autocomplete="new-password">
              <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Salvar</button></div>`);
            $('#ok', sh.el).onclick = e => {
              if ($('#p1', sh.el).value !== $('#p2', sh.el).value) return toast('As senhas novas não são iguais.', { error: true });
              act(e.target, () => api('/api/auth/password', { method: 'POST', body: { current: $('#p0', sh.el).value, password: $('#p1', sh.el).value } }), { ok: 'Senha trocada.' })
                .then(() => sh.close()).catch(() => {});
            };
          });
        },
        editme() {
          sheet(sh => {
            sh.render(`<h2>Seu perfil</h2><label class="f" for="nn">Apelido</label><input id="nn" type="text" maxlength="40" value="${esc(m.nickname || '')}" placeholder="${esc(m.full_name)}">
              <label class="f">Foto</label><div id="up"></div><div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Salvar</button></div>`);
            const up = uploader($('#up', sh.el), { hid: S.hid, kind: 'avatar' });
            $('#ok', sh.el).onclick = e => act(e.target, () => { const body = { nickname: $('#nn', sh.el).value }; const f = up.check(); if (f) body.photo_file_id = f; return api(P(`/members/${m.id}`), { method: 'PATCH', body }); }, { ok: 'Perfil atualizado.' })
              .then(async () => { sh.close(); await loadHouse(); render(); }).catch(() => {});
          });
        },
        async logout(b) { await act(b, () => api('/api/auth/logout', { method: 'POST', body: {} })).catch(() => {}); S.me = null; go('/entrar'); },
      });
    },
  };
}
const emptyState = (icon, title, text) => `<div class="empty"><span class="empty-ico">${I(icon)}</span><b>${esc(title)}</b><span>${esc(text)}</span></div>`;

// ---------- financeiro ----------
// Contas da casa (aluguel, água, luz, internet) ficam com o responsável pelas contas: só ele vê a divisão de todos.
// Cada morador vê a própria parte. Mercado e compras da casa são transparentes para quem participa.
const CAT_ICON = { aluguel: 'home', agua: 'droplet', luz: 'bulb', internet: 'wifi', gas: 'flame', condominio: 'building', mercado: 'cart', compra: 'cart', caixinha: 'coins', outro: 'file' };
const CAT_LIST = ['aluguel', 'agua', 'luz', 'internet', 'gas', 'condominio', 'mercado', 'outro'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const monthName = k => k === 'sem' ? 'Sem vencimento' : `${cap(MONTHS[+k.slice(5, 7) - 1])} de ${k.slice(0, 4)}`;
const docLink = (fid, label, has) => fid ? `<a class="doc" href="${fileUrl(fid)}" target="_blank" rel="noopener">${label}</a>` : has ? `<span class="doc missing">${I('lock')}${label}</span>` : `<span class="doc missing">${label} · não anexado</span>`;
function payInfoCard(d, compact = false) {
  if (!d.payment_info && !d.payers?.length) return '';
  return `<div class="card ${compact ? '' : 'accent'}"><span class="label">Pague para</span>
    <p><b>${esc((d.payers || []).join(', ') || 'Responsável pelas contas')}</b></p>
    ${d.payment_info ? `<p class="small" style="white-space:pre-line">${esc(d.payment_info)}</p><div class="actions"><button class="btn" data-act="copypay">Copiar dados</button></div>` : '<p class="muted small">O responsável ainda não cadastrou o Pix/banco.</p>'}</div>`;
}
function copyText(t) {
  (navigator.clipboard?.writeText(t) || Promise.reject()).then(() => toast('Copiado.')).catch(() => {
    const a = document.createElement('textarea'); a.value = t; document.body.append(a); a.select(); document.execCommand('copy'); a.remove(); toast('Copiado.');
  });
}

async function vFin(_, q) {
  const tab = ['casa', 'caixinha'].includes(q.get('aba')) ? q.get('aba') : 'minhas';
  const tabs = `<div class="tabbar three"><a class="${tab === 'minhas' ? 'on' : ''}" href="#/financeiro">Minhas</a><a class="${tab === 'caixinha' ? 'on' : ''}" href="#/financeiro?aba=caixinha">Caixinha</a><a class="${tab === 'casa' ? 'on' : ''}" href="#/financeiro?aba=casa">Contas da casa</a></div>`;
  if (tab === 'caixinha') return vCaixinha(tabs);
  const d = await api(P('/finance'));
  S.fin = d;
  const me = S.H.me, t = d.now.date;
  const head = `<div class="page-head"><h1>Contas</h1>${d.can_manage ? `<button class="btn primary sm" data-go="/nova-despesa">${I('plus')}Conta</button>` : ''}</div>`;
  const common = {
    copypay: () => copyText(d.payment_info),
    settings: () => financeSettings(d),
  };
  if (tab === 'minhas') {
    const mine = d.items.filter(e => e.mine);
    const open = mine.filter(e => e.mine.status === 'pendente').sort((a, b) => (a.due_date || '9') < (b.due_date || '9') ? -1 : 1);
    const waiting = mine.filter(e => e.mine.status === 'informado');
    const done = mine.filter(e => e.mine.status === 'confirmado').slice(0, 12);
    const totalOpen = open.reduce((a, e) => a + e.mine.amount_cents, 0);
    const toConfirm = d.items.flatMap(e => e.can_confirm ? e.shares.filter(s => s.status === 'informado' && s.member_id !== me.id).map(s => ({ ...s, e })) : []);
    const row = e => `<div class="list-item" data-go="/despesa/${e.id}"><span class="li-ico">${I(CAT_ICON[e.category] || 'file')}</span>
      <div class="grow"><b>${esc(e.title)}</b><div class="small muted">${e.due_date ? `${e.due_date < t && e.mine.status === 'pendente' ? 'Venceu' : 'Vence'} ${fmtDate(e.due_date)}` : 'Sem vencimento'}${e.is_market ? ' · compra coletiva' : ''}</div></div>
      <div style="text-align:right"><div class="money">${money(e.mine.amount_cents)}</div><span class="chip ${e.mine.status}">${SHARE_ST[e.mine.status]}</span></div></div>`;
    return {
      html: `${head}${tabs}
        <div class="card deep"><span class="label">Sua parte em aberto</span><div class="big-money">${money(totalOpen)}</div>
          <p class="muted small">${open.length ? `${open.length} conta(s) para pagar` : 'Tudo em dia.'}${waiting.length ? ` · ${waiting.length} aguardando confirmação` : ''}</p></div>
        ${open.length ? payInfoCard(d) : ''}
        ${open.length ? `<h2>Para pagar</h2><div class="card">${open.map(e => row(e) + `<div class="actions" style="margin:0 0 10px"><button class="btn primary" data-act="inform" data-sid="${e.mine.id}" data-amount="${e.mine.amount_cents}" data-title="${esc(e.title)}" data-eid="${e.id}">Informar pagamento</button></div>`).join('')}</div>` : ''}
        ${toConfirm.length ? `<h2>Pagamentos para conferir</h2><div class="card">${toConfirm.map(s => `<div class="list-item" data-go="/despesa/${s.e.id}"><div class="grow"><b>${esc(s.member_name)}</b> · ${esc(s.e.title)}<div class="small muted">${money(s.amount_cents)}${s.has_receipt ? ' · com comprovante' : ''}</div></div><span class="chip informado">Conferir</span></div>`).join('')}</div>` : ''}
        ${waiting.length ? `<h2>Aguardando confirmação</h2><div class="card">${waiting.map(row).join('')}</div>` : ''}
        ${done.length ? `<h2>Pagas recentemente</h2><div class="card">${done.map(row).join('')}</div>` : ''}
        ${!mine.length && !toConfirm.length ? '<p class="empty">Nenhuma conta no seu nome ainda.</p>' : ''}
        ${d.can_settings ? `<button class="btn ghost block" data-act="settings">${I('settings')}Dados para pagamento e privacidade</button>` : ''}`,
      bind(el) { bindActs(el, common); },
    };
  }
  // ---- Contas da casa: arquivo das contas (fatura + comprovante) ----
  const cat = q.get('cat') || '';
  const houseBills = d.items.filter(e => !e.is_market && e.category !== 'caixinha' && (!cat || e.category === cat));
  const months = {};
  for (const e of houseBills) (months[(e.due_date || '').slice(0, 7) || 'sem'] ||= []).push(e);
  const catsUsed = [...new Set(d.items.filter(e => !e.is_market && e.category !== 'caixinha').map(e => e.category))];
  const card = e => `<div class="list-item" data-go="/despesa/${e.id}" style="flex-wrap:wrap">
      <span class="li-ico">${I(CAT_ICON[e.category] || 'file')}</span>
      <div class="grow"><b>${esc(e.title)}</b><div class="small muted">${money(e.total_cents)}${e.due_date ? ` · vence ${fmtDate(e.due_date)}` : ''}${e.full_view && e.totals.count ? ` · ${e.totals.confirmed}/${e.totals.count} pagaram` : ''}</div></div>
      <span class="chip ${e.house_paid ? 'paga' : (e.due_date && e.due_date < t ? 'atrasada' : 'pendente')}">${e.house_paid ? 'Paga' : 'Em aberto'}</span>
      ${docsLine(e)}
    </div>`;
  function docsLine(e) {
    const parts = [];
    if (e.has_bill) parts.push(`<span class="doc">${I('file')}Fatura</span>`); else if (d.can_manage) parts.push(`<span class="doc missing">${I('file')}Sem fatura</span>`);
    if (e.house_paid) parts.push(e.has_paid_receipt ? `<span class="doc">${I('receipt')}Comprovante</span>` : `<span class="doc missing">${I('receipt')}Sem comprovante</span>`);
    return parts.length ? `<div class="actions" style="width:100%;margin:6px 0 0 48px">${parts.join('')}</div>` : '';
  }
  const hidden = !d.docs_visible && !d.can_manage;
  return {
    html: `${head}${tabs}
      <p class="muted small">Arquivo das contas da casa com a fatura e o comprovante de pagamento, para ninguém ter dúvida se foi paga.${d.can_manage ? '' : ` Quem paga as contas: <b>${esc(d.payers.join(', ') || '—')}</b>.`}</p>
      ${hidden ? `<div class="notice"><span class="notice-ico">${I('lock')}</span><div class="grow">As faturas e comprovantes da casa estão visíveis só para o responsável pelas contas.</div></div>` : `
      ${catsUsed.length > 1 ? `<div class="seg" style="margin:8px 0">${['', ...catsUsed].map(c => `<button data-go="/financeiro?aba=casa${c ? '&cat=' + c : ''}" class="${cat === c ? 'on' : ''}">${c ? CAT_ICON[c] + ' ' + esc(d.categories[c]) : 'Todas'}</button>`).join('')}</div>` : ''}
      ${Object.keys(months).sort().reverse().map(k => `<h2>${monthName(k)}</h2><div class="card">${months[k].map(card).join('')}</div>`).join('') || '<p class="empty">Nenhuma conta arquivada ainda.</p>'}`}
      ${d.can_settings ? `<button class="btn ghost block" data-act="settings">${I('settings')}Dados para pagamento e privacidade</button>` : ''}`,
    bind(el) { bindActs(el, common); },
  };
}

// ---------- Caixinha: o caixa da rep ----------
async function vCaixinha(tabs) {
  const d = await api(P('/caixinha'));
  const tz = S.H.house.timezone;
  const cur = d.months.find(m => m.month === d.current_month) || null;
  const mine = cur?.mine;
  const head = `<div class="page-head"><h1>Contas</h1>${d.can_manage ? `<button class="btn primary sm" data-act="move">${I('plus')}Movimentar</button>` : ''}</div>`;
  return {
    html: `${head}${tabs}
      <div class="card deep"><span class="label">Saldo da caixinha</span><div class="big-money">${money(d.balance)}</div>
        <p class="muted small">${money(d.contributions + d.entradas)} entrou · ${money(d.saidas)} saiu</p></div>

      ${!d.monthly_cents ? `<div class="notice info"><span class="notice-ico">${I('coins')}</span><div class="grow"><b>Caixinha ainda não configurada</b>
          <p class="muted small">${d.can_manage ? 'Defina quanto cada morador deposita por mês e o dia do vencimento.' : `${esc(d.payers.join(', ') || 'O Financeiro')} ainda não definiu o valor mensal.`}</p>
          ${d.can_manage ? '<div class="actions"><button class="btn primary sm" data-act="cfg">Definir valor mensal</button></div>' : ''}</div></div>` : `
      <h2>${cur ? esc(cur.title) : 'Este mês'}</h2>
      ${mine ? `<div class="card ${mine.status === 'pendente' ? 'accent' : ''}">
          <div class="row"><span class="label">Sua contribuição</span><span class="chip ${mine.status}">${SHARE_ST[mine.status]}</span></div>
          <div class="big-money" style="font-size:1.5rem">${money(mine.amount_cents)}</div>
          <p class="muted small">Vence dia ${fmtDate(cur.due_date)}${d.payers.length ? ` · deposite para ${esc(d.payers.join(', '))}` : ''}</p>
          ${mine.status === 'pendente' ? `<div class="actions"><button class="btn primary" data-act="inform" data-sid="${mine.id}" data-amount="${mine.amount_cents}" data-title="${esc(cur.title)}" data-eid="${cur.id}">Já depositei</button>${d.payment_info ? '<button class="btn" data-act="copypay">Copiar Pix</button>' : ''}</div>` : ''}
        </div>` : ''}
      ${cur ? `<div class="card"><div class="row"><span>${cur.paid} de ${cur.total} moradores depositaram</span><b>${money(cur.collected)}</b></div>
          <div class="progress" style="margin-top:10px;height:8px"><i style="width:${cur.total ? Math.round(cur.paid / cur.total * 100) : 0}%"></i></div>
          ${d.can_manage && cur.shares ? `<div style="margin-top:8px">${cur.shares.map(s => `<div class="list-item"><div class="grow"><span class="li-title">${esc(s.member_name)}</span>${s.receipt_file_id ? `<a class="li-sub" href="${fileUrl(s.receipt_file_id)}" target="_blank" rel="noopener">Ver comprovante</a>` : ''}</div>
            <span class="chip ${s.status}">${SHARE_ST[s.status]}</span>${s.status !== 'confirmado' ? `<button class="btn sm primary" data-act="conf" data-sid="${s.id}">Confirmar</button>` : ''}</div>`).join('')}</div>` : ''}
        </div>` : ''}
      <p class="muted small">Valor mensal: <b>${money(d.monthly_cents)}</b> por morador, até dia ${d.due_day}.${d.can_manage ? ' <a href="#" data-act="cfg">Alterar</a>' : ''}</p>`}

      <h2>Extrato</h2>
      ${d.extrato.length ? `<div class="list">${d.extrato.map(x => `<div class="list-item">
          <span class="li-ico ${x.kind === 'saida' ? 'late' : ''}">${I(x.kind === 'saida' ? 'up' : 'down')}</span>
          <span class="grow"><span class="li-title">${esc(x.description)}</span><span class="li-sub">${x.at ? fmtDateTime(x.at, tz) : ''}${x.by && x.source === 'manual' ? ` · por ${esc(x.by)}` : ''}${x.file_id ? ` · <a href="${fileUrl(x.file_id)}" target="_blank" rel="noopener">comprovante</a>` : ''}</span></span>
          <span class="money" style="color:${x.kind === 'saida' ? 'var(--warn)' : 'var(--ok)'}">${x.kind === 'saida' ? '−' : '+'}${money(x.amount_cents)}</span></div>`).join('')}</div>`
        : emptyState('coins', 'Nada no extrato ainda', 'Os depósitos confirmados e os gastos da caixinha aparecem aqui.')}
      ${d.months.length > 1 ? `<h2>Meses anteriores</h2><div class="list">${d.months.filter(m => m !== cur).map(m => `<div class="list-item"><span class="li-ico">${I('calendar')}</span>
          <span class="grow"><span class="li-title">${esc(m.title)}</span><span class="li-sub">${m.paid} de ${m.total} depositaram · ${money(m.collected)}</span></span>
          ${m.mine ? `<span class="chip ${m.mine.status}">${SHARE_ST[m.mine.status]}</span>` : ''}</div>`).join('')}</div>` : ''}`,
    bind(el) {
      bindActs(el, {
        copypay: () => copyText(d.payment_info),
        conf(b) { act(b, () => api(P(`/shares/${b.dataset.sid}/confirm`), { method: 'POST', body: {} }), { ok: 'Depósito confirmado.' }).then(render).catch(() => {}); },
        cfg() {
          sheet(sh => {
            sh.render(`<h2>Caixinha mensal</h2><p class="muted small">Todo mês cada morador recebe a cobrança desse valor. O saldo é o caixa da rep.</p>
              <label class="f" for="cv">Valor por morador</label><input id="cv" inputmode="decimal" placeholder="R$ 0,00" value="${d.monthly_cents ? (d.monthly_cents / 100).toFixed(2).replace('.', ',') : ''}">
              <label class="f" for="cd">Vence todo dia</label><input id="cd" type="number" min="1" max="28" value="${d.due_day || 10}">
              <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Salvar</button></div>`);
            $('#ok', sh.el).onclick = e => {
              const cents = parseMoney($('#cv', sh.el).value);
              if (!cents) return toast('Informe o valor.', { error: true });
              act(e.target, () => api(P('/caixinha/settings'), { method: 'PATCH', body: { monthly_cents: cents, due_day: +$('#cd', sh.el).value } }), { ok: 'Caixinha configurada. Os moradores foram avisados.' })
                .then(() => { sh.close(); render(); }).catch(() => {});
            };
          });
        },
        move() {
          const idem = uid();
          sheet(sh => {
            let kind = 'saida';
            const draw = () => {
              const keep = { v: $('#mv', sh.el)?.value || '', ds: $('#md', sh.el)?.value || '' };
              sh.render(`<h2>Movimentar caixinha</h2>
                <div class="seg"><button data-act="k" data-v="saida" class="${kind === 'saida' ? 'on' : ''}">${I('up')}Saída (gasto)</button><button data-act="k" data-v="entrada" class="${kind === 'entrada' ? 'on' : ''}">${I('down')}Entrada extra</button></div>
                <label class="f" for="md">Descrição</label><input id="md" type="text" maxlength="120" placeholder="${kind === 'saida' ? 'Ex.: Produtos de limpeza' : 'Ex.: Sobra da festa'}" value="${esc(keep.ds)}">
                <label class="f" for="mv">Valor</label><input id="mv" inputmode="decimal" placeholder="R$ 0,00" value="${esc(keep.v)}">
                <label class="f">Comprovante (opcional)</label><div id="up"></div>
                <p class="muted small">Saldo atual: ${money(d.balance)}</p>
                <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" data-act="ok">Registrar</button></div>`);
              up = uploader($('#up', sh.el), { hid: S.hid, kind: 'cash', pdf: true });
            };
            let up;
            bindActs(sh.el, {
              k(b) { kind = b.dataset.v; draw(); },
              ok(b) {
                const cents = parseMoney($('#mv', sh.el).value);
                if (!cents) return toast('Informe o valor.', { error: true });
                act(b, () => api(P('/caixinha/moves'), { method: 'POST', idem, body: { kind, amount_cents: cents, description: $('#md', sh.el).value, file_id: up.check() } }), { ok: 'Registrado no extrato.' })
                  .then(() => { sh.close(); render(); }).catch(() => {});
              },
            });
            draw();
          });
        },
      });
    },
  };
}

function financeSettings(d) {
  sheet(sh => {
    sh.render(`<h2>Contas da casa</h2>
      <label class="f" for="pi">Dados para pagamento (Pix, banco, nome)</label>
      <textarea id="pi" maxlength="300" placeholder="Ex.: Pix: (16) 99999-9999 · Nubank · Ana Souza">${esc(d.payment_info)}</textarea>
      <p class="muted small">Aparece para cada morador junto da parte dele.</p>
      <label class="check"><input type="checkbox" id="dv" ${d.docs_visible ? 'checked' : ''}> Moradores podem ver as faturas e comprovantes das contas em que participam</label>
      <p class="muted small">A divisão de cada morador (quem pagou, quanto) continua visível só para o responsável pelas contas.</p>
      <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Salvar</button></div>`);
    $('#ok', sh.el).onclick = e => act(e.target, () => api(P('/finance/settings'), { method: 'PATCH', body: { payment_info: $('#pi', sh.el).value, docs_visible: $('#dv', sh.el).checked } }), { ok: 'Salvo.' })
      .then(() => { sh.close(); render(); }).catch(() => {});
  });
}

async function vDespesa([id]) {
  const e = await api(P(`/expenses/${id}`));
  const me = S.H.me, tz = S.H.house.timezone;
  const manage = me.can_finance;
  const payers = S.fin?.payers || [];
  return {
    html: `<button class="btn ghost" data-go="/financeiro${e.is_market ? '' : '?aba=casa'}">${I('left')}Financeiro</button>
      <span class="label">${esc(e.category_label)}</span>
      <h1>${esc(e.title)}</h1><div class="big-money">${money(e.total_cents)}</div>
      <p class="muted">${e.due_date ? `Vencimento ${fmtDate(e.due_date)}` : 'Sem vencimento'}${e.receiver_name ? ` · pagar para ${esc(e.receiver_name)}` : ''}</p>

      ${e.mine ? `<div class="card ${e.mine.status === 'pendente' ? 'accent' : ''}"><div class="row"><span class="label">Sua parte</span><span class="chip ${e.mine.status}">${SHARE_ST[e.mine.status]}</span></div>
        <div class="big-money" style="font-size:1.6rem">${money(e.mine.amount_cents)}</div>
        ${e.mine.receipt_file_id ? `<div class="actions">${docLink(e.mine.receipt_file_id, I('receipt') + 'Meu comprovante', true)}</div>` : ''}
        ${e.mine.status === 'pendente' ? `<div class="actions"><button class="btn primary" data-act="inform" data-sid="${e.mine.id}" data-amount="${e.mine.amount_cents}" data-title="${esc(e.title)}" data-eid="${e.id}">Informar pagamento</button></div>` : ''}</div>
        ${e.mine.status === 'pendente' && !e.is_market && e.payment_info ? `<div class="card"><span class="label">Pague para ${esc(e.receiver_name || payers.join(', '))}</span><p class="small" style="white-space:pre-line">${esc(e.payment_info)}</p><div class="actions"><button class="btn" data-act="copypay">Copiar dados</button></div></div>` : ''}` : ''}

      <h2>Conta da casa</h2>
      <div class="card stack">
        <div class="row"><span>Situação</span><span class="chip ${e.house_paid ? 'paga' : 'pendente'}">${e.house_paid ? 'Paga' : 'Em aberto'}</span></div>
        ${e.house_paid ? `<p class="muted small">Paga${e.paid_by_name ? ` por ${esc(e.paid_by_name)}` : ''}${e.house_paid_at ? ` em ${fmtDateTime(e.house_paid_at, tz)}` : ''}.</p>` : ''}
        <div class="actions" style="margin-top:4px">${docLink(e.bill_file_id, I('file') + 'Fatura / boleto', e.has_bill)}${e.house_paid || e.has_paid_receipt ? docLink(e.paid_receipt_file_id, I('receipt') + 'Comprovante de pagamento', e.has_paid_receipt) : ''}</div>
        ${manage ? `<div class="actions">
          <button class="btn" data-act="bill">${e.has_bill ? 'Trocar fatura' : I('clip') + 'Anexar fatura'}</button>
          ${e.house_paid ? `<button class="btn" data-act="receipt">${e.has_paid_receipt ? 'Trocar comprovante' : I('clip') + 'Anexar comprovante'}</button><button class="btn ghost" data-act="unpay">Desmarcar paga</button>` : '<button class="btn primary" data-act="pay">Marcar conta como paga</button>'}
        </div>` : ''}
      </div>

      ${e.full_view && e.shares.length ? `<h2>Divisão</h2><div class="card">${e.totals.confirmed} de ${e.totals.count} confirmados
        ${e.shares.map(s => `<div class="list-item" style="flex-wrap:wrap"><div class="grow"><b>${esc(s.member_name)}</b><div class="small muted">${money(s.amount_cents)}${s.informed_at ? ' · informado ' + fmtDateTime(s.informed_at, tz) : ''}</div>
          ${s.receipt_file_id ? `<a class="small" href="${fileUrl(s.receipt_file_id)}" target="_blank" rel="noopener">Ver comprovante</a>` : ''}</div>
          <span class="chip ${s.status}">${SHARE_ST[s.status]}</span>
          ${e.can_confirm && s.member_id !== me.id && s.status !== 'confirmado' ? `<div class="actions" style="width:100%">${s.status === 'informado' ? `<button class="btn" data-act="rej" data-sid="${s.id}">Não encontrei</button>` : ''}<button class="btn primary" data-act="conf" data-sid="${s.id}">${s.status === 'informado' ? 'Confirmar' : 'Confirmar recebimento'}</button></div>` : ''}</div>`).join('')}</div>`
      : e.totals.count && !e.full_view ? `<p class="muted small">${I('lock')} A divisão entre os moradores fica só com ${esc(payers.join(', ') || 'o responsável pelas contas')}.</p>` : ''}`,
    bind(el) {
      const attach = (kind, title, path, field, extra = {}) => sheet(sh => {
        const idem = uid();
        const payFlow = extra.paid === true;
        sh.render(`<h2>${title}</h2><p class="muted small">Foto ou PDF. Fica guardado aqui para comprovar depois.</p><div id="up"></div>
          ${payFlow ? `<label class="check"><input type="checkbox" id="fc"> Paguei com o dinheiro da caixinha (${money(e.total_cents)} sai do saldo)</label>` : ''}
          <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Salvar</button></div>`);
        const up = uploader($('#up', sh.el), { hid: S.hid, kind, pdf: true, required: kind === 'bill', label: 'o arquivo' });
        $('#ok', sh.el).onclick = ev => act(ev.target, () => api(P(`/expenses/${e.id}/${path}`), { method: 'POST', idem, body: { ...extra, ...(payFlow ? { from_caixinha: $('#fc', sh.el).checked } : {}), [field]: up.check() } }), { ok: 'Salvo.' })
          .then(() => { sh.close(); render(); }).catch(() => {});
      });
      bindActs(el, {
        copypay: () => copyText(e.payment_info),
        bill: () => attach('bill', 'Fatura / boleto', 'documents', 'bill_file_id'),
        receipt: () => attach('house_receipt', 'Comprovante de pagamento da conta', 'documents', 'paid_receipt_file_id'),
        pay: () => attach('house_receipt', 'Conta paga — anexar comprovante', 'house-paid', 'receipt_file_id', { paid: true }),
        unpay(b) { act(b, () => api(P(`/expenses/${e.id}/house-paid`), { method: 'POST', body: { paid: false } })).then(render).catch(() => {}); },
        conf(b) { act(b, () => api(P(`/shares/${b.dataset.sid}/confirm`), { method: 'POST', body: {} }), { ok: 'Pagamento confirmado.' }).then(render).catch(() => {}); },
        rej(b) { act(b, () => api(P(`/shares/${b.dataset.sid}/reject`), { method: 'POST', body: {} }), { ok: 'Morador avisado.' }).then(render).catch(() => {}); },
      });
    },
  };
}

async function vNovaDespesa() {
  if (!S.H.me.can_finance) return { html: '<p class="empty">Só o responsável pelas contas pode lançar contas.</p>' };
  const t = today();
  const st = { cat: 'aluguel', split: true, mode: 'equal', parts: activeMembers().map(m => m.id), custom: {}, titleTouched: false };
  const idem = uid();
  const autoTitle = () => `${{ aluguel: 'Aluguel', agua: 'Água', luz: 'Luz', internet: 'Internet', gas: 'Gás', condominio: 'Condomínio', mercado: 'Mercado', outro: 'Conta' }[st.cat]} de ${MONTHS[+t.slice(5, 7) - 1]}`;
  return {
    html: '<div id="form"></div>',
    bind(el) {
      const f = $('#form', el);
      const keep = { title: autoTitle(), total: '', due: '' };
      let up;
      const read = () => { if ($('#et', f)) { keep.title = $('#et', f).value; keep.total = $('#ev', f).value; keep.due = $('#ed', f).value; for (const i of $$('[data-cm]', f)) st.custom[i.dataset.cm] = i.value; } };
      const shares = () => {
        if (!st.split) return [];
        const total = parseMoney(keep.total) || 0;
        if (st.mode === 'equal') {
          const n = st.parts.length; if (!n) return [];
          const base = Math.floor(total / n), rest = total - base * n;
          return st.parts.map((id, i) => ({ member_id: id, amount_cents: base + (i < rest ? 1 : 0) }));
        }
        return st.parts.map(id => ({ member_id: id, amount_cents: parseMoney(st.custom[id]) || 0 }));
      };
      const sumLine = () => {
        const total = parseMoney(keep.total) || 0, sum = shares().reduce((a, s) => a + s.amount_cents, 0);
        const ok = total > 0 && (!st.split || (sum === total && st.parts.length));
        $('#sum', f).innerHTML = !total ? '<span class="muted">Informe o valor total.</span>' : !st.split ? '<span class="sum-ok">✓ Só arquivar (sem dividir).</span>' : sum === total ? `<span class="sum-ok">✓ A soma bate com o total.</span>` : `<span class="sum-bad">Soma das partes: ${money(sum)} · ${sum < total ? 'faltam' : 'sobram'} ${money(Math.abs(total - sum))}</span>`;
        $('#save', f).disabled = !ok;
        if (st.split && st.mode === 'equal') for (const s of shares()) { const x = $(`[data-eq="${s.member_id}"]`, f); if (x) x.textContent = money(s.amount_cents); }
      };
      const draw = () => {
        f.innerHTML = `<button class="btn ghost" data-go="/financeiro?aba=casa">${I('left')}Financeiro</button><h1>Nova conta</h1>
          <label class="f">Tipo</label>
          <div class="seg">${CAT_LIST.map(c => `<button data-act="cat" data-v="${c}" class="${st.cat === c ? 'on' : ''}">${CAT_ICON[c]} ${esc(S.fin?.categories?.[c] || c)}</button>`).join('')}</div>
          ${st.cat === 'mercado' ? '<p class="muted small">Compras de mercado ficam visíveis para todos os participantes.</p>' : '<p class="muted small">Cada morador vê só a parte dele. A divisão completa fica com você.</p>'}
          <label class="f" for="et">Nome</label><input id="et" type="text" maxlength="80" value="${esc(keep.title)}">
          <label class="f" for="ev">Valor total</label><input id="ev" inputmode="decimal" placeholder="R$ 0,00" value="${esc(keep.total)}">
          <label class="f" for="ed">Vencimento</label><input id="ed" type="date" value="${esc(keep.due)}">
          <label class="f">Fatura / boleto (opcional)</label><div id="up"></div>
          <label class="check" style="margin-top:12px"><input type="checkbox" id="sp" ${st.split ? 'checked' : ''}> Dividir entre os moradores</label>
          ${st.split ? `<label class="f">Participantes</label>
            <div class="seg">${activeMembers().map(m => `<button data-act="p" data-v="${m.id}" class="${st.parts.includes(m.id) ? 'on' : ''}">${esc(m.name)}</button>`).join('')}</div>
            <label class="f">Como dividir</label>
            <div class="seg"><button data-act="mode" data-v="equal" class="${st.mode === 'equal' ? 'on' : ''}">Igualmente</button><button data-act="mode" data-v="custom" class="${st.mode === 'custom' ? 'on' : ''}">Valores por quarto</button></div>
            <div class="card">${st.parts.map(id => `<div class="list-item"><div class="grow">${esc(member(id).name)}</div>${st.mode === 'equal' ? `<span class="money" data-eq="${id}"></span>` : `<input style="width:130px" inputmode="decimal" data-cm="${id}" placeholder="R$ 0,00" value="${esc(st.custom[id] || '')}">`}</div>`).join('') || '<p class="muted">Escolha os participantes.</p>'}</div>` : '<p class="muted small">A conta fica só no arquivo, com a fatura e o comprovante.</p>'}
          <p id="sum"></p>
          <button class="btn primary big" id="save" data-act="save">Lançar conta</button>`;
        const prevFile = up?.fileId;
        up = uploader($('#up', f), { hid: S.hid, kind: 'bill', pdf: true });
        if (prevFile) { up = { fileId: prevFile, check: () => prevFile }; $('#up', f).innerHTML = '<p class="small sum-ok">✓ Fatura anexada</p>'; }
        $('#et', f).oninput = () => { st.titleTouched = true; };
        $('#sp', f).onchange = e => { read(); st.split = e.target.checked; draw(); };
        for (const i of $$('input', f)) i.addEventListener('input', () => { read(); sumLine(); });
        sumLine();
      };
      bindActs(f, {
        cat(b) { read(); st.cat = b.dataset.v; if (!st.titleTouched) keep.title = autoTitle(); draw(); },
        p(b) { read(); const id = +b.dataset.v; st.parts = st.parts.includes(id) ? st.parts.filter(x => x !== id) : [...st.parts, id]; draw(); },
        mode(b) { read(); st.mode = b.dataset.v; draw(); },
        save(b) {
          read();
          act(b, () => api(P('/expenses'), { method: 'POST', idem, body: { title: keep.title, category: st.cat, total_cents: parseMoney(keep.total), due_date: keep.due || null, split: st.split, shares: shares(), bill_file_id: up.check() } }), { ok: st.split ? 'Conta lançada. Cada morador foi avisado da parte dele.' : 'Conta arquivada.' })
            .then(r => go(`/despesa/${r.id}`)).catch(() => {});
        },
      });
      draw();
    },
  };
}

// ---------- casa ----------
async function vCasa() {
  const H = S.H, h = H.house, me = H.me;
  // no computador (localhost) o convite precisa usar o endereço da rede, senão não abre no celular dos outros
  const base = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && S.lan?.[0] ? S.lan[0] : location.origin;
  const link = `${base}/#/convite/${h.invite_code}`;
  const act_ = H.members.filter(m => m.active), old = H.members.filter(m => !m.active);
  return {
    html: `<div class="row start" style="gap:18px;margin:12px 0 4px"><span class="house-photo">${h.photo_file_id ? `<img src="${fileUrl(h.photo_file_id)}" alt="">` : esc(initials(h.name))}</span>
        <div><span class="label">República</span><h1 style="margin-top:2px">${esc(h.name)}</h1><p class="muted">${act_.length} morador(es)</p></div></div>
      <div id="phone-slot"></div>
      <h2>Convidar morador</h2>
      <div class="card">${h.invite_active ? `<p class="muted small">Quem abrir o link cria o próprio acesso e entra direto na casa.</p>
        <input type="text" readonly value="${esc(link)}" id="lnk">
        <div class="actions"><button class="btn primary" data-act="share">Compartilhar link</button><button class="btn" data-act="copy">Copiar</button></div>` : '<p class="muted">O link de convite está desativado.</p>'}
        ${me.is_admin ? `<div class="actions"><button class="btn ghost" data-act="toggle">${h.invite_active ? 'Desativar link' : 'Ativar link'}</button><button class="btn ghost" data-act="regen">Gerar link novo</button></div>` : ''}</div>
      <h2>Moradores</h2>
      <div class="card">${act_.map(m => `<div class="list-item" data-go="/morador/${m.id}">${avatar(m)}<div class="grow"><b>${esc(m.name)}${m.id === me.id ? ' (você)' : ''}</b><div class="small muted">${esc(m.role_label)}</div></div>${I('right', 'chev')}</div>`).join('')}</div>
      ${old.length ? `<details><summary class="muted" style="padding:8px 0;cursor:pointer">Ex-moradores (${old.length})</summary><div class="card">${old.map(m => `<div class="list-item" data-go="/morador/${m.id}">${avatar(m)}<div class="grow">${esc(m.name)}</div></div>`).join('')}</div></details>` : ''}
      <h2>Mais</h2>
      <div class="card">
        <div class="list-item" data-go="/compras"><span class="li-ico">${I('cart')}</span><div class="grow">${esc(h.shop_title)}</div>${I('right', 'chev')}</div>
        <div class="list-item" data-go="/ocorrencias"><span class="li-ico">${I('flag')}</span><div class="grow">Ocorrências</div>${I('right', 'chev')}</div>
        <div class="list-item" data-go="/notificacoes"><span class="li-ico">${I('bell')}</span><div class="grow">Notificações</div>${I('right', 'chev')}</div>
        ${me.is_admin ? `<div class="list-item" data-go="/configuracoes"><span class="li-ico">${I('settings')}</span><div class="grow">Configurações e personalização</div>${I('right', 'chev')}</div>` : ''}
      </div>
      ${S.houses.length > 1 ? `<h2>Suas repúblicas</h2><div class="card">${S.houses.map(x => `<div class="list-item" data-act="switch" data-id="${x.id}"><span class="li-ico">${I('home')}</span><div class="grow">${esc(x.name)}</div>${x.id === S.hid ? '<span class="chip concluida">Atual</span>' : ''}</div>`).join('')}</div>` : ''}
      <div class="actions"><button class="btn" data-go="/criar-casa">Criar outra república</button><button class="btn danger" data-act="logout">Sair da conta</button></div>
      <p class="muted small" style="margin-top:16px">Conectado como @${esc(S.me.username)}</p>`,
    bind(el) {
      phoneCard($('#phone-slot', el));
      bindActs(el, {
        async share() { if (navigator.share) { try { await navigator.share({ title: h.name, text: `Entre na ${h.name}:`, url: link }); } catch {} } else COPY(); },
        copy: () => COPY(),
        toggle(b) { act(b, () => api(P('/invite/toggle'), { method: 'POST', body: { active: !h.invite_active } })).then(async () => { await loadHouse(); render(); }).catch(() => {}); },
        async regen(b) {
          if (await confirmSheet({ title: 'Gerar um link novo?', text: 'O link antigo para de funcionar.', yes: 'Gerar' }))
            act(b, () => api(P('/invite/regenerate'), { method: 'POST', body: {} }), { ok: 'Link novo gerado.' }).then(async () => { await loadHouse(); render(); }).catch(() => {});
        },
        async switch(b) { S.hid = +b.dataset.id; store.set('hid', S.hid); await loadHouse(); go('/hoje'); },
        async logout(b) { await act(b, () => api('/api/auth/logout', { method: 'POST', body: {} })).catch(() => {}); S.me = null; go('/entrar'); },
      });
      const COPY = () => { const i = $('#lnk', el); i.select(); (navigator.clipboard?.writeText(link) || Promise.reject()).then(() => toast('Link copiado.')).catch(() => { document.execCommand('copy'); toast('Link copiado.'); }); };
    },
  };
}
const TZS = ['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Campo_Grande', 'America/Porto_Velho', 'America/Rio_Branco', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Bahia', 'America/Noronha', 'America/Boa_Vista', 'America/Araguaina', 'America/Maceio'];
const tzSelect = (id, val) => `<select id="${id}">${[...new Set([val, ...TZS])].filter(Boolean).map(z => `<option ${z === val ? 'selected' : ''}>${z}</option>`).join('')}</select>`;
async function vConfig() {
  const h = S.H.house;
  if (!S.H.me.is_admin) return { html: '<p class="empty">Só o administrador altera as configurações.</p>' };
  const rn = h.role_names;
  return {
    html: `<button class="btn ghost" data-go="/casa">${I('left')}Casa</button><h1>Configurações</h1>
      <h2>Identidade</h2><div class="card">
        <label class="f" for="cn">Nome da república</label><input id="cn" type="text" maxlength="60" value="${esc(h.name)}">
        <label class="f">Foto da casa</label><div id="up"></div>
        <label class="f" for="ht">Nome da tela inicial</label><input id="ht" type="text" maxlength="60" value="${esc(S.H.house.home_title)}">
        <label class="f" for="st">Nome da área de compras</label><input id="st" type="text" maxlength="60" value="${esc(S.H.house.shop_title)}">
        <label class="f" for="ac">Cor da casa</label><input id="ac" type="color" value="${esc(h.accent)}" style="width:72px;height:48px;border:0;background:none">
        <label class="f" for="tz">Fuso horário</label>${tzSelect('tz', h.timezone)}
      </div>
      <h2>Ocorrências</h2><div class="card">
        <label class="check"><input type="checkbox" id="sc" ${h.show_confirmed ? 'checked' : ''}> Mostrar ocorrências resolvidas para todos os moradores</label>
        <p class="muted small">Relatos pendentes, contestações e fotos ficam sempre só entre quem registrou, quem recebeu e quem revisa.</p></div>
      <h2>Avisos padrão das tarefas</h2><div class="card">
        <label class="check"><input type="checkbox" id="na" ${h.notify_defaults.assign ? 'checked' : ''}> Ao atribuir (de manhã, no dia)</label>
        <label class="check"><input type="checkbox" id="nb" ${h.notify_defaults.before ? 'checked' : ''}> 2h antes do prazo</label>
        <label class="check"><input type="checkbox" id="no" ${h.notify_defaults.after ? 'checked' : ''}> Depois do vencimento</label></div>
      <h2>Nomes dos cargos</h2><div class="card">
        ${[['admin', 'Quem administra'], ['schedule', 'Quem organiza escala e revisa'], ['finance', 'Quem cuida do financeiro'], ['member', 'Demais moradores']].map(([k, l]) => `<label class="f" for="r-${k}">${l}</label><input id="r-${k}" type="text" maxlength="40" value="${esc(rn[k])}">`).join('')}
        <p class="muted small">Quem pode o quê se escolhe no perfil de cada morador.</p></div>
      <h2>Ambientes</h2><div class="card">${S.H.environments.map(e => `<div class="list-item"><span class="li-ico">${I(e.icon)}</span><div class="grow">${esc(e.name)}</div></div>`).join('')}
        <div class="actions"><button class="btn" data-act="env">+ Novo ambiente</button></div></div>
      <button class="btn primary big" data-act="save" style="margin-top:16px">Salvar configurações</button>`,
    bind(el) {
      const up = uploader($('#up', el), { hid: S.hid, kind: 'house' });
      bindActs(el, {
        env() { newEnvSheet(() => render()); },
        save(b) {
          const body = {
            name: $('#cn', el).value, home_title: $('#ht', el).value, shop_title: $('#st', el).value, accent: $('#ac', el).value, timezone: $('#tz', el).value,
            show_confirmed: $('#sc', el).checked, notify_defaults: { assign: $('#na', el).checked, before: $('#nb', el).checked, after: $('#no', el).checked },
            role_names: Object.fromEntries(['admin', 'schedule', 'finance', 'member'].map(k => [k, $(`#r-${k}`, el).value])),
          };
          act(b, () => { const f = up.check(); if (f) body.photo_file_id = f; return api(P('/house'), { method: 'PATCH', body }); }, { ok: 'Configurações salvas.' })
            .then(async () => { await loadHouse(); go('/casa'); }).catch(() => {});
        },
      });
    },
  };
}

// ---------- compras ----------
async function vCompras() {
  const d = await api(P('/shop'));
  return {
    html: `<button class="btn ghost" data-go="/hoje">${I('left')}Hoje</button>
      <div class="row"><h1>${esc(S.H.house.shop_title)}</h1>${canSchedule() ? `<button class="btn primary sm" data-go="/novo-item">${I('plus')}Item</button>` : ''}</div>
      <p class="muted small">Cada item tem sua própria fila. Só quem está na vez recebe o aviso, mas todo mundo vê aqui de quem é a vez.</p>
      ${d.items.length ? `<div class="card">${d.items.map(shopRow).join('')}</div>` : '<p class="empty">Nenhum item ainda. Comece pelo galão de água.</p>'}`,
  };
}
const PAY = { buyer: 'Quem está na vez paga', split: 'Dividir entre os participantes', house: 'Sai da caixinha da rep' };
async function vItem([id]) {
  const it = await getItem(id);
  const tz = S.H.house.timezone;
  const order = it.participants.map((mid, n) => ({ m: member(mid), n }));
  return {
    html: `<button class="btn ghost" data-go="/compras">${I('left')}${esc(S.H.house.shop_title)}</button>
      <div class="row"><h1>${esc(it.name)}</h1>${canSchedule() ? `<button class="btn" data-go="/editar-item/${it.id}">Editar</button>` : ''}</div>
      <div class="card">${shopRow(it)}</div>
      ${it.status !== 'acabou' ? `<button class="btn block" data-act="shopBuy" data-id="${it.id}">Registrar compra</button>` : ''}
      <h2>Fila</h2><div class="card"><ol class="order">${order.map(({ m, n }) => `<li><span class="n">${n + 1}.</span><span class="grow">${esc(m?.name || '?')}${m && !m.active ? ' (saiu)' : ''}${it.credits[m?.id] ? ` <span class="small muted">· adiantou ${it.credits[m.id]} vez(es)</span>` : ''}</span>${m?.id === it.next_member ? '<span class="chip pendente" style="margin-right:8px">Próximo</span>' : ''}</li>`).join('')}</ol>
        <p class="muted small">Pagamento: ${PAY[it.payment_mode]} · Aviso: ${it.notify_mode === 'all' ? 'todos os participantes' : 'só quem está na vez'}</p></div>
      <h2>Histórico</h2>
      ${it.history.length ? `<div class="card">${it.history.map(p => `<div class="list-item"><div class="grow"><b>${esc(p.buyer_name)} comprou</b>${p.buyer_id !== p.turn_of ? ` · contou como a vez de ${esc(p.turn_name)}` : p.counts_as === 'own' ? ' · adiantou a própria vez' : ''}<div class="small muted">${fmtDateTime(p.created_at, tz)}${p.amount_cents ? ' · ' + money(p.amount_cents) : ''}${p.expense_id ? ' · <a href="#/despesa/' + p.expense_id + '">ver no Financeiro</a>' : ''}</div></div>
        ${p.receipt_file_id ? `<a class="small" href="${fileUrl(p.receipt_file_id)}" target="_blank" rel="noopener">Nota</a>` : ''}</div>`).join('')}</div>` : '<p class="muted">Nenhuma compra registrada ainda.</p>'}`,
  };
}
async function vItemEditor(params) {
  const id = params?.[0];
  const ICONS = SHOP_ICONS;
  let st;
  if (id) { const it = await getItem(id); st = { name: it.name, icon: iconKey(it.icon, 'cart'), participants: [...it.participants], starter: it.next_member, payment_mode: it.payment_mode, notify_mode: it.notify_mode }; }
  else st = { name: '', icon: 'droplet', participants: activeMembers().map(m => m.id), starter: null, payment_mode: 'buyer', notify_mode: 'turn' };
  const idem = uid();
  return {
    html: '<div id="form"></div>',
    bind(el) {
      const f = $('#form', el);
      const read = () => { if ($('#in', f)) { st.name = $('#in', f).value; st.starter = +$('#ss', f).value || null; } };
      const draw = () => {
        f.innerHTML = `<button class="btn ghost" data-go="${id ? `/compras/${id}` : '/compras'}">${I('left')}Voltar</button><h1>${id ? 'Editar item' : 'Novo item'}</h1>
          <label class="f" for="in">Nome</label><input id="in" type="text" maxlength="40" placeholder="Ex.: Galão de água" value="${esc(st.name)}">
          <label class="f">Ícone</label><div class="seg">${ICONS.map(i => `<button class="icon-pick ${st.icon === i ? 'on' : ''}" data-act="ic" data-v="${i}" aria-label="${i}">${I(i)}</button>`).join('')}</div>
          <label class="f">Quem participa</label><div class="seg">${activeMembers().map(m => `<button data-act="pt" data-v="${m.id}" class="${st.participants.includes(m.id) ? 'on' : ''}">${esc(m.name)}</button>`).join('')}</div>
          <p class="muted small">Ordem da fila:</p>
          <ol class="order">${st.participants.map((mid, n) => `<li><span class="n">${n + 1}.</span><span class="grow">${esc(member(mid)?.name || '?')}</span><button class="icon-btn" data-act="up" data-n="${n}" ${n === 0 ? 'disabled' : ''} aria-label="Subir">${I('up')}</button><button class="icon-btn" data-act="down" data-n="${n}" ${n === st.participants.length - 1 ? 'disabled' : ''} aria-label="Descer">${I('down')}</button></li>`).join('')}</ol>
          <label class="f" for="ss">Quem é o próximo a comprar?</label>
          <select id="ss">${st.participants.map(mid => `<option value="${mid}" ${st.starter === mid ? 'selected' : ''}>${esc(member(mid)?.name)}</option>`).join('')}</select>
          <p class="muted small">Use para respeitar o rodízio que a casa já usa (quem comprou por último fica antes dele na fila).</p>
          <label class="f">Como funciona o pagamento</label>
          <div class="opts one">${Object.entries(PAY).map(([k, l]) => `<button class="opt ${st.payment_mode === k ? 'on' : ''}" data-act="pm" data-v="${k}"><span>${l}<small>${{ buyer: 'Quem vai comprar também arca com o custo.', split: 'A compra confirmada vira uma despesa no Financeiro, dividida entre os participantes.', house: 'O valor sai do saldo da caixinha.' }[k]}</small></span></button>`).join('')}</div>
          <label class="f">Quem recebe o aviso quando acaba</label>
          <div class="seg"><button data-act="nm" data-v="turn" class="${st.notify_mode === 'turn' ? 'on' : ''}">Só quem está na vez</button><button data-act="nm" data-v="all" class="${st.notify_mode === 'all' ? 'on' : ''}">Todos os participantes</button></div>
          <p class="muted small">Em qualquer caso, todo mundo vê a situação no painel.</p>
          <div class="actions" style="margin-top:20px">${id ? '<button class="btn danger" data-act="arch">Arquivar</button>' : ''}<button class="btn primary big" data-act="save">${id ? 'Salvar' : 'Criar item'}</button></div>`;
      };
      bindActs(f, {
        ic(b) { read(); st.icon = b.dataset.v; draw(); },
        pt(b) { read(); const v = +b.dataset.v; st.participants = st.participants.includes(v) ? st.participants.filter(x => x !== v) : [...st.participants, v]; draw(); },
        up(b) { read(); const n = +b.dataset.n; [st.participants[n - 1], st.participants[n]] = [st.participants[n], st.participants[n - 1]]; draw(); },
        down(b) { read(); const n = +b.dataset.n; [st.participants[n + 1], st.participants[n]] = [st.participants[n], st.participants[n + 1]]; draw(); },
        pm(b) { read(); st.payment_mode = b.dataset.v; draw(); },
        nm(b) { read(); st.notify_mode = b.dataset.v; draw(); },
        save(b) {
          read();
          const body = { name: st.name, icon: st.icon, participants: st.participants, starter_member_id: st.starter, payment_mode: st.payment_mode, notify_mode: st.notify_mode };
          act(b, () => id ? api(P(`/shop/items/${id}`), { method: 'PATCH', body }) : api(P('/shop/items'), { method: 'POST', idem, body }), { ok: 'Item salvo.' })
            .then(r => go(`/compras/${id || r.id}`)).catch(() => {});
        },
        async arch(b) {
          if (await confirmSheet({ title: `Arquivar ${st.name}?`, text: 'Some do painel. O histórico fica guardado.', yes: 'Arquivar', danger: true }))
            act(b, () => api(P(`/shop/items/${id}`), { method: 'PATCH', body: { archive: true } })).then(() => go('/compras')).catch(() => {});
        },
      });
      draw();
    },
  };
}

// ---------- entrar / cadastro / convite / criar casa ----------
const authShell = inner => `<div class="auth"><img class="logo" src="/brand/logo.webp" alt="República Pantanal" width="340" height="292">
  <p class="tagline">A rotina da casa sem precisar perguntar no grupo</p>${inner}<div id="phone-slot"></div></div>`;
// No computador, mostra o QR para abrir no celular (mesmo Wi-Fi)
async function phoneCard(slot) {
  if (!slot || !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  try {
    const d = await api('/api/local-links');
    if (!d.urls.length) return;
    const u = d.urls[0];
    slot.innerHTML = `<div class="card" style="text-align:left"><h3>${I('phone')} Abrir no celular</h3>
      <div class="qr" style="margin-top:8px">${d.qr ? `<img src="/qr.svg?u=${encodeURIComponent(u)}" alt="QR code para abrir no celular">` : ''}
      <div><p class="muted small">Conecte o celular no mesmo Wi-Fi deste computador e aponte a câmera para o código, ou digite:</p><code>${esc(u)}</code>
      ${d.urls.length > 1 ? `<p class="muted small">Se não abrir, tente: ${d.urls.slice(1).map(esc).join(' · ')}</p>` : ''}</div></div></div>`;
  } catch {}
}
async function afterAuth() {
  const inv = ss.get('invite');
  await loadMe();
  if (inv) {
    ss.set('invite', null);
    try { const r = await api(`/api/invite/${inv}/join`, { method: 'POST', body: {} }); S.hid = r.id; store.set('hid', r.id); await loadMe(); }
    catch (e) { toast(e.message, { error: true }); }
  }
  await boot();
}
async function vEntrar() {
  const inv = ss.get('invite');
  return {
    html: authShell(`<form id="f" class="card">${inv ? '<p class="muted">Entre para aceitar o convite da casa.</p>' : ''}
      <label class="f" for="em">Usuário</label><input id="em" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Ex.: zago" required>
      <label class="f" for="pw">Senha</label><input id="pw" type="password" autocomplete="current-password" required>
      <button class="btn primary big" style="margin-top:18px">Entrar</button></form>
      <p class="switch">Ainda não tem conta? <a href="#/cadastro">Criar conta</a></p>`),
    bind(el) {
      phoneCard($('#phone-slot', el));
      $('#f', el).onsubmit = e => { e.preventDefault(); act(e.submitter, () => api('/api/auth/login', { method: 'POST', body: { username: $('#em', el).value, password: $('#pw', el).value } })).then(afterAuth).catch(() => {}); };
    },
  };
}
async function vCadastro() {
  return {
    html: authShell(`<form id="f" class="card"><label class="f" for="nm">Seu nome</label><input id="nm" type="text" autocomplete="name" maxlength="60" required>
      <label class="f" for="em">Usuário (para entrar)</label><input id="em" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="30" placeholder="Ex.: zago" required>
      <p class="muted small">Sem espaços. Pode ser o seu apelido da rep.</p>
      <label class="f" for="pw">Senha (mínimo 6 caracteres)</label><input id="pw" type="password" autocomplete="new-password" minlength="6" required>
      <button class="btn primary big" style="margin-top:18px">Criar conta</button></form>
      <p class="switch">Já tem conta? <a href="#/entrar">Entrar</a></p>`),
    bind(el) {
      // sugere o usuário a partir do nome
      const nm = $('#nm', el), us = $('#em', el);
      nm.oninput = () => { if (!us.dataset.touched) us.value = nm.value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, '.'); };
      us.oninput = () => { us.dataset.touched = '1'; };
      $('#f', el).onsubmit = e => { e.preventDefault(); act(e.submitter, () => api('/api/auth/register', { method: 'POST', body: { name: nm.value, username: us.value, password: $('#pw', el).value } })).then(afterAuth).catch(() => {}); };
    },
  };
}
async function vConvite([code]) {
  let inv;
  try { inv = await api(`/api/invite/${code}`); } catch (e) { return { html: authShell(`<div class="card warn">${esc(e.message)}</div><a class="btn" href="#/entrar">Ir para o início</a>`) }; }
  ss.set('invite', code);
  return {
    html: authShell(`<div class="card"><span class="label">Você foi convidado para</span><h1 style="margin:6px 0">${esc(inv.name)}</h1><p class="muted small">${inv.members} morador(es) já estão lá</p>
      <div class="actions">${S.me ? `<button class="btn primary big" data-act="join">Entrar na ${esc(inv.name)}</button>` : `<a class="btn primary big" href="#/cadastro">Criar meu acesso</a>`}</div></div>
      ${S.me ? '' : '<p class="switch">Já tem conta? <a href="#/entrar">Entrar</a></p>'}`),
    bind(el) { bindActs(el, { join(b) { act(b, afterAuth).catch(() => {}); } }); },
  };
}
async function vCriarCasa() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
  return {
    html: `${S.houses.length ? `<button class="btn ghost" data-go="/casa">${I('left')}Voltar</button>` : ''}<h1>Criar república</h1>
      <p class="muted">Você vira o administrador e recebe um link de convite para mandar aos outros moradores.</p>
      <form id="f"><label class="f" for="hn">Nome da república</label><input id="hn" type="text" maxlength="60" placeholder="Ex.: República Pantanal" required>
      <label class="f" for="tz">Fuso horário</label>${tzSelect('tz', tz)}
      <button class="btn primary big" style="margin-top:18px">Criar</button></form>
      ${S.houses.length ? '' : '<p class="muted small" style="margin-top:16px">Recebeu um link de convite? Abra o link que mandaram — você entra direto na casa.</p><button class="btn ghost" data-act="logout">Sair da conta</button>'}`,
    bind(el) {
      bindActs(el, { async logout() { await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {}); S.me = null; go('/entrar'); } });
      $('#f', el).onsubmit = e => { e.preventDefault(); act(e.submitter, () => api('/api/houses', { method: 'POST', body: { name: $('#hn', el).value, timezone: $('#tz', el).value } }), { ok: 'República criada!' }).then(async r => { S.hid = r.id; store.set('hid', r.id); await loadMe(); await loadHouse(); go('/casa'); }).catch(() => {}); };
    },
  };
}

// ======================================================================
// ROTEADOR
// ======================================================================
const ROUTES = [
  [/^\/hoje$/, vHoje, 'hoje'], [/^\/quadro$/, vQuadro, 'quadro'], [/^\/regras$/, vRegras, 'quadro'],
  [/^\/tarefa\/(\d+)\/(\d{4}-\d{2}-\d{2})$/, vTarefa, 'quadro'], [/^\/nova-tarefa$/, vTaskEditor, 'quadro'], [/^\/editar-tarefa\/(\d+)\/(\d{4}-\d{2}-\d{2})$/, vTaskEditor, 'quadro'],
  [/^\/troca\/(\d+)$/, vTroca, 'hoje'], [/^\/ocorrencia\/(\d+)$/, vOcorrencia, 'hoje'], [/^\/ocorrencias$/, vOcorrencias, 'casa'],
  [/^\/morador\/(\d+)$/, vMorador, 'casa'], [/^\/notificacoes$/, vNotif, null], [/^\/perfil$/, vPerfil, 'perfil'],
  [/^\/financeiro$/, vFin, 'financeiro'], [/^\/despesa\/(\d+)$/, vDespesa, 'financeiro'], [/^\/nova-despesa$/, vNovaDespesa, 'financeiro'],
  [/^\/casa$/, vCasa, 'casa'], [/^\/configuracoes$/, vConfig, 'casa'],
  [/^\/compras$/, vCompras, 'hoje'], [/^\/compras\/(\d+)$/, vItem, 'hoje'], [/^\/novo-item$/, vItemEditor, 'hoje'], [/^\/editar-item\/(\d+)$/, vItemEditor, 'hoje'],
];
const PUBLIC = [[/^\/entrar$/, vEntrar], [/^\/cadastro$/, vCadastro], [/^\/convite\/([\w-]+)$/, vConvite]];

function setBell(n) {
  S.unread = n;
  const b = $('#bell-count');
  b.hidden = !n; b.textContent = n > 99 ? '99+' : n;
  // contador no ícone do app (iPhone/Android com o app instalado)
  try { n ? navigator.setAppBadge?.(n) : navigator.clearAppBadge?.(); } catch {}
}
// barra de baixo flutuante
const TABS = [['hoje', 'sun', 'Hoje'], ['quadro', 'calendar', 'Quadro'], ['financeiro', 'wallet', 'Contas'], ['casa', 'home', 'Casa'], ['perfil', 'user', 'Eu']];
document.getElementById('tabs').innerHTML = TABS.map(([k, i, l]) => `<a href="#/${k}" data-tab="${k}">${I(i)}<span>${l}</span></a>`).join('');
// resumo do dia em uma frase
function summaryLine(d, needCount) {
  const tasks = d.mine_today.filter(i => !i.completion).length + d.mine_overdue.length;
  const parts = [];
  if (tasks) parts.push(`${tasks} tarefa${tasks > 1 ? 's' : ''}`);
  if (needCount) parts.push(`${needCount} resposta${needCount > 1 ? 's' : ''} pendente${needCount > 1 ? 's' : ''}`);
  return parts.length ? `Você tem ${parts.join(' e ')} hoje.` : 'Nada pendente com você hoje.';
}
function chrome(on, tab, auth = false) {
  $('#top').hidden = !on; $('#tabs').hidden = !on;
  document.body.classList.toggle('auth-mode', auth);
  for (const a of $$('#tabs a')) a.classList.toggle('on', a.dataset.tab === tab);
  if (on && S.H) {
    const h = S.H.house;
    // o rótulo "República" já aparece em cima; não repetir no nome
    $('#house-name').textContent = h.name.replace(/^rep[úu]blica\s+/i, '') || h.name;
    $('#house-avatar').innerHTML = h.photo_file_id ? `<img src="${fileUrl(h.photo_file_id)}" alt="">` : esc(initials(h.name));
  }
}
function applyAccent(color) {
  document.documentElement.style.setProperty('--accent', color || '#2f7d5b');
  
}
async function loadMe() {
  const d = await api('/api/me');
  S.me = d.user; S.houses = d.houses; S.pushKey = d.push_key;
}
async function loadHouse() {
  S.H = await api(P('/house'));
  applyAccent(S.H.house.accent);
}

async function render() {
  const tok = ++S.tok;
  const raw = location.hash.slice(1) || '/hoje';
  const [path, qs] = raw.split('?');
  const q = new URLSearchParams(qs || '');
  const main = $('#view');
  for (const [re, fn] of PUBLIC) {
    const m = path.match(re);
    if (m) { chrome(false, null, true); const v = await fn(m.slice(1), q).catch(e => ({ html: `<p class="err">${esc(e.message)}</p>` })); if (tok !== S.tok) return; main.innerHTML = v.html; main.onclick = null; v.bind?.(main); return; }
  }
  if (!S.me) { try { await loadMe(); } catch { return go('/entrar'); } }
  if (path === '/criar-casa') { chrome(false); const v = await vCriarCasa(); if (tok !== S.tok) return; main.innerHTML = v.html; main.onclick = null; v.bind?.(main); return; }
  if (!S.houses.length) return go('/criar-casa');
  if (!S.houses.some(h => h.id === S.hid)) { S.hid = S.houses[0].id; store.set('hid', S.hid); }
  const route = ROUTES.find(([re]) => re.test(path));
  if (!route) return go('/hoje');
  const [re, fn, tab] = route;
  try {
    await loadHouse();
    const v = await fn(path.match(re).slice(1), q);
    if (tok !== S.tok) return;
    chrome(true, tab);
    main.innerHTML = v.html;
    main.onclick = null;
    bindActs(main);
    v.bind?.(main);
  } catch (e) {
    if (tok !== S.tok) return;
    chrome(true, tab);
    main.innerHTML = `<div class="card warn"><b>Não deu para carregar.</b><p class="muted">${esc(e.message)}</p><div class="actions"><button class="btn primary" id="retry">Tentar de novo</button></div></div>`;
    $('#retry').onclick = render;
  }
}
let lastRoute = '';
window.addEventListener('hashchange', () => {
  const r = location.hash.split('?')[0];
  render().then(() => { if (r !== lastRoute) window.scrollTo(0, 0); lastRoute = r; });
});

async function boot() {
  const qh = new URLSearchParams(location.search).get('h');
  if (qh) { store.set('hid', qh); history.replaceState(null, '', '/' + location.hash); }
  S.hid = +store.get('hid') || null;
  api('/api/local-links').then(d => { S.lan = d.urls; }).catch(() => {});
  try { await loadMe(); } catch { S.me = null; }
  if (S.me) syncPush();
  if (!S.me && !/^#\/(entrar|cadastro|convite)/.test(location.hash)) return go('/entrar');
  if (S.me && /^#\/(entrar|cadastro)$/.test(location.hash)) return go('/hoje');
  render();
}

// contador do sino + aviso local quando o push real não está disponível
setInterval(async () => {
  if (!S.me || !S.hid || document.visibilityState === 'hidden' && !('Notification' in window)) return;
  try {
    const { unread } = await api(P('/notifications?count=1'));
    if (unread > S.unread && document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted') {
      const reg = await navigator.serviceWorker?.ready;
      const sub = await reg?.pushManager?.getSubscription().catch(() => null);
      if (!sub) reg?.showNotification('República', { body: `Você tem ${unread} aviso(s) não lido(s).`, icon: '/brand/icon-192.png', tag: 'unread', data: { url: '/#/notificacoes' } });
    }
    setBell(unread);
  } catch {}
}, 20000);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot();
