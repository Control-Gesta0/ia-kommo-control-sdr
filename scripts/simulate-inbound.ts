/**
 * Simula um add_message do Kommo no deploy (E2E sem WhatsApp).
 *   npx tsx scripts/simulate-inbound.ts <LEAD_ID> "mensagem"
 * O lead PRECISA ter a GATE_TAG. A resposta REAL sai pelo Salesbot para o WhatsApp do lead.
 */
import { loadEnv } from './env'

loadEnv()
const [leadId, ...rest] = process.argv.slice(2)
const text = rest.join(' ')
const url = (process.env.DEPLOY_URL || '').replace(/\/+$/, '')
if (!leadId || !text || !url) { console.error('uso: tsx scripts/simulate-inbound.ts <LEAD_ID> "texto"  (DEPLOY_URL no .env.local)'); process.exit(1) }

const body = new URLSearchParams({
  'account[id]': process.env.KOMMO_ACCOUNT_ID || '',
  'message[add][0][id]': `sim-${Date.now()}`,
  'message[add][0][entity_id]': leadId,
  'message[add][0][text]': text,
  'message[add][0][type]': 'incoming',
})
fetch(`${url}/api/inbound?secret=${encodeURIComponent(process.env.WEBHOOK_SECRET || '')}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body,
}).then(async r => console.log(r.status, await r.text()))
