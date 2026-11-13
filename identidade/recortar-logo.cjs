// Tira o fundo do logo: o contorno externo do logo é branco, então inundo o fundo a partir das bordas
// sem atravessar o branco. Gera PNG transparente + ícones do app.
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.argv[2]);
const [src, outDir] = [process.argv[3], process.argv[4]];
fs.mkdirSync(outDir, { recursive: true });
(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  const p = await b.newPage();
  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(src).toString('base64');
  const res = await p.evaluate(async (dataUrl) => {
    const img = new Image(); img.src = dataUrl; await img.decode();
    const w = img.width, h = img.height;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const id = g.getImageData(0, 0, w, h), d = id.data;
    const N = w * h;
    const white = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const r = d[i * 4], gg = d[i * 4 + 1], bb = d[i * 4 + 2];
      const mx = Math.max(r, gg, bb), mn = Math.min(r, gg, bb);
      white[i] = mn > 205 && mx - mn < 45 ? 1 : 0;
    }
    const dilate = (m, rad) => { // dilatação separável (quadrado)
      const t = new Uint8Array(N), o = new Uint8Array(N);
      for (let y = 0; y < h; y++) { let cnt = 0; for (let x = -rad; x < w; x++) { if (x + rad < w && m[y * w + x + rad]) cnt++; if (x - rad - 1 >= 0 && m[y * w + x - rad - 1]) cnt--; if (x >= 0) t[y * w + x] = cnt > 0 ? 1 : 0; } }
      for (let x = 0; x < w; x++) { let cnt = 0; for (let y = -rad; y < h; y++) { if (y + rad < h && t[(y + rad) * w + x]) cnt++; if (y - rad - 1 >= 0 && t[(y - rad - 1) * w + x]) cnt--; if (y >= 0) o[y * w + x] = cnt > 0 ? 1 : 0; } }
      return o;
    };
    const R = 3;
    const barrier = dilate(white, R);
    const flood = () => {
      const bg = new Uint8Array(N);
      const q = new Int32Array(N); let qh = 0, qt = 0;
      const seed = i => { if (!barrier[i] && !bg[i]) { bg[i] = 1; q[qt++] = i; } };
      for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
      // a ponta direita da faixa encosta na borda: não semear a borda direita na altura da faixa
      for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
      while (qh < qt) {
        const i = q[qh++], x = i % w, y = (i / w) | 0;
        if (x > 0) seed(i - 1); if (x < w - 1) seed(i + 1); if (y > 0) seed(i - w); if (y < h - 1) seed(i + w);
      }
      return bg;
    };
    let bg = flood();
    // o contorno de baixo da faixa tem falhas: mede o selo pela parte de cima (íntegra) e usa a elipse como barreira
    let top = h, best = { y: 0, l: 0, r: 0 };
    for (let y = 0; y < h * 0.6; y++) {
      let l = -1, r = -1;
      for (let x = 0; x < w; x++) if (!bg[y * w + x]) { if (l < 0) l = x; r = x; }
      if (l >= 0) { if (y < top) top = y; if (r - l > best.r - best.l) best = { y, l, r }; }
    }
    const cx = (best.l + best.r) / 2, rx = (best.r - best.l) / 2 - R - 1, cy = best.y, ry = cy - top - R - 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) barrier[y * w + x] = 1;
    }
    // borda de baixo da faixa (linha branca fina demais): traça como barreira
    const line = (x0, y0, x1, y1, t) => {
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
      for (let s = 0; s <= n; s++) {
        const x = x0 + (x1 - x0) * s / n, y = y0 + (y1 - y0) * s / n;
        for (let dy = -t; dy <= t; dy++) for (let dx = -t; dx <= t; dx++) {
          const xx = Math.round(x + dx), yy = Math.round(y + dy);
          if (xx >= 0 && xx < w && yy >= 0 && yy < h) barrier[yy * w + xx] = 1;
        }
      }
    };
    line(40, 987, 310, 929, 3);
    line(860, 924, 1178, 993, 3);
    bg = flood();
    // logo = o que não é fundo; desfaz a dilatação (dilata o fundo de volta)
    const bg2 = dilate(bg, R);
    let minx = w, miny = h, maxx = 0, maxy = 0, count = 0;
    const alpha = new Float32Array(N);
    for (let i = 0; i < N; i++) { alpha[i] = bg2[i] ? 0 : 1; }
    // borda suave (blur 1px no alfa)
    const a2 = new Float32Array(N);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += alpha[(y + dy) * w + x + dx];
      a2[y * w + x] = s / 9;
    }
    for (let i = 0; i < N; i++) {
      d[i * 4 + 3] = Math.round(a2[i] * 255);
      if (a2[i] > 0.5) { count++; const x = i % w, y = (i / w) | 0; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
    }
    g.putImageData(id, 0, 0);
    const pad = 6;
    minx = Math.max(0, minx - pad); miny = Math.max(0, miny - pad); maxx = Math.min(w - 1, maxx + pad); maxy = Math.min(h - 1, maxy + pad);
    const cw = maxx - minx + 1, ch = maxy - miny + 1;
    const out = document.createElement('canvas'); out.width = cw; out.height = ch;
    out.getContext('2d').drawImage(c, minx, miny, cw, ch, 0, 0, cw, ch);
    const logo = out.toDataURL('image/png');
    // selo redondo (avatar): recorte quadrado em volta da elipse, cortando as pontas da faixa
    const rr = Math.round(Math.max(rx, ry) + R + 4);
    const bc = document.createElement('canvas'); bc.width = bc.height = 512;
    const bx = bc.getContext('2d');
    bx.beginPath(); bx.arc(256, 256, 256, 0, Math.PI * 2); bx.clip();
    bx.drawImage(c, cx - rr, cy - rr, rr * 2, rr * 2, 0, 0, 512, 512);
    const badge = bc.toDataURL('image/png');
    // amostras de cor para a paleta
    const px = (x, y) => { const k = (y * w + x) * 4; return '#' + [d[k], d[k + 1], d[k + 2]].map(v => v.toString(16).padStart(2, '0')).join(''); };
    // ícones: logo sobre verde, quadrado com margem
    const icon = (size, bgc, padPct) => {
      const ic = document.createElement('canvas'); ic.width = ic.height = size;
      const x = ic.getContext('2d');
      x.fillStyle = bgc; x.fillRect(0, 0, size, size);
      const avail = size * (1 - padPct * 2), s = Math.min(avail / cw, avail / ch);
      x.drawImage(out, (size - cw * s) / 2, (size - ch * s) / 2, cw * s, ch * s);
      return ic.toDataURL('image/png');
    };
    // marca d'água: só o jacaré + círculo (recorte quadrado do centro do selo)
    return {
      w, h, crop: [minx, miny, cw, ch], coverage: count / N, logo, badge,
      icon512: icon(512, '#0f5a24', 0.08), icon192: icon(192, '#0f5a24', 0.08), apple180: icon(180, '#0f5a24', 0.06), maskable512: icon(512, '#0f5a24', 0.16),
      samples: { ring: px(600, 165), belly: px(560, 420), banner: px(200, 840), dark: px(470, 600), deep: px(1100, 1100) },
    };
  }, dataUrl);
  const save = (name, durl) => fs.writeFileSync(path.join(outDir, name), Buffer.from(durl.split(',')[1], 'base64'));
  save('pantanal-logo.png', res.logo); save('pantanal-badge.png', res.badge);
  save('icon-512.png', res.icon512); save('icon-192.png', res.icon192); save('apple-touch-icon.png', res.apple180); save('icon-maskable-512.png', res.maskable512);
  console.log(JSON.stringify({ size: [res.w, res.h], crop: res.crop, coverage: res.coverage.toFixed(3), samples: res.samples }));
  // prévia: logo sobre xadrez para conferir o recorte
  const pv = await b.newPage({ viewport: { width: 900, height: 900 } });
  await pv.setContent(`<body style="margin:0;background:repeating-conic-gradient(#ccc 0 25%,#fff 0 50%) 0 0/24px 24px;display:grid;place-items:center;height:100vh"><img src="data:image/png;base64,${fs.readFileSync(path.join(outDir, 'pantanal-logo.png')).toString('base64')}" style="max-width:860px;max-height:860px"></body>`);
  await pv.screenshot({ path: path.join(outDir, '..', 'preview-cutout.png') });
  await b.close();
})();
