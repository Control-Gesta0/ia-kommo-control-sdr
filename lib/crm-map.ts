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

const CAMPOS = {
  objetivo: {
    key: 'objetivo', id: 0, kommoName: '[PREENCHER: campo "Necessidade" ou similar]', name: 'O que quer resolver com o Kommo', type: 'textarea',
    sinal: /[a-zà-ú]{4,}/i, pergunta: 'O que vocês querem resolver primeiro com o Kommo?',
  },
  equipe: {
    key: 'equipe', id: 0, kommoName: '[PREENCHER]', name: 'Quantas pessoas vão usar o Kommo', type: 'text',
    sinal: /\d|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|vinte|s[oó] eu|sozinh|equipe|time|vendedor|pessoa|usu[aá]rio|atendente/i,
    pergunta: 'Quantas pessoas vão usar o Kommo no dia a dia?',
  },
  situacao: {
    key: 'situacao', id: 0, kommoName: '[PREENCHER]', name: 'Onde está hoje (já usa o Kommo, outro CRM, planilha)', type: 'text',
    sinal: /kommo|amo|crm|planilha|excel|caderno|whats|trial|per[ií]odo|teste|pipedrive|rd|hubspot|bitrix|ploomes|nada|nenhum|come[cç]ando|j[aá] (uso|usamos|tenho|temos)|ainda n[aã]o|n[aã]o (uso|usamos|tenho|temos)/i,
    pergunta: 'Vocês já usam o Kommo ou ainda estão em outra ferramenta?',
  },
  prazo: {
    key: 'prazo', id: 0, kommoName: '[PREENCHER]', name: 'Para quando precisa', type: 'text',
    sinal: /semana|m[eê]s|dia|j[aá]|urgente|agora|logo|ano|hoje|amanh|r[aá]pido|pressa|sem pressa|quanto antes|\d/i,
    pergunta: 'Para quando vocês precisam disso funcionando?',
  },
} satisfies Record<string, Campo>

const AGENDA: AgendaConfig = {
  ativa: true,
  responsavelId: 0,          // [PREENCHER] user_id do closer (discover → Usuários)
  taskTypeId: 2,             // 2 = Reunião no Kommo (conferir no discover)
  duracaoMin: 30,            // [CONFIRMAR]
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
  entrada: { pipelineId: 0, statusId: 55438567, name: '[PREENCHER: nome da etapa]' },
  /** quem recebe o lead aceito (o USER_ID do userscript) */
  responsavelEntradaId: 12725576,

  /** campo de texto onde o "Comment:" é copiado ao iniciar (0 = só nota no card) */
  comentarioFieldId: 0,

  /** tags que a IA põe ao iniciar e ao descartar teste */
  tags: {
    indicacao: 'indicacao-kommo',
    teste: 'indicacao-teste',
    semTelefone: 'indicacao-sem-telefone',
  },

  portas: [
    {
      id: 'indicacao',
      label: 'Indicação de parceiro Kommo',
      menu: null,
      ativa: true,
      promptFile: 'indicacao.md',
      sinais: /$^/,
      roteiro: ['objetivo', 'equipe', 'situacao', 'prazo'],
      obrigatorios: ['objetivo', 'equipe'],
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
  /** campos do roteiro que precisam estar respondidos antes de marcar */
  exigirAntesDeAgendar: ['objetivo', 'equipe'] as string[],
  /** etapa para onde `agendar_reuniao` move o lead DEPOIS da tarefa criada (id 0 = não move) */
  etapaAgendado: { id: 0, pipelineId: 0, name: '[PREENCHER: etapa de reunião agendada]' } as Etapa,
  /** campo date_time "Data da reunião" (epoch em SEGUNDOS). 0 = não grava */
  dataReuniaoFieldId: 0,

  finalizar: {
    removerGate: true,
    tags: ['ia-finalizou'] as string[],
    tagUrgente: '' as string,
    nota: true,
  },

  alertas: [] as Alerta[],

  /** a IA não move etapa por tool (só agendar_reuniao, com guard) */
  etapas: [] as Etapa[],
  etapasProtegidas: [142, 143] as number[],

  /** abertura sem LLM (se o modelo falhar ou reprovar na trava). {nome} = " Ana" ou vazio */
  aberturaFixa: 'Oi{nome}! Aqui é da Control Gestão, parceira da Kommo. A Kommo me passou o seu pedido e eu sigo com você por aqui. Pra eu entender melhor, quantas pessoas vão usar o Kommo no dia a dia?',

  textoSeguro: 'Entendi. Me conta mais um pouco sobre como vocês trabalham hoje?',
  textoSeguroFinal: 'Combinado, anotei tudo aqui. O nosso time segue com você por aqui.',

  midia: {
    instrucaoVisao: 'Descreva em português, em no máximo 4 frases, o conteúdo do arquivo que um lead enviou pelo WhatsApp: o que é, telas ou números legíveis. O que não estiver legível, diga "ilegível".',
  },
}

export const portaById = (id?: string) => CRM_MAP.portas.find(p => p.id === id)
export const campoByKey = (key: string) => CRM_MAP.campos[key]
