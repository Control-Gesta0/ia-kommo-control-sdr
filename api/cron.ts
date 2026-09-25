import type { VercelRequest, VercelResponse } from '@vercel/node'
import { brain } from '../lib/agent'
import { CONFIG } from '../lib/config'
import { portaById, CRM_MAP } from '../lib/crm-map'
import { filaResumo, pegarItem, processarItem, varrerNegociacao, vencidos } from '../lib/followup'
import { getHistory } from '../lib/history'
import { getContact, getLead } from '../lib/kommo'
import { kommoPort } from '../lib/port'
import { assinaturaValida } from '../lib/qstash'

/**
 * Relógio do follow-up (Vercel Cron a cada 15 min; Authorization: Bearer CRON_SECRET).
 * POST ?item=... assinado pelo QStash: processa só aquele item, na hora exata.
 * GET ?secret=WEBHOOK_SECRET&ver=1 mostra a fila sem executar nada.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = String(req.headers.authorization || '')
  const okCron = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`
  const okManual = String(req.query.secret || '') === CONFIG.webhookSecret
  const assinatura = String(req.headers['upstash-signature'] || '')
  const corpo = typeof req.body === 'string' ? req.body : ''
  const okQstash = !!assinatura && !!req.query.item && assinaturaValida(assinatura, req.url || '', corpo)
  if (!okCron && !okManual && !okQstash) return res.status(401).json({ error: 'unauthorized' })
  if (okManual && req.query.ver) return res.status(200).json({ ok: true, fila: await filaResumo() })

  const porta = portaById(CRM_MAP.menu.portaUnica)!
  const gerar = async (leadId: number, instrucao: string) => {
    const lead = await getLead(leadId)
    const contatoId = (lead._embedded?.contacts || []).find(c => c.is_main)?.id
    const nome = contatoId ? (await getContact(contatoId)).name || lead.name || '' : lead.name || ''
    const history = await getHistory(leadId)
    const ctx = { port: kommoPort(leadId), porta, gateTag: CONFIG.gateTag, leadText: '', lastLeadText: '', lastAgentText: '' }
    return brain.generateFollowup(ctx, { nomeContato: nome, primeiroContatoDaPorta: false }, history, instrucao)
  }

  // Sem o Salesbot de envio nada pode sair: não consome a fila (os itens esperam o bot existir)
  if (!CONFIG.kommoBotId) return res.status(200).json({ ok: true, aguardando: 'KOMMO_BOT_ID ausente: fila preservada, nada enviado', fila: (await filaResumo()).length })

  if (okQstash) {
    const item = String(req.query.item)
    const claim = await pegarItem(item)
    if (claim !== 'processar') return res.status(200).json({ ok: true, item, claim })
    // Erro aqui não volta para a fila (igual ao cron): 200 para o QStash não repetir o envio
    try { return res.status(200).json({ ok: true, item, feito: await processarItem(item, gerar) }) } catch (e) {
      return res.status(200).json({ ok: false, item, erro: e instanceof Error ? e.message : String(e) })
    }
  }

  const t0 = Date.now()
  const feitos: string[] = []
  let novosNeg = 0
  try { novosNeg = await varrerNegociacao() } catch (e) { feitos.push(`varredura negociação: ${e instanceof Error ? e.message : e}`) }
  for (const item of await vencidos()) {
    if (Date.now() - t0 > 240_000) break
    try { feitos.push(`${item}: ${await processarItem(item, gerar)}`) } catch (e) { feitos.push(`${item}: ERRO ${e instanceof Error ? e.message : e}`) }
  }
  return res.status(200).json({ ok: true, novosNaNegociacao: novosNeg, feitos, ms: Date.now() - t0 })
}
