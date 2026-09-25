# Lara · IA SDR das indicações de parceiro Kommo (Control Gestão)

A Kommo indica para a Control Gestão empresas que pediram um parceiro. Cada indicação chega em **Incoming leads** com a necessidade do cliente no `Comment:`. Este projeto tem duas partes:

1. **Userscript v3.1** (`userscript/kommo-indicacoes.user.js`, Tampermonkey): lê o `Comment:`, **não aceita teste** (decide pela intenção), **aceita no instante em que a Kommo libera** e avisa a Lara.
2. **Lara, a IA SDR** (Vercel): recebe o aviso, manda a **primeira mensagem com rapport** a partir do `Comment:`, qualifica pelo **CHAMP**, convida o decisor e **marca a reunião** na agenda do closer (tarefa de Reunião no Kommo, que a integração leva para o Google Agenda).

## Quem faz o quê

```
NAVEGADOR (Tampermonkey, aba do Kommo aberta)          VERCEL (Lara)
─────────────────────────────────────────────          ─────────────────────────────
card novo em Incoming leads
  → lê o Comment (card / API / notas / campos)
  → é teste? regra + IA de intenção ─────────────────→ /api/classificar
  → teste: NÃO aceita, selo vermelho
  → real: sonda o aceite antes dos 5 min,
          rajada na liberação, aceita na hora
  → aceitou ─────────────────────────────────────────→ /api/novo-lead
                                                         confere etapa, telefone, teste
                                                         1ª mensagem (saudação + Lara + Comment)
                                                         → Salesbot (WhatsApp Lite) → lead
lead responde no WhatsApp → Kommo (webhook add_message) → /api/inbound
                                                         CHAMP → consultar_horarios → agendar_reuniao
                                                         → tarefa de Reunião + nota + etapa
```

**O aceite é só no navegador.** A Kommo invalida indicação aceita por API, então nada no servidor aceita lead. O único webhook da Kommo que a Lara precisa é o de **mensagens** (`add_message`), que é como ela escuta o lead responder. Há um webhook de reserva opcional (`status_lead`), só para a Lara iniciar a conversa se o aviso do navegador falhar. Ele não é obrigatório.

## Como o userscript pega a liberação

A Kommo não libera em 5 minutos cravados, e até 5 parceiros disputam a mesma indicação. Por isso o script não dispara uma vez só aos 4min57s:

| Fase | Quando (a partir do created_at) | Ritmo |
|---|---|---|
| Sonda | de 4min15s até 4min52s | 1 tentativa a cada 2,5s |
| Rajada | de 4min52s até 5min20s | 150 a 300 ms |
| Depois | até 7min | 800 ms |

- "The leads is no longer available" e "The leads has already been accepted by other partners" = **ainda não liberou para nós**. O script continua tentando.
- "Requested lead is not found" ou o lead sumir de Incoming leads = acabou, ele para.
- Qualquer mudança no card na tela dispara uma tentativa na hora.
- **Aprende:** guarda quanto tempo depois do created_at cada aceite deu certo. Depois de 3 aceites, centraliza a rajada na mediana real, e não mais nos 5 min.
- Limite **global** de 6 req/s somando todos os leads (a Kommo bloqueia IP acima de 7).
- O relógio roda num Web Worker, então aba em segundo plano não atrasa. Deixe a aba do Kommo aberta e fixada, e tire o kommo.com da "Economia de memória" do Chrome, senão o Chrome congela a aba.

Filtro de teste: o óbvio ("teste", "lead de teste", "test 123", "asdf") é decidido pela regra, na hora. Quando "teste" aparece dentro de uma frase maior ("estamos testando o Kommo e queremos ajuda com o funil"), a **IA avalia a intenção** antes de aceitar. Se a IA não responder, vale o palpite da regra: contexto de trial passa, o resto bloqueia.

Console do Kommo:
- `__INDICACOES__.testar('Comment: estamos testando o Kommo')` testa o filtro;
- `copy(__INDICACOES__.relatorio())` copia tudo o que o script viu (HTML do card, cada resposta do aceite com o tempo). **É isso que eu preciso para calibrar.**

Prova em navegador (Chromium + Kommo simulado): `npm i --no-save playwright && node userscript/teste-navegador.mjs`.

## Regras da Lara

1. Começa sempre com a saudação do horário (bom dia até 12h, boa tarde até 18h, boa noite depois) e com "aqui é a Lara, da Control Gestão". Nunca abre com pergunta. **A saudação é garantida em código.**
2. Responde antes de perguntar.
3. Decisor sempre na reunião: se a decisão passa por outra pessoa, convida essa pessoa. O nome vai na tarefa da reunião.
4. Nunca informa preço. Descobre o tamanho pelo faturamento ou pelo número de vendedores.
5. CHAMP antes de marcar (checado em código): **C** onde organizam os leads, quantos vendedores e o que mais incomoda · **A** quem decide · **M** faturamento ou nº de vendedores · **P** começar este mês ou depois.

## Instalação

1. `npm install` · `cp .env.local.example .env.local` e preencha (token Kommo começa com `eyJ`).
2. `npm run discover`: funis, campos, usuários, tipos de tarefa, Incoming leads e onde o `Comment:` mora.
3. Preencha `lib/crm-map.ts` e os `[PREENCHER]` dos prompts. O `/api/validate` reprova enquanto houver placeholder.
4. `npm run typecheck && npm test` (hoje: 118 verificações verdes).
5. `EVAL_REPS=3 npm run evals`: todos aprovados ou não sobe.
6. Deploy na Vercel; `GET /api/validate?secret=` tem que dar `ok:true`.
7. Salesbot de envio (1 bloco "Enviar mensagem" pelo WhatsApp Lite, lendo o campo "Resposta IA (agente)") → `KOMMO_BOT_ID` → redeploy.
8. `npx tsx scripts/create-webhook.ts` (lista) → `--criar` (só `add_message`).
9. Userscript no Tampermonkey com `AGENTE_URL` e `AGENTE_SECRET` (= `INDICACAO_SECRET`).
10. E2E com lead próprio em `TEST_LEAD_IDS` (`MODO_INICIO=teste`): `npx tsx scripts/simulate-novo-lead.ts <LEAD_ID> "Comment"`.
11. `MODO_INICIO=ligado`.

## Operação

- **Desligar a Lara num lead:** tag `atendimento-humano` (ou tirar `ia-sdr`). Humano que escreve pelo Kommo faz a Lara recuar 6h.
- **Diário:** `/api/executions?secret=...`.
- **Depois de mexer no funil:** `/api/validate?secret=...`.

## Arquivos que são do cliente (patch)

`lib/crm-map.ts` · `lib/regras.ts` · `prompts/**` · `evals/cenarios.ts` · `scripts/test-cliente.ts` · `userscript/main.js` (CFG). O resto é motor do template.
