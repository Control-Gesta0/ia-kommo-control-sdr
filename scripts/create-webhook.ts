/**
 * Cria os webhooks VIA API (no UI é onde se erra o filtro e nasce o eco).
 *   npx tsx scripts/create-webhook.ts            → só LISTA os webhooks atuais
 *   npx tsx scripts/create-webhook.ts --criar    → cria DEPLOY_URL/api/inbound ← add_message
 *       (é só assim que a IA ESCUTA o lead responder; não aceita nem mexe em lead)
 *   ... --criar --reserva-indicacao              → também cria /api/novo-lead ← status_lead
 *       (reserva opcional para iniciar a conversa se o aviso do userscript falhar.
 *        O ACEITE continua só no navegador: a Kommo invalida indicação aceita por API)
 *
 * Ação externa: confirme com o responsável antes de --criar. Não remove nenhum
 * webhook existente (a desativação do sistema antigo é um passo separado e humano-aprovado).
 */
import { loadEnv } from './env'

loadEnv()
const domain = (process.env.KOMMO_DOMAIN || '').replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://')
const headers = { Authorization: `Bearer ${process.env.KOMMO_TOKEN}`, 'Content-Type': 'application/json' }

async function main() {
  const atual = await fetch(`${domain}/api/v4/webhooks`, { headers }).then(r => r.status === 204 ? {} : r.json()) as any
  for (const h of atual._embedded?.webhooks || []) console.log(`${h.id} · ${h.destination} · ${JSON.stringify(h.settings)}`)
  if (!process.argv.includes('--criar')) return
  const base = (process.env.DEPLOY_URL || '').replace(/\/+$/, '')
  const alvos: Array<[string, string[]]> = [[`${base}/api/inbound?secret=${process.env.WEBHOOK_SECRET}`, ['add_message']]]
  if (process.argv.includes('--reserva-indicacao')) alvos.push([`${base}/api/novo-lead?secret=${process.env.WEBHOOK_SECRET}`, ['status_lead']])
  for (const [destination, settings] of alvos) {
    const r = await fetch(`${domain}/api/v4/webhooks`, { method: 'POST', headers, body: JSON.stringify({ destination, settings }) })
    console.log(`criado ${settings.join(',')}:`, r.status, (await r.text()).slice(0, 300))
  }
}
main()
