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

const NAO_E_NOME = new Set(['ola', 'oi', 'oie', 'opa', 'eai', 'hello', 'hi', 'bom', 'boa', 'dia', 'tarde', 'noite', 'obrigado', 'obrigada', 'valeu', 'tudo', 'bem', 'sim', 'nao', 'ok', 'okay', 'certo', 'legal', 'show', 'beleza', 'blz', 'top', 'claro', 'lara', 'kommo', 'control', 'gestao', 'eu', 'ele', 'ela', 'quem', 'aqui', 'isso', 'pode', 'quero', 'preciso', 'somos', 'sou', 'meu', 'minha', 'dono', 'dona', 'socio', 'socia', 'gestor', 'gerente', 'senhor', 'senhora', 'amigo', 'amiga'])

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
  // Saudação, resposta curta ou nome nosso não é nome de pessoa ("ola" virava "Bom dia, Olá!")
  if (NAO_E_NOME.has(normalizar(p))) return ''
  const n = p[0].toUpperCase() + p.slice(1).toLowerCase()
  return titulo ? `${titulo} ${n}` : n
}

/** Mensagem do lead que é SÓ cumprimento ("Bom dia", "Oi, tudo bem?", "Olá Lara"). */
export const SO_CUMPRIMENTO = /^(?:(?:oi+e?|ol[aá]|opa|e a[ií]|bom dia|boa tarde|boa noite|tudo bem|tudo bom|tudo certo|como vai|lara)[\s,!.?]*)+$/i

/** O lead só cumprimentou: a saudação que volta pra ele (a dele: "Bom dia" → "Bom dia"; "Oi" → "Oi"). Vazio se não é só cumprimento. */
export function cumprimentoDoLead(texto: string): string {
  const t = (texto || '').trim()
  if (!t || !SO_CUMPRIMENTO.test(t)) return ''
  const m = t.match(/bom dia|boa tarde|boa noite/i)
  if (m) return m[0][0].toUpperCase() + m[0].slice(1).toLowerCase()
  return /^ol[aá]/i.test(t) ? 'Olá' : 'Oi'
}

/**
 * O lead só disse "Bom dia" (Luiz, 02/10): a resposta devolve o cumprimento dele
 * ("Bom dia, Luiz!") em vez de entrar seca no assunto. Tira o cumprimento que o
 * modelo já tenha escrito para não duplicar.
 */
export function cumprimentarDeVolta(texto: string, cumprimento: string, nome = ''): string {
  if (!cumprimento) return texto
  const nomeRe = nome ? new RegExp(`^${nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u') : null
  let t = texto.trim()
  // "Oi, Luiz, bom dia! ..." → "..."
  for (let i = 0; i < 4; i++) {
    const antes = t
    t = t.replace(/^(?:oi+e?|ol[aá]|opa|bom dia|boa tarde|boa noite)(?![\p{L}])/iu, '').replace(/^[\s,!.]+/, '')
    if (nomeRe) t = t.replace(nomeRe, '').replace(/^[\s,!.]+/, '')
    if (t === antes) break
  }
  // O nome já vai no cumprimento: sai do resto ("Tudo bem, Luiz?" → "Tudo bem?")
  if (nome) t = t.replace(new RegExp(`,\\s*${nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[!.,?\\s]|$)`, 'u'), '')
  const abre = `${cumprimento}${nome ? `, ${nome}` : ''}!`
  return t ? `${abre} ${t[0].toUpperCase()}${t.slice(1)}` : abre
}

/** Tira "Boa tarde!"/"Oi, bom dia!" do começo (só a primeira mensagem da conversa cumprimenta). */
export function tirarSaudacao(texto: string): string {
  const t = texto.trim()
  const sem = t.replace(/^\s*(?:(?:oi|ol[aá])[,!]?\s*)?(?:bom dia|boa tarde|boa noite)\b[^.!?\n]{0,30}[!.,]?\s*/i, '')
  if (sem === t || !sem) return t
  return sem[0].toUpperCase() + sem.slice(1)
}

const REACAO_INICIO = /^(perfeito|[óo]timo|show|boa|bacana|entendi|faz sentido|ahh?,? legal|legal|certo|certinho|beleza|fechado)\b[\s,.!]*/i

/**
 * Tom natural (pedido do comercial): o nome aparece de vez em quando, não em toda
 * mensagem; reação repetida ("Entendi" de novo, "Perfeito" pela 2ª vez) SAI da
 * frase (nunca vira outra reação: "Ahh, legal" para quem reclamou soa péssimo);
 * nome de empresa nunca vira vocativo ("Certinho, TD MOTOS").
 */
export function naturalizar(texto: string, nome: string, anteriores: string[], nomeCadastro = ''): string {
  let t = texto.trim()
  const ultima = anteriores[anteriores.length - 1] || ''
  const escapa = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Nome: se a mensagem anterior já chamou pelo nome, esta não chama
  if (nome && normalizar(ultima).includes(normalizar(nome))) {
    const n = escapa(nome)
    t = t.replace(new RegExp(`,\\s*${n}(?=[!.,?\\s])`, 'u'), '').replace(new RegExp(`^${n},\\s*`, 'u'), '')
  }
  // Cadastro com nome de empresa ("MOTOS TD"): tira o vocativo com essas palavras
  if (nomeCadastro && !primeiroNomeDe(nomeCadastro)) {
    const partes = nomeCadastro.split(/[\s\-|/]+/).filter(p => p.length >= 2).map(escapa)
    if (partes.length) t = t.replace(new RegExp(`,\\s*(?:${partes.join('|')})(?:\\s+(?:${partes.join('|')}))*(?=\\s*[!.,?])`, 'giu'), '')
  }
  // Reação: não repete a da mensagem anterior e "Perfeito" só uma vez na conversa
  const m = t.match(REACAO_INICIO)
  if (m) {
    const r = normalizar(m[1])
    const repetiu = normalizar(ultima).startsWith(r) || (r === 'perfeito' && anteriores.some(a => /\bperfeito\b/i.test(a)))
    let resto = t.slice(m[0].length)
    for (const n of [nome, ...(nomeCadastro ? [primeiroNomeDe(nomeCadastro)] : [])].filter(Boolean)) {
      resto = resto.replace(new RegExp(`^${escapa(n)}[,.!]\\s*`, 'u'), '')
    }
    if (repetiu && resto.length >= 12) t = resto
  }
  return t[0] ? t[0].toUpperCase() + t.slice(1) : t
}

/** "No jurídico é bem comum...", "isso acontece bastante em clínica...", "costuma virar..." */
const GENERALIZACAO = /(?<!\p{L})(?:(?:e|é) (?:bem |muito |super |bastante )?(?:comum|t[ií]pico)|costumam? (?:acontecer|ser|virar|dar|pesar|esfriar)|acontece (?:bastante|muito|direto|sempre|demais|com frequ[eê]ncia)|isso pesa|pesa bastante)(?!\p{L})/iu

/**
 * Generalização sobre o nicho só UMA vez na conversa (pedido do comercial: repetir
 * "no jurídico é comum..." a cada mensagem cansa). Da segunda em diante a frase sai;
 * a pergunta sempre fica.
 */
export function semGeneralizacaoRepetida(texto: string, anteriores: string[]): string {
  if (!anteriores.some(a => GENERALIZACAO.test(a)) || !GENERALIZACAO.test(texto)) return texto
  const linhas = texto.split('\n').map(linha => {
    const frases = linha.split(/(?<=[.!])\s+/)
    const ficam = frases.filter(f => f.includes('?') || !GENERALIZACAO.test(f))
    return ficam.join(' ')
  }).filter(l => l.trim())
  const out = linhas.join('\n').trim()
  if (out.length < 12) return texto
  return out[0].toUpperCase() + out.slice(1)
}

/** "Aqui é a Lara, da Control Gestão..." só na primeira mensagem: nas outras a frase sai. */
export function tirarApresentacao(texto: string): string {
  const out = texto.replace(/(^|[\n.!?]\s*)(?:oi,?\s*|ol[aá],?\s*)?aqui (?:é|e) a lara\b[^.!?\n]*[.!]?\s*/giu, '$1').trim()
  if (out.length < 12) return texto
  return out[0].toUpperCase() + out.slice(1)
}

/**
 * A pergunta 1 do roteiro é SEMPRE dupla (onde organizam + quantos vendedores). Se o
 * modelo perguntou só "onde" e o nº de vendedores ainda falta, completa a pergunta.
 */
export function completarPergunta1(texto: string, faltaVendedores: boolean): string {
  if (!faltaVendedores) return texto
  const perguntas = texto.split('?').length - 1
  if (perguntas !== 1 || !/\?\s*$/.test(texto)) return texto
  const ultima = texto.slice(0, texto.lastIndexOf('?')).split(/[.!\n]/).pop() || ''
  if (!/\b(onde|organizam|whats(app)?, planilha|planilha ou|outro crm|ferramenta)\b/i.test(ultima) || /\bquant[oa]s?\b/i.test(ultima)) return texto
  return `${texto.trimEnd()} E quantos vendedores usariam o sistema?`
}

const REACOES_VOC = 'perfeito|[óo]timo|show|boa|bacana|entendi|faz sentido|ahh?,? legal|legal|certo|certinho|beleza|fechado|combinado|claro|obrigad[oa]|prazer'

/**
 * Vocativo só com o nome do LEAD: "Perfeito, Kleber" quando Kleber é o sócio (decisor)
 * vira "Perfeito". Sem nome conhecido do lead, nenhum vocativo passa.
 */
export function vocativoCerto(texto: string, nomeLead: string): string {
  const alvo = normalizar(nomeLead)
  // Sem a flag "i": com ela, \\p{Lu} aceita minúscula e "Boa tarde!" virava "Boa!"
  const reacaoOk = new RegExp(`^(?:${REACOES_VOC})$`, 'i')
  let t = texto.trim().replace(/^(\p{L}+(?:,? \p{L}+)?)([,!]?)\s+(\p{Lu}\p{Ll}+)(?=[.!,])/u, (m, reacao: string, _p: string, nome: string) =>
    reacaoOk.test(reacao) && normalizar(nome) !== alvo ? reacao : m)
  // "Kleber. Tenho amanhã..." (sobra de reação cortada): nome solto no começo que não é o do lead
  t = t.replace(/^(\p{Lu}\p{Ll}+)\.\s+/u, (m, nome: string) => (normalizar(nome) === alvo || /^(Então|Hoje|Isso|Olha|Show|Boa|Certo|Fechado|Entendi|Perfeito|Ótimo|Legal|Beleza|Combinado|Claro)$/u.test(nome) ? m : ''))
  return t[0] ? t[0].toUpperCase() + t.slice(1) : t
}

/**
 * Nome do lead desconhecido nas primeiras mensagens: pede o nome (sem interrogação,
 * antes da pergunta final, para não virar duas perguntas).
 */
export function pedirNomeSeFalta(texto: string, nomeConhecido: boolean, mensagensDaLara: number): string {
  if (nomeConhecido || mensagensDaLara > 1 || /\bnome\b/i.test(texto)) return texto
  const pedido = 'Ah, me diz seu nome pra eu te chamar direitinho.'
  const i = texto.lastIndexOf('?')
  if (i < 0) return `${texto.trimEnd()} ${pedido}`
  // início da última frase (a pergunta)
  const antes = texto.slice(0, i)
  const corte = Math.max(antes.lastIndexOf('. '), antes.lastIndexOf('! '), antes.lastIndexOf('\n'))
  if (corte < 0) return `${pedido} ${texto}`
  const sep = texto[corte] === '\n' ? '\n' : ' '
  return `${texto.slice(0, corte + 1).trimEnd()}${sep === '\n' ? '\n' : ' '}${pedido} ${texto.slice(corte + 1).trimStart()}`
}

const SOLUCAO = ['etapa', 'responsavel', 'lembrete', 'retorno', 'funil', 'relatorio', 'centraliz', 'automatic', 'alerta', 'distribui', 'historico', 'caixa de entrada']
const temas = (t: string) => { const n = normalizar(t); return new Set(SOLUCAO.filter(k => n.includes(k))) }

/**
 * A solução ("funil com etapa, responsável e lembrete") não se repete em mensagens
 * seguidas: se a mensagem anterior da Lara já descreveu, a frase repetida sai
 * (a pergunta sempre fica).
 */
export function semSolucaoRepetida(texto: string, anteriores: string[]): string {
  const ultima = temas(anteriores[anteriores.length - 1] || '')
  if (ultima.size < 2) return texto
  const linhas = texto.split('\n').map(linha => linha.split(/(?<=[.!])\s+/).filter(f => {
    if (f.includes('?')) return true
    const comum = [...temas(f)].filter(k => ultima.has(k))
    return comum.length < 2
  }).join(' ')).filter(l => l.trim())
  const out = linhas.join('\n').trim()
  if (out.length < 12) return texto
  return out[0].toUpperCase() + out.slice(1)
}

/** O lead já disse quantas pessoas usariam ("8 vendedores", "somos 7", "só eu")? */
export function mencionaQuantidade(texto: string): boolean {
  return /\b\d+\s*(vendedor|pessoa|usu[aá]rio|atendente|corretor|consultor|colaborador|funcion[aá]rio|agente|operador)|\b(somos|temos|tenho|son|tenemos)\s+\d+|\b(um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|doze|quinze|vinte)\s+(vendedor|pessoa|usu|atendente|corretor|consultor|colaborador|funcion)|\bs[oó] eu\b|\b\d+\s*(vendedores|vendedoras)\b/i.test(texto || '')
}
