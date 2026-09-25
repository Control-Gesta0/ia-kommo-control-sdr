/**
 * TESTES DO CLIENTE (patch) — rodam junto com `npm test`. Sem rede.
 * Control Gestão · SDR de indicações Kommo:
 *   filtro de teste · paridade userscript × servidor · entrada do webhook ·
 *   decisão de início · agenda (livres, preferência, escolha) · tools de agenda.
 */
import fs from 'node:fs'
import vm from 'node:vm'

type Eq = (nome: string, got: unknown, want: unknown) => void

export default async function testesCliente(eq: Eq): Promise<number> {
  const { checkReply } = await import('../lib/guards')
  const regras = (t: string) => [...new Set(checkReply(t).map(v => v.regra))]
  eq('cliente: garantia bloqueia', regras('O resultado é garantido.'), ['prometeu resultado'])

  // ---------------- Filtro de teste (fonte única) ----------------
  const { extrairComentario, classificarTeste } = await import('../lib/indicacao')
  const teste = (c: string, modo: 'inteligente' | 'estrito' = 'inteligente') => classificarTeste(c, modo).teste
  const BLOQUEIA = ['teste', 'Teste', 'TESTE 123', 'test', 'testing lead', 'Lead de teste', 'lead teste, favor desconsiderar',
    'isso é um teste', 'apenas um teste', 'this is a test', 'teste teste', 'teste de integração', 'asdf', 'qwerty', 'Por favor ignorar este lead']
  const PASSA = ['Preciso organizar o funil de vendas e integrar o WhatsApp', 'Estou no período de teste do Kommo e preciso de ajuda para configurar',
    'Quero testar a integração com o WhatsApp antes de assinar', 'Tenho uma conta de teste e quero implantar para 5 vendedores',
    'Preciso de atestado de capacidade técnica', 'Minha contestação de cobrança', 'Necesito ayuda para configurar mi embudo',
    'We need help setting up Kommo for our sales team']
  for (const c of BLOQUEIA) eq(`filtro bloqueia "${c}"`, teste(c), true)
  for (const c of PASSA) eq(`filtro passa "${c}"`, teste(c), false)
  eq('modo estrito: trial também bloqueia', teste('Estou no período de teste do Kommo', 'estrito'), true)
  eq('extrai Comment multilinha', extrairComentario('Name: Ana\nPhone: +55 11 9999\nComment: Quero organizar o funil\nEmail: a@b.com'), 'Quero organizar o funil')
  eq('extrai Comentário:', extrairComentario('Comentário: preciso de ajuda'), 'preciso de ajuda')
  eq('extrai de JSON', extrairComentario('{"name":"Ana","comment":"Quero automatizar","phone":"1"}'), 'Quero automatizar')
  eq('sem marcador = null', extrairComentario('Nome: Ana'), null)

  // ---------------- Userscript: build atualizado e MESMA regra no navegador ----------------
  const { buildUserscript, USERSCRIPT_PATH } = await import('./build-userscript')
  eq('userscript .user.js commitado = build atual (rode npm run build:userscript)', fs.readFileSync(USERSCRIPT_PATH, 'utf-8') === buildUserscript(), true)
  const src = fs.readFileSync(USERSCRIPT_PATH, 'utf-8')
  const bloco = src.slice(src.indexOf('var FiltroIndicacao'), src.indexOf(';(function () {'))
  const sandbox: { FiltroIndicacao?: { classificarTeste: (c: string, m: string) => { teste: boolean } } } = {}
  vm.runInNewContext(`${bloco}\nthis.FiltroIndicacao = FiltroIndicacao`, sandbox)
  const divergentes = [...BLOQUEIA, ...PASSA].filter(c => sandbox.FiltroIndicacao!.classificarTeste(c, 'inteligente').teste !== teste(c))
  eq('userscript e servidor decidem igual', divergentes, [])
  eq('userscript mantém o timer de 4min57s', /ESPERA_MS: 4 \* 60 \* 1000 \+ 57400/.test(src), true)

  // ---------------- Entrada: webhook da Kommo e userscript ----------------
  const { parseEntrada } = await import('../api/novo-lead')
  eq('userscript JSON', parseEntrada({ leadId: 55, comentario: 'Quero ajuda', origem: 'userscript' }).iniciar, [{ leadId: 55, comentario: 'Quero ajuda', origem: 'userscript' }])
  const aceite = parseEntrada({ 'account[id]': '9', 'unsorted[delete][0][action]': 'accept', 'unsorted[delete][0][uid]': 'u1', 'unsorted[delete][0][accept_result][leads][0]': '321' })
  eq('webhook: Incoming lead aceito inicia', [aceite.accountId, aceite.iniciar.map(x => x.leadId)], ['9', [321]])
  const recusa = parseEntrada({ 'unsorted[delete][0][action]': 'decline', 'unsorted[delete][0][decline_result][leads][0]': '322' })
  eq('webhook: Incoming lead recusado NÃO inicia', recusa.iniciar, [])
  const etapa = parseEntrada({ 'leads[status][0][id]': '400', 'leads[status][0][status_id]': '55438567', 'leads[status][1][id]': '401', 'leads[status][1][status_id]': '777' }, 55438567)
  eq('webhook: só lead que ENTROU na etapa de entrada', etapa.iniciar.map(x => x.leadId), [400])
  const add = parseEntrada({ unsorted: { add: [{ uid: 'u2', lead_id: '500', source_data: { data: { comment: { name: 'Comment', value: 'Quero integrar o site' } } } }] } })
  eq('webhook: Incoming lead adicionado guarda o Comment', add.comentariosIncoming, [[500, 'Quero integrar o site']])
  const add2 = parseEntrada({ 'unsorted[add][0][lead_id]': '501', 'unsorted[add][0][source_data][text]': 'Name: Ana\nComment: teste' })
  eq('webhook: Comment em texto livre', add2.comentariosIncoming, [[501, 'teste']])

  // ---------------- Decisão de início (fail-closed) ----------------
  const { decidirInicio, aberturaFixa, primeiroNome } = await import('../lib/iniciar')
  const base = { leadId: 1, statusId: 55438567, pipelineId: 10, tags: [], comentario: 'Quero organizar o funil', telefones: ['+5511999999999'] }
  const cfg = { humanTag: 'atendimento-humano', exigirComentario: true, filtro: 'inteligente' as const, modoInicio: 'ligado' as const, testLeadIds: [7], entrada: { pipelineId: 10, statusId: 55438567, name: 'x' } }
  eq('início: lead real inicia', decidirInicio(base, cfg).acao, 'iniciar')
  eq('início: teste NÃO inicia', decidirInicio({ ...base, comentario: 'teste' }, cfg).acao, 'teste')
  eq('início: teste vence falta de telefone', decidirInicio({ ...base, comentario: 'lead de teste', telefones: [] }, cfg).acao, 'teste')
  eq('início: sem Comment NÃO inicia (exigido)', decidirInicio({ ...base, comentario: null }, cfg).acao, 'sem-comentario')
  eq('início: sem Comment inicia se não exigido', decidirInicio({ ...base, comentario: null }, { ...cfg, exigirComentario: false }).acao, 'iniciar')
  eq('início: sem telefone', decidirInicio({ ...base, telefones: [] }, cfg).acao, 'sem-telefone')
  eq('início: outra etapa', decidirInicio({ ...base, statusId: 1 }, cfg).acao, 'fora-da-entrada')
  eq('início: outro funil', decidirInicio({ ...base, pipelineId: 11 }, cfg).acao, 'fora-da-entrada')
  eq('início: humano assumiu', decidirInicio({ ...base, tags: ['Atendimento-Humano'] }, cfg).acao, 'humano')
  eq('início: rampagem só TEST_LEAD_IDS', [decidirInicio(base, { ...cfg, modoInicio: 'teste' }).acao, decidirInicio({ ...base, leadId: 7 }, { ...cfg, modoInicio: 'teste' }).acao], ['rampagem', 'iniciar'])
  eq('nome de gente', [primeiroNome('ana souza'), primeiroNome('Lead #123'), primeiroNome('Empresa XPTO'), primeiroNome('')], ['Ana', '', '', ''])
  eq('abertura fixa passa nas travas', [regras(aberturaFixa('Ana Souza')), aberturaFixa('Ana').startsWith('Oi Ana!')], [[], true])

  // ---------------- Roteador: porta única, sem menu ----------------
  const { rotear } = await import('../lib/router')
  const r = rotear({}, 'oi')
  eq('porta única trava sem menu', r.tipo === 'porta' && r.porta.id, 'indicacao')

  // ---------------- Agenda (relógio fixo: segunda 28/09/2026 10h de Brasília) ----------------
  const A = await import('../lib/agenda')
  const agora = Date.parse('2026-09-28T13:00:00Z')
  const cfgA = { ativa: true, responsavelId: 99, taskTypeId: 2, duracaoMin: 30, passoMin: 30, diasUteisJanela: 5, antecedenciaMinHoras: 3, expediente: { dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '18:00', pausas: [['12:00', '13:30']] as Array<[string, string]> }, maxOpcoes: 2, folgaMin: 15 }
  const iso = (s: string) => Date.parse(s)
  const livres = A.gerarLivres(agora, cfgA, [{ ini: iso('2026-09-28T17:00:00Z'), fim: iso('2026-09-28T18:00:00Z') }])
  eq('1º livre respeita antecedência, pausa e folga do ocupado', livres[0].label, 'hoje, segunda 28/09 às 15h30')
  eq('ocupado 14h a 15h + folga 15min tira 13h30 a 15h', livres.filter(s => s.label.startsWith('hoje')).map(s => s.label.split(' às ')[1]), ['15h30', '16h', '16h30', '17h', '17h30'])
  eq('sem ocupado, 1º livre é 13h30 (fim da pausa)', A.gerarLivres(agora, cfgA, [])[0].label, 'hoje, segunda 28/09 às 13h30')
  eq('nada no fim de semana', livres.some(s => /sábado|domingo/.test(s.label)), false)
  eq('janela de 5 dias úteis', A.local(livres[livres.length - 1].ini).d, 2)
  const semPref = A.escolherOpcoes(livres, {}, 2).opcoes.map(s => s.label)
  eq('sem preferência: espalha (hoje à tarde, amanhã de manhã)', semPref, ['hoje, segunda 28/09 às 15h30', 'amanhã, terça 29/09 às 9h'])
  const pQuinta = A.parsePreferencia('pode ser quinta à tarde', agora)
  eq('preferência "quinta à tarde"', A.escolherOpcoes(livres, pQuinta, 2).opcoes.map(s => s.label), ['quinta 01/10 às 13h30', 'quinta 01/10 às 14h'])
  eq('preferência "a partir das 16h" amanhã', A.escolherOpcoes(livres, A.parsePreferencia('amanhã, só consigo a partir das 16h', agora), 1).opcoes[0].label, 'amanhã, terça 29/09 às 16h')
  eq('"segunda opção" não vira segunda-feira', A.parsePreferencia('a segunda opção', agora).dias, undefined)

  const oferta = [
    { ini: iso('2026-09-29T13:00:00Z'), fim: iso('2026-09-29T13:30:00Z'), label: 'amanhã, terça 29/09 às 10h' },
    { ini: iso('2026-10-01T13:00:00Z'), fim: iso('2026-10-01T13:30:00Z'), label: 'quinta 01/10 às 10h' },
  ]
  const escolha = (t: string) => A.resolverEscolha(t, oferta, agora)?.label ?? null
  eq('escolha: dia + hora', escolha('quinta às 10'), 'quinta 01/10 às 10h')
  eq('escolha: "amanhã" resolve pelo dia', escolha('amanhã fica bom'), 'amanhã, terça 29/09 às 10h')
  eq('escolha: só a hora, repetida em 2 dias = ambíguo', escolha('10h'), null)
  eq('escolha: hora fora da oferta = null (nunca outro dia)', escolha('terça às 15h'), null)
  eq('escolha: dia fora da oferta = null', escolha('sexta'), null)
  eq('escolha: ordinal', [escolha('a segunda opção'), escolha('pode ser a primeira')], ['quinta 01/10 às 10h', 'amanhã, terça 29/09 às 10h'])
  eq('"pode ser" depois de UMA sugestão', [A.ehAfirmativo('pode ser!'), A.slotsCitados('Tenho quinta 01/10 às 10h, serve?', oferta).map(s => s.label)], [true, ['quinta 01/10 às 10h']])
  const oferta2 = [{ ini: iso('2026-10-01T12:00:00Z'), fim: 0, label: 'quinta 01/10 às 9h' }, { ini: iso('2026-10-01T12:30:00Z'), fim: 0, label: 'quinta 01/10 às 9h30' }]
  eq('"9h" não casa dentro de "9h30"', [A.resolverEscolha('quinta 01/10 às 9h30', oferta2, agora)?.label, A.slotsCitados('Tenho quinta 01/10 às 9h30, serve?', oferta2).map(s => s.label)], ['quinta 01/10 às 9h30', ['quinta 01/10 às 9h30']])
  eq('hora citada: "10 pessoas" não é horário', A.horaCitada('somos 10 pessoas'), null)

  // ---------------- Tools de agenda, ponta a ponta em memória ----------------
  const { CRM_MAP } = await import('../lib/crm-map')
  const { runTool } = await import('../lib/tools')
  Object.assign(CRM_MAP.agenda, cfgA)
  const w: any = { tags: new Set(['gate']), state: {} as Record<string, any>, reunioes: [] as any[], ocupados: [] as any[], notes: [] as string[] }
  const port = {
    getLead: async () => ({ id: 1, statusId: 1, pipelineId: 1, fields: {}, tags: [...w.tags] }),
    writeFields: async () => {}, moveStage: async () => {},
    addNote: async (n: string) => { w.notes.push(n) },
    addTags: async (t: string[]) => { t.forEach(x => w.tags.add(x)) },
    removeTags: async (t: string[]) => { t.forEach(x => w.tags.delete(x)) },
    buscarOcupados: async () => [...w.ocupados, ...w.reunioes],
    criarReuniao: async (x: any) => { w.reunioes.push(x); return `t${w.reunioes.length}` },
    getState: async () => structuredClone(w.state),
    patchState: async (p: Record<string, unknown>) => Object.assign(w.state, p),
  }
  const porta = CRM_MAP.portas[0]
  const ctx = (lead: string, ia = '') => ({ port, porta, gateTag: 'gate', leadText: lead, lastLeadText: lead, lastAgentText: ia, agora }) as any

  let out = await runTool(ctx('quinta às 10'), 'agendar_reuniao', { horario: 'quinta 01/10 às 10h' })
  eq('agendar antes do roteiro mínimo é recusado', [out.isError, /falta/.test(out.content)], [true, true])
  w.state.respostas = { objetivo: 'organizar o funil', equipe: '5' }
  out = await runTool(ctx('quinta às 10'), 'agendar_reuniao', { horario: 'quinta 01/10 às 10h' })
  eq('agendar sem oferta é recusado', [out.isError, /consultar_horarios/.test(out.content)], [true, true])
  out = await runTool(ctx('pode ser quinta de manhã'), 'consultar_horarios', { preferencia: 'quinta de manhã' })
  eq('consultar grava a oferta', [out.isError, w.state.oferta.map((s: any) => s.label)], [false, ['quinta 01/10 às 9h', 'quinta 01/10 às 9h30']])
  out = await runTool(ctx('beleza'), 'agendar_reuniao', { horario: 'quinta 01/10 às 9h' })
  eq('"beleza" sem escolher entre 2 opções é recusado', out.isError, true)
  w.ocupados.push({ ini: iso('2026-10-01T12:00:00Z'), fim: iso('2026-10-01T12:30:00Z') })
  out = await runTool(ctx('9h30 fica ótimo'), 'agendar_reuniao', { horario: 'quinta 01/10 às 9h30' })
  eq('horário ocupado na revalidação é recusado', [out.isError, /ocupado/.test(out.content), w.reunioes.length], [true, true, 0])
  w.ocupados = []
  await runTool(ctx('pode ser quinta de manhã'), 'consultar_horarios', { preferencia: 'quinta de manhã' })
  out = await runTool(ctx('9h30 fica ótimo'), 'agendar_reuniao', { horario: 'quinta 01/10 às 9h' })
  eq('modelo pediu horário diferente do lead: recusado', [out.isError, w.reunioes.length], [true, 0])
  out = await runTool(ctx('9h30 fica ótimo'), 'agendar_reuniao', { horario: 'quinta 01/10 às 9h30' })
  eq('agenda o horário do lead, finaliza e tira o gate', [out.isError, out.handoff, w.reunioes.length, new Date(w.reunioes[0]?.ini).toISOString(), w.state.finalizado?.motivo, w.tags.has('gate')],
    [false, true, 1, '2026-10-01T12:30:00.000Z', 'agendado', false])
  out = await runTool(ctx('e se for sexta?'), 'consultar_horarios', { preferencia: 'sexta' })
  eq('não marca segunda reunião', out.isError, true)
  return 0
}
