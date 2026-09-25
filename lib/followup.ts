import { fromLocal, local, rotulo } from './agenda'
import { CONFIG } from './config'
import { CRM_MAP } from './crm-map'
import { logExec } from './execlog'
import { appendMessage, humanSpokeRecently } from './history'
import { addLeadNote, addLeadTags, createTask, getContact, getLead, getTask, kommoGet, leadTags, patchLead, removeLeadTags, updateLeadFields } from './kommo'
import { lerEventoGoogle } from './google'
import { despertar } from './qstash'
import { k, redis } from './redis'
import { getState, patchState } from './state'
import { sendReply } from './transport'

/**
 * FOLLOW-UP — duas cadências, uma fila (ZSET no Redis), um relógio (cron a cada
 * 15 min na Vercel Pro, api/cron.ts).
 *
 *  sdr:<lead>  → a Lara retoma a conversa em 4h, 1d, 3d e 7d sem resposta.
 *  esg:<lead>  → cadência esgotada: remarketing + motivo "Sem resposta" + Rodrigo.
 *  neg:<lead>  → negociação: 2d, 3d, 5d, 7d e 10d depois de entrar na etapa.
 *  negfim:<lead> → sem resposta depois do último: tarefa para o Rodrigo.
 *
 * Lead respondeu (webhook add_message) → cancela tudo daquele lead na mesma volta.
 * Toda saída cai no expediente (dias e horário da agenda). Claim atômico: só quem
 * consegue o ZREM processa o item (cron duplicado nunca manda duas vezes).
 */

const FILA = () => k('fila')
const MIN = 60_000
const HORA = 60 * MIN
const DIA = 24 * HORA

// ---------- expediente ----------

const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0) }

/** Primeiro instante >= ms dentro do expediente (dias úteis, horário da agenda). */
export function noExpediente(ms: number): number {
  const ex = CRM_MAP.agenda.expediente
  for (let i = 0; i < 14; i++) {
    const l = local(ms + i * DIA)
    if (!ex.dias.includes(l.wd)) continue
    const ini = fromLocal(l.y, l.m, l.d, Math.floor(hm(ex.inicio) / 60), hm(ex.inicio) % 60)
    const fim = fromLocal(l.y, l.m, l.d, Math.floor(hm(ex.fim) / 60), hm(ex.fim) % 60)
    if (i === 0) {
      if (ms < ini) return ini
      if (ms < fim) return ms
      continue
    }
    return ini
  }
  return ms
}

// ---------- estado ----------

interface Cadencia { passo: number; desde: number; tipo: 'sdr' | 'neg' }

const chaveEstado = (tipo: string, leadId: number) => k('fu', tipo, leadId)

async function enfileirar(membro: string, quando: number): Promise<void> {
  await redis.zadd(FILA(), { score: quando, member: membro })
  await despertar(membro, quando).catch(e => console.warn('[qstash]', e instanceof Error ? e.message : e))
}

/**
 * Despertador do QStash chegou para um item: só processa se ele ainda está na fila
 * e já venceu (claim atômico com ZREM). Remarcado para depois = chama de novo mais tarde.
 */
export async function pegarItem(membro: string, agora = Date.now()): Promise<'processar' | 'adiado' | 'nada'> {
  const score = await redis.zscore(FILA(), membro)
  if (score === null || score === undefined) return 'nada'
  if (Number(score) > agora + MIN) {
    await despertar(membro, Number(score), agora).catch(e => console.warn('[qstash]', e instanceof Error ? e.message : e))
    return 'adiado'
  }
  return (await redis.zrem(FILA(), membro)) === 1 ? 'processar' : 'nada'
}

/** SDR: (re)começa a cadência a partir da última mensagem da Lara. */
export async function agendarFollowup(leadId: number, desde: number): Promise<void> {
  if (!CRM_MAP.followup.ativo) return
  await redis.zrem(FILA(), `esg:${leadId}`)
  await redis.set(chaveEstado('sdr', leadId), { passo: 0, desde, tipo: 'sdr' } satisfies Cadencia, { ex: 30 * 86400 })
  await enfileirar(`sdr:${leadId}`, noExpediente(desde + CRM_MAP.followup.horas[0] * HORA))
}

/** Cancela as cadências do lead (respondeu, humano assumiu, finalizou...). */
export async function cancelarFollowup(leadId: number, tipos: Array<'sdr' | 'neg'> = ['sdr', 'neg']): Promise<void> {
  for (const t of tipos) {
    await redis.zrem(FILA(), `${t}:${leadId}`, ...(t === 'sdr' ? [`esg:${leadId}`] : [`negfim:${leadId}`]))
    if (t === 'sdr') await redis.del(chaveEstado('sdr', leadId))
  }
  if (tipos.includes('neg') && await redis.get(chaveEstado('neg', leadId))) {
    await redis.set(chaveEstado('neg', leadId), { passo: -1, desde: Date.now(), tipo: 'neg' } satisfies Cadencia, { ex: 60 * 86400 }) // -1 = respondeu, não recomeça
    if (CRM_MAP.negociacao.proximoFollowupFieldId) await updateLeadFields(leadId, [{ field_id: CRM_MAP.negociacao.proximoFollowupFieldId, values: null as never }]).catch(() => undefined)
  }
}

// ---------- mensagem ----------

export type Gerador = (leadId: number, instrucao: string) => Promise<string | null>

const FIXOS_SDR = [
  'Oi! Passando só pra ver se ficou alguma dúvida do que conversamos. Sigo por aqui.',
  'Oi, tudo bem? Quando puder, me responde que eu te ajudo a destravar essa parte do Kommo.',
  'Oi! Imagino que a rotina esteja corrida. Se ainda fizer sentido organizar o Kommo, me chama por aqui.',
  'Vou deixar a conversa em pausa por aqui. Quando quiser retomar a implantação do Kommo, é só me mandar uma mensagem.',
]
const FIXOS_NEG = [
  'Oi! Conseguiu dar uma olhada na proposta? Se tiver qualquer ponto pra ajustar, me fala.',
  'Oi, tudo bem? Passando pra saber se ficou alguma dúvida sobre a proposta da implantação.',
  'Oi! Posso te ajudar com alguma informação pra decidir sobre a proposta?',
  'Oi! Sigo à disposição pra ajustar a proposta ao que faz sentido pra vocês agora.',
  'Oi! Vou deixar a proposta em aberto por aqui. Se quiser retomar, é só me chamar.',
]

function instrucaoSdr(passo: number, total: number): string {
  const ultimo = passo === total - 1
  return `[FOLLOW-UP ${passo + 1} de ${total}] O lead parou de responder. Escreva UMA mensagem curta de WhatsApp (até 2 linhas) retomando exatamente de onde a conversa parou: relembre em poucas palavras o último assunto ou a última pergunta que ficou sem resposta, sem copiar a mensagem anterior e sem cobrar ("vi que você não respondeu" é proibido). Não cumprimente com "bom dia/boa tarde" de novo e não se apresente.${ultimo ? ' É a ÚLTIMA tentativa: deixe a porta aberta com leveza, sem pergunta.' : ' Termine com UMA pergunta simples e fácil de responder.'} Responda só com o texto.`
}

function instrucaoNeg(passo: number, total: number): string {
  const ultimo = passo === total - 1
  return `[FOLLOW-UP DE PROPOSTA ${passo + 1} de ${total}] Este cliente já fez a reunião e recebeu a proposta da implantação (etapa de negociação). Escreva UMA mensagem curta de WhatsApp (até 2 linhas), em nome da equipe comercial da Control Gestão, retomando a proposta com naturalidade${passo ? ' e com um ângulo diferente das mensagens anteriores (ex.: prazo de implantação, dúvida comum, benefício ligado ao que ele contou)' : ''}. Não cite valores. Não se apresente como Lara e não cobre.${ultimo ? ' É a última: deixe a porta aberta, sem pergunta.' : ' Termine com UMA pergunta simples.'} Responda só com o texto.`
}

async function enviarFollowup(leadId: number, texto: string, tipo: string, passo: number): Promise<void> {
  const detalhe = await sendReply(leadId, texto)
  await appendMessage(leadId, { id: `fu:${tipo}:${leadId}:${passo}:${Date.now()}`, dir: 'out', text: texto, ts: Date.now() })
  await logExec({ tipo: 'followup', leadId, detalhe: `${tipo} ${passo + 1} · ${detalhe} · ${texto.slice(0, 80)}` })
}

// ---------- execução de um item da fila ----------

export async function processarItem(membro: string, gerar: Gerador, agora = Date.now()): Promise<string> {
  const [tipo, idTxt] = membro.split(':')
  const leadId = Number(idTxt)
  if (!leadId) return 'inválido'

  if (tipo === 'sdr') {
    const est = await redis.get<Cadencia>(chaveEstado('sdr', leadId))
    if (!est) return 'sem estado (cancelado)'
    const lead = await getLead(leadId)
    const tags = leadTags(lead).map(t => t.toLowerCase())
    const st = await getState(leadId)
    // Fail-closed: IA desligada, humano no comando, reunião marcada ou finalizado = não persegue
    if ((CONFIG.gateTag && !tags.includes(CONFIG.gateTag)) || tags.includes(CONFIG.humanTag) || st.finalizado || st.reuniao || await humanSpokeRecently(leadId)) {
      await cancelarFollowup(leadId, ['sdr'])
      return 'cancelado (gate, humano ou finalizado)'
    }
    const total = CRM_MAP.followup.horas.length
    const texto = (await gerar(leadId, instrucaoSdr(est.passo, total)).catch(() => null)) || FIXOS_SDR[Math.min(est.passo, FIXOS_SDR.length - 1)]
    await enviarFollowup(leadId, texto, 'sdr', est.passo)
    const passo = est.passo + 1
    if (passo < total) {
      await redis.set(chaveEstado('sdr', leadId), { ...est, passo }, { ex: 30 * 86400 })
      await enfileirar(`sdr:${leadId}`, noExpediente(est.desde + CRM_MAP.followup.horas[passo] * HORA))
    } else {
      await redis.del(chaveEstado('sdr', leadId))
      await enfileirar(`esg:${leadId}`, noExpediente(agora + CRM_MAP.followup.esgotar.depoisDeHoras * HORA))
    }
    return `sdr ${passo}/${total} enviado`
  }

  if (tipo === 'esg') {
    const e = CRM_MAP.followup.esgotar
    const corpo: Record<string, unknown> = { pipeline_id: e.pipelineId, status_id: e.statusId, responsible_user_id: e.responsavelId }
    try { await patchLead(leadId, { ...corpo, loss_reason_id: e.lossReasonId }) } catch { await patchLead(leadId, corpo) }
    if (CONFIG.gateTag) await removeLeadTags(leadId, [CONFIG.gateTag]).catch(() => undefined)
    await addLeadTags(leadId, [e.tag])
    await addLeadNote(leadId, `🤖 Lara: cadência de follow-up esgotada (${CRM_MAP.followup.horas.map(h => (h < 24 ? `${h}h` : `${h / 24}d`)).join(', ')}) sem resposta. Motivo: Sem resposta. Movido para ${e.nome} (Remarketing e Retornos futuros).`)
    await patchState(leadId, { finalizado: { motivo: 'sem_resposta', resumo: 'cadência de follow-up esgotada', em: new Date(agora).toISOString() } })
    await logExec({ tipo: 'finalizou', leadId, detalhe: `follow-up esgotado → ${e.nome}` })
    return 'esgotado → remarketing'
  }

  if (tipo === 'neg') {
    const n = CRM_MAP.negociacao
    const est = await redis.get<Cadencia>(chaveEstado('neg', leadId))
    if (!est || est.passo < 0) return 'sem estado (respondeu ou cancelado)'
    const lead = await getLead(leadId)
    if (lead.pipeline_id !== n.pipelineId || lead.status_id !== n.statusId) {
      await redis.del(chaveEstado('neg', leadId))
      return 'saiu da etapa de negociação'
    }
    const texto = (await gerar(leadId, instrucaoNeg(est.passo, n.dias.length)).catch(() => null)) || FIXOS_NEG[Math.min(est.passo, FIXOS_NEG.length - 1)]
    await enviarFollowup(leadId, texto, 'neg', est.passo)
    const passo = est.passo + 1
    await redis.set(chaveEstado('neg', leadId), { ...est, passo }, { ex: 60 * 86400 })
    if (passo < n.dias.length) {
      const prox = noExpediente(est.desde + n.dias[passo] * DIA)
      await enfileirar(`neg:${leadId}`, prox)
      if (n.proximoFollowupFieldId) await updateLeadFields(leadId, [{ field_id: n.proximoFollowupFieldId, values: [{ value: Math.floor(prox / 1000) }] }])
    } else {
      await enfileirar(`negfim:${leadId}`, noExpediente(agora + DIA))
      if (n.proximoFollowupFieldId) await updateLeadFields(leadId, [{ field_id: n.proximoFollowupFieldId, values: null as never }]).catch(() => undefined)
    }
    return `neg ${passo}/${n.dias.length} enviado`
  }

  const lem = tipo.match(/^lem(\d+)$/)
  if (lem) return processarLembrete(Number(lem[1]), leadId, agora)

  if (tipo === 'negfim') {
    const t = CRM_MAP.negociacao.tarefa
    const est = await redis.get<Cadencia>(chaveEstado('neg', leadId))
    if (!est || est.passo < 0) return 'respondeu: sem tarefa'
    await createTask({ leadId, responsibleUserId: t.responsavelId, taskTypeId: t.taskTypeId, text: t.texto, completeTill: Math.floor(noExpediente(agora) / 1000) + 3600, duration: 0 })
    await logExec({ tipo: 'followup', leadId, detalhe: 'negociação sem resposta: tarefa criada para o Rodrigo' })
    return 'tarefa criada'
  }
  return 'tipo desconhecido'
}

// ---------- lembretes da reunião (para o cliente) ----------

/** taskId: id da tarefa do Kommo, ou 'g:<id>' do evento no Google (antigos: número) */
interface Lembrete { ini: number; taskId: string | number }

/** Agenda 24h e 1h antes (só os que ainda estão no futuro). Não segue o expediente: é hora marcada. */
export async function agendarLembretes(leadId: number, ini: number, taskId: string | number, agora = Date.now()): Promise<void> {
  const cfg = CRM_MAP.lembretes
  if (!cfg.ativo) return
  await redis.set(k('lem', leadId), { ini, taskId } satisfies Lembrete, { ex: 30 * 86400 })
  for (const h of cfg.horasAntes) {
    const quando = ini - h * HORA
    if (quando > agora + 5 * MIN) await enfileirar(`lem${h}:${leadId}`, quando)
  }
}

function primeiroNome(nome: string): string {
  const p = (nome || '').trim().split(/\s+/)[0] || ''
  return /^[A-Za-zÀ-ú]{2,20}$/.test(p) && !/^(lead|contato|cliente|empresa)$/i.test(p) ? p[0].toUpperCase() + p.slice(1).toLowerCase() : ''
}

/** Texto do lembrete (fixo, sem IA: data e hora não podem sair erradas). Sempre em português. */
export function textoLembrete(horas: number, ini: number, agora: number, nome: string, link = ''): string {
  const l = local(ini)
  const hora = l.min ? `${l.h}h${String(l.min).padStart(2, '0')}` : `${l.h}h`
  const n = nome ? `, ${nome}` : ''
  if (horas >= 12) {
    return link
      ? `Oi${n}! Passando pra lembrar da nossa reunião ${rotulo(ini, agora)} com o especialista da Control Gestão. O link é este: ${link}\nConfere se abre certinho aí pra você?`
      : `Oi${n}! Passando pra lembrar da nossa reunião ${rotulo(ini, agora)} com o especialista da Control Gestão. Tudo certo pra você?`
  }
  return link
    ? `Oi${n}! Daqui a pouco, às ${hora}, é a nossa reunião com o especialista da Control Gestão. O link: ${link}\nAté já!`
    : `Oi${n}! Daqui a pouco, às ${hora}, é a nossa reunião com o especialista da Control Gestão. Até já!`
}

async function processarLembrete(horas: number, leadId: number, agora: number): Promise<string> {
  const lem = await redis.get<Lembrete>(k('lem', leadId))
  if (!lem) return 'sem reunião registrada'
  const ref = String(lem.taskId || '')
  let linkEvento = ''
  if (ref.startsWith('g:')) {
    // Evento no Google: cancelado/apagado = sem lembrete; remarcado = reagenda
    const ev = await lerEventoGoogle(ref.slice(2))
    if (!ev || ev.status === 'cancelled') return 'reunião cancelada no Google: sem lembrete'
    if (Number.isFinite(ev.ini) && ev.ini !== lem.ini) {
      await agendarLembretes(leadId, ev.ini, ref, agora)
      return `remarcada para ${new Date(ev.ini).toISOString()}: lembretes reagendados`
    }
    linkEvento = ev.link
  } else {
    const task = Number(ref) ? await getTask(Number(ref)) : null
    if (task && task.is_completed) return 'reunião concluída ou cancelada: sem lembrete'
    // O Rodrigo remarcou no Kommo: reagenda os lembretes para o horário novo
    if (task && task.complete_till * 1000 !== lem.ini) {
      await agendarLembretes(leadId, task.complete_till * 1000, ref, agora)
      return `remarcada para ${new Date(task.complete_till * 1000).toISOString()}: lembretes reagendados`
    }
  }
  const lead = await getLead(leadId)
  if (lead.status_id === 143) return 'lead perdido: sem lembrete'
  const contatoId = (lead._embedded?.contacts || []).find(c => c.is_main)?.id
  const nome = primeiroNome(contatoId ? (await getContact(contatoId)).name || '' : '')
  const linkCampo = CRM_MAP.linkReuniaoFieldId ? (lead.custom_fields_values || []).find(f => f.field_id === CRM_MAP.linkReuniaoFieldId)?.values?.[0]?.value : ''
  // O campo vence (o Rodrigo pode ter trocado o link à mão); depois o Meet do evento
  const link = String(linkCampo || linkEvento || CONFIG.linkReuniao || '').trim()
  const texto = textoLembrete(horas, lem.ini, agora, nome, link)
  if (!link && horas >= 12) {
    await createTask({ leadId, responsibleUserId: CRM_MAP.agenda.responsavelId, taskTypeId: 1, text: `URGENTE: o lembrete de ${horas}h saiu SEM link. Mande o link da reunião para o cliente e preencha o campo "Link da Reunião" (o lembrete de 1h usa ele).`, completeTill: Math.floor(agora / 1000) + 3600, duration: 0 }).catch(() => undefined)
  }
  await enviarFollowup(leadId, texto, `lembrete-${horas}h`, 0)
  return `lembrete ${horas}h enviado`
}

// ---------- negociação: quem entrou na etapa ----------

/** Procura leads na etapa de negociação sem cadência e começa a contar a partir de agora. */
export async function varrerNegociacao(agora = Date.now()): Promise<number> {
  const n = CRM_MAP.negociacao
  if (!n.ativo || !n.statusId) return 0
  const r = await kommoGet<{ _embedded?: { leads?: Array<{ id: number }> } }>(`/api/v4/leads?filter[statuses][0][pipeline_id]=${n.pipelineId}&filter[statuses][0][status_id]=${n.statusId}&limit=250`)
  let novos = 0
  for (const l of r._embedded?.leads || []) {
    const ok = await redis.set(chaveEstado('neg', l.id), { passo: 0, desde: agora, tipo: 'neg' } satisfies Cadencia, { nx: true, ex: 60 * 86400 })
    if (ok !== 'OK') continue
    const prox = noExpediente(agora + n.dias[0] * DIA)
    await enfileirar(`neg:${l.id}`, prox)
    if (n.proximoFollowupFieldId) await updateLeadFields(l.id, [{ field_id: n.proximoFollowupFieldId, values: [{ value: Math.floor(prox / 1000) }] }]).catch(() => undefined)
    novos++
  }
  return novos
}

/** Itens vencidos, com claim atômico (ZREM: só quem remove processa). */
export async function vencidos(agora = Date.now(), limite = 25): Promise<string[]> {
  const itens = await redis.zrange<string[]>(FILA(), 0, agora, { byScore: true, offset: 0, count: limite })
  const meus: string[] = []
  for (const m of itens) if ((await redis.zrem(FILA(), m)) === 1) meus.push(m)
  return meus
}

export async function filaResumo(): Promise<Array<{ item: string; quando: string }>> {
  const r = await redis.zrange<Array<string | number>>(FILA(), 0, 49, { withScores: true })
  const out: Array<{ item: string; quando: string }> = []
  for (let i = 0; i < r.length; i += 2) out.push({ item: String(r[i]), quando: new Date(Number(r[i + 1])).toISOString() })
  return out
}

