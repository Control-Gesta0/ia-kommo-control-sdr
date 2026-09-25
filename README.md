# IA SDR · Indicações de parceiro Kommo (Control Gestão)

A Kommo indica para a Control Gestão empresas que pediram um parceiro. Cada indicação chega em **Incoming leads** com a necessidade do cliente no `Comment:`. Este projeto faz três coisas:

1. **Userscript v3** (`userscript/kommo-indicacoes.user.js`, Tampermonkey): lê o `Comment:`, **não aceita indicação de teste**, aceita as reais no tempo certo (4min57s) e avisa o agente.
2. **Agente de IA** (Vercel): quando o lead é aceito, confere de novo se não é teste, **manda a primeira mensagem** pelo Salesbot (WhatsApp Lite), qualifica em poucas perguntas e **marca a reunião** na agenda do closer.
3. **Agenda**: horários livres calculados em código a partir das tarefas do closer no Kommo (e, se ligado, do livre/ocupado do Google Agenda). A reunião nasce como tarefa de Reunião no Kommo e a integração Kommo ↔ Google Agenda leva para o calendário.

Base: template Kommo v2 da skill `agente-ia-control-gestao-completo` (Desenho A, OpenAI, Upstash Redis, travas e evals).

## Como a indicação anda

```
Kommo → Incoming leads (Comment: ...)
  │
  ├─ userscript: lê o Comment (card, API de Incoming, notas, campos)
  │     teste? → NÃO aceita, selo vermelho no card, notificação
  │     real?  → aceita em created_at + 4min57s → POST /api/novo-lead (com o Comment)
  │
  └─ webhook Kommo (add_unsorted guarda o Comment · delete_unsorted/status_lead avisam o aceite)
        → /api/novo-lead  (idempotente: a primeira porta que chegar vence)
            etapa de entrada? Comment? teste? telefone? rampagem?
            → tag ia-sdr + indicacao-kommo · abertura personalizada pelo Comment
            → Salesbot (WhatsApp Lite) → lead
  lead responde → add_message → /api/inbound → buffer 10s → cérebro + tools
     salvar_respostas → consultar_horarios → agendar_reuniao
        → tarefa de Reunião no Kommo (→ Google Agenda) · etapa · nota · tira o gate
```

## Userscript v3: o que mudou da v2.1

| v2.1 | v3 | Por quê |
|---|---|---|
| Aceitava tudo | Lê o `Comment:` e não aceita teste | Pedido do negócio. Mesma regra roda no servidor (fonte única `userscript/filtro-indicacao.js`) |
| Relógio a partir da hora em que o card apareceu na tela | A partir do `created_at` do Incoming lead | Recarregar a página zerava a contagem |
| Estado só na memória | `localStorage` | Reload não reaceita nem esquece decisão |
| Só MutationObserver | Tela + consulta à API de Incoming leads com a sessão do navegador | Funciona com a aba em qualquer tela do Kommo |
| `setTimeout` | Relógio em Web Worker | Aba em segundo plano atrasava o disparo |
| 50 a 200 ms entre tentativas (até ~20 req/s) | 150 a 350 ms e recuo em 429 | A Kommo publica limite de 7 req/s e bloqueia IP que insiste |
| Só automático | `MODO: 'automatico'` ou `'assistido'` | Ver o aviso abaixo |
| Não falava com ninguém | Avisa o agente (`GM_xmlhttpRequest`) | A IA fala com o lead segundos depois do aceite |

**Aviso sobre a regra do programa.** O guia público de parceiros da Kommo pede aceite **manual, pelo navegador**, e não por automação, com suspensão progressiva (3 dias, 1 semana, 2 semanas, 1 mês, exclusão) para quem descumpre. O modo `automatico` mantém o comportamento que vocês já usam. O modo `assistido` filtra o teste, marca o card e avisa na hora de aceitar, e o clique fica com uma pessoa. A escolha é de vocês; está numa linha do `CFG`.

Filtro de teste (`FILTRO_MODO`):
- `inteligente` (padrão): bloqueia "teste", "lead de teste", "test 123", "isso é um teste", "asdf"... e também a palavra solta ("teste de integração"). **Deixa passar contexto de trial da Kommo**: "estou no período de teste do Kommo", "quero testar a integração com o WhatsApp". Quem está no trial é lead real.
- `estrito`: qualquer "teste/test" bloqueia.

Teste no console do Kommo: `__INDICACOES__.testar('Comment: estou testando o Kommo')`.

Prova em navegador de verdade (Chromium + Kommo simulado): `npm i --no-save playwright && node userscript/teste-navegador.mjs`. Resultado em 25/09/2026: lead real aceito na 3ª tentativa depois de dois "cedo demais", os dois testes (um no card, outro só nas notas) não aceitos, reload sem reaceite.

## Instalação

Ordem obrigatória (ver `docs/DIAGNOSTICO.md` para o que falta de cada item):

1. `npm install` · `cp .env.local.example .env.local` e preencha (token Kommo começa com `eyJ`).
2. `npm run discover`: funis, campos, usuários, tipos de tarefa, Incoming leads e **onde o `Comment:` mora** nos leads aceitos.
3. Preencha `lib/crm-map.ts` (entrada, closer, etapa de reunião, campos) e os `[PREENCHER]` dos prompts. O `/api/validate` reprova enquanto houver placeholder.
4. `npm run typecheck && npm test` (hoje: 107 verificações verdes).
5. `EVAL_REPS=3 npm run evals`: todos aprovados ou não sobe.
6. Deploy na Vercel com as envs; `GET /api/validate?secret=` tem que dar `ok:true`.
7. Salesbot de envio na UI (1 bloco "Enviar mensagem" pelo **WhatsApp Lite**, lendo o campo "Resposta IA (agente)") → `KOMMO_BOT_ID` → redeploy.
8. `npx tsx scripts/create-webhook.ts` (lista) → confirmar → `--criar` (cria `add_message` e `add_unsorted/delete_unsorted/status_lead`).
9. Userscript: instale `userscript/kommo-indicacoes.user.js` no Tampermonkey, preencha `AGENTE_URL` e `AGENTE_SECRET` (= `INDICACAO_SECRET`).
10. E2E com lead próprio em `TEST_LEAD_IDS` (`MODO_INICIO=teste`): `npx tsx scripts/simulate-novo-lead.ts <LEAD_ID> "Comment"` → conferir no celular, no card e em `/api/executions`.
11. Rampagem: `MODO_INICIO=ligado` só depois do E2E.

## Operação

- **Desligar a IA num lead:** tag `atendimento-humano` (ou tirar `ia-sdr`). Humano que escreve pelo Kommo faz a IA recuar 6h.
- **Diário:** `/api/executions?secret=...` (tipos `inicio`, `resposta`, `finalizou`, `pulou`, `erro`). Indicação de teste que passou pelo aceite aparece como `pulou · teste` e ganha a tag `indicacao-teste` com nota no card.
- **Depois de mexer no funil:** `/api/validate?secret=...`.

## Arquivos que são do cliente (patch)

`lib/crm-map.ts` · `lib/regras.ts` · `prompts/**` · `evals/cenarios.ts` · `scripts/test-cliente.ts` · `userscript/main.js` (CFG). O resto é motor do template.
