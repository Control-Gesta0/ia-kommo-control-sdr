import type { VercelRequest, VercelResponse } from '@vercel/node'
import { CONFIG } from '../lib/config'
import { readExecs } from '../lib/execlog'

/** GET /api/executions?secret=XXX&limit=100[&tipo=erro] — o diário. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (String(req.query.secret || '') !== CONFIG.webhookSecret) return res.status(401).json({ error: 'unauthorized' })
  const limit = Math.min(Number(req.query.limit || 100), 2000)
  const tipo = req.query.tipo ? String(req.query.tipo) : ''
  const execs = (await readExecs(limit)).filter(e => !tipo || e.tipo === tipo)
  const custo = execs.reduce((s, e) => s + (e.custoUsd || 0), 0)
  return res.status(200).json({
    ok: true,
    total: execs.length,
    custoUsdSomado: Math.round(custo * 10000) / 10000,
    naoMedidos: execs.filter(e => e.usage && e.custoUsd === null).length,
    urgentes: execs.filter(e => e.urgente).map(e => ({ at: e.at, leadId: e.leadId, nome: e.nome, porta: e.porta })),
    execs,
  })
}
