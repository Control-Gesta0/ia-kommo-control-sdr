/**
 * CENÁRIOS DO CLIENTE (patch) — Control Gestão · SDR de indicações Kommo.
 * Relógio fixo: segunda 28/09/2026 10h de Brasília (scripts/evals.ts).
 *
 * ⚠️ Os prompts ainda têm [PREENCHER] (oferta, preço, nome da IA). Rodar agora
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

const COMMENT = 'Preciso organizar o funil de vendas e integrar o WhatsApp da equipe no Kommo'
const ABERTURA = 'Oi, Ana! Aqui é da Control Gestão, parceira da Kommo. A Kommo me passou seu pedido sobre organizar o funil e ligar o WhatsApp da equipe. Quantas pessoas vão usar o Kommo no dia a dia?'

export const CENARIOS: Cenario[] = [
  {
    id: 'abertura-usa-comment',
    porta: 'indicacao', nomeContato: 'Ana Souza', comentario: COMMENT, abertura: true,
    msgs: [],
    checks: [umaPergunta, semFallback, tomHumano],
    criterios: [
      'A primeira mensagem diz que é da Control Gestão e que o pedido veio pela Kommo',
      'Mostra que leu o Comment citando a necessidade (funil e/ou WhatsApp) sem copiar o texto inteiro',
      'Termina com UMA pergunta simples que o Comment ainda não respondeu (não pergunta de novo o que ela quer resolver)',
      'Tem no máximo 3 linhas',
    ],
  },
  {
    id: 'abertura-espanhol',
    porta: 'indicacao', nomeContato: 'Carlos', comentario: 'Necesitamos configurar el embudo y conectar WhatsApp para 8 vendedores', abertura: true,
    msgs: [],
    checks: [umaPergunta, semFallback, tomHumano],
    criterios: ['A mensagem está em espanhol', 'Não pergunta quantas pessoas vão usar, porque o Comment já disse 8 vendedores'],
  },
  {
    id: 'qualifica-e-oferece-horarios',
    porta: 'indicacao', nomeContato: 'Ana Souza', comentario: COMMENT,
    historico: [['out', ABERTURA]],
    msgs: ['somos 6 vendedores, hoje a gente usa planilha'],
    checks: [umaPergunta, semFallback, tomHumano, chamou('salvar_respostas'), chamou('consultar_horarios'),
      { nome: 'gravou equipe', fn: (w: any) => !!w.state.respostas?.equipe }, naoMarcou],
    criterios: [
      'Oferece horários de reunião com dia e hora concretos (não pergunta "qual horário você prefere?" em aberto)',
      'Não inventa horário: os horários citados são no máximo dois e têm o formato "hoje/amanhã/dia da semana dd/mm às Xh"',
    ],
  },
  {
    id: 'agenda-ponta-a-ponta',
    porta: 'indicacao', nomeContato: 'Ana Souza', comentario: COMMENT,
    historico: [['out', ABERTURA]],
    msgs: ['somos 6 vendedores', 'quinta de manhã fica melhor pra mim', 'pode ser às 9h30'],
    checks: [semFallback, tomHumano, chamou('agendar_reuniao'),
      { nome: 'criou UMA reunião quinta 01/10 9h30', fn: (w: any) => w.reunioes.length === 1 && new Date(w.reunioes[0].ini).toISOString() === '2026-10-01T12:30:00.000Z' },
      finalizou('agendado'),
      { nome: 'confirmação sem pergunta', fn: (_w: any, t: any[]) => !t[t.length - 1].resposta.includes('?') }],
    criterios: ['A última mensagem confirma quinta 01/10 às 9h30 e não faz pergunta'],
  },
  {
    id: 'beleza-nao-escolhe',
    porta: 'indicacao', nomeContato: 'Ana Souza', comentario: COMMENT,
    state: {
      respostas: { objetivo: 'organizar o funil', equipe: '6' },
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
    id: 'preco-sem-inventar',
    porta: 'indicacao', nomeContato: 'Ana Souza', comentario: COMMENT,
    historico: [['out', ABERTURA]],
    msgs: ['antes, quanto custa a implantação?'],
    checks: [umaPergunta, semFallback, tomHumano, naoMarcou],
    criterios: [
      'Responde a pergunta de preço primeiro (com o que o prompt permite) e só depois faz no máximo uma pergunta',
      'Não inventa valor em reais que não esteja no prompt',
    ],
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
    historico: [['out', 'Oi, João! Aqui é da Control Gestão, parceira da Kommo. A Kommo me passou seu contato. O que vocês querem resolver com o Kommo?']],
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
    criterios: ['Assume que é a IA da Control Gestão, sem se desculpar, e segue a conversa'],
  },
]
