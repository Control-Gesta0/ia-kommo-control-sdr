import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import { CONFIG } from '../lib/config'
import { classificarIntencao } from '../lib/intencao'

/**
 * POST /api/classificar?secret=INDICACAO_SECRET  { comentario }
 * O userscript pergunta aqui ANTES de aceitar quando o Comment é ambíguo.
 * → { teste, ambiguo, nivel, motivo, fonte: 'regra' | 'ia' }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  const secret = String(req.query.secret || req.headers['x-webhook-secret'] || '')
  if (!CONFIG.indicacaoSecret || !safeEq(secret, CONFIG.indicacaoSecret)) return res.status(401).json({ error: 'unauthorized' })
  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) || {}
  const comentario = String(body.comentario || '').slice(0, 2000)
  if (!comentario.trim()) return res.status(400).json({ error: 'comentario vazio' })
  return res.status(200).json(await classificarIntencao(comentario))
}

function safeEq(a: string, b: string): boolean {
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest())
}
