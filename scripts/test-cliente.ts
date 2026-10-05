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
  const BLOQUEIA = ['TESTE TESTE TESTE NÃO ACEITAR!!!!!!!!', 'NAÕ ACEITAR!!!! TESTE LEAD TESTEEE TEST TEST', 'teste', 'Teste', 'TESTE 123', 'test', 'testing lead', 'Lead de teste', 'lead teste, favor desconsiderar',
    'isso é um teste', 'apenas um teste', 'this is a test', 'teste teste', 'teste de integração', 'asdf', 'qwerty', 'Por favor ignorar este lead']
  const PASSA = ['Indicações', 'Valor justo de implementeção', 'Quero alguem para me dar suporte para entender como funciona a plataforma',
    'cadastro mais detalhado dos clientes datas importantes preferências e historico de compras atendimento instantâneo com modo ia','Preciso organizar o funil de vendas e integrar o WhatsApp', 'Estou no período de teste do Kommo e preciso de ajuda para configurar',
    'Quero testar a integração com o WhatsApp antes de assinar', 'Tenho uma conta de teste e quero implantar para 5 vendedores',
    'Preciso de atestado de capacidade técnica', 'Minha contestação de cobrança', 'Necesito ayuda para configurar mi embudo',
    'We need help setting up Kommo for our sales team']
  for (const c of BLOQUEIA) eq(`filtro bloqueia "${c}"`, teste(c), true)
  for (const c of PASSA) eq(`filtro passa "${c}"`, teste(c), false)
  eq('modo estrito: trial também bloqueia', teste('Estou no período de teste do Kommo', 'estrito'), true)
  // Ambíguo = a IA de intenção decide (a regra só dá o palpite)
  const amb = (c: string) => classificarTeste(c).ambiguo
  eq('óbvio não vai para a IA', [amb('teste'), amb('lead de teste'), amb('Preciso organizar o funil')], [false, false, false])
  eq('"teste" dentro de frase maior vai para a IA', [amb('Estamos testando o Kommo e precisamos de ajuda'), amb('teste de integração')], [true, true])
  eq('modo estrito nunca é ambíguo', classificarTeste('teste de integração', 'estrito').ambiguo, false)
  eq('extrai Comment multilinha', extrairComentario('Name: Ana\nPhone: +55 11 9999\nComment: Quero organizar o funil\nEmail: a@b.com'), 'Quero organizar o funil')
  eq('extrai Comentário:', extrairComentario('Comentário: preciso de ajuda'), 'preciso de ajuda')
  eq('extrai de JSON', extrairComentario('{"name":"Ana","comment":"Quero automatizar","phone":"1"}'), 'Quero automatizar')
  eq('sem marcador = null', extrairComentario('Nome: Ana'), null)
  // Formato REAL da nota da indicação (lead 20751547, 25/09/2026)
  const NOTA = 'Country: Brazil\nCluster: LATAM\nLanguages: Portuguese\nIndustry: Retail &amp; ecommerce\nComment: cadastro mais detalhado dos clientes \ndatas importantes \npreferências e historico de compras \natendimento instantâneo com modo ia\n\n\npós vendas , aniversário, casamento \natendimento humanizado padrão joalheria'
  eq('nota real: Comment de várias linhas', extrairComentario(NOTA), 'cadastro mais detalhado dos clientes datas importantes preferências e historico de compras atendimento instantâneo com modo ia pós vendas , aniversário, casamento atendimento humanizado padrão joalheria')
  const { extrairContexto, marcaDeInvalido } = await import('../lib/indicacao')
  eq('nota real: contexto', extrairContexto(NOTA), { pais: 'Brazil', idiomas: 'Portuguese', segmento: 'Retail & ecommerce' })
  eq('marca de inválido', [marcaDeInvalido('The leads is no longer available'), marcaDeInvalido('The leads has already been accepted by other partners'), marcaDeInvalido('O Lead respondeu sua mensagem')], ['cedo', 'outros', null])

  // ---------------- Userscript: build atualizado e MESMA regra no navegador ----------------
  const { buildUserscript, USERSCRIPT_PATH } = await import('./build-userscript')
  eq('userscript .user.js commitado = build atual (rode npm run build:userscript)', fs.readFileSync(USERSCRIPT_PATH, 'utf-8') === buildUserscript(), true)
  const src = fs.readFileSync(USERSCRIPT_PATH, 'utf-8')
  const bloco = src.slice(src.indexOf('var FiltroIndicacao'), src.indexOf(';(function () {'))
  const sandbox: { FiltroIndicacao?: { classificarTeste: (c: string, m: string) => { teste: boolean } } } = {}
  vm.runInNewContext(`${bloco}\nthis.FiltroIndicacao = FiltroIndicacao`, sandbox)
  const divergentes = [...BLOQUEIA, ...PASSA].filter(c => sandbox.FiltroIndicacao!.classificarTeste(c, 'inteligente').teste !== teste(c))
  eq('userscript e servidor decidem igual', divergentes, [])
  eq('userscript: 5 min + margem ajustável, automático', [/LIBERACAO_MS: 5 \* 60 \* 1000/.test(src), /AJUSTAR_MARGEM: true/.test(src), /MODO: 'automatico'/.test(src)], [true, true, true])
  eq('userscript entende as mensagens da Kommo', ['no longer available', 'already been accepted', 'requested lead is not found'].every(m => src.includes(m)), true)
  eq('userscript: sem sonda antes da liberação, relógio do servidor, só o funil 4338500', [!/SONDA_|RAJADA_/.test(src), /amostrarRelogio/.test(src), /PIPELINE_ID: 4338500/.test(src), /CATEGORIAS_IGNORADAS: \['chats', 'mail', 'sip'\]/.test(src)], [true, true, true, true])

  // ---------------- Entrada: webhook da Kommo e userscript ----------------
  const { parseEntrada } = await import('../api/novo-lead')
  eq('userscript JSON', parseEntrada({ leadId: 55, comentario: 'Quero ajuda', origem: 'userscript' }).iniciar, [{ leadId: 55, comentario: 'Quero ajuda', origem: 'userscript' }])
  const aceite = parseEntrada({ 'account[id]': '9', 'unsorted[delete][0][action]': 'accept', 'unsorted[delete][0][uid]': 'u1', 'unsorted[delete][0][accept_result][leads][0]': '321' })
  eq('webhook: Incoming lead aceito inicia', [aceite.accountId, aceite.iniciar.map(x => x.leadId)], ['9', [321]])
  const recusa = parseEntrada({ 'unsorted[delete][0][action]': 'decline', 'unsorted[delete][0][decline_result][leads][0]': '322' })
  eq('webhook: Incoming lead recusado NÃO inicia', recusa.iniciar, [])
  const etapa = parseEntrada({ 'leads[status][0][id]': '400', 'leads[status][0][status_id]': '55438567', 'leads[status][0][tags][0][name]': 'LEAD Kommo', 'leads[status][1][id]': '401', 'leads[status][1][status_id]': '777' }, 55438567, 'ia-sdr')
  eq('webhook: lead na entrada SEM a tag da Lara não inicia', etapa.iniciar.map(x => x.leadId), [])
  const tag = parseEntrada({ 'leads[update][0][id]': '402', 'leads[update][0][status_id]': '55438567', 'leads[update][0][tags][0][name]': 'LEAD Kommo', 'leads[update][0][tags][1][name]': 'ia-sdr', 'leads[update][1][id]': '403', 'leads[update][1][status_id]': '80884464', 'leads[update][1][tags][0][name]': 'ia-sdr' }, 55438567, 'ia-sdr')
  eq('webhook: lead com a tag ia-sdr (qualquer etapa) vai para o início pela tag', tag.iniciar.map(x => [x.leadId, x.origem]), [[402, 'webhook:tag'], [403, 'webhook:tag']])
  const semTags = parseEntrada({ 'leads[update][0][id]': '404', 'leads[update][0][status_id]': '55438567' }, 55438567, 'ia-sdr')
  eq('webhook: payload sem tags vai para conferência', [semTags.iniciar, semTags.verificar], [[], [404]])
  const tirou = parseEntrada({ 'leads[update][0][id]': '405', 'leads[update][0][status_id]': '80884464', 'leads[update][0][tags][0][name]': 'LEAD Kommo' }, 55438567, 'ia-sdr')
  eq('webhook: lead sem a tag zera a marca de tag vista', [tirou.iniciar, tirou.semTag], [[], [405]])
  const reu = parseEntrada({ 'leads[update][0][id]': '406', 'leads[update][0][status_id]': '40438379', 'leads[update][0][custom_fields][0][id]': '1048615', 'leads[update][0][custom_fields][0][values][0][value]': 'x', 'leads[update][0][custom_fields][1][id]': '1040772', 'leads[update][0][custom_fields][1][values][0]': '1790600400' }, 55438567, 'ia-sdr', 1040772)
  eq('webhook: campo Reunião no payload vai para a marcação manual', reu.reunioes, [[406, '1790600400']])
  eq('decisão + investimento juntas passam; 3 perguntas não', [checkReply('A escolha do CRM é sua?\n\nE o faturamento fica em qual faixa?').some(v => v.regra === 'mais de uma pergunta'), checkReply('Qual o faturamento? E quem decide? Quando começa?').some(v => v.regra === 'mais de uma pergunta')], [false, true])
  const add = parseEntrada({ unsorted: { add: [{ uid: 'u2', lead_id: '500', source_data: { data: { comment: { name: 'Comment', value: 'Quero integrar o site' } } } }] } })
  eq('webhook: Incoming lead adicionado guarda o Comment', add.comentariosIncoming, [[500, 'Quero integrar o site']])
  const add2 = parseEntrada({ 'unsorted[add][0][lead_id]': '501', 'unsorted[add][0][source_data][text]': 'Name: Ana\nComment: teste' })
  eq('webhook: Comment em texto livre', add2.comentariosIncoming, [[501, 'teste']])

  // ---------------- Decisão de início (fail-closed) ----------------
  const { decidirInicio, aberturaFixa, primeiroNome } = await import('../lib/iniciar')
  const cls = (c: string) => ({ ...classificarTeste(c), fonte: 'regra' as const })
  const base = { leadId: 1, statusId: 55438567, pipelineId: 10, tags: [] as string[], comentario: 'Quero organizar o funil' as string | null, classificacao: cls('Quero organizar o funil') as ReturnType<typeof cls> | null, telefones: ['+5511999999999'] }
  const cfg = { humanTag: 'atendimento-humano', exigirComentario: true, modoInicio: 'ligado' as const, testLeadIds: [7], entrada: { pipelineId: 10, statusId: 55438567, name: 'x' } }
  eq('início: lead real inicia', decidirInicio(base, cfg).acao, 'iniciar')
  eq('tag à mão: a decisão do time passa por cima dos filtros da indicação', [
    decidirInicio({ ...base, manual: true, comentario: 'teste', classificacao: cls('teste') }, cfg).acao,
    decidirInicio({ ...base, manual: true, invalido: 'outros' }, cfg).acao,
    decidirInicio({ ...base, manual: true, comentario: null, classificacao: null, statusId: 999 }, cfg).acao,
    decidirInicio({ ...base, manual: true, telefones: [] }, cfg).acao,
    decidirInicio({ ...base, manual: true, tags: ['atendimento-humano'] }, cfg).acao,
  ], ['iniciar', 'iniciar', 'iniciar', 'sem-telefone', 'humano'])
  eq('início: teste NÃO inicia', decidirInicio({ ...base, comentario: 'teste', classificacao: cls('teste') }, cfg).acao, 'teste')
  eq('início: IA disse "real" num ambíguo → inicia', decidirInicio({ ...base, comentario: 'teste de integração do Kommo com o nosso site', classificacao: { ...cls('teste de integração'), teste: false, fonte: 'ia' as const } }, cfg).acao, 'iniciar')
  eq('início: teste vence falta de telefone', decidirInicio({ ...base, comentario: 'lead de teste', classificacao: cls('lead de teste'), telefones: [] }, cfg).acao, 'teste')
  eq('início: sem Comment NÃO inicia (exigido)', decidirInicio({ ...base, comentario: null, classificacao: null }, cfg).acao, 'sem-comentario')
  eq('início: sem Comment inicia se não exigido', decidirInicio({ ...base, comentario: null, classificacao: null }, { ...cfg, exigirComentario: false }).acao, 'iniciar')
  eq('início: sem telefone', decidirInicio({ ...base, telefones: [] }, cfg).acao, 'sem-telefone')
  eq('início: outra etapa', decidirInicio({ ...base, statusId: 1 }, cfg).acao, 'fora-da-entrada')
  eq('início: outro funil', decidirInicio({ ...base, pipelineId: 11 }, cfg).acao, 'fora-da-entrada')
  eq('início: aceite inválido NÃO inicia (vence tudo menos humano)', [decidirInicio({ ...base, invalido: 'cedo' }, cfg).acao, decidirInicio({ ...base, invalido: 'outros', telefones: [] }, cfg).acao], ['invalido', 'invalido'])
  eq('início: humano assumiu', decidirInicio({ ...base, tags: ['Atendimento-Humano'] }, cfg).acao, 'humano')
  eq('início: rampagem só TEST_LEAD_IDS', [decidirInicio(base, { ...cfg, modoInicio: 'teste' }).acao, decidirInicio({ ...base, leadId: 7 }, { ...cfg, modoInicio: 'teste' }).acao], ['rampagem', 'iniciar'])
  eq('nome de gente', [primeiroNome('ana souza'), primeiroNome('Lead #123'), primeiroNome('Empresa XPTO'), primeiroNome(''), primeiroNome('Dr. Darci Duarte'), primeiroNome('dra maria')], ['Ana', '', '', '', 'Dr. Darci', 'Dra. Maria'])
  eq('nome de empresa (ou saudação) não vira nome de pessoa', [primeiroNome('Control Gestão - CRM'), primeiroNome('MOTOS TD'), primeiroNome('CAROLINE AZEVEDO'), primeiroNome('rodrigo campeoti'), primeiroNome('Loja do Zé'), primeiroNome('Olá'), primeiroNome('ola'), primeiroNome('Lara')], ['', '', 'Caroline', 'Rodrigo', '', '', '', ''])
  const { tirarSaudacao } = await import('../lib/saudacao')
  const { naturalizar } = await import('../lib/saudacao')
  eq('nome de vez em quando; reação repetida sai (nunca vira "Ahh, legal")', [
    naturalizar('Entendi, Rodrigo. Com 7 pessoas dá pra organizar.', 'Rodrigo', ['Boa, Rodrigo. Dá pra sair do Trello.']),
    naturalizar('Perfeito, então o Kleber participa da reunião.', 'Rodrigo', ['Perfeito, anotado.', 'Show.']),
    naturalizar('Show, Rodrigo. Pelo que você contou...', 'Rodrigo', ['Entendi. Com 7 pessoas.']),
    naturalizar('Entendi, faz sentido, às vezes esse contato cai pra quem não pediu mesmo.', '', ['Entendi, obrigado por avisar.']),
  ], ['Entendi. Com 7 pessoas dá pra organizar.', 'Então o Kleber participa da reunião.', 'Show, Rodrigo. Pelo que você contou...', 'Faz sentido, às vezes esse contato cai pra quem não pediu mesmo.'])
  eq('nome de empresa não vira vocativo', naturalizar('Certinho, TD MOTOS. Hoje vocês organizam os leads onde?', '', [], 'MOTOS TD'), 'Certinho. Hoje vocês organizam os leads onde?')
  const { semGeneralizacaoRepetida } = await import('../lib/saudacao')
  const jaFalou = ['Ahh, legal, no jurídico é bem comum o cliente chamar no WhatsApp e a etapa do caso ficar solta.\nQuantos vendedores usariam o sistema?']
  eq('generalização sobre o nicho só uma vez (a pergunta fica)', [
    semGeneralizacaoRepetida('Entendi. No jurídico isso pesa bastante quando a consulta entra e ninguém sabe a fase.\nO que mais te incomoda hoje?', jaFalou),
    semGeneralizacaoRepetida('Faz sentido, em escritório de advocacia isso costuma virar perda de lead.\nA escolha do CRM é sua ou passa por mais alguém?', jaFalou),
    semGeneralizacaoRepetida('No jurídico é bem comum o caso esfriar. Dá pra resolver com funil.', []),
  ], ['Entendi.\nO que mais te incomoda hoje?', 'A escolha do CRM é sua ou passa por mais alguém?', 'No jurídico é bem comum o caso esfriar. Dá pra resolver com funil.'])
  const { tirarApresentacao } = await import('../lib/saudacao')
  eq('apresentação só na 1ª mensagem', [tirarApresentacao('Aqui é a Lara, da Control Gestão, parceira oficial da Kommo.\nHoje vocês organizam os leads onde?'), tirarApresentacao('Show. Hoje vocês organizam os leads onde?')], ['Hoje vocês organizam os leads onde?', 'Show. Hoje vocês organizam os leads onde?'])
  eq('reação repetida + nome solto somem juntos', naturalizar('Boa, Rodrigo. Dá pra deixar isso redondo com funil e lembrete.', 'Rodrigo', ['Boa, Rodrigo. Vocês querem começar este mês?']), 'Dá pra deixar isso redondo com funil e lembrete.')
  const { completarPergunta1 } = await import('../lib/saudacao')
  eq('pergunta 1 sempre dupla (onde + quantos)', [
    completarPergunta1('Me diz seu nome. Hoje vocês organizam os leads onde: WhatsApp, planilha ou outro CRM?', true),
    completarPergunta1('Hoje vocês organizam os leads onde: WhatsApp, planilha ou outro CRM?', false),
    completarPergunta1('O que mais te incomoda hoje?', true),
  ], ['Me diz seu nome. Hoje vocês organizam os leads onde: WhatsApp, planilha ou outro CRM? E quantos vendedores usariam o sistema?', 'Hoje vocês organizam os leads onde: WhatsApp, planilha ou outro CRM?', 'O que mais te incomoda hoje?'])
  const { decisorSemNome } = await import('../lib/tools')
  eq('decisor pelo cargo sem nome → pede o nome', [decisorSemNome('Meu sócio decide.'), decisorSemNome('o dono da empresa'), decisorSemNome('é o meu gestor, kleber'), decisorSemNome('eu mesmo'), decisorSemNome('eu e minha sócia Juliana decidimos')], [true, true, false, false, false])
  const { vocativoCerto, pedirNomeSeFalta } = await import('../lib/saudacao')
  eq('vocativo só com o nome do lead', [
    vocativoCerto('Perfeito, Kleber, com esse cenário dá pra organizar.', 'Rodrigo'),
    vocativoCerto('Boa, Rodrigo. Dá pra organizar.', 'Rodrigo'),
    vocativoCerto('Kleber. Tenho amanhã às 10h ou às 14h.', 'Rodrigo'),
    vocativoCerto('Então, dá pra organizar.', ''),
    vocativoCerto('Boa tarde! Aqui é a Lara, da Control Gestão.', ''),
  ], ['Perfeito, com esse cenário dá pra organizar.', 'Boa, Rodrigo. Dá pra organizar.', 'Tenho amanhã às 10h ou às 14h.', 'Então, dá pra organizar.', 'Boa tarde! Aqui é a Lara, da Control Gestão.'])
  eq('pede o nome no começo se não souber (antes da pergunta)', [
    pedirNomeSeFalta('Boa tarde! Aqui é a Lara. Dá pra organizar sim. O que mais tá travando hoje?', false, 0),
    pedirNomeSeFalta('Show. O que mais tá travando hoje?', true, 0),
    pedirNomeSeFalta('Show. O que mais tá travando hoje?', false, 3),
  ], ['Boa tarde! Aqui é a Lara. Dá pra organizar sim. Ah, me diz seu nome pra eu te chamar direitinho. O que mais tá travando hoje?', 'Show. O que mais tá travando hoje?', 'Show. O que mais tá travando hoje?'])
  const { semSolucaoRepetida } = await import('../lib/saudacao')
  eq('solução não se repete em mensagens seguidas', [
    semSolucaoRepetida('Faz sentido. No Kommo dá pra separar cada lead por etapa, com responsável e lembrete.\nA escolha do CRM é sua ou passa por mais alguém?', ['Entendi. Dá pra deixar cada atendimento com etapa, responsável e lembrete de retorno.\nO que mais te incomoda?']),
    semSolucaoRepetida('Faz sentido. No Kommo dá pra separar cada lead por etapa, com responsável e lembrete.\nA escolha do CRM é sua?', ['Show. A escolha do CRM é sua?']),
  ], ['Faz sentido.\nA escolha do CRM é sua ou passa por mais alguém?', 'Faz sentido. No Kommo dá pra separar cada lead por etapa, com responsável e lembrete.\nA escolha do CRM é sua?'])
  const { DISSE_NAO_SEI } = await import('../lib/guards')
  eq('"não sei" só como resposta (não no meio da dor)', ['não sei', 'Não sei dizer', 'não sei quantos seriam', 'sei lá', 'perco cliente, não sei a fase de cada atendimento', 'não sei mexer no kommo'].map(x => DISSE_NAO_SEI.test(x)), [true, true, true, true, false, false])
  const { semEspanhol } = await import('../lib/guards')
  eq('palavra em espanhol vira português', semEspanhol('Dá pra configurar o embudo de ventas e o equipo.'), 'Dá pra configurar o funil de vendas e o equipe.')
  const { mencionaQuantidade } = await import('../lib/saudacao')
  eq('lead já disse quantos são', ['Necesitamos configurar el embudo para 8 vendedores', 'somos 7 pessoas', 'só eu', 'temos 12 corretores', 'quero organizar o funil'].map(mencionaQuantidade), [true, true, true, true, false])
  const { tipoPeloLink, mediaKind } = await import('../lib/media')
  eq('tipo da mídia pelo link ou pelo tipo', [tipoPeloLink('https://x/voz.oga'), tipoPeloLink('https://x/a.ogg?x=1'), tipoPeloLink('https://x/foto.jpg'), tipoPeloLink('https://x/abc'), mediaKind('ptt')], ['audio', 'audio', 'image', null, 'audio'])
  const { ehRespostaAutomatica } = await import('../lib/automatica')
  eq('resposta automática de empresa é ignorada; mensagem de gente não', [
    ehRespostaAutomatica('TD MOTOS agradece seu contato. Em breve lhe atendenderemos.'),
    ehRespostaAutomatica('Olá! Seja bem-vindo à Clínica Bella. Digite 1 para agendar'),
    ehRespostaAutomatica('Obrigado pelo contato! Retornaremos o mais breve possível.'),
    ehRespostaAutomatica('Estamos fora do horário de atendimento'),
    ehRespostaAutomatica('uso o trello e somos 7 pessoas'),
    ehRespostaAutomatica('Eu não sou essa pessoa'),
    ehRespostaAutomatica('obrigado, em breve eu vejo isso com meu sócio'),
  ], [true, true, true, true, false, false, false])
  eq('só a 1ª mensagem cumprimenta', [tirarSaudacao('Boa tarde! Perfeito, já consigo te passar os horários.'), tirarSaudacao('Oi, bom dia, Ana! Show.'), tirarSaudacao('Ótimo! Boa tarde pra você também.')], ['Perfeito, já consigo te passar os horários.', 'Show.', 'Ótimo! Boa tarde pra você também.'])
  // Lead só cumprimentou (Luiz, 02/10): devolve o cumprimento dele, sem pergunta repetida
  const { cumprimentoDoLead, cumprimentarDeVolta } = await import('../lib/saudacao')
  const { acabamentoDoTurno, ajustarResposta } = await import('../lib/tom')
  eq('só cumprimento: qual saudação volta', ['Bom dia', 'oi, tudo bem?', 'Olá Lara', 'boa noite!!', 'Bom dia, quero saber o preço', 'ok'].map(cumprimentoDoLead), ['Bom dia', 'Oi', 'Olá', 'Boa noite', '', ''])
  eq('só cumprimento: devolve sem duplicar', [
    cumprimentarDeVolta('Tudo bem?', 'Bom dia', 'Luiz'),
    cumprimentarDeVolta('Bom dia, Luiz! Tudo bem por aí?', 'Bom dia', 'Luiz'),
    cumprimentarDeVolta('Oi, Luiz, bom dia! Fico por aqui pra te mostrar o Kommo.', 'Bom dia', 'Luiz'),
    cumprimentarDeVolta('Olá! Pode falar.', 'Oi', ''),
    cumprimentarDeVolta('Tudo bem, Luiz? Fico por aqui.', 'Boa tarde', 'Luiz'),
  ], ['Bom dia, Luiz! Tudo bem?', 'Bom dia, Luiz! Tudo bem por aí?', 'Bom dia, Luiz! Fico por aqui pra te mostrar o Kommo.', 'Oi! Pode falar.', 'Boa tarde, Luiz! Tudo bem? Fico por aqui.'])
  eq('acabamento: "Bom dia" depois da abertura volta com o cumprimento', ajustarResposta('Tudo bem? Fico por aqui pra te mostrar o Kommo.', { primeiro: false, nomeCadastro: 'Luiz', anteriores: ['Boa noite, Luiz! Aqui é a Lara...'], faltaVendedores: false, handoff: false, ...acabamentoDoTurno('Bom dia', false, false) }), 'Bom dia, Luiz! Tudo bem? Fico por aqui pra te mostrar o Kommo.')
  eq('acabamento: problema novo protege a solução (não corta como repetida)', [acabamentoDoTurno('O pior é orçamento que a gente manda e ninguém retorna', true, true).protegerSolucao, acabamentoDoTurno('somos 7 pessoas', true, true).protegerSolucao, acabamentoDoTurno('quanto custa?', true, true).protegerSolucao], [true, false, true])
  const { campoByKey } = await import('../lib/crm-map')
  const CRM_MAP_Q = (await import('../lib/crm-map')).CRM_MAP
  const campoByKeyQ = (await import('../lib/crm-map')).campoByKey
  // Comercial (02/10): duração da reunião uma vez só; qualificar (pessoas + tráfego/volume) antes de convidar
  const { semDuracaoRepetida } = await import('../lib/saudacao')
  const jaDisse = ['A análise é gratuita e leva de 30 a 45 minutos.']
  eq('duração "30 a 45 minutos" sai quando já foi dita', [
    semDuracaoRepetida('A análise é gratuita e leva de 30 a 45 minutos. Posso te passar dois horários?', jaDisse),
    semDuracaoRepetida('Na reunião de 30 a 45 minutos, o especialista dimensiona isso.', jaDisse),
    semDuracaoRepetida('Reunião marcada para amanhã, sexta 02/10 às 10h, com duração de 30 a 45 minutos.', jaDisse),
    semDuracaoRepetida('A análise leva de 30 a 45 minutos.', []),
  ], ['A análise é gratuita. Posso te passar dois horários?', 'Na reunião, o especialista dimensiona isso.', 'Reunião marcada para amanhã, sexta 02/10 às 10h.', 'A análise leva de 30 a 45 minutos.'])
  const T = await import('../lib/tools')
  const portaQ = CRM_MAP_Q.portas[0]
  const snapQ = (r: Record<string, string>) => T.snapshot(portaQ, { respostas: r } as any)
  eq('pronto para a reunião só com problema + pessoas + volume (ou 3 perguntas)', [
    T.prontoParaReuniao(snapQ({ dor: 'perco lead' }), 1),
    T.prontoParaReuniao(snapQ({ dor: 'perco lead', vendedores: '4' }), 2),
    T.prontoParaReuniao(snapQ({ dor: 'perco lead', vendedores: '4', volume: '20 por dia' }), 1),
    T.prontoParaReuniao(snapQ({ dor: 'perco lead' }), 3),
    T.prontoParaReuniao(snapQ({}), 3),
  ], [false, false, true, true, false])
  const L = await import('../lib/llm')
  eq('convite detectado (para não convidar antes da hora)', ['Quer marcar uma análise gratuita com o especialista?', 'Na análise, o especialista mostra isso. Quer marcar?', 'Posso te colocar numa análise gratuita com um especialista.', 'Isso o especialista te mostra na análise.', 'Quantas pessoas vão usar o Kommo no dia a dia?'].map(L.temConvite), [true, true, true, false, false])
  eq('lead que pede reunião, apresentação ou preço libera o convite (orçamento do negócio dele não)', ['quero conhecer a ferramenta', 'quanto custa?', 'Você pode apresentar a ferramenta?', 'Quero saber sobre o kommo', 'somos 4 vendedores', 'O pior é orçamento que a gente manda e ninguém retorna'].map(t => L.pediuReuniao(t)), [true, true, true, false, false, false])
  eq('volume alto: 20 por dia ou ~400 por mês', ['chegam uns 25 leads por dia', 'uns 600 leads por mês', 'uns 10 por dia', '1,5 mil contatos por mês', 'somos 4 vendedores'].map(L.volumeAlto), [true, true, false, true, false])
  eq('gancho de follow-up: na dor de retorno e no volume alto, com o dado dos 49% uma vez só', [
    /49%/.test(L.ganchoFollowup('O pior é orçamento que a gente manda e ninguém retorna')),
    /não repita/.test(L.ganchoFollowup('chegam uns 25 leads por dia', [{ dir: 'out', text: 'O follow-up pode aumentar as respostas em até 49%.' }])),
    L.ganchoFollowup('somos 4 vendedores'),
  ], [true, true, ''])
  eq('pedido de conversa no Comment libera o convite', [L.pediuReuniao('somos 6 vendedores', 'Gostaria de conversar com um vendedor'), L.pediuReuniao('somos 6 vendedores', 'Implementação e estruturação do CRM')], [true, false])
  eq('tema já perguntado (sem resposta) não trava o convite nem é perguntado de novo', [
    T.temasPerguntados(['Bom dia! Quantas pessoas vão usar o CRM no dia a dia?', 'Entendi. Vocês fazem tráfego pago? Quantos leads chegam por mês?']),
    T.prontoParaReuniao(snapQ({ dor: 'perco lead', vendedores: '4' }), 2, ['vendedores', 'volume']),
    T.lacunasDeQualificacao(snapQ({ dor: 'perco lead' }), ['vendedores']).length,
  ], [['vendedores', 'volume'], true, 1])
  eq('tráfego e volume valem como evidência', ['fazemos tráfego no Meta, chegam uns 600 leads por mês', 'não fazemos anúncio, é tudo indicação', 'somos 4 vendedores'].map(t => !!campoByKeyQ('volume')?.sinal?.test(t)), [true, true, true])
  const { decisorSoCargo, pedirNomeDoDecisor } = await import('../lib/saudacao')
  eq('decisor só pelo cargo: pede o nome dele/dela', ['quem decide é o dono da empresa', 'a decisão passa pela minha sócia', 'quem decide é o dono, Carlos', 'o dono pediu pra eu ver isso', 'quem aprova é a gerente'].map(decisorSoCargo), ['dele', 'dela', '', '', 'dela'])
  eq('decisor só pelo cargo: o pedido entra antes da pergunta e não duplica', [
    pedirNomeDoDecisor('Faz sentido ele participar da análise. Quer marcar?', 'dele'),
    pedirNomeDoDecisor('Faz sentido ele participar. Me passa o nome dele?', 'dele'),
  ], ['Faz sentido ele participar da análise. Me passa o nome dele que eu já deixo no convite da reunião. Quer marcar?', 'Faz sentido ele participar. Me passa o nome dele?'])
  eq('problema ou pedido: pedidos reais valem como evidência (antes eram recusados)', ['Implementação e estruturação do CRM', 'não consigo fazer os gatilhos funcionarem', 'Queria que disparasse a confirmação do agendamento e um lembrete no dia anterior', 'O pior é orçamento que a gente manda e ninguém retorna', 'Sou de Recife, quero conhecer melhor a plataforma', 'somos 4 vendedores'].map(t => !!campoByKey('dor')?.sinal?.test(t)), [true, true, true, true, true, false])
  eq('letra de outro alfabeto é texto corrompido', [regras('Tenho երկու opções na segunda').includes('texto corrompido'), regras('Ação, coração, São Paulo, nº 1 e 2ª opção').includes('texto corrompido')], [true, false])
  const manha = Date.parse('2026-09-28T13:00:00Z') // 10h em Brasília
  eq('abertura fixa: saudação do horário + Lara + passa nas travas', [regras(aberturaFixa('Ana Souza', manha)), aberturaFixa('Ana', manha).startsWith('Bom dia, Ana! Aqui é a Lara'), aberturaFixa('Lead #9', manha).startsWith('Bom dia! Aqui é a Lara')], [[], true, true])

  // ---------------- Saudação por horário (regra geral 1) ----------------
  const { saudacao, garantirSaudacao, abreComPergunta } = await import('../lib/saudacao')
  const h = (hh: string) => Date.parse(`2026-09-28T${hh}:00-03:00`)
  eq('saudação: 11h59 bom dia · 12h boa tarde · 17h59 boa tarde · 18h boa noite · 2h boa noite', [saudacao(h('11:59')), saudacao(h('12:00')), saudacao(h('17:59')), saudacao(h('18:00')), saudacao(h('02:00'))], ['Bom dia', 'Boa tarde', 'Boa tarde', 'Boa noite', 'Boa noite'])
  eq('saudação errada é trocada', garantirSaudacao('Bom dia, Ana! Aqui é a Lara.', 'Boa noite', 'Ana'), 'Boa noite, Ana! Aqui é a Lara.')
  eq('sem saudação ganha na frente', garantirSaudacao('Oi, Ana! Aqui é a Lara, da Control Gestão.', 'Boa tarde', 'Ana'), 'Boa tarde, Ana! Aqui é a Lara, da Control Gestão.')
  eq('abrir com pergunta é detectado', [abreComPergunta('Tudo bem? Aqui é a Lara.'), abreComPergunta('Boa tarde, Ana! Tudo bem?')], [true, false])

  // ---------------- Equipe pequena e suporte ----------------
  const { numeroVendedores } = await import('../lib/tools')
  eq('nº de vendedores', [numeroVendedores('somos 6 vendedores'), numeroVendedores('só eu'), numeroVendedores('duas pessoas'), numeroVendedores('não sei')], [6, 1, 2, null])

  // ---------------- Etapas (só para frente, só no funil de indicações) ----------------
  const { podeAvancar, champCompleto } = await import('../lib/etapas')
  eq('entrada → em contato', podeAvancar(4338500, 55438567, 'emContato'), true)
  eq('em contato → qualificado', podeAvancar(4338500, 80884464, 'qualificado'), true)
  eq('nunca volta (qualificado → em contato)', podeAvancar(4338500, 40438379, 'emContato'), false)
  eq('não mexe depois da reunião (PROPOSTA ENVIADA)', podeAvancar(4338500, 103456716, 'agendado'), false)
  eq('não mexe em outro funil', podeAvancar(7975447, 55438567, 'emContato'), false)
  // 02/10: só o problema é condição para marcar (o resto ajuda, mas não trava a reunião)
  eq('qualificado = problema claro', [champCompleto({ dor: 'x' }), champCompleto({ dor: 'x', decisor: 'eu', vendedores: '3', prioridade: 'mês' }), champCompleto({ organizacao: 'planilha', decisor: 'eu', faturamento: '50 mil' }, ['prioridade'])], [true, true, false])

  // ---------------- Follow-up só no expediente (seg a sex, 9h às 18h, Brasília) ----------------
  const { noExpediente } = await import('../lib/followup')
  const br = (s: string) => new Date(noExpediente(Date.parse(s))).toISOString()
  eq('dentro do expediente fica igual', br('2026-09-28T14:00:00-03:00'), '2026-09-28T17:00:00.000Z')
  eq('20h de segunda → terça 9h', br('2026-09-28T20:00:00-03:00'), '2026-09-29T12:00:00.000Z')
  eq('6h de terça → terça 9h', br('2026-09-29T06:00:00-03:00'), '2026-09-29T12:00:00.000Z')
  eq('sábado → segunda 9h', br('2026-10-03T11:00:00-03:00'), '2026-10-05T12:00:00.000Z')
  eq('sexta 18h30 → segunda 9h', br('2026-10-02T18:30:00-03:00'), '2026-10-05T12:00:00.000Z')

  // ---------------- Lembretes para o cliente ----------------
  const { textoLembrete } = await import('../lib/followup')
  const reuniao = Date.parse('2026-10-01T09:30:00-03:00') // quinta 9h30
  eq('lembrete 24h', textoLembrete(1440, reuniao, reuniao - 24 * 3600000, 'Ana'), 'Oi, Ana! Passando pra lembrar da nossa reunião amanhã, quinta 01/10 às 9h30 com o especialista da Control Gestão. Tudo certo pra você?')
  eq('lembrete 1h (o link vai 10 min antes)', textoLembrete(60, reuniao, reuniao - 3600000, 'Ana'), 'Oi, Ana! Daqui a pouco, às 9h30, é a nossa reunião com o especialista da Control Gestão. Te mando o link 10 minutinhos antes. Até já!')
  eq('lembrete 10 min com o link', textoLembrete(10, reuniao, reuniao - 600000, 'Ana', 'meet.google.com/abc-defg-hij'), 'Oi, Ana! Em 10 minutinhos começa a nossa reunião com o especialista da Control Gestão. É só entrar por aqui: meet.google.com/abc-defg-hij\nAté já!')
  eq('lembrete com link pede para conferir', textoLembrete(1440, reuniao, reuniao - 86400000, 'Ana', 'https://meet.google.com/abc-defg-hij').includes('https://meet.google.com/abc-defg-hij\nConfere se abre certinho aí pra você?'), true)
  const { foraDoIdioma } = await import('../lib/indicacao')
  eq('idioma decide pelo Comment: EUA com Comment em português aceita; espanhol/inglês não', [
    foraDoIdioma('Country: United States\nLanguages: English\nComment: Quero configurar meu CRM', 'Quero configurar meu CRM').fora,
    foraDoIdioma('Country: Brazil Cluster: LATAM Languages: Portuguese Comment: Configuração de etapas de funis e IA', 'Configuração de etapas de funis e IA').fora,
    foraDoIdioma('Country: Venezuela', 'Consultoría').fora,
    foraDoIdioma('', 'Necesitamos configurar el embudo de ventas').fora,
    foraDoIdioma('Country: Brazil', 'I need help with my sales pipeline').fora,
    foraDoIdioma('', 'Indicações').fora,
  ], [false, false, false, true, true, false])
  const { classificarSuporte } = await import('../lib/indicacao')
  eq('suporte básico não inicia; implantação sim', [classificarSuporte('meu whatsapp caiu').suporte, classificarSuporte('preciso conectar meu whatsapp').suporte, classificarSuporte('conectar o whatsapp e montar o funil').suporte, decidirInicio({ ...base, suporte: 'suporte básico: "whatsapp caiu"' }, cfg).acao], [true, true, false, 'suporte'])
  eq('início: Comment em outro idioma NÃO inicia', decidirInicio({ ...base, foraDoIdioma: 'Comment em espanhol' }, cfg).acao, 'outro-idioma')
  eq('lembretes passam nas travas', [regras(textoLembrete(1440, reuniao, reuniao - 86400000, 'Ana')), regras(textoLembrete(60, reuniao, reuniao - 3600000, '')), regras(textoLembrete(10, reuniao, reuniao - 600000, '', 'meet.google.com/x'))], [[], [], []])

  // ---------------- Roteador: porta única, sem menu ----------------
  const { rotear } = await import('../lib/router')
  const r = rotear({ comentario: 'quero organizar o funil', iniciadoPor: 'userscript' }, 'oi')
  eq('indicação (Lara iniciou com Comment) cai na porta de indicação', r.tipo === 'porta' && r.porta.id, 'indicacao')
  const rManual = rotear({}, 'oi, queria entender o Kommo')
  eq('tag ia-sdr colocada à mão (sem indicação) cai no contato direto', rManual.tipo === 'porta' && rManual.porta.id, 'direto')
  eq('porta travada não muda', (() => { const x = rotear({ porta: 'indicacao' }, 'oi'); return x.tipo === 'porta' && x.porta.id })(), 'indicacao')

  // ---------------- Agenda (relógio fixo: segunda 28/09/2026 10h de Brasília) ----------------
  const A = await import('../lib/agenda')
  const agora = Date.parse('2026-09-28T13:00:00Z')
  const cfgA = { ativa: true, responsavelId: 99, taskTypeId: 2, duracaoMin: 30, passoMin: 30, diasUteisJanela: 5, antecedenciaMinHoras: 3, expediente: { dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '18:00', pausas: [['12:00', '13:30']] as Array<[string, string]> }, maxOpcoes: 2, folgaMin: 15, horarios: undefined as string[] | undefined }
  const iso = (s: string) => Date.parse(s)
  const livres = A.gerarLivres(agora, cfgA, [{ ini: iso('2026-09-28T17:00:00Z'), fim: iso('2026-09-28T18:00:00Z') }])
  eq('1º livre respeita antecedência, pausa e folga do ocupado', livres[0].label, 'hoje, segunda 28/09 às 15h30')
  eq('ocupado 14h a 15h + folga 15min tira 13h30 a 15h', livres.filter(s => s.label.startsWith('hoje')).map(s => s.label.split(' às ')[1]), ['15h30', '16h', '16h30', '17h', '17h30'])
  const soPreferidos = A.gerarLivres(agora, { ...cfgA, duracaoMin: 60, folgaMin: 0, horarios: ['10:00', '11:00', '14:00', '15:00', '16:00', '17:00'] }, [{ ini: iso('2026-09-29T13:00:00Z'), fim: iso('2026-09-29T14:00:00Z') }])
  eq('horários preferidos: só 10h/11h/14h-17h, 11h livre logo após reunião das 10h', soPreferidos.filter(s => s.label.includes('29/09')).map(s => s.label.replace(/.* às /, '')), ['11h', '14h', '15h', '16h', '17h'])
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
  eq('escolha: número solto respondendo à lista (Camila, 05/10: "2")', [escolha('2'), escolha('1'), escolha('a 2'), escolha('opção 2'), escolha('3')], ['quinta 01/10 às 10h', 'amanhã, terça 29/09 às 10h', 'quinta 01/10 às 10h', 'quinta 01/10 às 10h', null])
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
    criarReuniao: async (x: any) => { w.reunioes.push(x); return { id: `t${w.reunioes.length}`, link: w.meet || '' } },
    agendarLembretes: async (x: any) => { w.lembretes = x },
    criarTarefaCloser: async (t: string) => { w.tarefas = [...(w.tarefas || []), t] },
    avisarCloser: async (t: string, _c: string) => { w.avisos = [...(w.avisos || []), t] },
    getState: async () => structuredClone(w.state),
    patchState: async (p: Record<string, unknown>) => Object.assign(w.state, p),
  }
  const porta = CRM_MAP.portas[0]
  const ctx = (lead: string, ia = '') => ({ port, porta, gateTag: 'gate', leadText: lead, lastLeadText: lead, lastAgentText: ia, agora }) as any

  let out = await runTool(ctx('quinta às 10'), 'agendar_reuniao', { horario: 'quinta 01/10 às 10h' })
  eq('agendar sem problema gravado: não trava e usa o pedido do lead', [/falta entender/.test(out.content), !!w.state.respostas?.dor], [false, true])
  // "Atendimento humano" (Luiz, 02/10) = a reunião na 1ª vez; pedir de novo ou pedir ligação passa para o time
  {
    const antes = { state: structuredClone(w.state), tags: new Set(w.tags), notes: [...w.notes] }
    const humano = (lead: string) => runTool(ctx(lead), 'finalizar_atendimento', { motivo: 'pediu_humano', evidencia: lead, resumo: 'x' })
    const h1 = await humano('Existe a possibilidade de atendimento humano, quero conhecer a ferramenta')
    const h2 = await humano('Prefiro falar com uma pessoa mesmo')
    w.state = {}
    const h3 = await humano('Me liga nesse número, por favor')
    w.state = {}
    const h4 = await humano('Estou ligado, mas quero falar com um atendente')
    eq('"atendimento humano": 1ª vez oferece a reunião; pedir de novo ou pedir ligação passa para o time', [h1.isError, /reuni[aã]o com o especialista/.test(h1.content), h2.isError, h3.isError, h4.isError], [true, true, false, false, true])
    Object.assign(w, antes)
  }
  w.state.respostas = { dor: 'perco lead' }
  out = await runTool(ctx('quinta às 10'), 'agendar_reuniao', { horario: 'quinta 01/10 às 10h' })
  eq('com o problema claro, não exige prioridade, decisor nem faturamento', /quando quer começar|decide|faturamento/i.test(out.content), false)
  eq('agendar sem oferta é recusado', [out.isError, /consultar_horarios/.test(out.content)], [true, true])
  out = await runTool(ctx('pode ser quinta de manhã'), 'consultar_horarios', { preferencia: 'quinta de manhã' })
  eq('consultar grava a oferta', [out.isError, w.state.oferta.map((s: any) => s.label)], [false, ['quinta 01/10 às 9h', 'quinta 01/10 às 9h30']])
  out = await runTool(ctx('pode ser na sexta às 10h?'), 'agendar_reuniao', { horario: 'sexta 02/10 às 10h' })
  eq('pediu outro dia fora da oferta: manda consultar de novo', [out.isError, /consultar_horarios com preferencia/.test(out.content), w.reunioes.length], [true, true, 0])
  await runTool(ctx('pode ser quinta de manhã'), 'consultar_horarios', { preferencia: 'quinta de manhã' })
  out = await runTool(ctx('beleza'), 'agendar_reuniao', { horario: 'quinta 01/10 às 9h' })
  eq('"beleza" sem escolher entre 2 opções é recusado', out.isError, true)
  w.ocupados.push({ ini: iso('2026-10-01T12:00:00Z'), fim: iso('2026-10-01T12:30:00Z') })
  out = await runTool(ctx('9h30 fica ótimo'), 'agendar_reuniao', { horario: 'quinta 01/10 às 9h30' })
  eq('horário ocupado na revalidação é recusado', [out.isError, /ocupado/.test(out.content), w.reunioes.length], [true, true, 0])
  w.ocupados = []
  await runTool(ctx('pode ser quinta de manhã'), 'consultar_horarios', { preferencia: 'quinta de manhã' })
  out = await runTool(ctx('9h30 fica ótimo'), 'agendar_reuniao', { horario: 'quinta 01/10 às 9h' })
  eq('modelo pediu horário diferente do lead: recusado', [out.isError, w.reunioes.length], [true, 0])
  out = await runTool(ctx('9h30 fica ótimo'), 'agendar_reuniao', { horario: 'quinta 01/10 às 9h30', decisor_convidado: 'Carlos (sócio)' })
  eq('reunião agenda os lembretes', w.lembretes?.taskId, 't1')
  eq('sem link: tarefa para o Rodrigo preencher o Link da Reunião', /Link da Reunião/.test((w.tarefas || [])[0] || ''), true)
  eq('decisor convidado vai para a tarefa', /Decisor convidado: Carlos \(sócio\)/.test(w.reunioes[0]?.texto || ''), true)
  eq('agenda o horário do lead, finaliza e tira o gate', [out.isError, out.handoff, w.reunioes.length, new Date(w.reunioes[0]?.ini).toISOString(), w.state.finalizado?.motivo, w.tags.has('gate')],
    [false, true, 1, '2026-10-01T12:30:00.000Z', 'agendado', false])
  out = await runTool(ctx('e se for sexta?'), 'consultar_horarios', { preferencia: 'sexta' })
  eq('não marca segunda reunião', out.isError, true)

  // Google Agenda: o evento volta com o Meet, que vai para o campo e para a confirmação (sem tarefa de link)
  w.state = { respostas: { dor: 'perco lead', decisor: 'eu', vendedores: '5', prioridade: 'este mês' } }
  w.tags = new Set(['gate']); w.reunioes = []; w.tarefas = []; w.meet = 'https://meet.google.com/abc-defg-hij'
  const escritos: any[] = []
  const portG = { ...port, writeFields: async (v: any[]) => { escritos.push(...v) } }
  const ctxG = (lead: string) => ({ ...ctx(lead), port: portG }) as any
  await runTool(ctxG('pode ser quinta de manhã'), 'consultar_horarios', { preferencia: 'quinta de manhã' })
  out = await runTool(ctxG('9h fica ótimo'), 'agendar_reuniao', { horario: 'quinta 01/10 às 9h' })
  eq('Meet do Google: link no campo e na confirmação, sem tarefa de link', [out.isError, escritos.some(v => v.field_id === CRM_MAP.linkReuniaoFieldId && v.values[0].value === w.meet), out.content.includes(w.meet), (w.tarefas || []).length],
    [false, true, true, 0])
  eq('aviso ao Rodrigo: blocos, data, um link só (card), só emoji que a Kommo aceita', [/NOVA REUNIÃO MARCADA/.test(w.avisos?.at(-1) || ''), (w.avisos?.at(-1) || '').includes('01/10 às 9h'), !(w.avisos?.at(-1) || '').includes(w.meet), /leads\/detail\/1$/.test(w.avisos?.at(-1) || ''), /[\u{10000}-\u{10FFFF}]/u.test(w.avisos?.at(-1) || '')], [true, true, true, true, false])
  eq('reunião: tag reuniao-agendada e nota visual com data e link', [w.tags.has('reuniao-agendada'), w.notes.some((n: string) => n.includes('Atendimento finalizado, transferido para humano') && n.includes('01/10 às 9h') && n.includes(w.meet) && n.includes('Resumo da qualificação'))], [true, true])
  w.meet = ''

  // Equipe pequena NÃO bloqueia reunião: o contexto decide (ex.: uma pessoa só que precisa de implantação)
  w.state = { respostas: { dor: 'perco lead', decisor: 'eu', vendedores: 'só eu', prioridade: 'este mês' } }
  w.tags = new Set(['gate'])
  out = await runTool(ctx('sou só eu, atendo e faço os procedimentos'), 'consultar_horarios', { preferencia: '' })
  eq('uma pessoa só: a reunião continua possível', out.isError, false)
  w.state = { respostas: { vendedores: '2' } }
  out = await runTool(ctx('fechado, quero o Advanced para 2 usuários'), 'finalizar_atendimento', { motivo: 'venda_licenca', resumo: 'Advanced, 2 usuários' })
  eq('venda de licença finaliza com a tag venda-licenca', [out.isError, w.state.finalizado?.motivo, w.tags.has('venda-licenca'), w.tags.has('gate')], [false, 'venda_licenca', true, false])
  w.state = {}; w.tags = new Set(['gate'])
  out = await runTool(ctx('meu whatsapp caiu e a mensagem não está enviando'), 'finalizar_atendimento', { motivo: 'suporte', evidencia: 'meu whatsapp caiu', resumo: 'suporte técnico' })
  eq('suporte técnico finaliza com a tag indicacao-suporte', [out.isError, w.tags.has('indicacao-suporte')], [false, true])

  // QStash: só aceita o despertador assinado com a chave certa e para o mesmo item
  process.env.QSTASH_CURRENT_SIGNING_KEY = 'sig_teste_atual'; process.env.QSTASH_NEXT_SIGNING_KEY = 'sig_teste_prox'
  const { assinaturaValida } = await import('../lib/qstash')
  const crypto = await import('crypto')
  const jwt = (chave: string, sub: string) => {
    const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const hp = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ iss: 'Upstash', sub, exp: Math.floor(Date.now() / 1000) + 300, nbf: Math.floor(Date.now() / 1000) })}`
    return `${hp}.${crypto.createHmac('sha256', chave).update(hp).digest('base64url')}`
  }
  const sub = 'https://x.vercel.app/api/cron?item=sdr%3A123'
  eq('QStash: assinatura válida (chave atual e próxima)', [assinaturaValida(jwt('sig_teste_atual', sub), '/api/cron?item=sdr%3A123'), assinaturaValida(jwt('sig_teste_prox', sub), '/api/cron?item=sdr:123')], [true, true])
  eq('QStash: chave errada ou outro item = recusado', [assinaturaValida(jwt('outra', sub), '/api/cron?item=sdr%3A123'), assinaturaValida(jwt('sig_teste_atual', sub), '/api/cron?item=sdr%3A999')], [false, false])

  // Follow-up: fim de semana não junta dois passos na mesma segunda 9h
  const { proximoPasso } = await import('../lib/followup')
  const sexta = iso('2026-09-25T17:40:00Z')           // última msg da Lara: sexta 14h40
  const segunda9h = iso('2026-09-28T12:00:00Z')       // passo 1 (4h) saiu segunda 9h
  eq('passo 2 (1 dia) não sai junto do passo 1 depois do fim de semana', new Date(proximoPasso(sexta, 24 * 3600000, 4 * 3600000, segunda9h)).toISOString(), '2026-09-29T12:00:00.000Z')
  eq('dia normal: passo 2 segue a cadência', new Date(proximoPasso(iso('2026-09-29T13:00:00Z'), 24 * 3600000, 4 * 3600000, iso('2026-09-29T17:00:00Z'))).toISOString(), '2026-09-30T13:00:00.000Z')
  return 0
}
