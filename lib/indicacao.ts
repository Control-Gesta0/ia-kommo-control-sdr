/**
 * Regra "é teste?" e leitura do "Comment:" no SERVIDOR.
 * A lógica mora em userscript/filtro-indicacao.js (fonte única): o navegador
 * não aceita o teste e o servidor não inicia conversa com ele, com o MESMO código.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const F = require('../userscript/filtro-indicacao.js') as {
  normalizar(s: unknown): string
  extrairComentario(texto: unknown): string | null
  classificarTeste(comentario: unknown, modo?: 'inteligente' | 'estrito'): Classificacao
}

export interface Classificacao { teste: boolean; nivel: 'frase' | 'so-lixo' | 'palavra' | 'nenhum'; motivo: string }

export const normalizar = F.normalizar
export const extrairComentario = F.extrairComentario
export const classificarTeste = (comentario: string, modo: 'inteligente' | 'estrito' = 'inteligente') => F.classificarTeste(comentario, modo)

/** Procura o "Comment:" em vários textos, na ordem. Primeiro que achar vence. */
export function acharComentario(textos: Array<string | null | undefined>): string | null {
  for (const t of textos) {
    if (!t) continue
    const c = extrairComentario(t)
    if (c !== null) return c
  }
  return null
}
