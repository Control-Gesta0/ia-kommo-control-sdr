import crypto from 'crypto'
import { brain } from './agent'
import { CONFIG } from './config'
import { CRM_MAP, portaById } from './crm-map'
import { logExec } from './execlog'
import { appendMessage } from './history'
import { acharComentario, type Classificacao } from './indicacao'
import { classificarIntencao } from './intencao'
import {
  addLeadNote, addLeadTags, contactPhones, getContact, getLead, getLeadNotes, leadTags, textoDasNotas, textoDoLead, updateLeadFields, type KommoLead,
} from './kommo'
import { primeiroNomeDe } from './llm'
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
  | { acao: 'sem-comentario' | 'sem-telefone' | 'fora-da-entrada' | 'humano' | 'rampagem'; motivo: string }

export interface FatosInicio {
  leadId: number
  statusId: number
  pipelineId: number
  tags: string[]
  comentario: string | null
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

async function lerComentario(lead: KommoLead, informado?: string | null): Promise<string | null> {
  if (informado && informado.trim()) return informado.trim().slice(0, 2000)
  const cache = await redis.get<string>(k('incoming', lead.id))
  if (cache) return cache
  let notas: string[] = []
  try { notas = textoDasNotas(await getLeadNotes(lead.id)) } catch (e) { console.warn(`[iniciar] notas do lead ${lead.id}:`, e) }
  return acharComentario([textoDoLead(lead), ...notas])
}

export interface ResultadoInicio { ok: boolean; acao: string; detalhe: string }

export async function iniciarConversa(leadId: number, origem: string, comentarioInformado?: string | null): Promise<ResultadoInicio> {
  const t0 = Date.now()
  const chave = k('inicio', leadId)
  if ((await redis.set(chave, origem, { nx: true, ex: 30 * 86400 })) !== 'OK') {
    return { ok: true, acao: 'ja-iniciado', detalhe: `já tratado por ${await redis.get<string>(chave)}` }
  }
  let nome = ''
  try {
    const lead = await getLead(leadId)
    nome = lead.name || ''
    const contatoId = (lead._embedded?.contacts || []).find(c => c.is_main)?.id || lead._embedded?.contacts?.[0]?.id
    const telefones = contatoId ? contactPhones(await getContact(contatoId)) : []
    const comentario = await lerComentario(lead, comentarioInformado)
    const classificacao = comentario ? await classificarIntencao(comentario) : null
    const d = decidirInicio({ leadId, statusId: lead.status_id, pipelineId: lead.pipeline_id, tags: leadTags(lead), comentario, classificacao, telefones })

    if (d.acao === 'teste') {
      await addLeadTags(leadId, [CRM_MAP.tags.teste])
      await addLeadNote(leadId, `🧪 IA NÃO iniciou conversa: indicação de TESTE (${d.classificacao.motivo}).\nComment: ${comentario}`)
      await logExec({ tipo: 'pulou', leadId, nome, detalhe: `teste: ${d.classificacao.motivo} · via ${origem}` })
      return { ok: true, acao: 'teste', detalhe: d.classificacao.motivo }
    }
    if (d.acao === 'sem-telefone') {
      await addLeadTags(leadId, [CRM_MAP.tags.semTelefone])
      await addLeadNote(leadId, `📵 IA não iniciou: o contato não tem telefone. Comment: ${comentario ?? '(não achado)'}`)
      await logExec({ tipo: 'pulou', leadId, nome, detalhe: `sem telefone · via ${origem}` })
      return { ok: true, acao: d.acao, detalhe: d.motivo }
    }
    if (d.acao !== 'iniciar') {
      // Sem comentário / fora da entrada / rampagem / humano: libera a chave. A outra
      // porta de entrada (userscript com o Comment, ou o lead chegando na etapa) ainda pode iniciar.
      await redis.del(chave)
      await logExec({ tipo: 'pulou', leadId, nome, detalhe: `${d.acao}: ${d.motivo} · via ${origem}` })
      return { ok: true, acao: d.acao, detalhe: d.motivo }
    }

    const porta = portaById(CRM_MAP.menu.portaUnica)!
    await patchState(leadId, { comentario: comentario || undefined, porta: porta.id, portaEm: t0 - 1, iniciadoEm: new Date().toISOString(), iniciadoPor: origem })
    if (CRM_MAP.comentarioFieldId && comentario) await updateLeadFields(leadId, [{ field_id: CRM_MAP.comentarioFieldId, values: [{ value: comentario }] }])
    await addLeadTags(leadId, [CRM_MAP.tags.indicacao, ...(CONFIG.gateTag ? [CONFIG.gateTag] : [])])

    const state = await getState(leadId)
    const ctx = { port: kommoPort(leadId), porta, gateTag: CONFIG.gateTag, leadText: comentario || '', lastLeadText: '', lastAgentText: '' }
    let texto = ''
    let guard: string[] = []
    let usage
    try {
      const ab = await brain.generateOpening(ctx, { nomeContato: nome, primeiroContatoDaPorta: true })
      if (ab) { texto = ab.text; guard = ab.guard; usage = ab.usage }
    } catch (e) { console.error(`[iniciar] abertura pelo modelo falhou no lead ${leadId}:`, e) }
    if (!texto) { texto = aberturaFixa(nome); guard = [...guard, 'abertura fixa (modelo falhou ou reprovou na trava)'] }

    const detalhe = await sendReply(leadId, texto)
    await appendMessage(leadId, { id: crypto.randomUUID(), dir: 'out', text: texto, ts: Date.now() })
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
