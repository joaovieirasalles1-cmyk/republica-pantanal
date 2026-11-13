// Abre um endereço HTTPS público para o app (Cloudflare Tunnel, gratuito, sem conta).
// Necessário para notificações no iPhone: o iOS só entrega push para apps abertos por HTTPS
// e adicionados à Tela de Início. Uso: npm run https  (com o servidor já rodando)
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './lib/db.mjs';

const PORT = +process.env.PORT || 3000;
const FILE = path.join(DATA_DIR, 'public-url.txt');

function findCloudflared() {
  try { return execSync(process.platform === 'win32' ? 'where cloudflared' : 'which cloudflared', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split(/\r?\n/)[0].trim(); } catch {}
  for (const p of ['C:\\Program Files (x86)\\cloudflared\\cloudflared.exe', 'C:\\Program Files\\cloudflared\\cloudflared.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe')]) if (p && fs.existsSync(p)) return p;
  return null;
}
const bin = findCloudflared();
if (!bin) {
  console.log('\n  cloudflared não encontrado. Instale com:\n    winget install --id Cloudflare.cloudflared\n  e rode de novo.\n');
  process.exit(1);
}
const cf = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
let shown = false;
const onData = async buf => {
  const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m && !shown) {
    shown = true;
    fs.writeFileSync(FILE, m[0]);
    console.log(`\n  Endereço seguro (HTTPS): ${m[0]}\n`);
    try {
      const QR = (await import('qrcode')).default;
      console.log((await QR.toString(m[0], { type: 'terminal', small: true })).replace(/^/gm, '    '));
    } catch {}
    console.log('  No iPhone: abra no Safari → Compartilhar → Adicionar à Tela de Início → abra pelo ícone → Perfil → Ativar notificações.');
    console.log('  Este endereço muda toda vez que o túnel reinicia. Deixe esta janela aberta.\n');
  }
};
cf.stdout.on('data', onData);
cf.stderr.on('data', onData);
const stop = () => { try { fs.rmSync(FILE, { force: true }); } catch {} cf.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
cf.on('exit', code => { try { fs.rmSync(FILE, { force: true }); } catch {} console.log('túnel encerrado', code ?? ''); process.exit(code || 0); });
