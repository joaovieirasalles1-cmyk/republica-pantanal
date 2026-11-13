// Service worker: guarda a casca do app (abre mesmo com conexão ruim) e mostra as notificações
// quando o app está fechado (iPhone: só com HTTPS + app adicionado à Tela de Início).
const CACHE = 'republica-v4';
const SHELL = ['/', '/index.html', '/app.js', '/ui.js', '/icons.js', '/styles.css', '/manifest.webmanifest', '/brand/logo.webp', '/brand/badge.webp', '/brand/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.origin !== location.origin) return;
  // rede primeiro; se cair, usa o cache
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('/index.html'))));
});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: 'República Pantanal', body: e.data ? e.data.text() : '' }; }
  const jobs = [self.registration.showNotification(d.title || 'República Pantanal', {
    body: d.body || '', icon: '/brand/icon-192.png', badge: '/brand/icon-192.png', tag: d.tag, data: { url: d.url || '/' },
  })];
  // contador no ícone do app (iOS 16.4+ e Android)
  if (typeof d.badge === 'number' && self.navigator.setAppBadge) jobs.push(self.navigator.setAppBadge(d.badge).catch(() => {}));
  e.waitUntil(Promise.all(jobs));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
// o navegador trocou a inscrição: avisa o app para registrar a nova
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => list.forEach(c => c.postMessage({ type: 'resubscribe' }))));
});
