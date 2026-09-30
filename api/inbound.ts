import type { VercelRequest, VercelResponse } from '@vercel/node'
import { waitUntil } from '@vercel/functions'
import crypto from 'crypto'
import { processLead } from '../lib/agent'
import { CONFIG } from '../lib/config'
import { logExec } from '../lib/execlog'
import { appendMessage, isEchoOfSent, markHumanSpoke, seenMessage } from '../lib/history'
import { mediaKind, mediaToText, tipoPeloLink } from '../lib/media'
import { k, redis } from '../lib/redis'
import { sleep } from '../lib/kommo'
import { ESPERA_PONTE_MS, esgotarPendente, lerPendente, registrarPendente } from '../lib/ponte-midia'
import { podeResetar, resetLead } from '../lib/reset'
import { ehRespostaAutomatica } from '../lib/automatica'
import { cancelarFollowup } from '../lib/followup'
import { sendReply } from '../lib/transport'

/**
 * Webhook nativo "add_message" do Kommo (form-urlencoded, chaves em colchetes):
 *   account[id] · message[add][0][id|entity_id|contact_id|text|created_at|type]
 *   message[add][0][attachment][type|link]   (voice | picture | file)
 * 200 IMEDIATO + waitUntil (senão o Kommo reenvia).
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') return res.status(200).json({ ok: true, service: 'agente-ia-kommo', cliente: CONFIG.clientName, model: CONFIG.llmModel, gate: CONFIG.gateTag || '(todos)' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  const provided = String(req.headers['x-webhook-secret'] || req.query.secret || '')
  if (!safeEq(provided, CONFIG.webhookSecret)) return res.status(401).json({ error: 'unauthorized' })

  const parsed = parseKommoWebhook(req.body)
  if (!parsed) return res.status(200).json({ ok: false, reason: 'sem message[add]' })
  if (parsed.accountId && parsed.accountId !== CONFIG.kommoAccountId) return res.status(200).json({ ok: false, reason: 'outra conta' })

  waitUntil(ingest(parsed.msgs, crypto.randomUUID()))
  return res.status(200).json({ ok: true })
}

function safeEq(a: string, b: string): boolean {
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest())
}

/** Aviso da Kommo quando o WhatsApp Lite ainda não entregou a mídia */
export const MIDIA_PENDENTE = /mensagem de m[ií]dia|media message|aguarde o carregamento|wait for the media/i

export interface InboundMsg { id: string; leadId: number; text: string; attachType: string; attachLink: string; direction: string; bruto?: Record<string, string> }

/** Todas as chaves da mensagem i, achatadas ("message[add][0][attachment][link]" → valor). */
function achatarMsg(body: Record<string, unknown>, i: number): Record<string, string> {
  const out: Record<string, string> = {}
  const pref = `message[add][${i}]`
  for (const [k2, v] of Object.entries(body)) if (k2.startsWith(pref) && v !== null && typeof v !== 'object') out[k2] = String(v)
  const aninhado = ((body.message as Record<string, unknown> | undefined)?.add as unknown[] | undefined)?.[i]
  const rec = (o: unknown, p2: string) => {
    if (o === null || o === undefined) return
    if (typeof o !== 'object') { out[p2] = String(o); return }
    for (const [k3, v3] of Object.entries(o as Record<string, unknown>)) rec(v3, `${p2}[${k3}]`)
  }
  if (aninhado) rec(aninhado, pref)
  return out
}

function pick(body: Record<string, unknown>, flat: string, nested: Array<string | number>): string {
  const v = body[flat]
  if (v !== undefined && v !== null) return String(v)
  let cur: unknown = body
  for (const key of nested) {
    if (cur === null || typeof cur !== 'object') return ''
    cur = (cur as Record<string, unknown>)[String(key)]
  }
  return cur === undefined || cur === null ? '' : String(cur)
}

export function parseKommoWebhook(raw: unknown): { accountId: string; msgs: InboundMsg[] } | null {
  if (!raw || typeof raw !== 'object') return null
  const body = raw as Record<string, unknown>
  const msgs: InboundMsg[] = []
  for (let i = 0; i < 20; i++) {
    const p = (f: string, n: Array<string | number>) => pick(body, `message[add][${i}]${f}`, ['message', 'add', i, ...n])
    const id = p('[id]', ['id'])
    const entityId = p('[entity_id]', ['entity_id'])
    const text = p('[text]', ['text'])
    if (!id && !entityId && !text) break
    const leadId = Number(entityId)
    if (!leadId) continue
    // Mídia: o campo muda conforme o canal (attachment/media/file). Procura tipo e link em qualquer chave da mensagem.
    const plano = achatarMsg(body, i)
    const attachType = p('[attachment][type]', ['attachment', 'type']) || Object.entries(plano).find(([k2]) => /(attachment|media|file)\]\[(type|mime)/i.test(k2))?.[1] || ''
    const attachLink = p('[attachment][link]', ['attachment', 'link']) || Object.values(plano).find(v => /^https?:\/\//i.test(v) && !/\/leads\/detail\//.test(v)) || ''
    msgs.push({
      id: id || `${leadId}:${p('[created_at]', ['created_at'])}:${i}`,
      leadId, text,
      attachType,
      attachLink,
      direction: p('[type]', ['type']).toLowerCase(),
      bruto: plano,
    })
  }
  return msgs.length ? { accountId: pick(body, 'account[id]', ['account', 'id']), msgs } : null
}

async function ingest(msgs: InboundMsg[], webhookId: string): Promise<void> {
  const leads = new Set<number>()
  const pendentes: InboundMsg[] = []
  for (const m of msgs) {
    try {
      let text = (m.text || '').trim()
      // Mídia que o WhatsApp Lite ainda não liberou: a Kommo manda só um aviso ("Você recebeu uma
      // mensagem de mídia... Aguarde o carregamento"). Se depois vier o MESMO id com o arquivo, processa.
      const avisoMidia = MIDIA_PENDENTE.test(text) && !m.attachLink
      const repetida = await seenMessage(`kommo:${m.id}`)
      if (repetida && !(m.attachLink && (await redis.get(k('midia-pendente', m.id))))) continue
      if (avisoMidia || (repetida && m.attachLink)) {
        await redis.lpush(k('diag', 'midia-aviso'), JSON.stringify({ em: new Date().toISOString(), leadId: m.leadId, id: m.id, repetida, attachType: m.attachType, attachLink: m.attachLink ? m.attachLink.slice(0, 120) : '', texto: text.slice(0, 100), bruto: m.bruto })).catch(() => 0)
        await redis.ltrim(k('diag', 'midia-aviso'), 0, 29).catch(() => undefined)
        await redis.expire(k('diag', 'midia-aviso'), 7 * 86400).catch(() => undefined)
      }
      if (avisoMidia && m.direction !== 'outgoing') {
        await redis.set(k('midia-pendente', m.id), String(m.leadId), { ex: 3600 })
        // Ponte: o navegador logado (userscript) busca o arquivo no chat da Kommo e manda pra transcrever
        const b = m.bruto || {}
        const campo = (nome: string) => Object.entries(b).find(([c]) => c.endsWith(`[${nome}]`))?.[1] || ''
        await registrarPendente({ id: m.id, leadId: m.leadId, chatId: campo('chat_id'), talkId: campo('talk_id'), criadoEm: Number(campo('created_at')) || Math.floor(Date.now() / 1000), registradaEm: Date.now() })
        await cancelarFollowup(m.leadId).catch(() => undefined)
        pendentes.push(m)
        continue
      }
      const outgoing = m.direction === 'outgoing'
      const kind = mediaKind(m.attachType) || tipoPeloLink(m.attachLink) || (!text && m.attachLink ? 'audio' : null)
      if (kind && !outgoing) text = await mediaToText(kind, m.attachLink, text)
      if (m.attachLink) await redis.del(k('midia-pendente', m.id), k('midia-pend', m.id))
      if (!outgoing && (kind || !text)) {
        // Guarda o formato que a Kommo mandou (24h) para conferir mídia que não abriu
        await redis.lpush(k('diag', 'inbound-midia'), JSON.stringify({ em: new Date().toISOString(), leadId: m.leadId, attachType: m.attachType, attachLink: m.attachLink ? m.attachLink.slice(0, 120) : '', texto: text.slice(0, 120), bruto: m.bruto })).catch(() => 0)
        await redis.ltrim(k('diag', 'inbound-midia'), 0, 19).catch(() => undefined)
        await redis.expire(k('diag', 'inbound-midia'), 86400).catch(() => undefined)
      }
      // Mensagem do lead sem texto e sem mídia legível: NUNCA some calada (a Lara pede pra escrever)
      if (!text && !outgoing) text = '[o lead mandou uma mensagem sem texto (provavelmente áudio, foto ou arquivo) que não consegui abrir]'
      if (!text) continue

      // Eco do que o NOSSO bot enviou: já está no histórico
      if (await isEchoOfSent(m.leadId, text)) continue
      if (outgoing) {
        // Saída que não é nossa = humano (ou outra automação) falando: registra e recua
        await appendMessage(m.leadId, { id: `kommo:${m.id}`, dir: 'out', text, ts: Date.now() })
        await markHumanSpoke(m.leadId)
        continue
      }

      if (await podeResetar(m.leadId, text)) {
        await resetLead(m.leadId)
        await sendReply(m.leadId, '🔄 Teste reiniciado. Mande a primeira mensagem como se fosse um lead novo.')
        await logExec({ tipo: 'reset', leadId: m.leadId, detalhe: 'reset de teste' })
        continue
      }

      // Resposta automática da empresa do lead: não é ele falando. Não responde e não
      // cancela o follow-up (quem vai ler ainda não leu)
      if (ehRespostaAutomatica(text)) {
        await logExec({ tipo: 'pulou', leadId: m.leadId, detalhe: `resposta automática ignorada: ${text.slice(0, 80)}` })
        continue
      }

      await appendMessage(m.leadId, { id: `kommo:${m.id}`, dir: 'in', text, ts: Date.now() })
      // Lead respondeu: para o follow-up da Lara e o da negociação na mesma volta
      await cancelarFollowup(m.leadId).catch(e => console.warn('[inbound] cancelar follow-up:', e))
      leads.add(m.leadId)
    } catch (e) {
      console.error(`[inbound] erro ingerindo msg ${m.id}:`, e)
    }
  }
  // Mídia pendente: os outros leads seguem; esta espera o navegador entregar o arquivo (api/midia).
  // Não chegou a tempo (navegador fechado)? A Lara não responde e o Rodrigo é avisado.
  const esperas = pendentes.map(async m => {
    const limite = Date.now() + ESPERA_PONTE_MS
    while (Date.now() < limite) {
      await sleep(5000)
      if (!(await lerPendente(m.id))) return
    }
    await redis.del(k('midia-pendente', m.id))
    const esgotou = await esgotarPendente(m.id, 'o navegador com o script não entregou o arquivo a tempo')
    if (esgotou) await logExec({ tipo: 'midia', leadId: m.leadId, detalhe: 'áudio não entregue pelo navegador: time avisado' }).catch(() => undefined)
  })
  await Promise.all([...[...leads].map(leadId => processLead(leadId, webhookId)), ...esperas])
}
