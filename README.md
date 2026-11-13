# República Pantanal

App (site com cara de aplicativo no celular) para organizar a rotina da República Pantanal: tarefas e escala em rodízio, regras da casa, ocorrências com resposta e revisão, compras da casa por vez, contas divididas com comprovantes, caixinha mensal e notificações no celular.

Produção: https://republica-pantanal.vercel.app

## Estrutura

```
app/
  server.mjs        API (Node, sem framework) — roda local ou como função da Vercel (api/index.mjs)
  lib/              banco (SQLite local / Postgres no Supabase), escala, notificações, arquivos
  public/           front-end (HTML/CSS/JS puro, PWA com service worker)
  test/             testes de ponta a ponta pela API
  deploy/           scripts de Supabase, migração, variáveis da Vercel e teste do site publicado
  seed.mjs          dados de exemplo (npm run demo) ou versão limpa (--limpo)
identidade/         logo original, sem fundo e o script que gerou os ícones
```

## Rodar no computador

```bash
cd app
npm install
npm run demo     # cria a casa de exemplo (senha de todos: 123456)
npm start        # http://localhost:3000 (e o endereço da rede para o celular)
npm test         # testes de ponta a ponta
```

Sem `DATABASE_URL` o app usa SQLite em `app/data/`. Com `DATABASE_URL` (ver `app/.env.example`) usa o Postgres.

## Publicar

```bash
cd app
npm test
vercel deploy --prod --yes
node deploy/smoke.mjs https://republica-pantanal.vercel.app
```

As chaves ficam em `app/.env.production.local` (fora do git) e nas variáveis da Vercel (`node deploy/vercel-env.mjs`). Lembretes por horário: pg_cron no Supabase chama `/api/cron` a cada 5 minutos.
