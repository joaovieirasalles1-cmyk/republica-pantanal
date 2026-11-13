import { I } from './icons.js';
// Utilitários de interface: API, avisos, folhas (pop-ups), anexos e formatação.
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- API ----------
export class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
export let onUnauthorized = () => {};
export const setUnauthorized = fn => { onUnauthorized = fn; };

export async function api(path, { method = 'GET', body, idem } = {}) {
  const headers = { 'X-Requested-With': 'republica' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method === 'POST') headers['X-Idem'] = idem || uid();
  let lastErr;
  // conexão instável: tenta de novo com a mesma chave (o servidor não duplica)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
      const data = await r.json().catch(() => ({}));
      if (r.status === 401 && !path.startsWith('/api/auth/')) { onUnauthorized(); throw new ApiError(data.error || 'Entre na sua conta.', 401); }
      if (!r.ok) throw new ApiError(data.error || 'Algo deu errado.', r.status);
      return data;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      lastErr = e;
      await sleep(700 * (attempt + 1));
    }
  }
  throw new ApiError('Sem conexão. Confira a internet e tente de novo.', 0, lastErr);
}

// Executa uma ação de botão: trava o botão (toque repetido não duplica) e mostra erro claro
export async function act(btn, fn, { ok } = {}) {
  if (btn && btn.getAttribute('aria-busy') === 'true') return;
  if (btn) { btn.setAttribute('aria-busy', 'true'); btn.disabled = true; }
  try {
    const r = await fn();
    if (ok) toast(ok);
    return r;
  } catch (e) {
    toast(e.message || 'Algo deu errado.', { error: true });
    throw e;
  } finally {
    if (btn && btn.isConnected) { btn.removeAttribute('aria-busy'); btn.disabled = false; }
  }
}

// ---------- avisos ----------
export function toast(msg, { error = false, action, onAction, ms = 3800 } = {}) {
  const el = document.createElement('div');
  el.className = 't' + (error ? ' err' : '');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { el.remove(); onAction?.(); };
  $('#toast').append(el);
  setTimeout(() => el.remove(), action ? ms + 2500 : ms);
}

// ---------- folha (pop-up de baixo) ----------
export function sheet(render, { onClose } = {}) {
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = '<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div><div class="body"></div></div>';
  const body = bg.querySelector('.body');
  const api = {
    el: body,
    close() { bg.remove(); document.body.style.overflow = ''; onClose?.(); },
    render(html) { body.innerHTML = html; body.scrollTop = 0; bg.querySelector('.sheet').scrollTop = 0; },
  };
  bg.addEventListener('click', e => { if (e.target === bg) api.close(); });
  bg.addEventListener('click', e => { if (e.target.closest('[data-close]')) api.close(); });
  $('#sheet-root').append(bg);
  document.body.style.overflow = 'hidden';
  render(api);
  return api;
}

export function confirmSheet({ title, text = '', yes = 'Confirmar', no = 'Cancelar', danger = false }) {
  return new Promise(resolve => {
    let done = false;
    const s = sheet(sh => {
      sh.render(`<h2>${esc(title)}</h2>${text ? `<p class="muted">${text}</p>` : ''}
        <div class="actions"><button class="btn" data-close>${esc(no)}</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cf-yes">${esc(yes)}</button></div>`);
      sh.el.querySelector('#cf-yes').onclick = () => { done = true; sh.close(); resolve(true); };
    }, { onClose: () => { if (!done) resolve(false); } });
    return s;
  });
}

// ---------- anexos ----------
// Cria o campo de anexo: câmera ou arquivo, prévia, progresso, remover e mensagem de erro.
export function uploader(container, { hid, kind, pdf = false, label = 'Foto', required = false }) {
  const state = { fileId: null, uploading: false };
  const accept = pdf ? 'image/*,application/pdf' : 'image/*';
  container.innerHTML = `
    <div class="up-buttons">
      <label class="btn"><input type="file" accept="image/*" capture="environment">${I('camera')}Tirar foto</label>
      <label class="btn"><input type="file" accept="${accept}">${I(pdf ? 'file' : 'image')}${pdf ? 'Escolher arquivo' : 'Galeria'}</label>
    </div>
    <div class="up-slot"></div>`;
  const slot = container.querySelector('.up-slot');
  const btns = container.querySelector('.up-buttons');
  let xhr = null;

  const reset = () => { xhr?.abort(); state.fileId = null; state.uploading = false; slot.innerHTML = ''; btns.hidden = false; };
  async function handle(file) {
    if (!file) return;
    btns.hidden = true;
    const isPdf = file.type === 'application/pdf';
    const url = isPdf ? null : URL.createObjectURL(file);
    slot.innerHTML = `<div class="up-preview">${isPdf ? '<div class="pdf">PDF</div>' : `<img src="${url}" alt="">`}
      <div class="grow" style="flex:1;min-width:0"><div class="small up-msg">Preparando…</div><div class="progress"><i></i></div></div>
      <button type="button" class="icon-btn up-rm" aria-label="Remover anexo">${I('x')}</button></div>`;
    slot.querySelector('.up-rm').onclick = reset;
    const msg = slot.querySelector('.up-msg'), bar = slot.querySelector('.progress i');
    let blob = file;
    if (!isPdf) blob = await compress(file).catch(() => file);
    if (blob.size > 10 * 1024 * 1024) { msg.innerHTML = '<span class="err">Arquivo grande demais (máximo 10 MB).</span>'; return; }
    const send = () => new Promise(resolve => {
      state.uploading = true;
      msg.textContent = 'Enviando…'; bar.style.width = '0';
      xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/h/${hid}/files?kind=${kind}`);
      xhr.setRequestHeader('X-Requested-With', 'republica');
      xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
      xhr.upload.onprogress = e => { if (e.lengthComputable) bar.style.width = (e.loaded / e.total * 100) + '%'; };
      xhr.onload = () => {
        state.uploading = false;
        let d = {}; try { d = JSON.parse(xhr.responseText); } catch {}
        if (xhr.status === 200) { state.fileId = d.id; bar.style.width = '100%'; msg.textContent = '✓ Anexo pronto'; }
        else fail(d.error || 'Não foi possível enviar.');
        resolve();
      };
      xhr.onerror = () => { state.uploading = false; fail('Falha no envio. Confira a conexão.'); resolve(); };
      xhr.send(blob);
    });
    const fail = text => {
      msg.innerHTML = `<span class="err">${esc(text)}</span> <button type="button" class="btn ghost up-retry" style="min-height:32px;padding:0 6px">Tentar de novo</button>`;
      msg.querySelector('.up-retry').onclick = send;
    };
    send();
  }
  for (const inp of container.querySelectorAll('input[type=file]')) inp.onchange = () => { handle(inp.files[0]); inp.value = ''; };
  return {
    get fileId() { return state.fileId; },
    check() {
      if (state.uploading) throw new Error('Espere o anexo terminar de enviar.');
      if (required && !state.fileId) throw new Error(`Anexe ${label.toLowerCase()} para continuar.`);
      return state.fileId;
    },
  };
}

// reduz fotos grandes do celular antes de enviar (mais rápido em conexão ruim)
async function compress(file) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) && file.type) return file;
  const bmp = await createImageBitmap(file);
  const max = 1600, scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 1.5 * 1024 * 1024 && file.type === 'image/jpeg') return file;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej()), 'image/jpeg', 0.82));
}

// ---------- formatação ----------
export const WD = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const WDS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const WDN = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const wdOf = d => new Date(d + 'T00:00:00Z').getUTCDay();
export const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const fmtDate = d => (d ? d.split('-').reverse().slice(0, 2).join('/') : '');
export const fmtHour = t => { const [h, m] = t.split(':'); return m === '00' ? `${+h}h` : `${+h}h${m}`; };
export const money = c => 'R$ ' + (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function parseMoney(s) {
  s = String(s || '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
  const v = Math.round(parseFloat(s) * 100);
  return Number.isFinite(v) ? v : null;
}
export function fmtTime(ms, tz) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(ms)).replace(':', 'h');
}
export function fmtDateTime(ms, tz) {
  const d = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit' }).format(new Date(ms));
  return `${d} às ${fmtTime(ms, tz)}`;
}
export function relDay(date, today) {
  if (date === today) return 'hoje';
  if (date === addDays(today, -1)) return 'ontem';
  if (date === addDays(today, 1)) return 'amanhã';
  return `${WDN[wdOf(date)]} (${fmtDate(date)})`;
}
export const initials = n => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');

// ---------- visualizador de anexos (foto / PDF) com botão de fechar ----------
// Abre dentro do app: no app instalado na Tela de Início não existe "voltar" do navegador.
export async function viewFile(url, title = 'Anexo') {
  const bg = document.createElement('div');
  bg.className = 'viewer';
  bg.innerHTML = `<div class="viewer-bar"><span>${esc(title)}</span>
      <a class="viewer-btn" download aria-label="Baixar">${I('down')}</a>
      <button class="viewer-btn" data-close aria-label="Fechar">${I('x')}</button></div>
    <div class="viewer-body"><div class="viewer-msg">Carregando…</div></div>`;
  document.body.append(bg);
  document.body.style.overflow = 'hidden';
  let obj = null;
  const close = () => { bg.remove(); document.body.style.overflow = ''; if (obj) URL.revokeObjectURL(obj); removeEventListener('keydown', onKey); removeEventListener('popstate', onPop); };
  const onKey = e => { if (e.key === 'Escape') history.back(); };
  const onPop = () => close();
  // o gesto de voltar do celular também fecha
  history.pushState({ viewer: true }, '');
  addEventListener('popstate', onPop);
  addEventListener('keydown', onKey);
  bg.addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === bg.querySelector('.viewer-body')) history.back(); });
  try {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error();
    const blob = await r.blob();
    obj = URL.createObjectURL(blob);
    const body = bg.querySelector('.viewer-body');
    const dl = bg.querySelector('a[download]');
    dl.href = obj;
    dl.setAttribute('download', (title || 'anexo').replace(/[^\w\-]+/g, '_') + (blob.type === 'application/pdf' ? '.pdf' : blob.type.includes('png') ? '.png' : '.jpg'));
    body.innerHTML = blob.type === 'application/pdf' ? `<iframe src="${obj}" title="${esc(title)}"></iframe>` : `<img src="${obj}" alt="${esc(title)}">`;
  } catch {
    bg.querySelector('.viewer-msg').textContent = 'Não foi possível abrir o anexo.';
  }
}
