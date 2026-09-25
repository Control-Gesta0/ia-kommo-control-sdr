import { local } from './agenda'
import { normalizar } from './indicacao'

/**
 * Regra do comercial: toda conversa começa com saudação + apresentação, e a
 * saudação segue o relógio de Brasília (bom dia até 12h, boa tarde até 18h,
 * boa noite depois). É CÓDIGO: o modelo recebe a saudação certa no contexto e,
 * se a abertura sair sem ela (ou com a errada), o código corrige antes de enviar.
 */
export type Idioma = 'pt' | 'es' | 'en'
export type Saudacao = string

const SAUDACOES: Record<Idioma, [string, string, string]> = {
  pt: ['Bom dia', 'Boa tarde', 'Boa noite'],
  es: ['Buenos días', 'Buenas tardes', 'Buenas noches'],
  en: ['Good morning', 'Good afternoon', 'Good evening'],
}

export function saudacao(agora: number = Date.now(), idioma: Idioma = 'pt'): Saudacao {
  const h = local(agora).h
  // "boa noite depois das 18h" vale até o amanhecer: de 0h às 4h59 ainda é boa noite
  const i = h >= 5 && h < 12 ? 0 : h >= 12 && h < 18 ? 1 : 2
  return SAUDACOES[idioma][i]
}

/**
 * Idioma da conversa: o que o cliente ESCREVEU no Comment vale mais que o campo
 * "Languages" da Kommo (que às vezes vem genérico). Sem sinal claro: português.
 */
export function idiomaDe(comentario = '', languages = ''): Idioma {
  const n = ` ${normalizar(comentario)} `
  const conta = (ws: string[]) => ws.filter(w => n.includes(` ${w} `)).length
  const es = conta(['necesitamos', 'necesito', 'queremos', 'embudo', 'ventas', 'el', 'y', 'para', 'nuestro', 'nuestra', 'mi', 'empresa', 'clientes', 'ayuda', 'configurar', 'vendedores', 'los', 'las', 'con', 'una'])
  const pt = conta(['precisamos', 'preciso', 'quero', 'funil', 'vendas', 'o', 'e', 'para', 'nosso', 'nossa', 'meu', 'minha', 'empresa', 'clientes', 'ajuda', 'configurar', 'vendedores', 'os', 'as', 'com', 'uma', 'nao', 'atendimento'])
  const en = conta(['we', 'need', 'help', 'our', 'the', 'and', 'sales', 'team', 'with', 'for', 'to', 'setup', 'set', 'up', 'want', 'my', 'company'])
  const ptPuro = conta(['nao', 'atendimento', 'funil', 'vendas', 'preciso', 'precisamos', 'quero', 'nosso', 'meu', 'o', 'e'])
  const esPuro = conta(['necesitamos', 'necesito', 'embudo', 'ventas', 'nuestro', 'nuestra', 'el', 'y', 'los', 'mi'])
  if (esPuro > ptPuro && es >= 2) return 'es'
  if (en > es && en > pt && en >= 2) return 'en'
  if (ptPuro || pt > es) return 'pt'
  const l = normalizar(languages)
  if (/spanish|espanol/.test(l) && !/portugu/.test(l)) return 'es'
  if (/english|ingles/.test(l) && !/portugu|spanish/.test(l)) return 'en'
  return 'pt'
}

/** Abertura sempre começa com a saudação CERTA do horário. */
const QUALQUER_SAUDACAO = /\b(bom dia|boa tarde|boa noite|buenos d[ií]as|buenas tardes|buenas noches|good morning|good afternoon|good evening)\b/i

export function garantirSaudacao(texto: string, s: Saudacao, nome = ''): string {
  const t = texto.trim()
  // Já cumprimenta na 1ª frase ("Oi, Ana, boa tarde!" / "Ana, bom dia!"): só acerta o horário
  const primeira = t.split(/(?<=[.!?])\s/)[0] || ''
  if (QUALQUER_SAUDACAO.test(primeira)) {
    return t.replace(QUALQUER_SAUDACAO, x => (x[0] === x[0].toUpperCase() ? s : s.toLowerCase()))
  }
  // Começou com "Oi, Ana!"/"Hola, Ana!" ou direto no assunto: põe a saudação na frente
  const semOi = t.replace(/^\s*(oi|ola|olá|hola|hi|hello)\b[^.!?\n]*[!.]\s*/i, '')
  const primeiraFrase = semOi.split(/(?<=[.!?])\s/)[0] || ''
  const citaNome = nome && normalizar(primeiraFrase).startsWith(normalizar(nome))
  return `${s}${nome && !citaNome ? `, ${nome}` : ''}! ${semOi}`.replace(/\s+/g, ' ').trim()
}

/** A abertura não pode começar com pergunta direta: a 1ª frase precisa terminar sem "?". */
export function abreComPergunta(texto: string): boolean {
  const primeira = texto.trim().split(/(?<=[.!?])\s/)[0] || ''
  return primeira.trim().endsWith('?')
}
