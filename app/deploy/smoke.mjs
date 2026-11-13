// Teste rápido contra um servidor rodando (local com o Supabase, ou o site publicado).
// Uso: node deploy/smoke.mjs http://localhost:3100   (não altera dados, exceto 1 arquivo de teste e a leitura)
const BASE = process.argv[2] || 'http://localhost:3100';
let cookie = '';
const call = async (method, p, body, type = 'application/json') => {
  const r = await fetch(BASE + p, { method, headers: { 'X-Requested-With': 'republica', 'Content-Type': type, cookie }, body: body === undefined ? undefined : (type === 'application/json' ? JSON.stringify(body) : body) });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, data: ct.includes('json') ? await r.json() : await r.arrayBuffer() };
};
const t0 = Date.now();
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };
ok((await call('POST', '/api/auth/login', { username: 'faiska', password: '123456' })).status === 200, 'login do Faiska');
const me = (await call('GET', '/api/me')).data;
ok(me.houses?.length === 1, `casa: ${me.houses?.[0]?.name}`);
const H = `/api/h/${me.houses[0].id}`;
for (const p of ['/house', '/today', '/me', '/finance', '/caixinha', '/shop', `/schedule?from=2026-11-01&to=2026-11-30`, '/notifications', '/occurrences']) {
  const s = Date.now(); const r = await call('GET', H + p);
  ok(r.status === 200, `${p} (${Date.now() - s} ms)${r.status !== 200 ? ' → ' + JSON.stringify(r.data) : ''}`);
}
const house = (await call('GET', H + '/house')).data;
ok(house.members.find(m => m.name === 'Faiska')?.role_label === 'Veterano Master', 'Faiska é Veterano Master');
ok(house.members.find(m => m.name === 'Passa')?.role_label === 'Financeiro', 'Passa é Financeiro');
const photo = await call('GET', `${H}/files/${house.house.photo_file_id}`);
ok(photo.status === 200 && photo.data.byteLength > 1000, `foto da casa vem do Storage (${photo.data.byteLength} bytes)`);
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b40000000049454e44ae426082', 'hex');
const up = await call('POST', `${H}/files?kind=task`, png, 'image/png');
ok(up.status === 200, 'upload de foto para o Storage');
const back = await call('GET', `${H}/files/${up.data.id}`);
ok(back.status === 200 && back.data.byteLength === png.length, 'foto enviada volta igual');
ok((await call('GET', '/api/push/status')).data.enabled === true, 'notificações (push) ativas no servidor');
console.log(`\nTotal: ${Date.now() - t0} ms`);
