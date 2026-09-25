function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Env var obrigatória ausente: ${name}`)
  return v
}

const list = (v: string | undefined) => (v || '').split(',').map(x => x.trim()).filter(Boolean)

/**
 * Variante KOMMO · Desenho A (envio pelo Salesbot; aqui o canal é o WhatsApp Lite
 * do Kommo). O Kommo não devolve transcript: o histórico é NOSSO (Redis).
 */
export const CONFIG = {
  clientName: process.env.CLIENT_NAME || 'Cliente · Agente',

  kommoDomain: required('KOMMO_DOMAIN').replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://'),
  kommoToken: required('KOMMO_TOKEN'),
  kommoAccountId: required('KOMMO_ACCOUNT_ID'),
  kommoBotId: Number(process.env.KOMMO_BOT_ID || 0),

  openaiApiKey: required('OPENAI_API_KEY'),
  llmModel: process.env.LLM_MODEL || 'gpt-5.4-mini-2026-03-17',
  visionModel: process.env.VISION_MODEL || 'gpt-5.4-mini-2026-03-17',
  sttModel: process.env.STT_MODEL || 'gpt-4o-mini-transcribe',

  upstashUrl: required('UPSTASH_REDIS_REST_URL'),
  upstashToken: required('UPSTASH_REDIS_REST_TOKEN'),
  redisPrefix: process.env.REDIS_PREFIX || 'ak:',

  webhookSecret: required('WEBHOOK_SECRET'),
  debounceSeconds: Number(process.env.DEBOUNCE_SECONDS || 10),

  // Gate: só atende quem tem a tag. Vazio = atende todos (só no fim da rampagem).
  gateTag: (process.env.GATE_TAG || '').toLowerCase(),
  humanTag: (process.env.HUMAN_TAG || 'atendimento-humano').toLowerCase(),
  testLeadIds: list(process.env.TEST_LEAD_IDS).map(Number).filter(Boolean),

  // ---- Indicações de parceiro Kommo ----
  /** segredo do userscript (POST /api/novo-lead). Separado do WEBHOOK_SECRET: vaza menos se o navegador vazar */
  indicacaoSecret: process.env.INDICACAO_SECRET || '',
  /** 'inteligente' (trial do Kommo passa) ou 'estrito' (qualquer "teste" no Comment bloqueia) */
  filtroTesteModo: (process.env.FILTRO_TESTE_MODO === 'estrito' ? 'estrito' : 'inteligente') as 'estrito' | 'inteligente',
  /** true = sem "Comment:" a IA NÃO inicia (fail-closed: pode não ser indicação de parceiro) */
  exigirComentario: process.env.EXIGIR_COMENTARIO !== '0',

  /** link fixo das reuniões do closer (ex.: sala do Google Meet). Vazio = só o do campo do lead */
  linkReuniao: process.env.LINK_REUNIAO || '',

  // ---- Google Agenda (opcional, só leitura de livre/ocupado) ----
  googleServiceAccount: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
  googleCalendarId: process.env.GOOGLE_CALENDAR_ID || '',
}
