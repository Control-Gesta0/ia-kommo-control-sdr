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
  foraDoIdioma(texto: unknown, comentario: unknown): { fora: boolean; motivo: string }
}

export interface Classificacao { teste: boolean; ambiguo: boolean; nivel: 'frase' | 'so-lixo' | 'palavra' | 'nenhum'; motivo: string; fonte?: 'regra' | 'ia' }

export const normalizar = F.normalizar
export const extrairComentario = F.extrairComentario
export const foraDoIdioma = F.foraDoIdioma
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

export interface ContextoIndicacao { pais?: string; idiomas?: string; segmento?: string }

/**
 * A nota da indicação traz, antes do Comment, linhas "Country: Brazil",
 * "Languages: Portuguese", "Industry: Retail & ecommerce". Viram contexto para a
 * Lara (segmento para o rapport, idioma da conversa).
 */
export function extrairContexto(texto: string): ContextoIndicacao {
  const t = String(texto || '').replace(/&amp;/g, '&')
  const campo = (re: RegExp) => (t.match(re)?.[1] || '').trim().slice(0, 80) || undefined
  return {
    pais: campo(/(?:^|\n)\s*Country:\s*([^\n]+)/i),
    idiomas: campo(/(?:^|\n)\s*Languages?:\s*([^\n]+)/i),
    segmento: campo(/(?:^|\n)\s*Industry:\s*([^\n]+)/i),
  }
}

/** Marcas que a Kommo põe no lead quando o aceite não valeu. */
export function marcaDeInvalido(texto: string): 'cedo' | 'outros' | null {
  const t = String(texto || '').toLowerCase()
  if (t.includes('no longer available')) return 'cedo'
  if (t.includes('already been accepted') || t.includes('accepted by other partners')) return 'outros'
  return null
}
