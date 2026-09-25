import type { VercelRequest, VercelResponse } from '@vercel/node'
import { CONFIG } from '../lib/config'
import { getOutbox } from '../lib/transport'

/**
 * Callback do widget-request (bot montado na opção 1 do PLAYBOOK).
 * Bot com "Enviar mensagem" lendo o campo de resposta NÃO usa este endpoint.
 * Outbox vazio → execute_handlers vazio: melhor silêncio explicado que mensagem em branco.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true, service: 'salesbot-callback' })
  if (String(req.query.secret || '') !== CONFIG.webhookSecret) return res.status(401).json({ error: 'unauthorized' })

  const body = (req.body || {}) as Record<string, unknown>
  const leadId = Number(body['data[lead_id]'] ?? (body.data as Record<string, unknown> | undefined)?.lead_id ?? body.lead_id ?? 0)
  const returnUrl = String(body.return_url || '')
  if (!leadId || !returnUrl.startsWith('http')) return res.status(200).json({ ok: false })

  const text = (await getOutbox(leadId)) || ''
  if (!text) console.warn(`[salesbot] outbox vazio pro lead ${leadId} (run atrasado ou duplicado?)`)
  try {
    const r = await fetch(returnUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CONFIG.kommoToken}` },
      body: JSON.stringify({
        data: { resposta_ia: text },
        execute_handlers: text ? [{ handler: 'goto', params: { type: 'question', step: 1 } }] : [],
      }),
    })
    if (!r.ok) console.error(`[salesbot] return_url -> ${r.status}: ${(await r.text()).slice(0, 200)}`)
  } catch (e) {
    console.error('[salesbot] falha no return_url:', e)
  }
  return res.status(200).json({ ok: true })
}
