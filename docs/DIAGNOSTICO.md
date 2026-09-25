# Diagnóstico · SDR das indicações Kommo

**Estado do projeto (25/09/2026): `VALIDANDO` (local).** Código construído, `tsc` limpo, `npm test` 118/118, userscript v3.1 provado em Chromium contra Kommo simulado (liberação atrasada, "already accepted", lead expirado, Comment ambíguo decidido pela IA, limite de 6 req/s, reload). **Não está no ar**: faltam dados do negócio, IDs vivos da conta, evals e E2E em número real.

## Fatos confirmados

| Fato | Fonte |
|---|---|
| CRM: Kommo. Canal: **WhatsApp Lite do Kommo**, envio pelo Salesbot (Desenho A) | Mestre, 25/09 |
| Agenda: **Google Agenda integrado ao Kommo** | Mestre, 25/09 |
| Aceite liberado por volta de **5 min**, mas não cravado; outros parceiros podem levar antes | Mestre, 25/09 (a página pública ainda diz 15 min) |
| Antes da liberação a Kommo responde "The leads is no longer available"; se outro parceiro já aceitou, "The leads has already been accepted by other partners" | Mestre, 25/09 |
| Aceite por API/webhook invalida a indicação: o aceite é **só no navegador** (`/ajax/unsorted/accept`) | Mestre, operação atual |
| Salesbot inicia conversa pelo WhatsApp Lite com lead sem chat | Mestre, 25/09 |
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
