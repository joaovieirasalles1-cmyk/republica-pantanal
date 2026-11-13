# República

> Projeto criado em 12/11/2026. Pasta dedicada — instruções aqui sobrescrevem as da raiz quando relevantes.

## Sobre

Site com experiência de app no celular para organizar a rotina de repúblicas universitárias: tarefas, escala, regras, ocorrências, notificações, financeiro e compras em rodízio. Piloto: República Pantanal.

## Tipo

Iniciativa pessoal

## Entregas previstas

- MVP do app (`app/`) — briefing completo em [[projetos/republica/República App|República App]]

## Onde salvar o que

- Briefings e contexto: nessa pasta na raiz
- Código: `app/` (servidor Node + front-end em `app/public/`)

## Como rodar

- `Iniciar.bat` (ou `cd app` → `npm start`) → http://localhost:3000
- `npm run demo` recria a República Pantanal de demonstração (apaga os dados; parar o servidor antes)
- `npm test` roda os fluxos de ponta a ponta pela API (banco temporário)

## Arquitetura (decisões)

- Node ≥ 22 com SQLite embutido (`node:sqlite`). Sem framework, sem build. Única dependência: `web-push` (opcional, para push no celular)
- Banco e anexos em `app/data/` (não versionar)
- Escala não é gravada dia a dia: é calculada a partir da tarefa. Rodízio = `rotation[índice da ocorrência % tamanho]`, então avança mesmo se alguém atrasar. Trocas e "só esta data" viram `task_overrides`
- "Esta e as próximas" divide a tarefa em duas (a antiga termina na véspera) mantendo a posição do rodízio
- Toda rota `/api/h/:hid/...` exige morador ativo daquela casa (isolamento no servidor). Anexos só saem pela API com checagem de função
- Toque repetido: o front manda `X-Idem` em todo POST; o servidor devolve a mesma resposta sem duplicar

## Contexto que herda da raiz

Esse projeto herda automaticamente o tom de voz e contexto definidos em `_memoria/` da raiz. Não duplicar essas informações aqui.

## Identidade visual (Pantanal)

- Logo original e versão sem fundo em `identidade/` (`recortar-logo.cjs` refaz o recorte e os ícones)
- Arquivos usados pelo app em `app/public/brand/` (logo.webp, badge.webp, ícones PNG)
- Visual limpo: fundo branco, verde #1b7f2a só nos detalhes, fonte Poppins em tudo, barra de baixo flutuante (5 abas: Hoje, Quadro, Contas, Casa, Eu)
- Sem emojis na interface: ícones em traço em `app/public/icons.js` (`I('nome')`). Ambientes e itens de compra guardam o nome do ícone
- Aba "Eu" (`/perfil`): obrigações da pessoa em ordem de urgência, cada uma com o botão de ação

## Publicação (produção)

- Código: https://github.com/joaovieirasalles1-cmyk/republica-pantanal (privado, branch `main`; a raiz do repo é esta pasta)
- Site: https://republica-pantanal.vercel.app (Vercel, projeto `republica-pantanal`, função em `pdx1`)
- Banco: Supabase, projeto "App Rep" (`fulbqmfhffmtyqeephed`, us-west-2), schema `republica`, usuário `republica_app`. Arquivos no bucket privado `republica-arquivos`
- Chaves só em `app/.env.production.local` (local, fora do git) e nas variáveis da Vercel. Regravar na Vercel: `node deploy/vercel-env.mjs` (não usar `vercel env add` pelo PowerShell: corrompe os valores)
- Publicar mudança: `cd app` → `npm test` → `vercel deploy --prod --yes` → `node deploy/smoke.mjs https://republica-pantanal.vercel.app`
- Lembretes: pg_cron no Supabase (job `republica-lembretes`, a cada 5 min) chama `/api/cron?key=CRON_SECRET`
- Local continua com SQLite (`npm start`, `npm test`); com `DATABASE_URL` definido usa o Postgres
- Produção começou limpa (`seed.mjs --limpo`): casa, 7 moradores, cargos, ambientes, regras, escala e itens de compra. Senha inicial de todos: 123456

## Notificações no celular

- iPhone só recebe push com o app fechado se: site em HTTPS + app adicionado à Tela de Início + permissão dada dentro do app
- Pelo endereço local `http://192.168…` não funciona (o navegador bloqueia). Modo seguro: `npm run https` (Cloudflare Tunnel, precisa do `cloudflared`)
- O endereço do túnel muda a cada reinício: quem instalou o app precisa adicionar de novo. Para endereço fixo, precisa de conta/domínio

## Cargos

- **Veterano Master** (Faiska): todos os acessos, inclusive o financeiro. Único que muda cargos e configurações
- **Financeiro** (Passa): lança e anexa as contas, confirma pagamentos e cuida da caixinha
- **Morador** (Zago, Zara, Paviu, Sedex, Pegada): sem acesso a cargos, contas da casa ou configurações. "Organização" (escala + revisar ocorrências) é um extra opcional que o Master pode dar

## Caixinha

- Valor fixo por morador por mês (dia de vencimento configurável). A cobrança do mês é gerada sozinha e aparece em "Eu" e em Contas → Caixinha
- Saldo = depósitos confirmados + entradas extras − saídas. Contas pagas "com a caixinha" e compras no modo "Sai da caixinha" viram saída automática
- Moradores veem o saldo, o extrato e quantos depositaram; quem depositou (nome a nome) só o Financeiro e o Master

## Financeiro (regras)

- Contas da casa (aluguel, água, luz, internet…): só quem tem a função "financeiro" (o responsável pelas contas) vê a divisão de todos e confirma pagamentos. Cada morador vê só a própria parte. Nem o admin vê a parte dos outros
- Mercado e compras da casa: transparentes para todos os participantes
- Cada conta guarda a fatura e o comprovante de pagamento. A opção "moradores podem ver faturas e comprovantes" fica em Financeiro → Dados para pagamento e privacidade
- Pix/banco do responsável aparece para o morador na hora de pagar

## Celular

- O servidor mostra o link da rede e um QR code no terminal, na tela de entrar e em Casa (quando aberto no computador)
- O IP pode mudar quando o roteador reinicia: o QR sempre mostra o atual

## Específico desse projeto

- Textos da interface sempre em português, curtos e com opções clicáveis (evitar campo de texto obrigatório)
- Nomes da casa ("Painel X", "Compras da X") vêm do cadastro — nunca fixar "Pantanal" no código
