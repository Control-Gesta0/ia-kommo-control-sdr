import crypto from 'crypto'
import { brain, enviarResposta, processLead } from './agent'
import { CONFIG } from './config'
import { CRM_MAP, portaById } from './crm-map'
import { logExec } from './execlog'
import { appendMessage, getHistory } from './history'
import { acharComentario, classificarSuporte, extrairContexto, foraDoIdioma, marcaDeInvalido, segmentoPt, type Classificacao, type ContextoIndicacao } from './indicacao'
import { classificarIntencao } from './intencao'
import {
  addLeadNote, addLeadTags, contactPhones, getContact, getLead, getLeadNotes, kommoGet, leadTags, textoDasNotas, textoDoLead, updateLeadFields, type KommoLead,
} from './kommo'
import { primeiroNomeDe } from './llm'
import { nota, quando } from './notas'
import { avancar } from './etapas'
import { agendarFollowup, agendarItem } from './followup'
import { kommoPort } from './port'
import { k, redis } from './redis'
import { saudacao } from './saudacao'
import { getState, patchState } from './state'
import { sendReply } from './transport'

/**
 * A IA FALA PRIMEIRO. Lead de indicação aceito → confere que é indicação de
 * verdade, descarta teste, e manda a abertura pelo Salesbot.
 *
 * Quem chama: o USERSCRIPT, logo depois do aceite no navegador (traz o Comment
 * que leu na tela). O webhook da Kommo é só uma rota opcional de reserva.
 * Idempotência: chave `inicio:{leadId}` com NX. Só uma conversa por lead.
 */

export type DecisaoInicio =
  | { acao: 'iniciar' }
  | { acao: 'teste'; classificacao: Classificacao }
  | { acao: 'invalido'; motivo: string }
  | { acao: 'outro-idioma'; motivo: string }
  | { acao: 'suporte'; motivo: string }
  | { acao: 'sem-comentario' | 'sem-telefone' | 'fora-da-entrada' | 'humano' | 'rampagem'; motivo: string }

export interface FatosInicio {
  leadId: number
  statusId: number
  pipelineId: number
  tags: string[]
  comentario: string | null
  /** a Kommo marcou o aceite como inválido ("no longer available" / "already accepted") */
  invalido?: 'cedo' | 'outros' | null
  /** só atendemos em português: motivo se a indicação é de outro país/idioma */
  foraDoIdioma?: string | null
  /** pedido de suporte básico da Kommo (não é implantação): motivo */
  suporte?: string | null
  /** tag da Lara colocada à mão: a decisão é do time, os filtros da indicação não bloqueiam */
  manual?: boolean
  /** resultado do filtro de teste (regra + IA de intenção nos ambíguos) */
  classificacao: Classificacao | null
  telefones: string[]
}

/** Decisão pura (testada em npm test). A ordem importa: teste vem antes de telefone. */
export function decidirInicio(f: FatosInicio, cfg = {
  humanTag: CONFIG.humanTag, exigirComentario: CONFIG.exigirComentario,
  modoInicio: modoInicio(), testLeadIds: CONFIG.testLeadIds, entrada: CRM_MAP.entrada,
}): DecisaoInicio {
  if (f.tags.map(t => t.toLowerCase()).includes(cfg.humanTag)) return { acao: 'humano', motivo: `tag "${cfg.humanTag}"` }
  if (f.manual) {
    if (!f.telefones.length) return { acao: 'sem-telefone', motivo: 'contato principal sem telefone' }
    if (cfg.modoInicio === 'desligado') return { acao: 'rampagem', motivo: 'MODO_INICIO=desligado' }
    return { acao: 'iniciar' }
  }
  if (f.foraDoIdioma) return { acao: 'outro-idioma', motivo: f.foraDoIdioma }
  if (f.suporte) return { acao: 'suporte', motivo: f.suporte }
  if (f.invalido) return { acao: 'invalido', motivo: f.invalido === 'cedo' ? 'aceito antes da liberação (The leads is no longer available)' : 'outros parceiros já tinham aceitado (already accepted by other partners)' }
  if (f.statusId !== cfg.entrada.statusId || (cfg.entrada.pipelineId && f.pipelineId !== cfg.entrada.pipelineId)) {
    return { acao: 'fora-da-entrada', motivo: `lead em ${f.pipelineId}/${f.statusId}, entrada é ${cfg.entrada.pipelineId || '*'}/${cfg.entrada.statusId}` }
  }
  if (f.comentario === null && cfg.exigirComentario) return { acao: 'sem-comentario', motivo: 'nenhum "Comment:" no payload, no cache do Incoming lead, nas notas ou nos campos' }
  if (f.classificacao?.teste) return { acao: 'teste', classificacao: f.classificacao }
  if (!f.telefones.length) return { acao: 'sem-telefone', motivo: 'contato principal sem telefone' }
  if (cfg.modoInicio === 'desligado') return { acao: 'rampagem', motivo: 'MODO_INICIO=desligado' }
  if (cfg.modoInicio === 'teste' && !cfg.testLeadIds.includes(f.leadId)) return { acao: 'rampagem', motivo: 'MODO_INICIO=teste e o lead não está em TEST_LEAD_IDS' }
  return { acao: 'iniciar' }
}

export function modoInicio(): 'desligado' | 'teste' | 'ligado' {
  const v = (process.env.MODO_INICIO || 'teste').toLowerCase()
  return v === 'ligado' || v === 'desligado' ? v : 'teste'
}

/** Comment guardado quando o webhook "Incoming lead adicionado" chegou (antes do aceite). */
export async function guardarComentarioIncoming(leadId: number, comentario: string): Promise<void> {
  await redis.set(k('incoming', leadId), comentario, { ex: 7 * 86400 })
}

interface Leitura { comentario: string | null; contexto: ContextoIndicacao; invalido: 'cedo' | 'outros' | null; textoIndicacao: string }

/**
 * Tudo que a indicação carrega. Formato real da conta (25/09/2026): nota "common"
 * com "Country / Cluster / Languages / Industry / Comment:" (o Comment em várias linhas).
 */
async function lerIndicacao(lead: KommoLead, informado?: string | null): Promise<Leitura> {
  let notas: string[] = []
  try { notas = textoDasNotas(await getLeadNotes(lead.id)) } catch (e) { console.warn(`[iniciar] notas do lead ${lead.id}:`, e) }
  let eventos = ''
  try { eventos = JSON.stringify(await kommoGet(`/api/v4/events?filter[entity]=lead&filter[entity_id]=${lead.id}&limit=50`)) } catch { /* sem eventos */ }
  const notaIndicacao = notas.find(n => acharComentario([n]) !== null) || ''
  const cache = await redis.get<string>(k('incoming', lead.id))
  const comentario = (informado && informado.trim() ? informado.trim().slice(0, 2000) : null) ?? cache ?? acharComentario([textoDoLead(lead), ...notas])
  return { comentario, contexto: extrairContexto(notaIndicacao), invalido: marcaDeInvalido([...notas, eventos].join('\n')), textoIndicacao: notaIndicacao }
}

export interface ResultadoInicio { ok: boolean; acao: string; detalhe: string }

export async function iniciarConversa(leadId: number, origem: string, comentarioInformado?: string | null, opts: { manual?: boolean; responder?: boolean; reconferencia?: boolean } = {}): Promise<ResultadoInicio> {
  const t0 = Date.now()
  const chave = k('inicio', leadId)
  if ((await redis.set(chave, origem, { nx: true, ex: 30 * 86400 })) !== 'OK') {
    return { ok: true, acao: 'ja-iniciado', detalhe: `já tratado por ${await redis.get<string>(chave)}` }
  }
  let nome = ''
  try {
    const lerContato = async () => {
      const l = await getLead(leadId)
      const cid = (l._embedded?.contacts || []).find(c => c.is_main)?.id || l._embedded?.contacts?.[0]?.id
      const c = cid ? await getContact(cid) : null
      return { lead: l, contato: c, telefones: c ? contactPhones(c) : [] }
    }
    const { lead, contato, telefones } = await lerContato()
    // Nome da PESSOA (o nome do lead costuma ser a empresa ou "Lead №85304")
    nome = contato?.name || lead.name || ''
    const leitura = await lerIndicacao(lead, comentarioInformado)
    const { comentario, contexto, textoIndicacao } = leitura
    // Liberado pelo Rodrigo (LIBERAR_INVALIDOS): atende mesmo com a marca de inválido da Kommo
    const liberado = !!leitura.invalido && CONFIG.liberarInvalidos.includes(leadId)
    const invalido = liberado ? null : leitura.invalido
    const idioma = foraDoIdioma(textoIndicacao, comentario || '')
    const classificacao = comentario && !invalido ? await classificarIntencao(comentario) : null
    const sup = classificarSuporte(comentario || '')
    const d = decidirInicio({ leadId, statusId: lead.status_id, pipelineId: lead.pipeline_id, tags: leadTags(lead), comentario, classificacao, telefones, invalido, foraDoIdioma: idioma.fora ? idioma.motivo : null, suporte: sup.suporte ? sup.motivo : null, manual: opts.manual })

    if (d.acao === 'outro-idioma') {
      await addLeadTags(leadId, [CRM_MAP.tags.outroIdioma])
      await addLeadNote(leadId, `✈️ Lara NÃO iniciou conversa: ${d.motivo}. A Control Gestão só atende em português.`)
      await logExec({ tipo: 'pulou', leadId, nome, detalhe: `outro idioma: ${d.motivo} · via ${origem}` })
      return { ok: true, acao: d.acao, detalhe: d.motivo }
    }
    if (d.acao === 'suporte') {
      await addLeadTags(leadId, [CRM_MAP.tags.suporte])
      await addLeadNote(leadId, nota('NÃO iniciou conversa · suporte básico da Kommo', [`➡️ ${d.motivo}`, comentario && `✉️ Comment: "${comentario}"`, '☑️ Isso quem resolve é o suporte da própria Kommo (chat dentro da conta)']))
      await logExec({ tipo: 'pulou', leadId, nome, detalhe: `suporte: ${d.motivo} · via ${origem}` })
      return { ok: true, acao: d.acao, detalhe: d.motivo }
    }
    if (d.acao === 'invalido') {
      await addLeadTags(leadId, [CRM_MAP.tags.invalida])
      await addLeadNote(leadId, `⛔ Lara NÃO iniciou conversa: ${d.motivo}.`)
      await logExec({ tipo: 'pulou', leadId, nome, detalhe: `inválido: ${d.motivo} · via ${origem}` })
      return { ok: true, acao: 'invalido', detalhe: d.motivo }
    }

    if (d.acao === 'teste') {
      await addLeadTags(leadId, [CRM_MAP.tags.teste])
      await addLeadNote(leadId, `⚗️ IA NÃO iniciou conversa: indicação de TESTE (${d.classificacao.motivo}).\nComment: ${comentario}`)
      await logExec({ tipo: 'pulou', leadId, nome, detalhe: `teste: ${d.classificacao.motivo} · via ${origem}` })
      return { ok: true, acao: 'teste', detalhe: d.classificacao.motivo }
    }
    if (d.acao === 'sem-telefone') {
      await addLeadTags(leadId, [CRM_MAP.tags.semTelefone])
      // A Kommo cria o contato e o telefone alguns segundos DEPOIS do aceite (lead 20782629, 06/10:
      // checou às 14:04:03, telefone às 14:04:04): confere UMA vez de novo daqui a 5 minutos
      const reconfere = !opts.reconferencia
      await addLeadNote(leadId, `☎️ IA não iniciou: o contato não tem telefone${reconfere ? ' (confere de novo em 5 minutos)' : ''}. Comment: ${comentario ?? '(não achado)'}`)
      await logExec({ tipo: 'pulou', leadId, nome, detalhe: `sem telefone · via ${origem}${reconfere ? ' · reconfere em 5 min' : ''}` })
      // Libera a chave: a reconferência (ou a tag ia-sdr colocada à mão) pode iniciar a conversa depois
      await redis.del(chave)
      if (reconfere) await agendarItem(`tel:${leadId}`, Date.now() + 5 * 60000).catch(e => console.warn('[inicio] reconferir telefone:', e))
      return { ok: true, acao: d.acao, detalhe: d.motivo }
    }
    if (d.acao !== 'iniciar') {
      // Sem comentário / fora da entrada / rampagem / humano: libera a chave. A outra
      // porta de entrada (userscript com o Comment, ou o lead chegando na etapa) ainda pode iniciar.
      await redis.del(chave)
      await logExec({ tipo: 'pulou', leadId, nome, detalhe: `${d.acao}: ${d.motivo} · via ${origem}` })
      return { ok: true, acao: d.acao, detalhe: d.motivo }
    }

    // Tag à mão num lead sem indicação: abertura de contato direto (sem falar de indicação)
    if (opts.manual) await redis.del(k('humano', leadId)) // o time passou o lead para a Lara
    if (opts.manual && !comentario) return await iniciarDireto(leadId, nome, origem, t0, !!opts.responder)

    const porta = portaById(CRM_MAP.menu.portaUnica)!
    const segmento = segmentoPt(contexto.segmento)
    await patchState(leadId, { comentario: comentario || undefined, contexto: { ...contexto, segmento }, porta: porta.id, portaEm: t0 - 1, iniciadoEm: new Date().toISOString(), iniciadoPor: origem, ...(segmento ? { respostas: { ...(await getState(leadId)).respostas, segmento } } : {}) })
    if (CRM_MAP.comentarioFieldId && comentario) await updateLeadFields(leadId, [{ field_id: CRM_MAP.comentarioFieldId, values: [{ value: comentario }] }])
    await addLeadTags(leadId, [CRM_MAP.tags.indicacao, ...(CONFIG.gateTag ? [CONFIG.gateTag] : [])])

    const state = await getState(leadId)
    const ctx = { port: kommoPort(leadId), porta, gateTag: CONFIG.gateTag, leadText: comentario || '', lastLeadText: '', lastAgentText: '' }
    let texto = ''
    let guard: string[] = []
    let usage
    try {
      const ab = await brain.generateOpening({ ...ctx, lastLeadText: comentario || '' }, { nomeContato: nome, primeiroContatoDaPorta: true })
      if (ab) { texto = ab.text; guard = ab.guard; usage = ab.usage }
    } catch (e) { console.error(`[iniciar] abertura pelo modelo falhou no lead ${leadId}:`, e) }
    if (!texto) { texto = aberturaFixa(nome); guard = [...guard, 'abertura fixa (modelo falhou ou reprovou na trava)'] }

    const detalhe = await enviarResposta(leadId, texto, true)
    const prox = await agendarFollowup(leadId, Date.now())
    const linhas = [
      '✉️ Lara enviou a primeira mensagem',
      prox && `⏭️ Próximo follow-up: ${quando(prox)} (se não responder)`,
      liberado && '⚠️ Kommo marcou como aceito por outro parceiro; atendido por decisão do Rodrigo',
    ]
    const moveu = await avancar(ctx.port, 'emContato', linhas).catch(e => { console.warn('[etapa] em contato:', e); return false })
    if (!moveu) await addLeadNote(leadId, nota('Primeira mensagem enviada', linhas.slice(1))).catch(() => undefined)
    await logExec({ tipo: 'inicio', leadId, nome, porta: porta.id, ms: Date.now() - t0, guard, usage, detalhe: `${detalhe} · via ${origem} · ${state.comentario ? 'com Comment' : 'sem Comment'}` })
    return { ok: true, acao: 'iniciou', detalhe }
  } catch (e) {
    await redis.del(chave) // falhou no meio: deixa a próxima porta de entrada tentar
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300)
    await logExec({ tipo: 'erro', leadId, nome, ms: Date.now() - t0, detalhe: `início: ${msg}` })
    return { ok: false, acao: 'erro', detalhe: msg }
  }
}

export const primeiroNome = primeiroNomeDe

export function aberturaFixa(nome: string, agora = Date.now()): string {
  const n = primeiroNomeDe(nome)
  return CRM_MAP.aberturaFixa.replace('{saudacao}', saudacao(agora)).replace('{nome}', n ? `, ${n}` : '')
}

/** Abertura quando a tag foi colocada à mão num lead sem indicação (fixa: sem contexto, sem risco de inventar). */
export function aberturaDireta(nome: string, agora = Date.now()): string {
  const n = primeiroNomeDe(nome)
  return CRM_MAP.aberturaDireta.replace('{saudacao}', saudacao(agora)).replace('{nome}', n ? `, ${n}` : '')
}

async function iniciarDireto(leadId: number, nome: string, origem: string, t0: number, responder: boolean): Promise<ResultadoInicio> {
  const porta = portaById('direto')!
  await patchState(leadId, { porta: porta.id, portaEm: 0, iniciadoEm: new Date().toISOString(), iniciadoPor: origem })
  // O lead escreveu e ninguém respondeu: a Lara responde a mensagem dele (melhor que abertura genérica)
  if (responder) {
    await processLead(leadId, `tag:${leadId}:${t0}`)
    return { ok: true, acao: 'respondeu', detalhe: 'contato direto: respondeu a mensagem que estava sem resposta' }
  }
  const texto = aberturaDireta(nome)
  const detalhe = await sendReply(leadId, texto)
  await appendMessage(leadId, { id: crypto.randomUUID(), dir: 'out', text: texto, ts: Date.now() })
  const prox = await agendarFollowup(leadId, Date.now())
  const linhas = ['✉️ Lara enviou a primeira mensagem (tag colocada pelo time)', prox && `⏭️ Próximo follow-up: ${quando(prox)} (se não responder)`]
  const moveu = await avancar(kommoPort(leadId), 'emContato', linhas).catch(() => false)
  if (!moveu) await addLeadNote(leadId, nota('Primeira mensagem enviada (tag colocada pelo time)', linhas.slice(1))).catch(() => undefined)
  await logExec({ tipo: 'inicio', leadId, nome, porta: porta.id, ms: Date.now() - t0, detalhe: `${detalhe} · contato direto · via ${origem}` })
  return { ok: true, acao: 'iniciou', detalhe: `contato direto · ${detalhe}` }
}

/**
 * Tag da Lara colocada à mão (webhook update_lead ou varredura do cron): se ela
 * ainda não falou com esse lead, manda a primeira mensagem (indicação: abertura da
 * indicação; qualquer outro lead: abertura de contato direto). Se já falou, segue
 * quando o lead responder.
 */
export async function iniciarPorTag(leadId: number, origem = 'tag-manual'): Promise<ResultadoInicio> {
  await redis.del(k('humano', leadId)) // o time passou o lead para a Lara: sem pausa de humano
  const hist = await getHistory(leadId).catch(() => [])
  // Mensagens do time também ficam no histórico como saída (id "kommo:..."): só conta o que a Lara mandou
  const laraFalou = hist.some(m => m.dir === 'out' && !String(m.id).startsWith('kommo:'))
  const esperando = hist[hist.length - 1]?.dir === 'in' // o lead escreveu e ninguém respondeu
  if (laraFalou) {
    if (!esperando) return { ok: true, acao: 'ja-conversando', detalhe: 'a Lara já falou com esse lead: segue quando ele responder' }
    await processLead(leadId, `tag:${leadId}:${Date.now()}`)
    return { ok: true, acao: 'respondeu', detalhe: 'respondeu a última mensagem do lead' }
  }
  return iniciarConversa(leadId, origem, null, { manual: true, responder: esperando })
}

/**
 * Reserva do webhook: indicação na etapa de entrada com a tag da Lara colocada à
 * mão (aceite manual) e sem conversa iniciada = inicia. Uma tentativa por lead por
 * dia (lead sem Comment ou recusado não fica tentando a cada 15 min).
 */
export async function varrerTagManual(): Promise<string[]> {
  const e = CRM_MAP.entrada
  if (!CONFIG.gateTag || modoInicio() === 'desligado') return []
  const r = await kommoGet<{ _embedded?: { leads?: KommoLead[] } }>(`/api/v4/leads?filter[statuses][0][pipeline_id]=${e.pipelineId}&filter[statuses][0][status_id]=${e.statusId}&limit=250`)
  const feitos: string[] = []
  for (const lead of r?._embedded?.leads || []) {
    if (!leadTags(lead).map(t => t.toLowerCase()).includes(CONFIG.gateTag.toLowerCase())) continue
    if (await redis.get(k('inicio', lead.id))) continue
    if ((await redis.set(k('varredura-tag', lead.id), 1, { nx: true, ex: 86400 })) !== 'OK') continue
    const res = await iniciarPorTag(lead.id, 'varredura-tag')
    feitos.push(`${lead.id}: ${res.acao}`)
  }
  return feitos
}
