import { local } from './agenda'
import { normalizar } from './indicacao'

/**
 * Regra do comercial: toda conversa começa com saudação + apresentação, e a
 * saudação segue o relógio de Brasília (bom dia até 12h, boa tarde até 18h,
 * boa noite depois). É CÓDIGO: o modelo recebe a saudação certa no contexto e,
 * se a abertura sair sem ela (ou com a errada), o código corrige antes de enviar.
 */
export type Saudacao = 'Bom dia' | 'Boa tarde' | 'Boa noite'

/** A Control Gestão só atende em português: a saudação é sempre em português. */
export function saudacao(agora: number = Date.now()): Saudacao {
  const h = local(agora).h
  // "boa noite depois das 18h" vale até o amanhecer: de 0h às 4h59 ainda é boa noite
  return h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite'
}

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

const TITULOS: Record<string, string> = { dr: 'Dr.', dra: 'Dra.', doutor: 'Dr.', doutora: 'Dra.' }

/** Palavras que denunciam nome de empresa/lead ("Control Gestão - CRM", "MOTOS TD", "Lead №85370") */
const EMPRESA = /\b(lead|contato|cliente|empresa|ltda|me|mei|eireli|sa|s\/a|epp|crm|gestao|control|motos?|loja|lojas|comercio|servicos?|consultoria|clinica|grupo|studio|store|imoveis|imobiliaria|tech|solucoes|distribuidora|industria|agencia|marketing|digital|assessoria|advocacia|advogados|contabilidade|transportes?|auto|pecas|center|academia|restaurante|company|oficial|brasil|teste|novo|deal|comercial|vendas|atendimento|financeiro|suporte|equipe|time|whatsapp|kommo)\b/

/** Nome para chamar o lead: primeiro nome de PESSOA ("Dr. Darci Duarte" vira "Dr. Darci"). Vazio se parece empresa. */
export function primeiroNomeDe(nome: string): string {
  const bruto = (nome || '').trim()
  if (!bruto || /[\d@#№|&/_-]/.test(bruto) || EMPRESA.test(normalizar(bruto))) return ''
  const partes = bruto.split(/\s+/)
  // Sigla solta ("MOTOS TD", "JR ME") = empresa
  if (partes.some(p => /^[A-ZÀ-Ú]{2,3}$/.test(p) && !/^(DA|DE|DO|DOS|DAS|E)$/.test(p))) return ''
  const titulo = TITULOS[(partes[0] || '').toLowerCase().replace(/\.$/, '')]
  const p = (titulo ? partes[1] : partes[0]) || ''
  if (!/^[A-Za-zÀ-ú]{2,20}$/.test(p)) return ''
  const n = p[0].toUpperCase() + p.slice(1).toLowerCase()
  return titulo ? `${titulo} ${n}` : n
}

/** Tira "Boa tarde!"/"Oi, bom dia!" do começo (só a primeira mensagem da conversa cumprimenta). */
export function tirarSaudacao(texto: string): string {
  const t = texto.trim()
  const sem = t.replace(/^\s*(?:(?:oi|ol[aá])[,!]?\s*)?(?:bom dia|boa tarde|boa noite)\b[^.!?\n]{0,30}[!.,]?\s*/i, '')
  if (sem === t || !sem) return t
  return sem[0].toUpperCase() + sem.slice(1)
}

const REACOES = ['Ahh, legal', 'Ótimo', 'Show', 'Boa', 'Bacana', 'Entendi', 'Faz sentido']
const REACAO_INICIO = /^(perfeito|[óo]timo|show|boa|bacana|entendi|faz sentido|ahh?,? legal|legal|certo|beleza|fechado)\b/i

/**
 * Tom natural (pedido do comercial): o nome aparece de vez em quando, não em toda
 * mensagem, e a reação do começo varia ("Perfeito" no máximo uma vez na conversa).
 */
export function naturalizar(texto: string, nome: string, anteriores: string[]): string {
  let t = texto.trim()
  const ultima = anteriores[anteriores.length - 1] || ''
  // Nome: se a mensagem anterior já chamou pelo nome, esta não chama
  if (nome && normalizar(ultima).includes(normalizar(nome))) {
    const n = nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    t = t.replace(new RegExp(`,\\s*${n}(?=[!.,?\\s])`, 'u'), '').replace(new RegExp(`^${n},\\s*`, 'u'), '')
    t = t[0] ? t[0].toUpperCase() + t.slice(1) : t
  }
  // Reação: não repete a da mensagem anterior e "Perfeito" só uma vez na conversa
  const m = t.match(REACAO_INICIO)
  if (m) {
    const r = normalizar(m[1])
    const repetiu = normalizar(ultima).startsWith(r) || (r === 'perfeito' && anteriores.some(a => /\bperfeito\b/i.test(a)))
    if (repetiu) {
      const usadas = anteriores.slice(-3).map(a => normalizar(a).slice(0, 12))
      const nova = REACOES.find(x => !usadas.some(u => u.startsWith(normalizar(x))) && normalizar(x) !== r) || 'Entendi'
      t = nova + t.slice(m[0].length)
    }
  }
  return t
}
