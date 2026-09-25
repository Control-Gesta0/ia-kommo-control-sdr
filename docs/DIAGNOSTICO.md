# Diagnóstico · SDR das indicações Kommo

**Estado do projeto (25/09/2026): `PROVANDO`.** Agente publicado em https://ia-kommo-control-sdr.vercel.app (Vercel, projeto `ia-kommo-control-sdr`). `/api/validate` confere a conta real e o único problema é o `KOMMO_BOT_ID` (Salesbot de envio ainda não criado). Webhook `add_message` 47492416 criado. `MODO_INICIO=teste`: a Lara só inicia conversa com leads em `TEST_LEAD_IDS`. Userscript v3.3 no Tampermonkey (aceite nunca antes dos 300s).

## Funil e follow-up (25/09/2026)

| Momento | O que a Lara faz |
|---|---|
| Manda a 1ª mensagem | move para **em contato** (80884464) |
| CHAMP completo | move para **QUALIFICAÇÃO** (40438379) |
| Reunião criada | move para **APRESENTAÇÃO agendada** (81193772). Daí para frente é o Rodrigo |
| Lead some no meio da conversa | follow-up em 4h, 1d, 3d e 7d da última mensagem dela, só em dia útil das 9h às 18h, retomando de onde parou |
| Cadência esgotada (+1 dia sem resposta) | funil Remarketing e Retornos futuros → REMARKETING, motivo "Sem resposta", Rodrigo responsável, tag `follow-up-esgotado` |
| Lead responde | a cadência para na hora |

Só move para frente e só no funil 4338500 (código em `lib/etapas.ts`, testado).

**Negociação** (construído, DESLIGADO até confirmar a etapa): mensagens em 2, 3, 5, 7 e 10 dias depois de o lead entrar na etapa (hoje configurada como "PROPOSTA ENVIADA", 103456716), campo "Próximo Follow-up" (1048617) com a data do próximo toque, cliente respondeu = para, sem resposta depois do último = tarefa para o Rodrigo. Liga com `negociacao.ativo: true` em `lib/crm-map.ts`.

Relógio: Vercel Cron a cada 15 min (`/api/cron`, `CRON_SECRET`). Fila em `/api/cron?secret=WEBHOOK_SECRET&ver=1`.

## Roteiro de virada (nesta ordem)

1. **Salesbot de envio** (Kommo → Salesbot → novo bot): um único bloco "Enviar mensagem", canal WhatsApp Lite, para o contato principal, conteúdo = campo do lead **"Resposta IA (Lara)"** (id 1048615). Salvar, ativar e copiar o número do bot da URL → env `KOMMO_BOT_ID` na Vercel → redeploy.
2. **E2E com o seu número:** criar um lead de teste na etapa "INICIAL - ENRIQUECIMENTO" com uma nota "Comment: ...", pôr o id em `TEST_LEAD_IDS`, rodar `npx tsx scripts/simulate-novo-lead.ts <id> "comment"` e conferir: mensagem no WhatsApp, tags, `/api/executions`. Responder pelo WhatsApp e ver a Lara seguir o CHAMP e marcar.
3. ~~Desligar a cadência antiga~~ **feito pelo mestre em 25/09**, conferido nos eventos do lead 20751955 (nenhuma mensagem automática nem Jornada K1 depois do aceite). Referência do que era: no Digital Pipeline do funil "Funil de vendas - SDR", etapa "INICIAL - ENRIQUECIMENTO", o gatilho que roda os bots "Lead inicial komo", "Lead inicial komo APÓS k1", "N- Lead inicial komo bom dia" e "Follow up - Campanha Lead Kommo". Os eventos mostram mensagens automáticas às indicações ~7 a 10 min depois do aceite, +4h, +24h e +5 dias. Sem desligar, o lead recebe as duas.
4. `MODO_INICIO=ligado` na Vercel → redeploy.
5. Robôs que ouvem mensagens na conta (ByteGPT x2, n8n `control-n8n`): nenhum mandou mensagem às indicações no histórico analisado; ficam como estão e são revistos se aparecer resposta dupla.

## Fatos confirmados

| Fato | Fonte |
|---|---|
| CRM: Kommo. Canal: **WhatsApp Lite do Kommo**, envio pelo Salesbot (Desenho A) | Mestre, 25/09 |
| Agenda: **Google Agenda integrado ao Kommo** | Mestre, 25/09 |
| Aceite liberado por volta de **5 min**, mas não cravado; outros parceiros podem levar antes | Mestre, 25/09 (a página pública ainda diz 15 min) |
| Antes da liberação a Kommo responde "The leads is no longer available"; se outro parceiro já aceitou, "The leads has already been accepted by other partners" | Mestre, 25/09 |
| Aceite por API/webhook invalida a indicação: o aceite é **só no navegador** (`/ajax/unsorted/accept`) | Mestre, operação atual |
| Salesbot inicia conversa pelo WhatsApp Lite com lead sem chat | Mestre, 25/09 |
| Liberação da indicação: **exatamente 300s** depois da chegada. Aceites aos 299s: 11 de 16 queimados; aos 300 a 301s: válidos, 8 perdidos para outros parceiros | Eventos de 62 indicações do funil 4338500, 25/09 |
| O Comment fica numa nota "common" com Country / Cluster / Languages / Industry / Comment | Notas das indicações, 25/09 |
| Closer: Rodrigo Campeoti (12725576). Reunião de 30 a 45 min, agenda reserva 1h, tarefa "Apresentação" | Mestre, 25/09 |
| Licença da Kommo em reais (6 meses, tabela BR): Básico R$104, Avançado R$156, Pro R$234 por usuário/mês | kommo.com/br/precos/compare-planos + print do mestre, 25/09 |
| IA se chama **Lara**; regras gerais (saudação por horário, responder antes, decisor na call, sem preço) e CHAMP | Mestre, 25/09 |
| Aceite automático e filtro de teste pela intenção | Decisão do mestre, 25/09 |
| `USER_ID` 12725576 · `STATUS_ID` de entrada 55438567 | userscript em uso (conferidos pelo `/api/validate` no deploy) |
| Até **5 parceiros** podem aceitar a mesma indicação; depois disso ela some | support.kommo.com/docs/pt-br/become-a-kommo-partner |
| Contato com o cliente em até **2 dias úteis** depois do aceite | idem |
| Aceite deve ser **manual, no navegador**, não por automação; suspensão progressiva até exclusão | idem |
| Cota padrão: 2 indicações/dia, 30/mês | idem |
| API v4: limite de 7 req/s; insistência bloqueia o IP (403) | developers.kommo.com/docs/limitations |
| Webhooks de Incoming lead: `add_unsorted`, `delete_unsorted` (`action=accept` + `accept_result[leads][0]`) | developers.kommo.com/docs/webhooks-general |

## Decisões e trade-offs

1. **Aceite pela liberação real, não por relógio fixo.** Sonda lenta antes, rajada em volta da liberação esperada, aprendizado da mediana real. Ganha: aceita no instante em que libera. Custa: umas 15 a 20 tentativas "cedo demais" por indicação, todas dentro do limite global de 6 req/s.
2. **Filtro de teste em duas camadas.** Regra para o óbvio (instantânea, igual no navegador e no servidor) e IA de intenção para o ambíguo. Na dúvida, a IA prefere "real": perder cliente custa mais que conversar com um teste.
3. **Userscript é o gatilho da Lara.** Ele avisa `/api/novo-lead` com o Comment; se o aviso falhar, reenvia (3s, 10s, 30s, 2 min) e, se ainda falhar, guarda como pendente e reenvia ao recarregar a página. Webhook da Kommo para isso é só reserva opcional.
4. **Saudação e apresentação em código.** O modelo recebe a saudação certa; se a abertura sair sem ela, com a errada ou começando por pergunta, o código corrige ou cai na abertura fixa. De 0h às 5h vale "boa noite".
5. **CHAMP checado em código antes de marcar.** Cada letra precisa de ao menos uma resposta (M vale por faturamento OU nº de vendedores). "Não sei" dito pelo lead conta como resposta.
6. **Sem preço, nunca.** Regra no prompt, eval `preco-sem-valor` reprova qualquer "R$".
7. **Agenda calculada e escolha resolvida em código**, revalidada antes de criar; só `agendar_reuniao` muda a etapa, e o decisor convidado vai na tarefa.
8. **Alçada termina no agendamento.** Rampagem por `MODO_INICIO` (teste → ligado).

## O que falta (e o que cada item destrava)

**Do negócio (o mestre responde; bloqueia o deploy):**
- 5 a 10 trechos reais de conversa boa do comercial → tom do prompt.
- O que a Control Gestão entrega numa implantação Kommo e 2 ou 3 clientes/segmentos que podem ser citados → seção 2 do `prompts/nucleo.md`.
- Duração da reunião, expediente do closer, pausa de almoço, antecedência mínima → `CRM_MAP.agenda`.
- Quem é o closer (user_id sai do discover) e se há mais de um.
- Existe corte de desqualificação no CHAMP (ex.: menos de 2 vendedores ou faturamento abaixo de X vai para outro fluxo)?

**Do navegador (para calibrar o aceite; o userscript coleta sozinho):**
- Instale a v3.1, deixe a aba do funil aberta e, depois da próxima indicação (aceita ou perdida), rode no console `copy(__INDICACOES__.relatorio())` e me mande o texto. Ele traz o HTML do card, a resposta exata da Kommo a cada tentativa e o tempo de cada uma. Com 2 ou 3 relatórios dá para ver se a tela mostra algum sinal de liberação (contador, botão que habilita) e apertar a rajada.
- O ID do funil das indicações: é o número na URL quando você abre o funil (`.../leads/pipeline/NÚMERO/`).

**Da conta (a skill descobre com o token):**
- `KOMMO_DOMAIN`, `KOMMO_TOKEN` (`eyJ...`), `KOMMO_ACCOUNT_ID` → `npm run discover`.
- Funil da etapa 55438567, etapa de "Reunião agendada", campo "Data da reunião", campo de resposta, tipo de tarefa Reunião.
- **Onde o `Comment:` fica depois do aceite** (nota, campo ou só no Incoming lead). O discover mostra lead a lead.
- `OPENAI_API_KEY`, Upstash Redis (`REDIS_PREFIX=ak-cg-sdr:`), `WEBHOOK_SECRET` e `INDICACAO_SECRET` novos.

**Ação manual na UI (uma vez):** Salesbot de envio pelo WhatsApp Lite → `KOMMO_BOT_ID`.

## Riscos e o que ainda precisa de prova

| Risco | Como aparece | Prova que fecha |
|---|---|---|
| Automação do aceite contra a regra pública do programa (aceite manual) | suspensão da conta de parceiro | decisão do mestre (25/09): automático |
| Tentativas antes da liberação serem vistas como abuso | aviso da Kommo ou bloqueio | limite de 6 req/s; sonda lenta ajustável em `SONDA_INTERVALO_MS` |
| Aba do Kommo congelada pelo Chrome | nenhum aceite no relatório | fixar a aba e tirar kommo.com da Economia de memória |
| `Comment:` em formato diferente do esperado | diário mostra `sem-comentario` | discover + 1 indicação real |
| Integração Kommo ↔ Google não sincroniza tarefa criada pela API | reunião no card e não no calendário | E2E: tarefa criada pela IA aparece no Google do closer |
| API v4 recusar a sessão do navegador no userscript | log "API de Incoming leads indisponível" | o script segue pela tela do funil; só perde o `created_at` |

## Próximo gate

Receber os dados do negócio e o token → `discover` → preencher mapa e prompts → `validate` ok → evals 10/10 → deploy → Salesbot → E2E com número real → `MODO_INICIO=ligado`. Em paralelo: userscript v3.1 no ar e os primeiros relatórios de aceite.
