import crypto from 'crypto'
import { CONFIG } from './config'
import { sleep } from './kommo'
import { k, redis } from './redis'

/**
 * Buffer de 10s + eleição: rajada de mensagens vira UMA resposta.
 *  - "último webhook vence" (token)
 *  - lock com dono (compare-and-delete): retry nunca duplica
 *  - rate limit 10/min por lead: proteção de custo E de loop de eco
 */

const LOCK_TTL = 180

export interface Claim { proceed: boolean; reason: string; lockOwner?: string }

export async function debounceAndClaim(leadId: number, webhookId: string): Promise<Claim> {
  const rl = await redis.incr(k('rl', leadId))
  if (rl === 1) await redis.expire(k('rl', leadId), 60)
  if (rl > 10) return { proceed: false, reason: 'rate limit (10/min) — possível loop de eco' }

  await redis.set(k('token', leadId), webhookId, { ex: 600 })
  await sleep(CONFIG.debounceSeconds * 1000)
  if ((await redis.get<string>(k('token', leadId))) !== webhookId) return { proceed: false, reason: 'webhook mais novo assumiu' }

  const lockOwner = crypto.randomUUID()
  const locked = await redis.set(k('lock', leadId), lockOwner, { nx: true, ex: LOCK_TTL })
  if (locked !== 'OK') return { proceed: false, reason: 'lock ocupado (o dono re-checa ao final)' }
  return { proceed: true, reason: 'ok', lockOwner }
}

export async function releaseLock(leadId: number, lockOwner?: string): Promise<void> {
  if (!lockOwner) return
  await redis.eval(`if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`, [k('lock', leadId)], [lockOwner])
}

export async function renewLock(leadId: number, lockOwner: string): Promise<void> {
  await redis.eval(`if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("expire", KEYS[1], ${LOCK_TTL}) else return 0 end`, [k('lock', leadId)], [lockOwner])
}

export const currentToken = (leadId: number) => redis.get<string>(k('token', leadId))

export async function adoptToken(leadId: number, webhookId: string): Promise<void> {
  await redis.set(k('token', leadId), webhookId, { ex: 600 })
}
