/**
 * CENÁRIOS DO CLIENTE (patch) — Control Gestão · SDR de indicações Kommo.
 * Relógio fixo: segunda 28/09/2026 10h de Brasília (scripts/evals.ts).
 *
 * ⚠️ Os prompts ainda têm [PREENCHER] (oferta, cases, tom real, duração). Rodar agora
 * mede o COMPORTAMENTO (ordem, tools, agenda, tom); o 10/10 que libera o deploy
 * só vale depois dos dados do negócio preenchidos.
 */
import type { Cenario } from '../scripts/evals'

const umaPergunta = { nome: 'no máximo 1 pergunta por resposta', fn: (_w: any, t: any[]) => t.every(x => (x.resposta.match(/\?/g) || []).length <= 1) }
const ABERTURA_ENCENADA = /^(ótima pergunta|excelente pergunta|perfeito!|show!|bora lá|deixa eu te explicar|claro!|com certeza!)/i
const RESIDUO_CHATBOT = /(espero ter ajudado|fico à disposição|posso ajudar (com|em) (mais )?(alguma|algo)|qualquer dúvida,? (é só|estou))/i
const tomHumano = { nome: 'tom humano: sem travessão, abertura encenada ou resíduo de chatbot', fn: (_w: any, t: any[]) => t.every(x => !/[—–]/.test(x.resposta) && !ABERTURA_ENCENADA.test(x.resposta.trim()) && !RESIDUO_CHATBOT.test(x.resposta)) }
const semFallback = { nome: 'nenhuma resposta caiu no texto de segurança', fn: (_w: any, t: any[]) => t.every(x => !x.guard.includes('fallback')) }
const chamou = (tool: string) => ({ nome: `chamou ${tool}`, fn: (_w: any, t: any[]) => t.some(x => x.tools.includes(tool)) })
const naoMarcou = { nome: 'não criou reunião', fn: (w: any) => w.reunioes.length === 0 }
const finalizou = (motivo: string) => ({ nome: `finalizou como ${motivo}`, fn: (w: any) => w.state.finalizado?.motivo === motivo })

const semPreco = { nome: 'não cita valor em R$', fn: (_w: any, t: any[]) => t.every(x => !/r\$\s*\d|\d+\s*(mil )?reais|a partir de r?\$?\s*\d/i.test(x.resposta)) }
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
      'Termina com UMA pergunta do CHAMP que o Comment ainda não respondeu',
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
    id: 'abertura-espanhol',
    porta: 'indicacao', nomeContato: 'Carlos', comentario: 'Necesitamos configurar el embudo y conectar WhatsApp para 8 vendedores', abertura: true, agora: '2026-09-28T16:00:00Z',
    msgs: [],
    checks: [umaPergunta, semFallback],
    criterios: ['A mensagem está em espanhol (pode começar com a saudação do horário)', 'Se apresenta como Lara', 'Não pergunta quantos vendedores são, porque o Comment já disse 8'],
  },
  {
    id: 'responde-antes-de-perguntar',
    porta: 'indicacao', nomeContato: 'Ana Souza', comentario: COMMENT,
    historico: [['out', ABERTURA]],
    msgs: ['planilha. Mas vocês integram o WhatsApp oficial ou só o Lite?'],
    checks: [umaPergunta, semFallback, tomHumano, chamou('salvar_respostas')],
    criterios: ['Responde a pergunta sobre WhatsApp primeiro (sem inventar detalhe técnico que não sabe; pode dizer que o especialista detalha) e só depois faz UMA pergunta do CHAMP'],
  },
  {
    id: 'preco-sem-valor',
    porta: 'indicacao', nomeContato: 'Ana Souza', comentario: COMMENT,
    historico: [['out', ABERTURA]],
    msgs: ['antes, quanto custa a implantação?'],
    checks: [umaPergunta, semFallback, tomHumano, semPreco, naoMarcou],
    criterios: [
      'Responde a pergunta de preço primeiro, sem citar nenhum valor, dizendo que depende do tamanho da operação e que o especialista monta a proposta',
      'Usa a pergunta seguinte para entender o tamanho: faturamento mensal ou quantos vendedores vão usar',
    ],
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
    msgs: ['planilha, somos 6 vendedores e o pior é perder lead', 'eu mesma decido', 'faturamos uns 150 mil por mês e queremos começar ainda este mês', 'quinta de manhã fica melhor pra mim', 'pode ser às 9h30'],
    checks: [semFallback, tomHumano, semPreco, chamou('agendar_reuniao'),
      { nome: 'criou UMA reunião quinta 01/10 9h30', fn: (w: any) => w.reunioes.length === 1 && new Date(w.reunioes[0].ini).toISOString() === '2026-10-01T12:30:00.000Z' },
      finalizou('agendado'),
      { nome: 'confirmação sem pergunta', fn: (_w: any, t: any[]) => !t[t.length - 1].resposta.includes('?') }],
    criterios: ['A última mensagem confirma quinta 01/10 às 9h30 e não faz pergunta'],
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
    id: 'bot-assume',
    porta: 'indicacao', nomeContato: 'Ana Souza', comentario: COMMENT,
    historico: [['out', ABERTURA]],
    msgs: ['você é um robô?'],
    checks: [umaPergunta, tomHumano],
    criterios: ['Assume que é a Lara, IA da Control Gestão, sem se desculpar, e segue a conversa'],
  },
]
