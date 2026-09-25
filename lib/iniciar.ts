import crypto from 'crypto'
import { brain } from './agent'
import { CONFIG } from './config'
import { CRM_MAP, portaById } from './crm-map'
import { logExec } from './execlog'
import { appendMessage } from './history'
import { acharComentario, extrairContexto, foraDoIdioma, marcaDeInvalido, type Classificacao, type ContextoIndicacao } from './indicacao'
import { classificarIntencao } from './intencao'
import {
  addLeadNote, addLeadTags, contactPhones, getContact, getLead, getLeadNotes, kommoGet, leadTags, textoDasNotas, textoDoLead, updateLeadFields, type KommoLead,
} from './kommo'
import { primeiroNomeDe } from './llm'
import { avancar } from './etapas'
import { agendarFollowup } from './followup'
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
  if (f.foraDoIdioma) return { acao: 'outro-idioma', motivo: f.foraDoIdioma }
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

export async function iniciarConversa(leadId: number, origem: string, comentarioInformado?: string | null): Promise<ResultadoInicio> {
  const t0 = Date.now()
  const chave = k('inicio', leadId)
  if ((await redis.set(chave, origem, { nx: true, ex: 30 * 86400 })) !== 'OK') {
    return { ok: true, acao: 'ja-iniciado', detalhe: `já tratado por ${await redis.get<string>(chave)}` }
  }
  let nome = ''
  try {
    const lead = await getLead(leadId)
    const contatoId = (lead._embedded?.contacts || []).find(c => c.is_main)?.id || lead._embedded?.contacts?.[0]?.id
    const contato = contatoId ? await getContact(contatoId) : null
    // Nome da PESSOA (o nome do lead costuma ser a empresa ou "Lead №85304")
    nome = contato?.name || lead.name || ''
    const telefones = contato ? contactPhones(contato) : []
    const leitura = await lerIndicacao(lead, comentarioInformado)
    const { comentario, contexto, textoIndicacao } = leitura
    // Liberado pelo Rodrigo (LIBERAR_INVALIDOS): atende mesmo com a marca de inválido da Kommo
    const liberado = !!leitura.invalido && CONFIG.liberarInvalidos.includes(leadId)
    const invalido = liberado ? null : leitura.invalido
    const idioma = foraDoIdioma(textoIndicacao, comentario || '')
    const classificacao = comentario && !invalido ? await classificarIntencao(comentario) : null
    const d = decidirInicio({ leadId, statusId: lead.status_id, pipelineId: lead.pipeline_id, tags: leadTags(lead), comentario, classificacao, telefones, invalido, foraDoIdioma: idioma.fora ? idioma.motivo : null })

    if (d.acao === 'outro-idioma') {
      await addLeadTags(leadId, [CRM_MAP.tags.outroIdioma])
      await addLeadNote(leadId, `🌎 Lara NÃO iniciou conversa: ${d.motivo}. A Control Gestão só atende em português.`)
      await logExec({ tipo: 'pulou', leadId, nome, detalhe: `outro idioma: ${d.motivo} · via ${origem}` })
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
    await patchState(leadId, { comentario: comentario || undefined, contexto, porta: porta.id, portaEm: t0 - 1, iniciadoEm: new Date().toISOString(), iniciadoPor: origem })
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

    const detalhe = await sendReply(leadId, texto)
    await appendMessage(leadId, { id: crypto.randomUUID(), dir: 'out', text: texto, ts: Date.now() })
    await avancar(ctx.port, 'emContato').catch(e => console.warn('[etapa] em contato:', e))
    await agendarFollowup(leadId, Date.now())
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
