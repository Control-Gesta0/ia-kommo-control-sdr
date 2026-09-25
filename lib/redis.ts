import { Redis } from '@upstash/redis'
import { CONFIG } from './config'

/**
 * Redis é o dono do histórico nesta variante. Database compartilhado entre
 * clientes (Upstash free = 1 DB): TODA chave passa por k() com o prefixo do
 * cliente — nunca escreva chave "na mão".
 */
export const redis = new Redis({ url: CONFIG.upstashUrl, token: CONFIG.upstashToken })

export const k = (...parts: Array<string | number>) => `${CONFIG.redisPrefix}${parts.join(':')}`
