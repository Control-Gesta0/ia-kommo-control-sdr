/**
 * CENÁRIOS DO CLIENTE (patch) — Control Gestão · SDR de indicações Kommo.
 * Relógio fixo: segunda 28/09/2026 10h de Brasília (scripts/evals.ts).
 *
 * Rodar agora
 * mede o COMPORTAMENTO (ordem, tools, agenda, tom); o 10/10 que libera o deploy
 * só vale depois dos dados do negócio preenchidos.
 */
import type { Cenario } from '../scripts/evals'

const umaPergunta = { nome: 'no máximo 2 perguntas por resposta', fn: (_w: any, t: any[]) => t.every(x => (x.resposta.match(/\?/g) || []).length <= 2) }
const ABERTURA_ENCENADA = /^(ótima pergunta|excelente pergunta|perfeito!|show!|bora lá|deixa eu te explicar|claro!|com certeza!)/i
const RESIDUO_CHATBOT = /(espero ter ajudado|fico à disposição|posso ajudar (com|em) (mais )?(alguma|algo)|qualquer dúvida,? (é só|estou))/i
const tomHumano = { nome: 'tom humano: sem travessão, abertura encenada ou resíduo de chatbot', fn: (_w: any, t: any[]) => t.every(x => !/[—–]/.test(x.resposta) && !ABERTURA_ENCENADA.test(x.resposta.trim()) && !RESIDUO_CHATBOT.test(x.resposta)) }
const semFallback = { nome: 'nenhuma resposta caiu no texto de segurança', fn: (_w: any, t: any[]) => t.every(x => !x.guard.includes('fallback')) }
const chamou = (tool: string) => ({ nome: `chamou ${tool}`, fn: (_w: any, t: any[]) => t.some(x => x.tools.includes(tool)) })
const naoMarcou = { nome: 'não criou reunião', fn: (w: any) => w.reunioes.length === 0 }
const finalizou = (motivo: string) => ({ nome: `finalizou como ${motivo}`, fn: (w: any) => w.state.finalizado?.motivo === motivo })

// A pergunta de faturamento tem faixas em R$ ("até R$ 50 mil, de R$ 50 a 200 mil"): isso não é preço nosso
const semFaixaFaturamento = (t: string) => t.replace(/[^.?!\n]*fatura[^.?!\n]*[.?!]?/gi, '')
const semPreco = { nome: 'não cita valor em R$', fn: (_w: any, t: any[]) => t.every(x => !/r\$\s*\d|\d+\s*(mil )?reais|a partir de r?\$?\s*\d/i.test(semFaixaFaturamento(x.resposta))) }
const abreCerto = (s: string) => ({ nome: `abertura começa com "${s}" e se apresenta como Lara`, fn: (_w: any, t: any[]) => t[0].resposta.startsWith(s) && /\bLara\b/.test(t[0].resposta) && !/^[^.!]*\?/.test(t[0].resposta) })

const COMMENT = 'Preciso organizar o funil de vendas e integrar o WhatsApp da equipe no Kommo'
const ABERTURA = 'Bom dia, Ana! Aqui é a Lara, da Control Gestão, parceira oficial da Kommo. A Kommo me passou seu pedido sobre organizar o funil e ligar o WhatsApp da equipe. Hoje os leads de vocês ficam organizados onde?'
const CHAMP_OK = { respostas: { organizacao: 'planilha', vendedores: '6', dor: 'perco lead', decisor: 'eu', faturamento: '200 mil', prioridade: 'este mês' } }

export const CENARIOS: Cenario[] = [
  {
    id: 'abertura-rapport-comment',
    porta: 'indicacao', nomeContato: 'Ana Souza', comentario: COMMENT, abertura: true,
    msgs: [],
    checks: [umaPergunta, semFallback, tomHumano, abreCerto('Bom dia')],
    criterios: [
      'Começa com saudação e apresentação (Lara, Control Gestão) e diz que o pedido veio pela Kommo, antes de qualquer pergunta',
      'Cria rapport citando a necessidade do Comment (funil e/ou WhatsApp) com as palavras do lead, sem copiar o texto inteiro',
      'Termina com uma pergunta do roteiro (o que mais trava / quanto isso pesa / prioridade), sem perguntar o que o Comment já respondeu',
      'Tem no máximo 3 linhas',
    ],
  },
  {
    id: 'abertura-noite',
    porta: 'indicacao', nomeContato: 'Paulo', comentario: 'Temos 12 corretores e perdemos muito lead no WhatsApp', abertura: true, agora: '2026-09-28T22:30:00Z',
    msgs: [],
    checks: [umaPergunta, semFallback, abreCerto('Boa noite')],
    criterios: ['Não pergunta quantos vendedores/corretores são, porque o Comment já disse 12', 'Cita a dor de perder lead no WhatsApp'],
  },
  {
    id: 'abertura-comment-espanhol-responde-em-portugues',
    porta: 'indicacao', nomeContato: 'Carlos', comentario: 'Necesitamos configurar el embudo y conectar WhatsApp para 8 vendedores', abertura: true, agora: '2026-09-28T16:00:00Z',
    msgs: [],
    checks: [umaPergunta, semFallback],
    criterios: ['A mensagem está inteira em PORTUGUÊS (a Control Gestão só atende em português), mesmo com o Comment em espanhol', 'Se apresenta como Lara', 'Não pergunta quantos vendedores são, porque o Comment já disse 8'],
  },
  {
    id: 'responde-antes-de-perguntar',
    porta: 'indicacao', nomeContato: 'Ana Souza', comentario: COMMENT,
    historico: [['out', ABERTURA]],
    msgs: ['planilha. Mas vocês integram o WhatsApp oficial ou só o Lite?'],
    checks: [umaPergunta, semFallback, tomHumano, chamou('salvar_respostas')],
    criterios: ['Responde a pergunta sobre WhatsApp primeiro (sem inventar detalhe técnico que não sabe; pode dizer que o especialista detalha) e só depois faz a próxima pergunta do roteiro'],
  },
  {
    id: 'preco-sem-valor',
    porta: 'indicacao', nomeContato: 'Ana Souza', comentario: COMMENT,
    historico: [['out', ABERTURA]],
    msgs: ['antes, quanto custa a implantação?'],
    checks: [umaPergunta, semFallback, tomHumano, semPreco, naoMarcou],
    criterios: [
      'Responde a pergunta de preço primeiro, sem citar nenhum valor, dizendo que depende do tamanho da operação (ou do escopo, ou da quantidade de usuários)',
      'Usa a pergunta seguinte para entender o tamanho: faturamento mensal ou quantos vendedores vão usar',
    ],
  },
  {
    id: 'preco-licenca-pode',
    porta: 'indicacao', nomeContato: 'Ana Souza', comentario: COMMENT,
    historico: [['out', ABERTURA]],
    msgs: ['quanto custa a licença do Kommo por usuário?'],
    checks: [umaPergunta, semFallback, tomHumano, { nome: 'não fala preço em dólar', fn: (_w: any, t: any[]) => t.every(x => !/US\$|(?<!R)\$\s*\d|d[oó]lar/i.test(x.resposta)) }],
    criterios: ['Informa o preço da licença EM REAIS (Básico R$ 104, Avançado R$ 156 ou Pro R$ 234 por usuário/mês, ou o do plano indicado), sem nenhum valor em dólar', 'Não cita preço de implantação ou serviço da Control Gestão'],
  },
  {
    id: 'estetica-uma-pessoa-precisa-implantacao',
    porta: 'indicacao', nomeContato: 'Juliana', comentario: 'Tenho uma clínica de estética e preciso organizar os agendamentos e o atendimento no WhatsApp',
    historico: [['out', 'Bom dia, Juliana! Aqui é a Lara, da Control Gestão, parceira oficial da Kommo. A Kommo me passou seu pedido sobre organizar os agendamentos e o atendimento da clínica no WhatsApp. Hoje quantas pessoas atendem os clientes aí?']],
    msgs: ['sou só eu, eu atendo, marco e faço os procedimentos. já comprei a licença mas não sei configurar nada'],
    checks: [umaPergunta, semFallback, tomHumano, { nome: 'não finalizou como venda de licença', fn: (w: any) => w.state.finalizado?.motivo !== 'venda_licenca' }],
    criterios: ['Não tenta vender licença (ela já comprou); trata como implantação e segue qualificando ou oferece a reunião', 'Acolhe a dificuldade de não saber configurar'],
  },
  {
    id: 'decisor-convidado',
    porta: 'indicacao', nomeContato: 'Ana Souza', comentario: COMMENT,
    state: { respostas: { organizacao: 'planilha', vendedores: '6', dor: 'perco lead' } },
    historico: [['out', ABERTURA], ['in', 'planilha, somos 6 e o que mais dói é perder lead'], ['out', 'Entendi, perder lead na planilha é bem comum. A decisão de contratar passa só por você ou tem mais alguém junto?']],
    msgs: ['quem decide é meu sócio, o Carlos'],
    checks: [umaPergunta, semFallback, tomHumano, { nome: 'gravou decisor', fn: (w: any) => /carlos|s[oó]cio/i.test(w.state.respostas?.decisor || '') }],
    criterios: ['Convida o Carlos (sócio) para participar da reunião com o especialista'],
  },
  {
    id: 'agenda-ponta-a-ponta',
    porta: 'indicacao', nomeContato: 'Ana Souza', comentario: COMMENT,
    historico: [['out', ABERTURA]],
    msgs: ['planilha, somos 6 vendedores e o pior é perder lead', 'eu mesma decido', 'faturamos uns 150 mil por mês e queremos começar ainda este mês', 'quinta de manhã fica melhor pra mim', 'pode ser às 10h'],
    checks: [semFallback, tomHumano, semPreco, chamou('agendar_reuniao'),
      { nome: 'criou UMA reunião quinta 01/10 10h', fn: (w: any) => w.reunioes.length === 1 && new Date(w.reunioes[0].ini).toISOString() === '2026-10-01T13:00:00.000Z' },
      finalizou('agendado'),
      { nome: 'confirmação sem pergunta', fn: (_w: any, t: any[]) => !t[t.length - 1].resposta.includes('?') }],
    criterios: ['A última mensagem confirma quinta 01/10 às 10h e não faz pergunta'],
  },
  {
    id: 'beleza-nao-escolhe',
    porta: 'indicacao', nomeContato: 'Ana Souza', comentario: COMMENT,
    state: {
      ...CHAMP_OK,
      oferta: [
        { ini: Date.parse('2026-09-28T16:30:00Z'), fim: Date.parse('2026-09-28T17:00:00Z'), label: 'hoje, segunda 28/09 às 13h30' },
        { ini: Date.parse('2026-09-29T12:00:00Z'), fim: Date.parse('2026-09-29T12:30:00Z'), label: 'amanhã, terça 29/09 às 9h' },
      ],
    },
    historico: [['out', ABERTURA], ['in', 'somos 6'], ['out', 'Consigo hoje, segunda 28/09 às 13h30 ou amanhã, terça 29/09 às 9h. Qual fica melhor?']],
    msgs: ['beleza'],
    checks: [umaPergunta, naoMarcou],
    criterios: ['Não confirma reunião nenhuma: pergunta qual dos dois horários ela prefere'],
  },
  {
    id: 'ja-tem-parceiro',
    porta: 'indicacao', nomeContato: 'Ana Souza', comentario: COMMENT,
    historico: [['out', ABERTURA]],
    msgs: ['obrigada, mas ontem já fechei com outro parceiro da Kommo'],
    checks: [finalizou('ja_tem_parceiro'), naoMarcou, { nome: 'sem pergunta', fn: (_w: any, t: any[]) => !t[0].resposta.includes('?') }],
    criterios: ['Agradece sem insistir e sem falar mal do outro parceiro'],
  },
  {
    id: 'fora-do-escopo',
    porta: 'indicacao', nomeContato: 'João', comentario: 'quero trabalhar com vocês',
    historico: [['out', 'Bom dia, João! Aqui é a Lara, da Control Gestão, parceira oficial da Kommo. A Kommo me passou seu contato. O que vocês querem resolver com o Kommo?']],
    msgs: ['na verdade estou procurando emprego de vendedor, vocês estão contratando?'],
    checks: [finalizou('fora_do_escopo'), naoMarcou],
    criterios: ['Não oferece reunião de implantação e encerra com educação'],
  },
  {
    // Caso REAL (lead 20751547, 25/09/2026): o Comment e a 1ª mensagem já respondem o C do CHAMP
    id: 'nao-repete-joalheria',
    porta: 'indicacao', nomeContato: 'Kalel Rodrigues Mendonça',
    comentario: 'cadastro mais detalhado dos clientes datas importantes preferências e historico de compras atendimento instantâneo com modo ia pós vendas , aniversário, casamento atendimento humanizado padrão joalheria',
    abertura: true, agora: '2026-09-25T14:40:00Z',
    msgs: ['Então eu não sei como mexer na empresa de vocês, tentei aprender mais não consegui, eu estava precisando de um atendimento instantâneo com ia quando algum cliente mandar mensagem quando a nossa empresa não estiver em funcionamento, queria ter um CRM, com as informações de cada cliente organizando um por um'],
    checks: [umaPergunta, semFallback, tomHumano, abreCerto('Bom dia'),
      { nome: 'gravou a dor a partir do que ele já contou', fn: (w: any) => !!w.state.respostas?.dor }],
    criterios: [
      'A abertura cria rapport citando pelo menos um ponto concreto do Comment (ex.: cadastro dos clientes, datas especiais, pós-venda, atendimento com IA ou o padrão de joalheria)',
      'A resposta à mensagem do lead acolhe a dificuldade dele e NÃO pergunta de novo o que ele quer resolver, se tem CRM ou onde organiza os clientes',
      'A pergunta da resposta é sobre algo que ainda falta no roteiro (impacto, prioridade, ou decisão e faturamento)',
    ],
  },
  {
    id: 'bot-assume',
    porta: 'indicacao', nomeContato: 'Ana Souza', comentario: COMMENT,
    historico: [['out', ABERTURA]],
    msgs: ['você é um robô?'],
    checks: [umaPergunta, tomHumano],
    criterios: ['Assume que é a Lara, IA da Control Gestão, sem se desculpar, e segue a conversa'],
  },
  {
    // Teste real do Rodrigo (28/09): "no jurídico é comum..." em toda mensagem, sem pedir nome, "o dono"
    id: 'contato-direto-advogado-sem-repetir',
    porta: 'direto', nomeContato: 'Control Gestão - CRM',
    msgs: ['ola, preciso organizar meu atendimento', 'Rodrigo. utilizamos chat guru, é um escritório de advocacia', 'somos 7 pessoas', 'tudo isso: perco cliente, não sei a fase de cada atendimento e não tenho relatório', 'quem decide é o dono da empresa'],
    checks: [semFallback, tomHumano,
      { nome: 'generalização sobre o ramo no máximo 1 vez', fn: (_w: any, t: any[]) => t.filter(x => /(?<!\p{L})(?:(?:e|é) (?:bem |muito )?comum|costuma|acontece (?:bastante|muito|direto))(?!\p{L})/iu.test(x.resposta)).length <= 1 },
      { nome: 'registrou o nome do lead', fn: (w: any) => /rodrigo/i.test(w.state.respondenteNome || '') }],
    criterios: [
      'Na primeira resposta pede o nome da pessoa (o cadastro é de empresa) e não chama o lead pelo nome da empresa',
      'Não repete em várias mensagens frases genéricas sobre o ramo (tipo "no jurídico é comum...", "em escritório de advocacia isso acontece bastante")',
      'Quando o lead conta a dor, mostra em uma frase como isso se resolve no Kommo (funil, etapas, responsável, lembrete ou relatório)',
      'Quando o lead diz que quem decide é "o dono da empresa", pede o nome dessa pessoa (referir-se a ele como "ele" ou "dele" é normal; o erro seria tratar "o dono" como se fosse o nome dele)',
    ],
  },
  {
    // Eduardo (28/09): "Eu não sou essa pessoa" e a Lara respondeu "Ahh, legal"
    id: 'contato-errado',
    porta: 'indicacao', nomeContato: 'Eduardo Ribeiro Nunes', comentario: COMMENT,
    historico: [['out', ABERTURA]],
    msgs: ['Eu não sou essa pessoa, todo dia aparece alguém falando disso, não pedi nada'],
    checks: [finalizou('contato_errado'), tomHumano, { nome: 'sem pergunta e sem reação animada', fn: (_w: any, t: any[]) => t.every(x => !x.resposta.includes('?') && !/\b(legal|show|bacana|que bom)\b/i.test(x.resposta)) }],
    criterios: ['Pede desculpa em poucas palavras, não insiste e encerra sem fazer pergunta'],
  },
]
