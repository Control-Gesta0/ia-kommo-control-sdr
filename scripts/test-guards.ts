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
  eq('duas perguntas', regras('Qual a idade dele? E quantas pessoas moram na casa?'), ['mais de uma pergunta'])
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
  eq('webhook plano', plano?.msgs[0], { id: 'm1', leadId: 77, text: 'oi', attachType: 'voice', attachLink: 'https://x/a.ogg', direction: '' })
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

  const extra = await import('./test-cliente').catch(() => null)
  if (extra?.default) { const extras = await extra.default(eq); falhas += extras }

  console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ Todas as travas OK')
  process.exit(falhas ? 1 : 0)
}
main()
