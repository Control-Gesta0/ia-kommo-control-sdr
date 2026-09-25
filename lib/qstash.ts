import crypto from 'crypto'

/**
 * QStash (Upstash): despertador na hora exata de cada item da fila de follow-up
 * e lembretes. A fila no Redis continua sendo a verdade; o QStash só chama
 * /api/cron?item=... no horário. O cron de 15 min fica como rede de segurança.
 *
 * QSTASH_URL, QSTASH_TOKEN, QSTASH_CURRENT_SIGNING_KEY, QSTASH_NEXT_SIGNING_KEY.
 * Destino: PUBLIC_URL, ou o domínio de produção da Vercel.
 */

const env = (k: string) => (process.env[k] || '').trim().replace(/^"|"$/g, '')
export const qstashAtivo = () => !!(env('QSTASH_TOKEN') && env('QSTASH_CURRENT_SIGNING_KEY') && urlPublica())

/** O plano grátis aceita atraso de até 7 dias: além disso, o despertador vem antes e é remarcado. */
const MAX_ATRASO_MS = 6.5 * 86400000

function urlPublica(): string {
  const u = env('PUBLIC_URL') || (env('VERCEL_PROJECT_PRODUCTION_URL') ? `https://${env('VERCEL_PROJECT_PRODUCTION_URL')}` : '')
  return u.replace(/\/+$/, '')
}

export function destino(item: string): string {
  return `${urlPublica()}/api/cron?item=${encodeURIComponent(item)}`
}

/** Agenda o despertador. Erro não derruba nada: o cron de 15 min cobre. */
export async function despertar(item: string, quando: number, agora = Date.now()): Promise<void> {
  if (!qstashAtivo()) return
  const alvo = Math.min(quando, agora + MAX_ATRASO_MS)
  const base = (env('QSTASH_URL') || 'https://qstash.upstash.io').replace(/\/+$/, '')
  const r = await fetch(`${base}/v2/publish/${destino(item)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('QSTASH_TOKEN')}`,
      'Upstash-Not-Before': String(Math.max(Math.ceil(alvo / 1000), Math.floor(agora / 1000))),
      'Upstash-Deduplication-Id': `${item}-${quando}-${alvo}`.replace(/[^\w-]/g, '_'),
      'Upstash-Retries': '3',
    },
  })
  if (!r.ok) throw new Error(`QStash publish ${r.status}: ${(await r.text()).slice(0, 200)}`)
}

const b64url = (b: Buffer) => b.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

/** Confere a assinatura (JWT HS256) do QStash: chave atual ou a próxima, destino e validade. */
export function assinaturaValida(assinatura: string, url: string, corpo = '', agora = Date.now()): boolean {
  const partes = assinatura.split('.')
  if (partes.length !== 3) return false
  const [h, p, s] = partes
  for (const chave of [env('QSTASH_CURRENT_SIGNING_KEY'), env('QSTASH_NEXT_SIGNING_KEY')].filter(Boolean)) {
    const esperado = b64url(crypto.createHmac('sha256', chave).update(`${h}.${p}`).digest())
    if (esperado.length !== s.length || !crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(s))) continue
    let c: { iss?: string; sub?: string; exp?: number; nbf?: number; body?: string }
    try { c = JSON.parse(Buffer.from(p, 'base64url').toString('utf-8')) } catch { return false }
    const seg = Math.floor(agora / 1000)
    if (c.iss !== 'Upstash' || (c.exp && seg > c.exp + 60) || (c.nbf && seg < c.nbf - 60)) return false
    if (!c.sub || !mesmoDestino(c.sub, url)) return false
    if (c.body && corpo && c.body.replace(/=+$/, '') !== b64url(crypto.createHash('sha256').update(corpo).digest())) return false
    return true
  }
  return false
}

function mesmoDestino(a: string, b: string): boolean {
  try {
    const x = new URL(a), y = new URL(b, 'https://x')
    return x.pathname === y.pathname && x.searchParams.get('item') === y.searchParams.get('item')
  } catch { return false }
}
