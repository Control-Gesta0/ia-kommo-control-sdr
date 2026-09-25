import crypto from 'crypto'
import { k, redis } from './redis'

/**
 * Histórico da conversa no Redis (o Kommo não devolve transcript).
 * Últimas 60 mensagens, TTL 90 dias (custo zero crescente + LGPD: o dado bruto
 * morre; o que importa comercialmente fica no card).
 */

export interface ChatMsg { id: string; dir: 'in' | 'out'; text: string; ts: number }

const MAX_MSGS = 60
const TTL_S = 90 * 86400

export async function appendMessage(leadId: number, msg: ChatMsg): Promise<void> {
  const key = k('conv', leadId)
  await redis.rpush(key, JSON.stringify(msg))
  await redis.ltrim(key, -MAX_MSGS, -1)
  await redis.expire(key, TTL_S)
}

export async function getHistory(leadId: number): Promise<ChatMsg[]> {
  const raw = await redis.lrange<string | ChatMsg>(k('conv', leadId), 0, -1)
  const out: ChatMsg[] = []
  for (const r of raw) {
    try { out.push(typeof r === 'string' ? JSON.parse(r) as ChatMsg : r) } catch { /* ignora corrompida */ }
  }
  return out
}

export async function clearHistory(leadId: number): Promise<void> {
  await redis.del(k('conv', leadId))
}

export function lastInbound(msgs: ChatMsg[]): ChatMsg | null {
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].dir === 'in') return msgs[i]
  return null
}

/** true se esta mensagem JÁ foi registrada (retry de webhook) — atômico. */
export async function seenMessage(msgId: string): Promise<boolean> {
  return (await redis.set(k('seen', msgId), '1', { nx: true, ex: 7 * 86400 })) !== 'OK'
}

export async function alreadyAnswered(leadId: number, inboundId: string): Promise<boolean> {
  return (await redis.get<string>(k('done', leadId))) === inboundId
}

export async function markAnswered(leadId: number, inboundId: string): Promise<void> {
  await redis.set(k('done', leadId), inboundId, { ex: 86400 })
}

// ---------- Anti-eco (o add_message dispara também para o que o bot enviou) ----------

const hash = (text: string) => crypto.createHash('sha1').update(text.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16)

export async function rememberSent(leadId: number, text: string): Promise<void> {
  await redis.sadd(k('sent', leadId), hash(text))
  await redis.expire(k('sent', leadId), 86400)
}

export async function isEchoOfSent(leadId: number, text: string): Promise<boolean> {
  return (await redis.sismember(k('sent', leadId), hash(text))) === 1
}

// ---------- Humano falando pelo Kommo: a IA recua ----------

const HUMANO_TTL = 6 * 3600

export async function markHumanSpoke(leadId: number): Promise<void> {
  await redis.set(k('humano', leadId), String(Date.now()), { ex: HUMANO_TTL })
}

export async function humanSpokeRecently(leadId: number): Promise<boolean> {
  return !!(await redis.get(k('humano', leadId)))
}
