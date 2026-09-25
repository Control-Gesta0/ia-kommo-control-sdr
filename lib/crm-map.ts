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
    key: 'organizacao', curto: 'Organização', id: 1046001, kommoName: 'Situação', name: 'Onde organizam os leads hoje', type: 'text',
    sinal: /planilha|excel|sheets|caderno|papel|whats|kommo|amo|crm|sistema|agenda|cabe[cç]a|mem[oó]ria|google|trello|notion|pipedrive|\brd\b|hubspot|bitrix|ploomes|anot|nada|nenhum|lugar nenhum|n[aã]o (organiz|temos|tenho|usamos)/i,
    pergunta: 'Hoje vocês organizam os leads onde: WhatsApp, planilha ou outro CRM?',
  },
  vendedores: {
    key: 'vendedores', curto: 'Vendedores', id: 0, name: 'Quantos vendedores usariam o Kommo', type: 'text',
    sinal: /\d|\b(um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|vinte|trinta)\b|s[oó] eu|sozinh|vendedor|pessoa|usu[aá]rio|atendente|consultor|corretor|equipe|time/i,
    pergunta: 'Quantos vendedores usariam o sistema?',
  },
  dor: {
    key: 'dor', curto: 'Dor', id: 1046003, kommoName: 'Problema', name: 'O que mais incomoda hoje (perder lead, não saber a etapa, falta de relatório)', type: 'textarea',
    sinal: /perd|esquec|some|sum|escap|etapa|fase|onde (est|par)|relat[oó]rio|n[uú]mero|m[eé]trica|indicador|controle|acompanh|organiz|bagun|demor|follow|retorno|respond|resposta|vis[aã]o|gest[aã]o|funil|atendimento|whats/i,
    pergunta: 'O que mais te incomoda hoje: perder lead, não saber em que etapa cada um está ou não ter relatório?',
  },
  decisor: {
    key: 'decisor', curto: 'Decisor', id: 1046753, kommoName: 'Authorit', name: 'Quem decide a contratação', type: 'text',
    sinal: /\beu\b|mim|s[oó]ci[oa]|dono|dona|diretor|gerente|gestor|decid|chefe|marido|esposa|mulher|pai|m[aã]e|junto|conselho|ceo|financeiro|propriet|presidente|patr[aã]o|\bnós\b|\bnos dois\b/i,
    pergunta: 'A escolha do CRM é sua ou passa por mais alguém?',
  },
  faturamento: {
    key: 'faturamento', curto: 'Faturamento', id: 1046017, kommoName: 'Faturamento', name: 'Faturamento mensal ou faixa de investimento', type: 'text',
    sinal: /\d|\bmil\b|milh|\bk\b|fatur|investi|or[cç]amento|budget|verba|reais|r\$|n[aã]o (sei|posso|quero) (dizer|informar|falar)/i,
    pergunta: 'Pra eu entender o tamanho da operação: o faturamento mensal de vocês fica mais perto de até R$ 50 mil, de R$ 50 a 200 mil ou acima disso?',
  },
  prioridade: {
    key: 'prioridade', curto: 'Prioridade', id: 1046757, kommoName: 'Tempo', name: 'Quando quer começar (este mês ou mais pra frente)', type: 'text',
    sinal: /m[eê]s|semana|\bj[aá]\b|agora|urgente|logo|hoje|amanh|\bano\b|trimestre|depois|pra frente|sem pressa|quanto antes|imediat|r[aá]pido|pressa|\d/i,
    pergunta: 'Vocês querem começar a usar ainda este mês ou estão pesquisando pra mais pra frente?',
  },
} satisfies Record<string, Campo>

const AGENDA: AgendaConfig = {
  ativa: true,
  responsavelId: 12725576,   // Rodrigo Campeoti (closer)
  taskTypeId: 2238563,       // "Apresentação" (tipos da conta: 2=Meeting, 2238563=Apresentação)
  duracaoMin: 60,            // a reunião dura 30 a 45 min, mas a agenda reserva 1h
  passoMin: 30,
  diasUteisJanela: 5,
  antecedenciaMinHoras: 3,
  expediente: { dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '18:00', pausas: [['12:00', '13:30']] }, // seg a sex (Rodrigo, 25/09)
  horarios: ['10:00', '11:00', '14:00', '15:00', '16:00', '17:00'], // preferência do Rodrigo (25/09)
  maxOpcoes: 2,
  folgaMin: 0,               // horários de 1h em sequência (10h e 11h) precisam caber um depois do outro
}

export const CRM_MAP = {
  /** textarea que o Salesbot envia (Desenho A) */
  respostaFieldId: 1048615, // "Resposta IA (Lara)" (criado em 25/09/2026)

  /** a IA NUNCA escreve nestes campos */
  camposProibidos: [] as number[],

  campos: CAMPOS as Record<string, Campo>,

  /** onde o lead aceito cai (o STATUS_ID do userscript) — a IA só inicia conversa com lead nesta etapa */
  entrada: { pipelineId: 4338500, statusId: 55438567, name: 'INICIAL - ENRIQUECIMENTO' },
  /** etapas intermediárias do funil de indicações que a Lara move (só para frente) */
  funilSdr: { emContato: 80884464, qualificado: 40438379 },

  /**
   * Follow-up da Lara quando o lead some no meio da conversa: retoma de onde parou.
   * Horas contadas da última mensagem da Lara sem resposta; só no expediente da agenda.
   * Esgotou: vai para o funil de remarketing com motivo de perda e o Rodrigo responsável.
   */
  followup: {
    ativo: true,
    horas: [4, 24, 72, 168],
    esgotar: { depoisDeHoras: 24, pipelineId: 7975447, statusId: 64122543, nome: 'REMARKETING', lossReasonId: 8035796, responsavelId: 12725576, tag: 'follow-up-esgotado' },
  },

  /**
   * Follow-up da NEGOCIAÇÃO (depois da reunião, etapa do Rodrigo): mensagens em
   * 2, 3, 5, 7 e 10 dias depois de entrar na etapa, enquanto o cliente não responde.
   * Respondeu: para. Sem resposta depois do último: tarefa para o Rodrigo.
   */
  negociacao: {
    ativo: true,
    pipelineId: 4338500,
    statusId: 61597311, // "Negociação" (funil limpo pelo mestre em 25/09/2026)
    nome: 'Negociação',
    dias: [2, 3, 5, 7, 10],
    proximoFollowupFieldId: 1048617, // campo date_time "Próximo Follow-up" (criado em 25/09/2026)
    tarefa: { taskTypeId: 1, responsavelId: 12725576, texto: 'Proposta sem resposta depois de 5 follow-ups: ligar ou marcar como Perdido' },
  },

  /**
   * Link da reunião: o fixo do Rodrigo (env LINK_REUNIAO) ou o que estiver no campo
   * "Link da Reunião" do lead (o do lead vence). Vai na confirmação e nos lembretes.
   */
  linkReuniaoFieldId: 1046627,

  /** Lembretes da reunião PARA O CLIENTE, no WhatsApp: horas antes do horário marcado */
  lembretes: { ativo: true, horasAntes: [24, 1] },

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
    outroIdioma: 'indicacao-outro-pais',
    suporte: 'indicacao-suporte',
    licenca: 'venda-licenca',
    reuniao: 'reuniao-agendada',
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
    {
      // Tag ia-sdr colocada à mão num lead qualquer (teste, demonstração): mesmo CHAMP, sem falar de indicação
      id: 'direto',
      label: 'Contato direto (tag ia-sdr colocada pelo time)',
      menu: null,
      ativa: true,
      promptFile: 'direto.md',
      sinais: /$^/,
      roteiro: ['organizacao', 'vendedores', 'dor', 'decisor', 'faturamento', 'prioridade'],
      obrigatorios: ['organizacao', 'vendedores'],
    },
  ] as Porta[],

  menu: {
    /** sem menu: todo lead com o gate cai nesta porta */
    portaUnica: 'indicacao' as string,
    /** lead com a tag e SEM indicação (a Lara não iniciou, não há Comment): atende como contato direto */
    portaManual: 'direto' as string,
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
  /** Aviso de reunião marcada no WhatsApp pessoal do closer: mensagem pelo Salesbot no lead dele (0 = desligado) */
  avisoCloser: { leadId: 20755415 },  // "Rodrigo Pessoal" (+55 11 97606-1468), funil ATENDIMENTO CONTROL GESTAO
  /** etapa para onde `agendar_reuniao` move o lead DEPOIS da tarefa criada (id 0 = não move) */
  etapaAgendado: { id: 81193772, pipelineId: 4338500, name: 'APRESENTAÇÃO agendada' } as Etapa,
  /** campo date_time "Reunião" (epoch em SEGUNDOS). 0 = não grava */
  dataReuniaoFieldId: 1040772,

  /**
   * Licença da Kommo: a Lara PODE informar o preço (o que nunca informa é serviço).
   * Valores em REAIS por usuário/mês. null = ainda não configurado: a Lara diz que
   * manda a tabela atualizada em reais e segue. Equipe pequena NÃO é regra fixa:
   * o contexto decide (quem já tem licença ou precisa de implantação vai para reunião).
   */
  licenca: {
    contrato: 'contrato de 6 meses; em 9 meses, 1 ano ou 2 anos o valor mensal cai (o time passa o valor exato)',
    // kommo.com/br/precos/compare-planos, moeda BRL, contrato de 6 meses, tabela regional do Brasil (25/09/2026):
    // Básico 104 e Avançado 156 conferidos no print do mestre; Pro 234 lido na página (o Pro não tem preço regional).
    planos: [
      { nome: 'Básico', reaisPorUsuario: 104 as number | null, resumo: 'para quem está começando: caixa de entrada unificada, múltiplos funis, painel personalizável e IA básica' },
      { nome: 'Avançado', reaisPorUsuario: 156 as number | null, resumo: 'tudo do Básico + Kommo IA, agente de IA, transmissão (disparos) e automações de chats e acompanhamentos' },
      { nome: 'Pro', reaisPorUsuario: 234 as number | null, resumo: 'tudo do Avançado com mais recursos de IA, para escalar as vendas com automação e insights avançados' },
      { nome: 'Empresarial', reaisPorUsuario: null as number | null, resumo: 'sob medida para grandes empresas: segurança, controle e suporte dedicado' },
    ],
  },

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
      aviso: 'O lead perguntou PREÇO. Se for da LICENÇA/plano da Kommo, pode responder em REAIS com os planos do contexto. Se for da implantação/configuração/suporte/IA (nosso serviço), NÃO cite valor: "Depende do tamanho da operação, por isso quero te passar o valor certo." (ou do tamanho do projeto/escopo). E a pergunta desta resposta é sobre o TAMANHO (quantos vendedores vão usar, ou o faturamento mensal).',
    },
    {
      nome: 'dificuldade',
      re: /n[aã]o sei (configurar|mexer|usar)|n[aã]o consegui|tentei aprender|dif[ií]cil|perdid[oa]|complicado|n[aã]o entendo/i,
      aviso: 'O lead contou uma DIFICULDADE. Comece a resposta acolhendo em meia frase (ex.: "normal, no começo o Kommo assusta mesmo, a gente deixa isso simples pra você") e só depois siga.',
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
