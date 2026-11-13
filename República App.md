# República App

> Iniciativa pessoal · criado em 12/11/2026 · volta: [[Início]]

## Objetivo

Um site com cara de app no celular para a república organizar a rotina. A tela inicial responde a três perguntas: o que eu preciso fazer hoje, até que horas, e se alguém da casa precisa de uma resposta minha.

## Entregas

- MVP em `app/`: base (contas, casa, convite, funções), rotina (Hoje, escala, regras, rodízio, troca), convivência (ocorrências, revisão, histórico, notificações, anexos), financeiro (despesas, divisão, pagamentos) e compras da casa em rodízio

## Critério de piloto

A casa passa uma semana usando só o celular: monta a escala, troca uma tarefa, resolve uma ocorrência, confere quem fez o quê e lança e divide o aluguel sem ajuda.

Demonstração: começar pelo prato encontrado às 00h01 (regra da louça, prazo até 00h de terça).

## Status

- [x] MVP rodando localmente com dados da República Pantanal
- [x] Fluxos testados pela API (`npm test`)
- [ ] Teste em Android e iPhone de verdade (câmera, upload, conexão ruim, sem push)
- [ ] Publicar com HTTPS (precisa disso para push no iPhone e câmera fora da rede local)
