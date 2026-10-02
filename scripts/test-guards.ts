/**
 * npm test — travas determinísticas do MOTOR (sem rede, sem env de produção).
 * Cada cliente ACRESCENTA os casos das próprias regras (lib/regras.ts) no fim.
 */
process.env.KOMMO_DOMAIN ||= 'https://teste.kommo.com'
process.env.KOMMO_TOKEN ||= 'x'
process.env.KOMMO_ACCOUNT_ID ||= '1'
process.env.OPENAI_API_KEY ||= 'x'
process.env.UPSTASH_REDIS_REST_URL ||= 'https://x.upstash.io'
process.env.UPSTASH_REDIS_REST_TOKEN ||= 'x'
process.env.WEBHOOK_SECRET ||= 'x'

let falhas = 0
export function eq(nome: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${nome}${ok ? '' : ` → recebido ${JSON.stringify(got)}, esperado ${JSON.stringify(want)}`}`)
}

async function main() {
  const { checkReply, evidenceFound, keepLastQuestion, matchOption, parseNumeroBR, semTravessao } = await import('../lib/guards')
  const { escolhaMenu } = await import('../lib/router')
  const { parseKommoWebhook } = await import('../api/inbound')
  const regras = (t: string) => [...new Set(checkReply(t, []).map(v => v.regra))]

  // Degeneração do modelo (comum §49)
  eq('tool vazada', regras('salvar_respostas({"campo":"x"}) to=functions.salvar_respostas 重庆'), ['texto corrompido'])
  eq('JSON vazado', regras('{"respostas":[{"campo":"nome","evidencia":"joão","valor":"João"}]}'), ['texto corrompido'])
  eq('até 2 perguntas passam; 3 não', [regras('Qual a idade dele? E quantas pessoas moram na casa?'), regras('Qual a idade? Onde mora? Quem decide?')], [[], ['mais de uma pergunta']])
  eq('texto normal passa', regras('Entendido, Cláudia. Quantas pessoas moram junto com o Davi?'), [])
  // Tom humano (SKILL §5.1): travessão sai em código
  eq('travessão é violação', regras('O curso — que começa em março — custa R$ 1.200.'), ['travessão'])
  eq('aposto vira vírgula', semTravessao('O curso — que começa em março — custa R$ 1.200.'), 'O curso, que começa em março, custa R$ 1.200.')
  eq('faixa numérica vira "a"', semTravessao('Atendemos das 9–18h.'), 'Atendemos das 9 a 18h.')
  eq('travessão no fim da frase', semTravessao('Pode deixar — anotei.'), 'Pode deixar, anotei.')
  eq('sem travessão fica igual', semTravessao('Tá certo, anotei aqui.'), 'Tá certo, anotei aqui.')
  eq('corta eco da pergunta do lead', keepLastQuestion('Você tem direito? Quem avalia é o especialista. Qual a idade dele?', 'eu tenho direito?'), 'Quem avalia é o especialista. Qual a idade dele?')

  // Números e opções
  eq('R$ 1.491,00', parseNumeroBR('R$ 1.491,00'), 1491)
  eq('2,6 mil', parseNumeroBR('2,6 mil'), 2600)
  eq('não sei', parseNumeroBR('não sei'), null)
  const opts = [{ id: 1, value: 'Sim, do INSS' }, { id: 2, value: 'Não' }, { id: 3, value: 'Não sabe' }]
  eq('opção por texto → enum', matchOption('sim do inss', opts)?.id, 1)
  eq('"sim" ambíguo', matchOption('sim', [{ id: 1, value: 'Sim, do INSS' }, { id: 4, value: 'Sim, particular' }]), null)

  // Anti-invenção (comum §48)
  const lead = 'Moramos em 4 aqui em casa e a renda somada dá uns 2.600'
  eq('evidência real', evidenceFound('moramos em 4', lead), true)
  eq('evidência inventada', evidenceFound('não recebe outro benefício', lead), false)
  eq('"não" curto presente', evidenceFound('não', 'não'), true)

  // Menu
  eq('menu "4"', escolhaMenu('4'), 4)
  eq('menu "4️⃣"', escolhaMenu('4️⃣'), 4)
  eq('menu "3 - BPC"', escolhaMenu('3 - BPC/LOAS'), 3)
  eq('menu "opção 2"', escolhaMenu('opção 2'), 2)
  eq('texto não é menu', escolhaMenu('quero saber do bpc'), null)

  // Parser do webhook (formato plano e aninhado — kommo §5)
  const plano = parseKommoWebhook({ 'account[id]': '9', 'message[add][0][id]': 'm1', 'message[add][0][entity_id]': '77', 'message[add][0][text]': 'oi', 'message[add][0][attachment][type]': 'voice', 'message[add][0][attachment][link]': 'https://x/a.ogg' })
  eq('webhook plano', (({ bruto: _b, ...resto }) => resto)(plano!.msgs[0]), { id: 'm1', leadId: 77, text: 'oi', attachType: 'voice', attachLink: 'https://x/a.ogg', direction: '' })
  const semTipo = parseKommoWebhook({ 'message[add][0][id]': 'm2', 'message[add][0][entity_id]': '79', 'message[add][0][text]': '', 'message[add][0][media][link]': 'https://drive.kommo.com/x/voz.oga' })
  eq('webhook: áudio sem tipo de anexo acha o link mesmo assim', [semTipo?.msgs[0].attachLink], ['https://drive.kommo.com/x/voz.oga'])
  const aninhado = parseKommoWebhook({ account: { id: '9' }, message: { add: [{ id: 'm2', entity_id: '78', text: 'olá', type: 'incoming' }] } })
  eq('webhook aninhado', [aninhado?.accountId, aninhado?.msgs[0].leadId, aninhado?.msgs[0].direction], ['9', 78, 'incoming'])

  // Roteador (usa o crm-map real do projeto: rode depois de preencher as portas)
  const { rotear } = await import('../lib/router')
  const { CRM_MAP } = await import('../lib/crm-map')
  const p1 = CRM_MAP.portas.find(p => p.menu !== null)
  if (p1) {
    const r1 = rotear({}, `${p1.menu}`)
    eq('número sozinho trava a porta', r1.tipo === 'porta' && r1.porta.id, p1.id)
    const r2 = rotear({}, `${p1.menu} anos que parou`)
    eq('número dentro de frase NÃO é menu antes do menu', r2.tipo === 'porta' ? r2.porta.id : r2.tipo, CRM_MAP.menu.classificarTextoLivre && CRM_MAP.portas.filter(p => p.sinais.test(`${p1.menu} anos que parou`)).length === 1 ? CRM_MAP.portas.find(p => p.sinais.test(`${p1.menu} anos que parou`))!.id : 'mensagem')
    const r3 = rotear({ porta: p1.id }, `${CRM_MAP.menu.outros}`)
    eq('porta travada nunca muda', r3.tipo === 'porta' && r3.porta.id, p1.id)
    const r4 = rotear({}, 'oi boa tarde')
    eq('mensagem vaga → menu', r4.tipo === 'mensagem' && r4.texto, CRM_MAP.menu.texto)
    const r5 = rotear({ menuEnviado: true }, 'hã?')
    eq('não entendeu depois do menu', r5.tipo === 'mensagem' && r5.texto, CRM_MAP.menu.naoEntendi)
    const r6 = rotear({ aguardandoResumo: true }, 'zzz assunto que ninguém atende')
    eq('resumo sem sinal → porta padrão de outros', r6.tipo === 'porta' && r6.porta.id, CRM_MAP.menu.portaPadraoOutros)
  }

  // Finalização: remove a tag de gate e exige evidência
  const { runTool } = await import('../lib/tools')
  const porta = CRM_MAP.portas.find(p => p.ativa) || CRM_MAP.portas[0]
  const mundo = { tags: new Set(['gate', 'outra']), state: {} as Record<string, any> }
  const port = {
    getLead: async () => ({ id: 1, statusId: 1, pipelineId: 1, fields: {}, tags: [...mundo.tags] }),
    writeFields: async () => {}, moveStage: async () => {}, addNote: async () => {},
    addTags: async (t: string[]) => { t.forEach(x => mundo.tags.add(x)) },
    removeTags: async (t: string[]) => { t.forEach(x => mundo.tags.delete(x)) },
    getState: async () => ({ ...mundo.state }),
    patchState: async (p: Record<string, unknown>) => Object.assign(mundo.state, p),
  }
  const ctx = (lead: string) => ({ port, porta, gateTag: 'gate', leadText: lead, lastLeadText: lead, lastAgentText: '' }) as any
  let out = await runTool(ctx('quero organizar meu funil'), 'finalizar_atendimento', { motivo: 'ja_tem_parceiro', evidencia: 'já fechei com outro parceiro', resumo: 'x' })
  eq('motivo com evidência inventada NÃO finaliza', [out.isError, mundo.tags.has('gate')], [true, true])
  out = await runTool(ctx('obrigado, mas já fechei com outro parceiro ontem'), 'finalizar_atendimento', { motivo: 'ja_tem_parceiro', evidencia: 'já fechei com outro parceiro', resumo: 'x' })
  eq('motivo real finaliza e remove SÓ o gate', [out.isError, out.handoff, mundo.tags.has('gate'), mundo.tags.has('outra'), mundo.state.finalizado?.motivo], [false, true, false, true, 'ja_tem_parceiro'])
  if (porta.obrigatorios.length) {
    mundo.state = {}
    out = await runTool(ctx('oi'), 'finalizar_atendimento', { motivo: 'qualificado_sem_reuniao', resumo: 'x' })
    eq('qualificado com roteiro incompleto é recusado', out.isError, true)
  }
  out = await runTool(ctx('oi'), 'finalizar_atendimento', { motivo: 'agendado', resumo: 'x' })
  eq('modelo NÃO pode finalizar como "agendado" (só a tool de agenda)', out.isError, true)

  // Custo da Meta por mensagem não é pergunta de preço do serviço (Larissa, 30/09)
  {
    const { CRM_MAP } = await import('../lib/crm-map')
    const { alertaAtivo } = await import('../lib/llm')
    const ativos = (t: string) => CRM_MAP.alertas.filter(a => alertaAtivo(a, t)).map(a => a.nome).filter(n => /pre[cç]o|meta|whatsapp/i.test(n))
    eq('cobrança da Meta por mensagem → alerta do WhatsApp oficial, sem trava de preço', ativos('a gente tinha que pagar o meta, o meta tem que aprovar as mensagens e a gente tem que pagar um valor por mensagem'), ['custo do WhatsApp oficial'])
    eq('preço do serviço continua com a trava de preço', ativos('quanto custa a implantação de vocês?'), ['perguntou preço'])
    const { OFERECEU_HORA } = await import('../lib/llm')
    eq('horário oferecido no texto (sem consultar a agenda vira trava)', ['Qual fica melhor: amanhã às 10h ou às 15h?', 'Qual fica melhor: 10h ou 15h?', 'Tenho segunda às 14h ou às 15h.', 'Que tal amanhã às 16h?', 'Atendemos das 8h às 18h', 'Vocês atendem até as 18h?', 'Posso te mandar a proposta em 24h', 'Quer que eu veja os horários livres?'].map(t => OFERECEU_HORA.test(t)), [true, true, true, true, false, false, false, false])
    eq('preço: só quando PEDE o preço (orçamento do negócio dele não é pergunta de preço)', [
      'Qual seria a média de valores?', 'Não posso agendar, quero saber uma média de valores', 'gostaria de ir primeiro ao seu orçamento', 'me passa um orçamento', 'Vocês fazem orçamento?', 'Precisamos de um orçamento', 'qual o investimento?', 'Preciso ter informações de tempo e valores para esse trabalho complementar', 'Perfeito, aguardo o orçamento',
      'O pior é orçamento que a gente manda e ninguém retorna', 'Mandei um orçamento pro cliente e ele sumiu', 'O valor do nosso ticket médio é 5 mil', 'o investimento em tráfego não volta', 'Hoje o custo com anúncio é alto',
    ].map(t => ativos(t).includes('perguntou preço')), [true, true, true, true, true, true, true, true, true, false, false, false, false, false])
    const robo = (t: string) => CRM_MAP.alertas.some(a => a.nome === 'perguntou se é robô' && alertaAtivo(a, t))
    eq('"você é um robô?" aciona o alerta (com acento)', [robo('você é um robô?'), robo('to falando com uma pessoa?'), robo('Existe a possibilidade de atendimento humano, quero conhecer a ferramenta')], [true, true, false])
  }

  // Resposta + pergunta em duas mensagens (02/10)
  {
    const { dividirMensagem } = await import('../lib/tom')
    eq('resposta e pergunta viram 2 mensagens', dividirMensagem('Entendi. Dá pra montar as automações por etapa e cada mensagem sai no momento certo.\n\nHoje vocês fazem esse acompanhamento por onde?').length, 2)
    eq('duas perguntas em 2 blocos ficam juntas na 2ª mensagem', dividirMensagem('Faz sentido, isso a gente organiza com funil e lembrete de retorno.\n\nA escolha é sua ou passa por mais alguém?\n\nE vocês querem resolver ainda este mês?'), ['Faz sentido, isso a gente organiza com funil e lembrete de retorno.', 'A escolha é sua ou passa por mais alguém?\n\nE vocês querem resolver ainda este mês?'])
    eq('sem pergunta: uma mensagem só', dividirMensagem('Fechado, sexta às 10h.\n\nO link é meet.google.com/abc').length, 1)
    eq('começa perguntando: uma mensagem só', dividirMensagem('Vocês já usam algum CRM?\n\nPergunto porque muda a implantação.').length, 1)
    eq('reação curta não vira mensagem sozinha', dividirMensagem('Entendi.\n\nHoje vocês usam algum CRM?').length, 1)
  }

  const extra = await import('./test-cliente').catch(() => null)
  if (extra?.default) { const extras = await extra.default(eq); falhas += extras }

  console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ Todas as travas OK')
  process.exit(falhas ? 1 : 0)
}
main()
