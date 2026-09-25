import { local } from './agenda'
import { normalizar } from './indicacao'

/**
 * Regra do comercial: toda conversa começa com saudação + apresentação, e a
 * saudação segue o relógio de Brasília (bom dia até 12h, boa tarde até 18h,
 * boa noite depois). É CÓDIGO: o modelo recebe a saudação certa no contexto e,
 * se a abertura sair sem ela (ou com a errada), o código corrige antes de enviar.
 */
export type Saudacao = 'Bom dia' | 'Boa tarde' | 'Boa noite'

export function saudacao(agora: number = Date.now()): Saudacao {
  const h = local(agora).h
  // "boa noite depois das 18h" vale até o amanhecer: de 0h às 4h59 ainda é boa noite
  return h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite'
}

/** Abertura sempre começa com a saudação CERTA do horário. */
export function garantirSaudacao(texto: string, s: Saudacao, nome = ''): string {
  const t = texto.trim()
  // Já cumprimenta na 1ª frase ("Oi, Ana, boa tarde!" / "Ana, bom dia!"): só acerta o horário
  const primeira = t.split(/(?<=[.!?])\s/)[0] || ''
  if (/\b(bom dia|boa tarde|boa noite)\b/i.test(primeira)) {
    return t.replace(/\b(bom dia|boa tarde|boa noite)\b/i, x => (x[0] === x[0].toUpperCase() ? s : s.toLowerCase()))
  }
  // Começou com "Oi, Ana!" ou direto no assunto: põe a saudação na frente
  const semOi = t.replace(/^\s*(oi|ola|olá)\b[^.!?\n]*[!.]\s*/i, '')
  const primeiraFrase = semOi.split(/(?<=[.!?])\s/)[0] || ''
  const citaNome = nome && normalizar(primeiraFrase).startsWith(normalizar(nome))
  return `${s}${nome && !citaNome ? `, ${nome}` : ''}! ${semOi}`.replace(/\s+/g, ' ').trim()
}

/** A abertura não pode começar com pergunta direta: a 1ª frase precisa terminar sem "?". */
export function abreComPergunta(texto: string): boolean {
  const primeira = texto.trim().split(/(?<=[.!?])\s/)[0] || ''
  return primeira.trim().endsWith('?')
}
