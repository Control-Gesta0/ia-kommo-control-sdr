# Diagnóstico · SDR das indicações Kommo

**Estado do projeto (25/09/2026): `VALIDANDO` (local).** Código construído, `tsc` limpo, `npm test` 107/107, userscript provado em Chromium contra Kommo simulado. **Não está no ar**: faltam dados do negócio, IDs vivos da conta, evals e E2E em número real.

## Fatos confirmados

| Fato | Fonte |
|---|---|
| CRM: Kommo. Canal: **WhatsApp Lite do Kommo**, envio pelo Salesbot (Desenho A) | Mestre, 25/09 |
| Agenda: **Google Agenda integrado ao Kommo** | Mestre, 25/09 |
| Aceite da indicação liberado em **5 min** (o script usa 4min57s + janela de 8s) | Mestre, 25/09 (a página pública ainda diz 15 min) |
| Aceite por API/webhook invalida a indicação; o aceite pelo endpoint web `/ajax/unsorted/accept` funciona | Mestre, operação atual |
| `USER_ID` 12725576 · `STATUS_ID` de entrada 55438567 | userscript em uso (conferidos pelo `/api/validate` no deploy) |
| Até **5 parceiros** podem aceitar a mesma indicação; depois disso ela some | support.kommo.com/docs/pt-br/become-a-kommo-partner |
| Contato com o cliente em até **2 dias úteis** depois do aceite | idem |
| Aceite deve ser **manual, no navegador**, não por automação; suspensão progressiva até exclusão | idem |
| Cota padrão: 2 indicações/dia, 30/mês | idem |
| API v4: limite de 7 req/s; insistência bloqueia o IP (403) | developers.kommo.com/docs/limitations |
| Webhooks de Incoming lead: `add_unsorted`, `delete_unsorted` (`action=accept` + `accept_result[leads][0]`) | developers.kommo.com/docs/webhooks-general |

## Decisões e trade-offs

1. **Filtro de teste em dois lugares com o mesmo código.** O navegador não aceita; o servidor não inicia conversa mesmo se alguém aceitar à mão. Ganha: teste nunca recebe mensagem. Custa: nada, a regra é um arquivo só (`userscript/filtro-indicacao.js`), e o `npm test` falha se o `.user.js` divergir.
2. **Filtro "inteligente" por padrão.** Quem está no trial da Kommo escreve "estou testando o Kommo" e é lead real. Ganha: não perde cliente em trial. Custa: um teste disfarçado de trial passa. Se preferir o literal, `FILTRO_MODO: 'estrito'` e `FILTRO_TESTE_MODO=estrito`.
3. **A IA fala primeiro, em segundos.** Com até 5 parceiros no mesmo lead, chegar primeiro com uma mensagem que mostra que leu o pedido é a vantagem. A abertura é gerada pelo modelo a partir do `Comment:` e passa pelas travas; se falhar, sai a abertura fixa do `crm-map`.
4. **Sem `Comment:` a IA não inicia** (`EXIGIR_COMENTARIO=1`). Fail-closed: pode não ser indicação. O userscript é a porta que traz o Comment lido na tela; o webhook espera 8s por ele.
5. **Agenda calculada em código, escolha resolvida em código.** O modelo só pode oferecer os horários que a tool devolveu, e só marca o horário que o LEAD escolheu entre os oferecidos (nunca "outro dia com a mesma hora"). Revalida a agenda imediatamente antes de criar. Só `agendar_reuniao` move a etapa, depois da tarefa criada.
6. **Reunião = tarefa de Reunião no Kommo** (a integração leva para o Google). Não criamos evento direto no Google para não duplicar. O free/busy do Google é leitura opcional para enxergar compromisso pessoal fora do Kommo.
7. **Alçada termina no agendamento.** Marcou, a IA confirma, põe nota e tira o gate. Proposta e negociação são do closer.
8. **Rampagem:** `MODO_INICIO=teste` só abre conversa com `TEST_LEAD_IDS`; `ligado` depois do E2E.

## O que falta (e o que cada item destrava)

**Do negócio (o mestre responde; bloqueia o deploy):**
- Nome da IA e 5 a 10 trechos reais de conversa boa do comercial → tom do prompt.
- O que a Control Gestão entrega numa implantação Kommo, prazo típico e **a política de preço** (faixa ou frase exata) → seção 2 do `prompts/nucleo.md`.
- 2 ou 3 clientes/segmentos que podem ser citados.
- Duração da reunião, expediente do closer, pausa de almoço, antecedência mínima → `CRM_MAP.agenda`.
- Quem é o closer (user_id sai do discover) e se há mais de um.
- O que qualifica ou desqualifica (ex.: menos de X usuários vai para outro fluxo?).

**Da conta (a skill descobre com o token):**
- `KOMMO_DOMAIN`, `KOMMO_TOKEN` (`eyJ...`), `KOMMO_ACCOUNT_ID` → `npm run discover`.
- Funil da etapa 55438567, etapa de "Reunião agendada", campo "Data da reunião", campo de resposta, tipo de tarefa Reunião.
- **Onde o `Comment:` fica depois do aceite** (nota, campo ou só no Incoming lead). O discover mostra lead a lead.
- `OPENAI_API_KEY`, Upstash Redis (`REDIS_PREFIX=ak-cg-sdr:`), `WEBHOOK_SECRET` e `INDICACAO_SECRET` novos.

**Ação manual na UI (uma vez):** Salesbot de envio pelo WhatsApp Lite → `KOMMO_BOT_ID`.

## Riscos e o que ainda precisa de prova

| Risco | Como aparece | Prova que fecha |
|---|---|---|
| Salesbot pelo WhatsApp Lite pode **não abrir conversa** com contato que nunca falou com a conta | IA "iniciou" no diário e nada chega no celular | E2E com número próprio: lead de teste sem chat → abertura chega no WhatsApp |
| Automação do aceite contra a regra do programa | suspensão da conta de parceiro | decisão do mestre: `MODO: 'automatico'` ou `'assistido'` |
| `Comment:` em formato diferente do esperado | diário mostra `sem-comentario` | discover + 1 indicação real |
| Integração Kommo ↔ Google não sincroniza tarefa criada pela API | reunião no card e não no calendário | E2E: tarefa criada pela IA aparece no Google do closer |
| API v4 recusar a sessão do navegador no userscript | log "API de Incoming leads indisponível" | o script segue pela tela do funil; só perde o `created_at` |

## Próximo gate

Receber os dados do negócio e o token → `discover` → preencher mapa e prompts → `validate` ok → evals 10/10 → deploy → Salesbot → E2E com número real → `MODO_INICIO=ligado`.
