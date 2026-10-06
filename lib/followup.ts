import { fromLocal, local, rotulo } from './agenda'
import { CONFIG } from './config'
import { CRM_MAP } from './crm-map'
import { logExec } from './execlog'
import { appendMessage, getHistory, humanSpokeRecently } from './history'
import { addLeadNote, addLeadTags, createTask, getContact, getLead, getTask, kommoGet, leadTags, patchLead, removeLeadTags, updateLeadFields } from './kommo'
import { lerEventoGoogle } from './google'
import { nota, quando } from './notas'
import { overlap } from './guards'
import { despertar } from './qstash'
import { primeiroNomeDe } from './saudacao'
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

/**
 * Próximo passo da cadência: no horário previsto, mas NUNCA antes do intervalo
 * entre os passos contado do envio anterior (um fim de semana empurrava dois
 * passos para a mesma segunda 9h e eles saíam com segundos de diferença).
 */
export function proximoPasso(desde: number, alvo: number, anterior: number, agora: number): number {
  return noExpediente(Math.max(desde + alvo, agora + (alvo - anterior)))
}

/** Última mensagem que a Lara mandou (resposta ou follow-up) = base do intervalo mínimo. */
async function ultimoEnvio(leadId: number): Promise<number> {
  const hist = await getHistory(leadId).catch(() => [])
  return hist.filter(m => m.dir === 'out').reduce((mx, m) => Math.max(mx, m.ts || 0), 0)
}

// ---------- estado ----------

interface Cadencia { passo: number; desde: number; tipo: 'sdr' | 'neg' }

const chaveEstado = (tipo: string, leadId: number) => k('fu', tipo, leadId)

/** Item avulso na fila (ex.: tel:<lead> = reconferir o telefone do contato) */
export const agendarItem = (membro: string, quando: number) => enfileirar(membro, quando)

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

/** Grava a data no campo "Próximo Follow-up" (null = limpa). Nunca derruba o fluxo. */
async function campoProximo(leadId: number, ms: number | null): Promise<void> {
  const id = CRM_MAP.negociacao.proximoFollowupFieldId
  if (!id) return
  await updateLeadFields(leadId, [{ field_id: id, values: ms === null ? null as never : [{ value: Math.floor(ms / 1000) }] }]).catch(() => undefined)
}

/** SDR: (re)começa a cadência a partir da última mensagem da Lara. Devolve quando sai o próximo follow-up. */
export async function agendarFollowup(leadId: number, desde: number): Promise<number | null> {
  if (!CRM_MAP.followup.ativo) return null
  await redis.zrem(FILA(), `esg:${leadId}`)
  await redis.set(chaveEstado('sdr', leadId), { passo: 0, desde, tipo: 'sdr' } satisfies Cadencia, { ex: 30 * 86400 })
  const prox = noExpediente(desde + CRM_MAP.followup.horas[0] * HORA)
  await enfileirar(`sdr:${leadId}`, prox)
  await campoProximo(leadId, prox)
  return prox
}

/** Cancela as cadências do lead (respondeu, humano assumiu, finalizou...). */
export async function cancelarFollowup(leadId: number, tipos: Array<'sdr' | 'neg'> = ['sdr', 'neg']): Promise<void> {
  for (const t of tipos) {
    await redis.zrem(FILA(), `${t}:${leadId}`, ...(t === 'sdr' ? [`esg:${leadId}`] : [`negfim:${leadId}`]))
    if (t === 'sdr' && (await redis.del(chaveEstado('sdr', leadId))) > 0) await campoProximo(leadId, null)
  }
  if (tipos.includes('neg') && await redis.get(chaveEstado('neg', leadId))) {
    await redis.set(chaveEstado('neg', leadId), { passo: -1, desde: Date.now(), tipo: 'neg' } satisfies Cadencia, { ex: 60 * 86400 }) // -1 = respondeu, não recomeça
    await campoProximo(leadId, null)
  }
}

// ---------- mensagem ----------

export type Gerador = (leadId: number, instrucao: string) => Promise<string | null>

/**
 * Cada passo da cadência tem um TIPO diferente (pedido do comercial, 29/09): repetir a
 * última pergunta em todo follow-up cansava. Dados de mercado: SÓ os desta lista.
 */
const DADOS_MERCADO = [
  'Um estudo da Harvard Business Review mostrou que empresas que respondem o lead em até 1 hora têm cerca de 7 vezes mais chance de qualificar a venda do que quem demora mais.',
  'Um estudo do MIT com a InsideSales mostrou que responder em até 5 minutos, em vez de 30, aumenta em até 21 vezes a chance de qualificar o lead.',
  'Na prática, muita venda só sai depois de vários contatos, e sem lembrete no CRM a equipe desiste no primeiro ou no segundo.',
  'A Control Gestão já fez mais de 400 implantações de Kommo, e o ganho mais comum é parar de perder lead por falta de retorno.',
]

const TIPOS_SDR = [
  { tipo: 'educativo', como: 'Follow-up EDUCATIVO: compartilhe UMA dica prática e curta ligada ao problema que ele contou (ex.: separar os leads por etapa, lembrete de retorno, resposta rápida no WhatsApp), do jeito de quem ajuda de graça. Termine com uma pergunta leve sobre a rotina dele, diferente das anteriores.' },
  { tipo: 'valor', como: `Follow-up de VALOR: traga UM dado de mercado desta lista (use só um, com a fonte de forma simples, sem inventar número): ${DADOS_MERCADO.join(' | ')} Ligue o dado ao que ele contou e ofereça a análise gratuita com o especialista.` },
  { tipo: 'checar', como: 'Follow-up de CHECAR: pergunte com naturalidade como está aquela situação que ele contou (o atendimento, os leads, o processo) e se ainda faz sentido olhar isso com o especialista numa análise gratuita.' },
  { tipo: 'retomada', como: 'Follow-up de RETOMADA (último): mensagem leve deixando a porta aberta, com uma novidade útil (ex.: agente de IA da Kommo que responde na hora e qualifica, ou automação de follow-up), sem pressão e SEM pergunta.' },
]

const TIPOS_NEG = [
  { tipo: 'agradecimento', como: 'Follow-up de AGRADECIMENTO: agradeça em uma frase o tempo dele na reunião com o especialista e pergunte se ficou alguma dúvida sobre a proposta.' },
  { tipo: 'valor', como: `Follow-up de VALOR: traga UM dado de mercado desta lista (só um, fonte simples, sem inventar número): ${DADOS_MERCADO.join(' | ')} Ligue ao que ele contou e à proposta.` },
  { tipo: 'educativo', como: 'Follow-up EDUCATIVO: tire uma dúvida comum de quem está decidindo (implantação em até 30 dias, acompanhamento de 6 meses depois, treinamento da equipe e suporte por WhatsApp), para dar segurança. Termine com uma pergunta simples.' },
  { tipo: 'checar', como: 'Follow-up de CHECAR: pergunte como está a decisão por aí (se já conversou com quem decide junto) e se pode ajudar com alguma informação.' },
  { tipo: 'retomada', como: 'Follow-up de RETOMADA (último): deixe a proposta em aberto com leveza, sem pressão e SEM pergunta.' },
]

const FIXOS_SDR = [
  'Uma dica rápida: só de separar os contatos por etapa e colocar lembrete de retorno, já para de escapar muita venda. Hoje vocês conseguem ver quem ficou sem resposta?',
  'Um estudo da Harvard Business Review mostrou que responder o lead em até 1 hora aumenta em cerca de 7 vezes a chance de qualificar. Se quiser, o especialista te mostra numa análise gratuita como deixar isso automático aí.',
  'E aí, como tá a organização dos atendimentos por aí? Se ainda fizer sentido, marco uma análise gratuita com o especialista pra você ver como ficaria.',
  'Vou deixar a conversa em pausa por aqui. Quando quiser organizar o atendimento no Kommo, com agente de IA respondendo na hora e lembrete de retorno, é só me chamar.',
]
const FIXOS_NEG = [
  'Obrigada pelo tempo na reunião com o especialista! Ficou alguma dúvida sobre a proposta?',
  'Um estudo da Harvard Business Review mostrou que quem responde o lead em até 1 hora tem cerca de 7 vezes mais chance de qualificar. É bem isso que a implantação deixa rodando pra vocês.',
  'Uma dúvida comum de quem está decidindo: a implantação sai em até 30 dias e depois tem 6 meses de acompanhamento, com suporte por WhatsApp. Quer que eu detalhe alguma parte?',
  'Como está a decisão por aí? Se precisar de alguma informação pra conversar com quem decide junto, me fala.',
  'Vou deixar a proposta em aberto por aqui. Quando quiser retomar, é só me chamar.',
]

export function instrucaoSdr(passo: number, total: number): string {
  const t = TIPOS_SDR[Math.min(passo, TIPOS_SDR.length - 1)]
  const ultimo = passo === total - 1
  return `[FOLLOW-UP ${passo + 1} de ${total} · tipo ${t.tipo}] O lead parou de responder. Escreva UMA mensagem curta de WhatsApp (até 3 linhas). ${t.como} NÃO repita a pergunta nem a frase das mensagens anteriores (leia o histórico e mude de assunto conforme o tipo). Sem cobrar ("vi que você não respondeu" é proibido), sem "bom dia/boa tarde" e sem se apresentar. Use o primeiro nome dele se souber.${ultimo ? ' É a ÚLTIMA tentativa: sem pergunta.' : ''} Responda só com o texto.`
}

export function instrucaoNeg(passo: number, total: number): string {
  const t = TIPOS_NEG[Math.min(passo, TIPOS_NEG.length - 1)]
  const ultimo = passo === total - 1
  return `[FOLLOW-UP DE PROPOSTA ${passo + 1} de ${total} · tipo ${t.tipo}] Este cliente já fez a reunião e recebeu a proposta da implantação (etapa de negociação). Escreva UMA mensagem curta de WhatsApp (até 3 linhas), em nome da equipe comercial da Control Gestão. ${t.como} NÃO repita frases das mensagens anteriores. Não cite valores. Não se apresente como Lara e não cobre.${ultimo ? ' É a última: sem pergunta.' : ''} Responda só com o texto.`
}

/** Saiu parecido com a última mensagem da Lara? Então vai o texto fixo do tipo deste passo. */
function semRepetir(texto: string | null, ultimaLara: string, fixo: string): string {
  if (!texto) return fixo
  return ultimaLara && overlap(texto, ultimaLara) >= 0.6 ? fixo : texto
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

  if (tipo === 'tel') {
    // Reconferência do telefone 5 min depois do aceite (uma vez só)
    const { iniciarConversa } = await import('./iniciar')
    const r = await iniciarConversa(leadId, 'reconferencia-telefone', null, { reconferencia: true })
    return `reconferência do telefone: ${r.acao} (${r.detalhe})`
  }

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
    const horas = CRM_MAP.followup.horas
    // Trava: respeita o intervalo desde o último envio (item antigo na fila, fim de semana, feriado)
    const minimo = est.passo === 0 ? horas[0] * HORA * 0.75 : (horas[est.passo] - horas[est.passo - 1]) * HORA
    const ultimo = await ultimoEnvio(leadId)
    if (ultimo && agora - ultimo < minimo) {
      const novo = noExpediente(ultimo + minimo)
      await enfileirar(`sdr:${leadId}`, novo)
      await campoProximo(leadId, novo)
      return `adiado para ${new Date(novo).toISOString()} (intervalo mínimo desde o último envio)`
    }
    const ultimaLara = (await getHistory(leadId).catch(() => [])).filter(m => m.dir === 'out').pop()?.text || ''
    const texto = semRepetir(await gerar(leadId, instrucaoSdr(est.passo, total)).catch(() => null), ultimaLara, FIXOS_SDR[Math.min(est.passo, FIXOS_SDR.length - 1)])
    await enviarFollowup(leadId, texto, 'sdr', est.passo)
    const passo = est.passo + 1
    let linhaProx: string
    if (passo < total) {
      await redis.set(chaveEstado('sdr', leadId), { ...est, passo }, { ex: 30 * 86400 })
      const prox = proximoPasso(est.desde, horas[passo] * HORA, horas[passo - 1] * HORA, agora)
      await enfileirar(`sdr:${leadId}`, prox)
      await campoProximo(leadId, prox)
      linhaProx = `⏭️ Próximo follow-up: ${quando(prox, agora)}`
    } else {
      await redis.del(chaveEstado('sdr', leadId))
      const fim = noExpediente(agora + CRM_MAP.followup.esgotar.depoisDeHoras * HORA)
      await enfileirar(`esg:${leadId}`, fim)
      await campoProximo(leadId, null)
      linhaProx = `⛳ Último follow-up. Sem resposta até ${quando(fim, agora)}, o lead vai para ${CRM_MAP.followup.esgotar.nome}.`
    }
    await addLeadNote(leadId, nota(`Follow-up ${passo} de ${total} enviado`, [linhaProx])).catch(() => undefined)
    return `sdr ${passo}/${total} enviado`
  }

  if (tipo === 'esg') {
    const e = CRM_MAP.followup.esgotar
    const corpo: Record<string, unknown> = { pipeline_id: e.pipelineId, status_id: e.statusId, responsible_user_id: e.responsavelId }
    try { await patchLead(leadId, { ...corpo, loss_reason_id: e.lossReasonId }) } catch { await patchLead(leadId, corpo) }
    if (CONFIG.gateTag) await removeLeadTags(leadId, [CONFIG.gateTag]).catch(() => undefined)
    await addLeadTags(leadId, [e.tag])
    await addLeadNote(leadId, nota('Follow-ups esgotados, lead sem resposta', [
      `♻️ Cadência: ${CRM_MAP.followup.horas.map(h => (h < 24 ? `${h}h` : `${h / 24}d`)).join(', ')}`,
      `➡️ Movido para ${e.nome} (Remarketing e Retornos futuros)`,
      '❌ Motivo de perda: Sem resposta',
      '☺️ Responsável: Rodrigo',
    ]))
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
    if (est.passo > 0) {
      const minimo = (n.dias[est.passo] - n.dias[est.passo - 1]) * DIA
      const ultimo = await ultimoEnvio(leadId)
      if (ultimo && agora - ultimo < minimo) {
        const novo = noExpediente(ultimo + minimo)
        await enfileirar(`neg:${leadId}`, novo)
        await campoProximo(leadId, novo)
        return `adiado para ${new Date(novo).toISOString()} (intervalo mínimo desde o último envio)`
      }
    }
    const ultimaLara = (await getHistory(leadId).catch(() => [])).filter(m => m.dir === 'out').pop()?.text || ''
    const texto = semRepetir(await gerar(leadId, instrucaoNeg(est.passo, n.dias.length)).catch(() => null), ultimaLara, FIXOS_NEG[Math.min(est.passo, FIXOS_NEG.length - 1)])
    await enviarFollowup(leadId, texto, 'neg', est.passo)
    const passo = est.passo + 1
    await redis.set(chaveEstado('neg', leadId), { ...est, passo }, { ex: 60 * 86400 })
    let linhaProx: string
    if (passo < n.dias.length) {
      const prox = proximoPasso(est.desde, n.dias[passo] * DIA, n.dias[passo - 1] * DIA, agora)
      await enfileirar(`neg:${leadId}`, prox)
      await campoProximo(leadId, prox)
      linhaProx = `⏭️ Próximo follow-up: ${quando(prox, agora)}`
    } else {
      await enfileirar(`negfim:${leadId}`, noExpediente(agora + DIA))
      await campoProximo(leadId, null)
      linhaProx = '⛳ Último follow-up da negociação. Sem resposta, o vendedor recebe uma tarefa.'
    }
    await addLeadNote(leadId, nota(`Follow-up de negociação ${passo} de ${n.dias.length} enviado`, [linhaProx])).catch(() => undefined)
    return `neg ${passo}/${n.dias.length} enviado`
  }

  const lem = tipo.match(/^lem(m?)(\d+)$/) // lemm10 = minutos; lem24/lem1 (formato antigo) = horas
  if (lem) return processarLembrete(lem[1] ? Number(lem[2]) : Number(lem[2]) * 60, leadId, agora)

  if (tipo === 'negfim') {
    const t = CRM_MAP.negociacao.tarefa
    const est = await redis.get<Cadencia>(chaveEstado('neg', leadId))
    if (!est || est.passo < 0) return 'respondeu: sem tarefa'
    await createTask({ leadId, responsibleUserId: t.responsavelId, taskTypeId: t.taskTypeId, text: t.texto, completeTill: Math.floor(noExpediente(agora) / 1000) + 3600, duration: 0 })
    await addLeadNote(leadId, nota('Negociação sem resposta após todos os follow-ups', ['✍️ Tarefa criada para o vendedor retomar o contato'])).catch(() => undefined)
    await logExec({ tipo: 'followup', leadId, detalhe: 'negociação sem resposta: tarefa criada para o Rodrigo' })
    return 'tarefa criada'
  }
  return 'tipo desconhecido'
}

// ---------- lembretes da reunião (para o cliente) ----------

/** taskId: id da tarefa do Kommo, ou 'g:<id>' do evento no Google (antigos: número) */
interface Lembrete { ini: number; taskId: string | number }

/** Agenda os lembretes (24h, 1h e 10 min antes; só os que ainda estão no futuro). Hora marcada: não segue o expediente. */
export async function agendarLembretes(leadId: number, ini: number, taskId: string | number, agora = Date.now()): Promise<void> {
  const cfg = CRM_MAP.lembretes
  if (!cfg.ativo) return
  await redis.set(k('lem', leadId), { ini, taskId } satisfies Lembrete, { ex: 30 * 86400 })
  // Remarcou: tira os lembretes do horário antigo (inclusive os do formato antigo lem24/lem1)
  await redis.zrem(FILA(), ...cfg.minutosAntes.map(m => `lemm${m}:${leadId}`), `lem24:${leadId}`, `lem1:${leadId}`)
  for (const m of cfg.minutosAntes) {
    const quando = ini - m * MIN
    if (quando > agora + 2 * MIN) await enfileirar(`lemm${m}:${leadId}`, quando)
  }
}

/** "o Rodrigo, especialista da Control Gestão" (o lead pergunta o nome de quem faz a reunião, 05/10) */
const ESPECIALISTA = CRM_MAP.agenda.especialista ? `o ${CRM_MAP.agenda.especialista}, especialista da Control Gestão` : 'o especialista da Control Gestão'

/** Texto do lembrete (fixo, sem IA: data e hora não podem sair erradas). Sempre em português. */
export function textoLembrete(minutos: number, ini: number, agora: number, nome: string, link = ''): string {
  const l = local(ini)
  const hora = l.min ? `${l.h}h${String(l.min).padStart(2, '0')}` : `${l.h}h`
  const n = nome ? `, ${nome}` : ''
  // 10 min antes: o link para entrar
  if (minutos <= 15) {
    return link
      ? `Oi${n}! Em ${minutos} minutinhos começa a nossa reunião com ${ESPECIALISTA}. É só entrar por aqui: ${link}\nAté já!`
      : `Oi${n}! Em ${minutos} minutinhos começa a nossa reunião com ${ESPECIALISTA}. ${CRM_MAP.agenda.especialista ? `O ${CRM_MAP.agenda.especialista}` : 'Ele'} te chama por aqui. Até já!`
  }
  // 1h antes: aviso (o link vai 10 min antes)
  if (minutos <= 120 && CRM_MAP.lembretes.minutosAntes.some(m => m <= 15)) {
    return `Oi${n}! Daqui a pouco, às ${hora}, é a nossa reunião com ${ESPECIALISTA}. Te mando o link 10 minutinhos antes. Até já!`
  }
  if (minutos >= 12 * 60) {
    return link
      ? `Oi${n}! Passando pra lembrar da nossa reunião ${rotulo(ini, agora)} com ${ESPECIALISTA}. O link é este: ${link}\nConfere se abre certinho aí pra você?`
      : `Oi${n}! Passando pra lembrar da nossa reunião ${rotulo(ini, agora)} com ${ESPECIALISTA}. Tudo certo pra você?`
  }
  return link
    ? `Oi${n}! Daqui a pouco, às ${hora}, é a nossa reunião com ${ESPECIALISTA}. O link: ${link}\nAté já!`
    : `Oi${n}! Daqui a pouco, às ${hora}, é a nossa reunião com ${ESPECIALISTA}. Até já!`
}

async function processarLembrete(minutos: number, leadId: number, agora: number): Promise<string> {
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
  const nome = primeiroNomeDe(contatoId ? (await getContact(contatoId)).name || '' : '')
  const linkCampo = CRM_MAP.linkReuniaoFieldId ? (lead.custom_fields_values || []).find(f => f.field_id === CRM_MAP.linkReuniaoFieldId)?.values?.[0]?.value : ''
  // O campo vence (o Rodrigo pode ter trocado o link à mão); depois o Meet do evento
  const link = String(linkCampo || linkEvento || CONFIG.linkReuniao || '').trim()
  const texto = textoLembrete(minutos, lem.ini, agora, nome, link)
  if (!link && minutos >= 12 * 60) {
    await createTask({ leadId, responsibleUserId: CRM_MAP.agenda.responsavelId, taskTypeId: 1, text: `URGENTE: o lembrete de ${minutos >= 60 ? `${minutos / 60}h` : `${minutos} min`} saiu SEM link. Mande o link da reunião para o cliente e preencha o campo "Link da Reunião" (o lembrete de 1h usa ele).`, completeTill: Math.floor(agora / 1000) + 3600, duration: 0 }).catch(() => undefined)
  }
  await enviarFollowup(leadId, texto, `lembrete-${minutos >= 60 ? `${minutos / 60}h` : `${minutos} min`}`, 0)
  return `lembrete ${minutos >= 60 ? `${minutos / 60}h` : `${minutos} min`} enviado`
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
    await campoProximo(l.id, prox)
    await addLeadNote(l.id, nota(`Cadência de negociação iniciada (${n.dias.join(', ')} dias)`, [`⏭️ Primeiro follow-up: ${quando(prox, agora)}`, '✋ Para sozinha quando o cliente responder'])).catch(() => undefined)
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

