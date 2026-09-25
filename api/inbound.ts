import type { VercelRequest, VercelResponse } from '@vercel/node'
import { waitUntil } from '@vercel/functions'
import crypto from 'crypto'
import { processLead } from '../lib/agent'
import { CONFIG } from '../lib/config'
import { logExec } from '../lib/execlog'
import { appendMessage, isEchoOfSent, markHumanSpoke, seenMessage } from '../lib/history'
import { mediaKind, mediaToText } from '../lib/media'
import { isResetCommand, resetLead } from '../lib/reset'
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

export interface InboundMsg { id: string; leadId: number; text: string; attachType: string; attachLink: string; direction: string }

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
    msgs.push({
      id: id || `${leadId}:${p('[created_at]', ['created_at'])}:${i}`,
      leadId, text,
      attachType: p('[attachment][type]', ['attachment', 'type']),
      attachLink: p('[attachment][link]', ['attachment', 'link']),
      direction: p('[type]', ['type']).toLowerCase(),
    })
  }
  return msgs.length ? { accountId: pick(body, 'account[id]', ['account', 'id']), msgs } : null
}

async function ingest(msgs: InboundMsg[], webhookId: string): Promise<void> {
  const leads = new Set<number>()
  for (const m of msgs) {
    try {
      if (await seenMessage(`kommo:${m.id}`)) continue
      let text = (m.text || '').trim()
      const kind = mediaKind(m.attachType)
      const outgoing = m.direction === 'outgoing'
      if (kind && !outgoing) text = await mediaToText(kind, m.attachLink, text)
      if (!text) continue

      // Eco do que o NOSSO bot enviou: já está no histórico
      if (await isEchoOfSent(m.leadId, text)) continue
      if (outgoing) {
        // Saída que não é nossa = humano (ou outra automação) falando: registra e recua
        await appendMessage(m.leadId, { id: `kommo:${m.id}`, dir: 'out', text, ts: Date.now() })
        await markHumanSpoke(m.leadId)
        continue
      }

      if (isResetCommand(m.leadId, text)) {
        await resetLead(m.leadId)
        await sendReply(m.leadId, '🔄 Teste reiniciado. Mande a primeira mensagem como se fosse um lead novo.')
        await logExec({ tipo: 'reset', leadId: m.leadId, detalhe: 'reset de teste' })
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
  await Promise.all([...leads].map(leadId => processLead(leadId, webhookId)))
}
