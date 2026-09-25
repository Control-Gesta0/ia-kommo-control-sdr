/**
 * MAPA DO CRM — Control Gestão · SDR das indicações de parceiro Kommo (patch).
 *
 * Tudo que é número vem da conta VIVA: `npm run discover` e copie daqui.
 * Placeholder é 0 de propósito: o /api/validate acusa cada um e o deploy não
 * passa no gate. Os dois números que JÁ vieram do userscript em uso
 * (USER_ID 12725576 e STATUS_ID 55438567) também são conferidos pelo validate.
 *
 * O desenho deste agente:
 *  - UMA porta ("indicacao"), travada no início pela própria IA: não existe menu.
 *  - A IA fala PRIMEIRO (o lead chega pela Kommo, sem conversa aberta).
 *  - O "Comment:" da indicação entra como contexto e como evidência do lead.
 *  - Qualifica pouco (a Kommo já mandou a necessidade) e marca a reunião.
 *  - A alçada termina no agendamento: só `agendar_reuniao` move para a etapa
 *    de reunião, depois da tarefa criada (comum/PEGADINHAS §40).
 */

import type { AgendaConfig, Alerta, Campo, Etapa, Porta } from './crm-map-types'
export type { AgendaConfig, Alerta, Campo, CampoTipo, Etapa, Porta } from './crm-map-types'

// CHAMP: Challenges (organização + dor + vendedores) · Authority (decisor) ·
// Money (faturamento ou nº de usuários) · Prioritization (quando começar)
const CAMPOS = {
  organizacao: {
    key: 'organizacao', id: 1046001, kommoName: 'Situação', name: 'Onde organizam os leads hoje', type: 'text',
    sinal: /planilha|excel|sheets|caderno|papel|whats|kommo|amo|crm|sistema|agenda|cabe[cç]a|mem[oó]ria|google|trello|notion|pipedrive|\brd\b|hubspot|bitrix|ploomes|anot|nada|nenhum|lugar nenhum|n[aã]o (organiz|temos|tenho|usamos)/i,
    pergunta: 'Hoje vocês organizam os leads onde, em planilha, no próprio WhatsApp ou em algum sistema?',
  },
  vendedores: {
    key: 'vendedores', id: 0, name: 'Quantos vendedores usariam o Kommo', type: 'text',
    sinal: /\d|\b(um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|vinte|trinta)\b|s[oó] eu|sozinh|vendedor|pessoa|usu[aá]rio|atendente|consultor|corretor|equipe|time/i,
    pergunta: 'Quantos vendedores usariam o Kommo no dia a dia?',
  },
  dor: {
    key: 'dor', id: 1046003, kommoName: 'Problema', name: 'O que mais incomoda hoje (perder lead, não saber a etapa, falta de relatório)', type: 'textarea',
    sinal: /perd|esquec|some|sum|escap|etapa|fase|onde (est|par)|relat[oó]rio|n[uú]mero|m[eé]trica|indicador|controle|acompanh|organiz|bagun|demor|follow|retorno|respond|resposta|vis[aã]o|gest[aã]o|funil|atendimento|whats/i,
    pergunta: 'O que mais incomoda hoje: perder lead no caminho, não saber em que etapa cada um está ou não ter relatório?',
  },
  decisor: {
    key: 'decisor', id: 1046753, kommoName: 'Authorit', name: 'Quem decide a contratação', type: 'text',
    sinal: /\beu\b|mim|s[oó]ci[oa]|dono|dona|diretor|gerente|gestor|decid|chefe|marido|esposa|mulher|pai|m[aã]e|junto|conselho|ceo|financeiro|propriet|presidente|patr[aã]o|\bnós\b|\bnos dois\b/i,
    pergunta: 'A decisão de contratar passa só por você ou tem mais alguém junto?',
  },
  faturamento: {
    key: 'faturamento', id: 1046017, kommoName: 'Faturamento', name: 'Faturamento mensal ou faixa de investimento', type: 'text',
    sinal: /\d|\bmil\b|milh|\bk\b|fatur|investi|or[cç]amento|budget|verba|reais|r\$|n[aã]o (sei|posso|quero) (dizer|informar|falar)/i,
    pergunta: 'Pra eu entender o tamanho da operação, qual é mais ou menos o faturamento mensal da empresa?',
  },
  prioridade: {
    key: 'prioridade', id: 1046757, kommoName: 'Tempo', name: 'Quando quer começar (este mês ou mais pra frente)', type: 'text',
    sinal: /m[eê]s|semana|\bj[aá]\b|agora|urgente|logo|hoje|amanh|\bano\b|trimestre|depois|pra frente|sem pressa|quanto antes|imediat|r[aá]pido|pressa|\d/i,
    pergunta: 'Vocês querem começar ainda este mês ou mais pra frente?',
  },
} satisfies Record<string, Campo>

const AGENDA: AgendaConfig = {
  ativa: true,
  responsavelId: 0,          // [PREENCHER] user_id do closer (discover → Usuários)
  taskTypeId: 2238563,       // "Apresentação" (tipos da conta: 2=Meeting, 2238563=Apresentação)
  duracaoMin: 60,            // a reunião dura 30 a 45 min, mas a agenda reserva 1h
  passoMin: 30,
  diasUteisJanela: 5,
  antecedenciaMinHoras: 3,
  expediente: { dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '18:00', pausas: [['12:00', '13:30']] }, // [CONFIRMAR]
  maxOpcoes: 2,
  folgaMin: 15,
}

export const CRM_MAP = {
  /** textarea que o Salesbot envia (Desenho A) */
  respostaFieldId: 0,

  /** a IA NUNCA escreve nestes campos */
  camposProibidos: [] as number[],

  campos: CAMPOS as Record<string, Campo>,

  /** onde o lead aceito cai (o STATUS_ID do userscript) — a IA só inicia conversa com lead nesta etapa */
  entrada: { pipelineId: 4338500, statusId: 55438567, name: 'INICIAL - ENRIQUECIMENTO' },
  /** quem recebe o lead aceito (o USER_ID do userscript) */
  responsavelEntradaId: 12725576,

  /** campo de texto onde o "Comment:" é copiado ao iniciar (0 = só nota no card) */
  comentarioFieldId: 1046007, // "Necessidade" (textarea)

  /** tags que a IA põe ao iniciar e ao descartar teste */
  tags: {
    indicacao: 'indicacao-kommo',
    teste: 'indicacao-teste',
    semTelefone: 'indicacao-sem-telefone',
    invalida: 'indicacao-invalida',
    suporte: 'indicacao-suporte',
    licenca: 'venda-licenca',
  },

  portas: [
    {
      id: 'indicacao',
      label: 'Indicação de parceiro Kommo',
      menu: null,
      ativa: true,
      promptFile: 'indicacao.md',
      sinais: /$^/,
      roteiro: ['organizacao', 'vendedores', 'dor', 'decisor', 'faturamento', 'prioridade'],
      obrigatorios: ['organizacao', 'vendedores'],
    },
  ] as Porta[],

  menu: {
    /** sem menu: todo lead com o gate cai nesta porta */
    portaUnica: 'indicacao' as string,
    outros: 9,
    portaPadraoOutros: 'indicacao',
    classificarTextoLivre: false,
    texto: '',
    pedirResumo: '',
    naoEntendi: '',
  },

  agenda: AGENDA,
  /**
   * CHAMP antes de marcar: cada grupo precisa de PELO MENOS UM campo respondido
   * (ou "não sei" dito pelo lead). Money vale por faturamento OU nº de vendedores.
   */
  exigirAntesDeAgendar: [['dor', 'organizacao'], ['decisor'], ['faturamento', 'vendedores'], ['prioridade']] as string[][],
  /** etapa para onde `agendar_reuniao` move o lead DEPOIS da tarefa criada (id 0 = não move) */
  etapaAgendado: { id: 81193772, pipelineId: 4338500, name: 'APRESENTAÇÃO agendada' } as Etapa,
  /** campo date_time "Reunião" (epoch em SEGUNDOS). 0 = não grava */
  dataReuniaoFieldId: 1040772,

  /**
   * Equipe pequena: não marca reunião, tenta vender a LICENÇA pelo WhatsApp.
   * Código: agendar_reuniao recusa quando vendedores ≤ maxVendedores (a menos que
   * o lead peça a reunião); finalizar(venda_licenca) só com vendedores respondido.
   */
  licenca: { maxVendedores: 3 },

  finalizar: {
    removerGate: true,
    tags: ['ia-finalizou'] as string[],
    tagUrgente: '' as string,
    nota: true,
  },

  alertas: [
    {
      nome: 'perguntou preço',
      re: /quanto custa|quanto fica|quanto [ée]|pre[cç]o|valor|investimento|or[cç]amento|mensalidade|cobram|custo/i,
      aviso: 'O lead perguntou PREÇO. Se for da LICENÇA/plano da Kommo, pode responder com os planos. Se for da implantação/configuração/suporte/IA (nosso serviço), NÃO cite valor: "Depende do tamanho da operação, por isso quero te passar o valor certo." E a pergunta desta resposta é sobre o TAMANHO (quantos vendedores vão usar, ou o faturamento mensal).',
    },
  ] as Alerta[],

  /** a IA não move etapa por tool (só agendar_reuniao, com guard) */
  etapas: [] as Etapa[],
  etapasProtegidas: [142, 143] as number[],

  /** abertura sem LLM (se o modelo falhar ou reprovar na trava). {saudacao} = "Bom dia"; {nome} = ", Ana" ou vazio */
  aberturaFixa: '{saudacao}{nome}! Aqui é a Lara, da Control Gestão, parceira oficial da Kommo. A Kommo me passou o seu pedido e eu vou te ajudar por aqui. Pra eu entender o cenário de vocês, hoje os leads ficam organizados onde?',

  textoSeguro: 'Entendi. Me conta um pouco de como vocês trabalham os leads hoje?',
  textoSeguroFinal: 'Combinado, anotei tudo aqui. O nosso time segue com você por aqui.',

  midia: {
    instrucaoVisao: 'Descreva em português, em no máximo 4 frases, o conteúdo do arquivo que um lead enviou pelo WhatsApp: o que é, telas ou números legíveis. O que não estiver legível, diga "ilegível".',
  },
}

export const portaById = (id?: string) => CRM_MAP.portas.find(p => p.id === id)
export const campoByKey = (key: string) => CRM_MAP.campos[key]
