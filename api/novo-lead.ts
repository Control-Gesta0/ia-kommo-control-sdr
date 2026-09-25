import type { VercelRequest, VercelResponse } from '@vercel/node'
import { waitUntil } from '@vercel/functions'
import crypto from 'crypto'
import { CONFIG } from '../lib/config'
import { CRM_MAP } from '../lib/crm-map'
import { extrairComentario } from '../lib/indicacao'
import { guardarComentarioIncoming, iniciarConversa } from '../lib/iniciar'
import { sleep } from '../lib/kommo'

/**
 * Entrada do lead de indicação (idempotente). NÃO aceita lead: o aceite é só no
 * navegador. Aqui a IA é avisada de que o lead JÁ foi aceito e manda a 1ª mensagem.
 *
 * 1. Userscript (o caminho principal; JSON, ?secret=INDICACAO_SECRET):
 *      { leadId, comentario, origem: "userscript" }
 * 2. Reserva opcional, webhook da Kommo (form-urlencoded, ?secret=WEBHOOK_SECRET):
 *      add_unsorted    → unsorted[add][i][lead_id] + source_data: GUARDA o Comment (ainda não inicia)
 *      delete_unsorted → unsorted[delete][i][action]=accept + ...[accept_result][leads][0]: INICIA
 *      status_lead     → leads[status][i][id]: INICIA se o lead estiver na etapa de entrada
 *
 * 200 imediato (a Kommo espera resposta em até 2s) + waitUntil.
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') return res.status(200).json({ ok: true, service: 'novo-lead', cliente: CONFIG.clientName })
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  const secret = String(req.headers['x-webhook-secret'] || req.query.secret || '')
  const doWebhook = safeEq(secret, CONFIG.webhookSecret)
  const doUserscript = !!CONFIG.indicacaoSecret && safeEq(secret, CONFIG.indicacaoSecret)
  if (!doWebhook && !doUserscript) return res.status(401).json({ error: 'unauthorized' })

  const body = (typeof req.body === 'string' ? tryJson(req.body) : req.body) || {}
  const ev = parseEntrada(body)
  if (ev.accountId && ev.accountId !== CONFIG.kommoAccountId) return res.status(200).json({ ok: false, reason: 'outra conta' })

  waitUntil((async () => {
    for (const [leadId, comentario] of ev.comentariosIncoming) await guardarComentarioIncoming(leadId, comentario)
    if (!ev.iniciar.length) return
    // Webhook: dá alguns segundos para o userscript chegar com o Comment lido na tela
    if (!doUserscript) await sleep(8000)
    for (const { leadId, comentario, origem } of ev.iniciar) {
      const r = await iniciarConversa(leadId, doUserscript ? `userscript` : origem, comentario)
      console.log(`[novo-lead] lead ${leadId} via ${origem}: ${r.acao} · ${r.detalhe}`)
    }
  })())
  return res.status(200).json({ ok: true, iniciar: ev.iniciar.map(x => x.leadId), incoming: ev.comentariosIncoming.map(x => x[0]) })
}

function safeEq(a: string, b: string): boolean {
  if (!b) return false
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest())
}

function tryJson(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s) } catch { return Object.fromEntries(new URLSearchParams(s)) }
}

/** Achata {a:{b:[{c:1}]}} → {"a[b][0][c]": "1"}; chaves já planas ficam como estão. */
export function achatar(obj: unknown, prefixo = '', out: Record<string, string> = {}): Record<string, string> {
  if (obj === null || obj === undefined) return out
  if (typeof obj !== 'object') { out[prefixo] = String(obj); return out }
  for (const [key, v] of Object.entries(obj as Record<string, unknown>)) achatar(v, prefixo ? `${prefixo}[${key}]` : key, out)
  return out
}

export interface Entrada {
  accountId: string
  iniciar: Array<{ leadId: number; comentario: string | null; origem: string }>
  comentariosIncoming: Array<[number, string]>
}

export function parseEntrada(raw: Record<string, unknown>, statusEntrada = CRM_MAP.entrada.statusId): Entrada {
  const out: Entrada = { accountId: '', iniciar: [], comentariosIncoming: [] }
  // Userscript (JSON simples)
  if (raw.leadId !== undefined) {
    const leadId = Number(raw.leadId)
    if (leadId) out.iniciar.push({ leadId, comentario: typeof raw.comentario === 'string' ? raw.comentario : null, origem: String(raw.origem || 'userscript') })
    return out
  }
  const f = achatar(raw)
  out.accountId = f['account[id]'] || ''
  const add = (leadId: number, origem: string) => { if (leadId && !out.iniciar.some(x => x.leadId === leadId)) out.iniciar.push({ leadId, comentario: null, origem }) }

  // Incoming lead ADICIONADO: guarda o Comment que veio no source_data
  const itensAdd = new Set(Object.keys(f).map(k => k.match(/^unsorted\[add\]\[(\d+)\]/)?.[1]).filter((x): x is string => !!x))
  for (const i of itensAdd) {
    const pref = `unsorted[add][${i}]`
    const chaves = Object.keys(f).filter(k => k.startsWith(pref))
    const leadId = Number(f[`${pref}[lead_id]`] || f[`${pref}[data][leads][0][id]`] || 0)
    const texto = chaves.map(k => `${k.slice(pref.length).replace(/^\[|\]$/g, '').replace(/\]\[/g, '.')}: ${f[k]}`).join('\n')
    const valores = chaves.map(k => f[k]).join('\n')
    const c = extrairComentario(texto) ?? extrairComentario(valores) ?? comentarioPorChave(chaves.map(k => [k, f[k]]))
    if (leadId && c) out.comentariosIncoming.push([leadId, c])
  }

  // Incoming lead ACEITO
  for (const [key, v] of Object.entries(f)) {
    const m = key.match(/^unsorted\[delete\]\[(\d+)\]\[action\]$/)
    if (!m || v !== 'accept') continue
    for (const [k2, v2] of Object.entries(f)) {
      if (k2.startsWith(`unsorted[delete][${m[1]}][accept_result][leads]`) || /^accept_result\[leads\]\[\d+\]$/.test(k2)) add(Number(v2), 'webhook:aceite')
    }
  }
  // Mudança de etapa (o aceite leva o lead para a etapa de entrada)
  // (status_lead chega para TODO lead da conta: filtra pela etapa já no payload)
  for (const [key, v] of Object.entries(f)) {
    const m = key.match(/^leads\[(status|add)\]\[(\d+)\]\[id\]$/)
    if (!m) continue
    const st = Number(f[`leads[${m[1]}][${m[2]}][status_id]`] || 0)
    if (st && st !== statusEntrada) continue
    add(Number(v), 'webhook:etapa')
  }
  return out
}

/** Comment em chave própria: source_data[data][comment][value] = "..." */
function comentarioPorChave(pares: Array<[string, string]>): string | null {
  const hit = pares.find(([k2, v]) => /comment|coment[aá]rio/i.test(k2) && v && !/^(comment|coment[aá]rio)$/i.test(v.trim()))
  return hit ? hit[1].trim().slice(0, 2000) : null
}
