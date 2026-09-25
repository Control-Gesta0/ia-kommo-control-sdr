import { rotulo } from './agenda'

/**
 * Notas visuais das ações da Lara no card (para acompanhar e para demonstração).
 * Todas começam com "⚡ LARA ·" e usam o mesmo desenho:
 *   ⚡ LARA · Primeira mensagem enviada
 *   ⏭️ Próximo follow-up: segunda 28/09 às 9h
 */
export function nota(titulo: string, linhas: Array<string | false | null | undefined | 0> = []): string {
  const corpo = linhas.filter(Boolean).join('\n')
  return `⚡ LARA · ${titulo}${corpo ? `\n${corpo}` : ''}`
}

/** "amanhã, terça 29/09 às 10h" no fuso de São Paulo */
export const quando = (ms: number, agora = Date.now()) => rotulo(ms, agora)

export const trecho = (t: string, max = 160) => {
  const s = (t || '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}
