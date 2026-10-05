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

// Roteiro de 4 perguntas (pedido do comercial, 28/09): 1. Problema (dor) · 2. Impacto ·
// 3. Prioridade · 4. Decisão + Investimento (decisor + faturamento). Opcionais: gravados se o lead falar.
const CAMPOS = {
  segmento: {
    key: 'segmento', curto: 'Segmento', opcional: true, id: 0, name: 'Nicho/segmento da empresa', type: 'text',
    sinal: /advog|advocacia|jur[ií]dic|escrit[oó]rio|cl[ií]nic|est[eé]tic|odonto|dent|m[eé]dic|sa[uú]de|psic|fisio|nutri|imobili|corretor|im[oó]v|escola|curso|educa|faculdade|idioma|loja|varejo|commerce|moda|roupa|cal[cç]ado|m[oó]veis|decora|autom[oó]v|carro|moto|oficina|pe[cç]as|ve[ií]culo|consult|ag[eê]ncia|marketing|servi[cç]o|contab|seguro|financ|cr[eé]dito|cons[oó]rcio|constru|engenharia|arquitet|reforma|solar|energia|turismo|viage|hotel|pousada|restaurante|aliment|delivery|academia|fitness|ind[uú]stria|f[aá]brica|distribui|atacad|log[ií]stic|transport|tecnologia|software|saas|pet|veterin|beleza|sal[aã]o|barbear|evento|igreja|ong\b|laborat|farm[aá]c|[oó]tica|gr[aá]fica|com[eé]rcio|representa|franquia|infoproduto|mentoria|coach|agro|fazenda|emprestimo|telecom|internet|provedor|cosm[eé]tic|joia|joalher|rel[oó]gio|bijou|acess[oó]rio|perfum|pizzaria|padaria|confeitaria|doceria|cafeteria|lanchonete|mercado|a[cç]ougue|hortifruti|bebida|cervej|vinho|floricultura|gr[aá]fica|papelaria|brinquedo|eletr[oô]nic|inform[aá]tica|seguran[cç]a|limpeza|log[ií]stica|b2b|b2c|ramo|segmento|nicho|setor|trabalho com|trabalhamos com|somos (uma|um)/i,
    pergunta: 'Me conta rapidinho, vocês atuam em qual ramo?',
  },
  organizacao: {
    key: 'organizacao', curto: 'Organização', opcional: true, id: 1046001, kommoName: 'Situação', name: 'Onde organizam os leads hoje', type: 'text',
    sinal: /planilha|excel|sheets|caderno|papel|whats|kommo|amo|crm|sistema|agenda|cabe[cç]a|mem[oó]ria|google|trello|notion|pipedrive|\brd\b|hubspot|bitrix|ploomes|anot|nada|nenhum|lugar nenhum|n[aã]o (organiz|temos|tenho|usamos)/i,
    pergunta: 'Hoje vocês organizam os leads onde: WhatsApp, planilha ou outro CRM?',
  },
  // Qualificação do comercial (02/10): quantas pessoas usam (3+ = operação boa) e tráfego/volume de leads
  // (20 por dia já é volume alto). Exemplos, não roteiro: pergunta só o que ainda não sabe.
  vendedores: {
    key: 'vendedores', curto: 'Pessoas no CRM', id: 0, name: 'Quantas pessoas vão usar o CRM (3 ou mais = operação boa)', type: 'text',
    sinal: /\d|\b(um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|vinte|trinta)\b|s[oó] eu|sozinh|vendedor|pessoa|usu[aá]rio|atendente|consultor|corretor|equipe|time|acesso/i,
    pergunta: 'Quantas pessoas vão usar o Kommo no dia a dia?',
  },
  volume: {
    key: 'volume', curto: 'Tráfego e volume', id: 0, name: 'Tráfego pago e volume de leads (quantos chegam por mês ou por dia; 20 por dia já é volume alto)', type: 'text',
    sinal: /\d|lead|contato|mensag|cliente|tr[aá]fego|an[uú]ncio|\bads\b|meta|google|instagram|facebook|org[aâ]nic|indica[cç]|campanha|n[aã]o (fazemos|fa[cç]o|temos|investimos|rodamos)|por (dia|m[eê]s|semana)|muito|pouco|bastante|nenhum/i,
    pergunta: 'Vocês já fazem tráfego pago? Mais ou menos quantos leads chegam por mês?',
  },
  dor: {
    key: 'dor', curto: 'Dor', id: 1046003, kommoName: 'Problema', name: 'Problema ou pedido do lead (o que ele quer resolver, nas palavras dele)', type: 'textarea',
    // Problema OU pedido (02/10): "Implementação e estruturação do CRM", "não consigo fazer os gatilhos
    // funcionarem" e "orçamento que ninguém retorna" eram recusados e a Lara voltava a perguntar o problema
    sinal: /perd|esquec|some|sum|escap|etapa|fase|onde (est|par)|relat[oó]rio|n[uú]mero|m[eé]trica|indicador|controle|acompanh|organiz|bagun|demor|follow|retorn|respond|resposta|vis[aã]o|gest[aã]o|funil|funis|atendimento|whats|implant|implement|estrutur|configur|automa|gatilho|fluxo|rob[oô]|salesbot|integr|dispar|lembrete|agendamento|confirma|\bcrm\b|kommo|treina|centraliz|or[cç]amento|proposta|\bvendas?\b|\bvender\b|dificuldade|n[aã]o consigo|n[aã]o sei (mexer|usar|configurar)|problema|ajuda|conhecer/i,
    pergunta: 'O que mais tá travando hoje no atendimento de vocês: perder lead, não saber em que etapa cada um está ou não ter relatório?',
  },
  impacto: {
    key: 'impacto', curto: 'Impacto', id: 0, name: 'Impacto do problema (quanto pesa: leads, vendas, tempo, dinheiro)', type: 'text',
    sinal: /\d|muito|bastante|demais|pouco|perco|perd|escap|vend|client|lead|dinheiro|faturamento|receita|tempo|hora|dia|semana|m[eê]s|preju[ií]zo|custa|caro|atras|demora|sobrecarreg|estress|equipe|n[aã]o sei|dif[ií]cil|grande|enorme|pesa/i,
    pergunta: 'E quanto isso pesa hoje pra vocês? Mais ou menos quantos clientes ou vendas acabam escapando por mês?',
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
    pergunta: 'Vocês querem resolver isso ainda este mês ou estão pesquisando pra mais pra frente?',
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
  especialista: 'Rodrigo',   // quem faz a reunião (05/10)
}

/** Dúvida sobre a cobrança da Meta por mensagem (API oficial do WhatsApp) */
const CUSTO_META = /\bmeta\b.{0,80}(pag|cobr|valor|custo|aprov)|(pag|cobr|valor|custo).{0,80}\bmeta\b|por mensagem|api oficial.{0,60}(pag|cobr|custo)|templates?.{0,40}(pag|cobr|aprov)|n[aã]o (quero )?pagar (mais )?nada al[eé]m|pagar s[oó] (o|a) kommo|s[oó] (o|a) kommo e mais nada/i

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
  /** minutos antes da reunião: 24h (link para conferir), 1h (aviso) e 10 min (link para entrar) */
  lembretes: { ativo: true, minutosAntes: [1440, 60, 10] },

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
    contatoErrado: 'contato-errado',
  },

  portas: [
    {
      id: 'indicacao',
      label: 'Indicação de parceiro Kommo',
      menu: null,
      ativa: true,
      promptFile: 'indicacao.md',
      sinais: /$^/,
      roteiro: ['segmento', 'dor', 'vendedores', 'volume', 'impacto', 'prioridade', 'decisor', 'faturamento', 'organizacao'],
      obrigatorios: ['dor'],
    },
    {
      // Tag ia-sdr colocada à mão num lead qualquer (teste, demonstração): mesmo CHAMP, sem falar de indicação
      id: 'direto',
      label: 'Contato direto (tag ia-sdr colocada pelo time)',
      menu: null,
      ativa: true,
      promptFile: 'direto.md',
      sinais: /$^/,
      roteiro: ['segmento', 'dor', 'vendedores', 'volume', 'impacto', 'prioridade', 'decisor', 'faturamento', 'organizacao'],
      obrigatorios: ['dor'],
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
  exigirAntesDeAgendar: [['dor']] as string[][], // 02/10: o resto é bom saber, não condição (lead que pede horário marca)
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
      // Só PEDIDO de preço (02/10): "o pior é orçamento que a gente manda e ninguém retorna" ou "o valor do
      // nosso ticket" é o negócio do lead, e a Lara respondia como se ele tivesse perguntado o preço
      re: /quanto (?:custa|fica|[ée]|sai|cobra|seria|vai ficar)|pre[cç]os?\b|mensalidade|cobram|(?:qual|quais|me passa|passa|manda|envia|saber|ideia|m[eé]dia|faixa|seria|sobre|informa[cç](?:[aã]o|[oõ]es))\b[^.?!\n]{0,25}\b(?:valor|valores|or[cç]amento|custo|investimento)|(?:valor|valores|or[cç]amento|custo|investimento)\b[^.!\n]{0,40}\?|(?:quero|queria|gostaria|precis\w*|pedir|solicitar|primeiro ao|aguard\w*|espero)\s+(?:(?:de|um|uma|o|ao|seu|teu|do|da)\s+){0,3}or[cç]amento|(?:seu|teu)\s+or[cç]amento|or[cç]amento\s+(?:de|da|com)\s+voc[eê]s/i,
      exceto: CUSTO_META,
      aviso: 'O lead perguntou PREÇO. Licença/plano da Kommo: pode responder em REAIS com os planos do contexto. Implantação/configuração/treinamento/suporte/IA (nosso serviço): NÃO cite valor (você não tem) e NÃO ignore: explique em uma frase que depende do escopo, ligado ao que ELE contou. Mostre que a reunião é rápida e é onde o especialista dimensiona e passa a proposta certa. Se ainda não sabe quantas pessoas vão usar, pode perguntar junto ("pra te dar uma direção, quantas pessoas vão usar o Kommo?"); mas se ele está impaciente ou já disse que quer o orçamento antes de tudo, não pergunte mais nada: convide. Se ele já perguntou antes e você já explicou, não repita a explicação: ofereça a análise curta e sem compromisso; recusou de novo, encerre com gentileza (qualificado_sem_reuniao).',
    },
    {
      nome: 'custo do WhatsApp oficial',
      re: CUSTO_META,
      aviso: 'O lead está perguntando da COBRANÇA DA META por mensagem no WhatsApp (API oficial), não do preço do nosso serviço. Responda a dúvida de verdade, curto e sem citar valores: (1) essa cobrança é da Meta, não da Kommo, e vale para qualquer CRM que use a API oficial; (2) responder o cliente dentro de 24h depois que ele manda mensagem não é cobrado; o que a Meta cobra são os disparos de modelos aprovados (templates) que a empresa inicia, como campanhas e lembretes fora dessa janela; (3) dá pra reduzir bastante o custo desenhando as automações para rodar dentro da janela de 24h, e há a opção do WhatsApp Lite (número atual pelo QR code), sem cobrança por mensagem, mas com limites para disparo e robôs. Acolha a frustração em meia frase e convide para o especialista mostrar na reunião qual desenho sai mais barato para a operação dela.',
    },
    {
      nome: 'perguntou se é robô',
      re: /(?<![\p{L}])(?:(?:voc[eê]|vc|isso|aqui)\s+(?:é|e|eh)\s+(?:uma?\s+)?(?:rob[oô]|bot|ia|intelig[eê]ncia artificial|m[aá]quina|humano|humana|pessoa|gente)|(?:falando|conversando)\s+com\s+(?:uma?\s+)?(?:rob[oô]|bot|ia|m[aá]quina|humano|humana|pessoa)|[eé]\s+(?:uma?\s+)?(?:rob[oô]|bot))(?![\p{L}])/iu,
      aviso: 'O lead perguntou se está falando com robô/IA. Responda que SIM, com naturalidade e sem se desculpar: você é a Lara, assistente de IA da Control Gestão (é o tipo de coisa que a gente implanta para os clientes). Depois siga a conversa.',
    },
    {
      nome: 'dificuldade',
      re: /n[aã]o sei (configurar|mexer|usar|trabalhar)|n[aã]o consegui (configurar|mexer|usar|aprender|entender|montar|fazer)|tentei aprender|tenho dificuldade|dif[ií]cil de (usar|mexer|configurar|entender)|me (sinto )?perdid[oa]|complicado|n[aã]o entendo (nada )?(do|de|da) (kommo|crm|sistema|plataforma|ferramenta)/i,
      aviso: 'O lead contou uma DIFICULDADE (não sabe configurar/mexer). Comece a resposta acolhendo EXATAMENTE essa dificuldade em meia frase e mostre que é aí que a gente entra (ex.: "normal, no começo o Kommo assusta mesmo, e a configuração a gente faz junto com você na implantação"). Só depois siga com a próxima pergunta.',
    },
  ] as Alerta[],

  /** a IA não move etapa por tool (só agendar_reuniao, com guard) */
  etapas: [] as Etapa[],
  etapasProtegidas: [142, 143] as number[],

  /** abertura sem LLM (se o modelo falhar ou reprovar na trava). {saudacao} = "Bom dia"; {nome} = ", Ana" ou vazio */
  /** abertura quando a tag é colocada à mão num lead que não veio de indicação */
  aberturaDireta: '{saudacao}{nome}! Aqui é a Lara, da Control Gestão, parceira oficial da Kommo. Tô passando pra entender como está a organização do atendimento e das vendas de vocês e ver como a gente pode ajudar. Me conta, o que vocês mais gostariam de organizar hoje?',

  aberturaFixa: '{saudacao}{nome}! Aqui é a Lara, da Control Gestão, parceira oficial da Kommo. A Kommo me passou o seu pedido e eu vou te ajudar por aqui. Pra eu entender o cenário de vocês, hoje os leads ficam organizados onde?',

  textoSeguro: 'Entendi. Me conta um pouco de como vocês trabalham os leads hoje?',
  textoSeguroFinal: 'Combinado, anotei tudo aqui. O nosso time segue com você por aqui.',

  midia: {
    instrucaoVisao: 'Descreva em português, em no máximo 4 frases, o conteúdo do arquivo que um lead enviou pelo WhatsApp: o que é, telas ou números legíveis. O que não estiver legível, diga "ilegível".',
  },
}

export const portaById = (id?: string) => CRM_MAP.portas.find(p => p.id === id)
export const campoByKey = (key: string) => CRM_MAP.campos[key]
