import { CONFIG } from './config'
import { k, redis } from './redis'

/**
 * Diário de execuções: quem, quando, o que fez, quanto custou.
 * Preços USD / 1M tokens (conferidos na skill em 24/07/2026 — confira antes de
 * prometer valor). Modelo fora da tabela = custo "não medido" (null).
 */

const PRICES: Record<string, { in: number; cached: number; out: number }> = {
  'gpt-5.4-mini': { in: 0.75, cached: 0.075, out: 4.5 },
  'gpt-5.6-terra': { in: 2.5, cached: 0.25, out: 15 },
}

export interface Usage { input: number; cached: number; output: number; calls: number }

export const emptyUsage = (): Usage => ({ input: 0, cached: 0, output: 0, calls: 0 })

export function addUsage(u: Usage, raw?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } | null } | null): void {
  if (!raw) return
  u.calls++
  u.input += raw.prompt_tokens || 0
  u.cached += raw.prompt_tokens_details?.cached_tokens || 0
  u.output += raw.completion_tokens || 0
}

export function costUsd(model: string, u: Usage): number | null {
  const p = Object.entries(PRICES).find(([name]) => model.startsWith(name))?.[1]
  if (!p) return null
  const fresh = Math.max(0, u.input - u.cached)
  return Math.round(((fresh * p.in + u.cached * p.cached + u.output * p.out) / 1e6) * 1e6) / 1e6
}

export interface ExecEntry {
  at: string
  tipo: 'resposta' | 'menu' | 'finalizou' | 'pulou' | 'erro' | 'reset' | 'inicio'
  leadId: number
  nome?: string
  porta?: string
  ms?: number
  tools?: string[]
  guard?: string[]
  midia?: { audios: number; imagens: number; documentos: number }
  usage?: Usage
  custoUsd?: number | null
  urgente?: boolean
  detalhe?: string
}

export async function logExec(e: Omit<ExecEntry, 'at'>): Promise<void> {
  const entry: ExecEntry = { at: new Date().toISOString(), ...e }
  if (e.usage && e.custoUsd === undefined) entry.custoUsd = costUsd(CONFIG.llmModel, e.usage)
  try {
    await redis.lpush(k('execlog'), entry)
    await redis.ltrim(k('execlog'), 0, 1999)
  } catch (err) {
    console.error('[execlog] falha ao gravar:', err)
  }
}

export async function readExecs(limit = 100): Promise<ExecEntry[]> {
  return (await redis.lrange<ExecEntry>(k('execlog'), 0, limit - 1)) || []
}
