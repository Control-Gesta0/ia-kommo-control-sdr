import { processLead } from './agent'
import { CRM_MAP } from './crm-map'
import { cancelarFollowup } from './followup'
import { appendMessage } from './history'
import { getContact, getLead, kommoGet } from './kommo'
import { k, redis } from './redis'
import { sendReply } from './transport'

/**
 * Ponte de mídia do WhatsApp Lite.
 * O webhook do Lite traz só o aviso "Você recebeu uma mensagem de mídia... Aguarde o carregamento",
 * sem o arquivo, e a API oficial não lê o chat. O áudio fica no chat da Kommo (amojo), que só
 * a sessão do navegador acessa. Então:
 *   1. inbound registra a mídia pendente aqui;
 *   2. o userscript (navegador logado) consulta GET /api/midia, acha a mensagem no chat,
 *      baixa o arquivo e manda os bytes em POST /api/midia;
 *   3. o servidor transcreve e a Lara responde ao conteúdo;
 *   4. se o navegador não entregar a tempo, o Rodrigo é avisado e a Lara NÃO responde
 *      (nada de "não consegui ouvir").
 */

export interface MidiaPendente { id: string; leadId: number; chatId: string; talkId: string; criadoEm: number; registradaEm: number }

const TTL_S = 15 * 60
/** Quanto a Lara espera o navegador entregar a mídia antes de chamar o time */
export const ESPERA_PONTE_MS = 4 * 60 * 1000

export async function registrarPendente(p: MidiaPendente): Promise<void> {
  await redis.set(k('midia-pend', p.id), JSON.stringify(p), { ex: TTL_S })
  await redis.sadd(k('midias-pend'), p.id)
}

export async function lerPendente(id: string): Promise<MidiaPendente | null> {
  const v = await redis.get<MidiaPendente | string>(k('midia-pend', id))
  if (!v) return null
  return typeof v === 'string' ? (JSON.parse(v) as MidiaPendente) : v
}

export async function listarPendentes(): Promise<MidiaPendente[]> {
  const ids = ((await redis.smembers(k('midias-pend'))) || []).map(String)
  const out: MidiaPendente[] = []
  for (const id of ids) {
    const p = await lerPendente(id)
    if (p) out.push(p)
    else await redis.srem(k('midias-pend'), id)
  }
  return out
}

/** Só quem apaga a chave processa (navegador x tempo esgotado nunca respondem os dois). */
async function tomarPendente(id: string): Promise<MidiaPendente | null> {
  const p = await lerPendente(id)
  if (!p) return null
  const apagou = await redis.del(k('midia-pend', id))
  await redis.srem(k('midias-pend'), id)
  return apagou ? p : null
}

/** Mídia entregue e lida: entra no histórico e a Lara responde ao conteúdo. */
export async function resolverPendente(id: string, texto: string, webhookId: string): Promise<boolean> {
  const p = await tomarPendente(id)
  if (!p) return false
  await appendMessage(p.leadId, { id: `kommo:${id}`, dir: 'in', text: texto, ts: Date.now() })
  await cancelarFollowup(p.leadId).catch(() => undefined)
  await processLead(p.leadId, webhookId)
  return true
}

/** O navegador não entregou: a Lara fica quieta e o Rodrigo ouve o áudio no card. */
export async function esgotarPendente(id: string, motivo: string): Promise<boolean> {
  const p = await tomarPendente(id)
  if (!p) return false
  await appendMessage(p.leadId, { id: `kommo:${id}`, dir: 'in', text: '[o lead mandou um áudio; o especialista vai ouvir e responder]', ts: Date.now() })
  await cancelarFollowup(p.leadId).catch(() => undefined)
  await avisarTimeAudio(p.leadId, motivo).catch(e => console.warn('[aviso áudio]', e))
  return true
}

async function avisarTimeAudio(leadId: number, motivo: string): Promise<void> {
  const alvo = CRM_MAP.avisoCloser.leadId
  if (!alvo || alvo === leadId) return
  if ((await redis.set(k('aviso-audio', leadId), 1, { nx: true, ex: 7200 })) !== 'OK') return
  const lead = await getLead(leadId).catch(() => null)
  const contatoId = (lead?._embedded?.contacts || []).find(c => c.is_main)?.id
  const nome = (contatoId ? (await getContact(contatoId).catch(() => null))?.name : '') || lead?.name || `Lead #${leadId}`
  await sendReply(alvo, `✉️ *Áudio para você ouvir*\n\n${nome} mandou um áudio e a Lara não conseguiu pegar o arquivo (${motivo}). Ela não respondeu.\nOuça no card e responda por lá:\n\n➡️ https://controlgestao.kommo.com/leads/detail/${leadId}`)
}

/** Id do chat da conta (amojo), que o navegador usa para ler as mensagens. */
export async function amojoIdDaConta(): Promise<string> {
  const cache = await redis.get<string>(k('amojo-id'))
  if (cache) return String(cache)
  const conta = await kommoGet<{ amojo_id?: string }>('/api/v4/account?with=amojo_id').catch(() => null)
  const id = conta?.amojo_id || ''
  if (id) await redis.set(k('amojo-id'), id, { ex: 7 * 86400 })
  return id
}

export async function registrarDiagPonte(dado: unknown): Promise<void> {
  await redis.lpush(k('diag', 'ponte-midia'), JSON.stringify({ em: new Date().toISOString(), dado }).slice(0, 20000)).catch(() => 0)
  await redis.ltrim(k('diag', 'ponte-midia'), 0, 29).catch(() => undefined)
  await redis.expire(k('diag', 'ponte-midia'), 7 * 86400).catch(() => undefined)
}
