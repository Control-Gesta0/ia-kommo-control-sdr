/**
 * AGENDA — arquivo puro (sem env, sem rede) para rodar em `npm test`.
 *
 * O Kommo não tem API de calendário. O desenho aqui:
 *  - OCUPADO = tarefas abertas do closer no Kommo (+ free/busy do Google, se configurado);
 *  - LIVRE   = expediente do crm-map menos o ocupado, com antecedência mínima;
 *  - a IA OFERECE opções geradas em código e gravadas no estado do lead;
 *  - a ESCOLHA do lead é resolvida em código contra a oferta gravada (nunca "outro
 *    dia com a mesma hora" — comum/PEGADINHAS §47) e revalidada antes de criar;
 *  - o evento nasce como TAREFA de reunião no Kommo; a integração Kommo ↔ Google
 *    Agenda leva para o calendário do closer.
 *
 * Fuso: America/Sao_Paulo (UTC-3, sem horário de verão desde 2019).
 */
import { normalizar } from './indicacao'

export const TZ = 'America/Sao_Paulo'
const OFFSET_H = 3 // UTC = local + 3h

export interface Intervalo { ini: number; fim: number } // ms epoch

export interface AgendaConfig {
  /** false = as tools de agenda nem aparecem para o modelo */
  ativa: boolean
  /** user_id do closer no Kommo (dono da agenda) */
  responsavelId: number
  /** 2 = "Reunião" no Kommo (confirme em /api/v4/tasks... pelo discover) */
  taskTypeId: number
  duracaoMin: number
  /** de quanto em quanto tempo nasce um horário (30 = 9h, 9h30, 10h...) */
  passoMin: number
  /** quantos dias úteis para a frente a IA oferece */
  diasUteisJanela: number
  /** não oferece horário que começa antes de agora + N horas */
  antecedenciaMinHoras: number
  expediente: { dias: number[]; inicio: string; fim: string; pausas?: Array<[string, string]> }
  /** horários de início preferidos do closer ("10:00"...). Definido = só esses são oferecidos */
  horarios?: string[]
  /** quantas opções a IA oferece por vez */
  maxOpcoes: number
  /** folga entre reuniões (min) aplicada em volta do ocupado */
  folgaMin: number
}

export interface Slot { ini: number; fim: number; label: string }

// ---------- relógio local ----------

const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false })
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export interface Local { y: number; m: number; d: number; h: number; min: number; wd: number }

export function local(ms: number): Local {
  const p: Record<string, string> = {}
  for (const x of fmt.formatToParts(new Date(ms))) p[x.type] = x.value
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, wd: WD[p.weekday] }
}

export function fromLocal(y: number, m: number, d: number, h = 0, min = 0): number {
  return Date.UTC(y, m - 1, d, h + OFFSET_H, min)
}

const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0) }
const diaKey = (l: Local) => `${l.y}-${l.m}-${l.d}`
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

export function rotulo(ms: number, agora: number): string {
  const l = local(ms)
  const hoje = local(agora)
  const amanha = local(fromLocal(hoje.y, hoje.m, hoje.d, 12) + 86400000)
  const rel = diaKey(l) === diaKey(hoje) ? 'hoje, ' : diaKey(l) === diaKey(amanha) ? 'amanhã, ' : ''
  const hora = l.min ? `${l.h}h${String(l.min).padStart(2, '0')}` : `${l.h}h`
  return `${rel}${DIAS[l.wd]} ${String(l.d).padStart(2, '0')}/${String(l.m).padStart(2, '0')} às ${hora}`
}

// ---------- horários livres ----------

export function gerarLivres(agora: number, cfg: AgendaConfig, ocupados: Intervalo[]): Slot[] {
  const out: Slot[] = []
  const dur = cfg.duracaoMin * 60000
  const folga = cfg.folgaMin * 60000
  const minIni = agora + cfg.antecedenciaMinHoras * 3600000
  const hoje = local(agora)
  let diasUteis = 0
  for (let i = 0; i < 31 && diasUteis < cfg.diasUteisJanela; i++) {
    const dia = local(fromLocal(hoje.y, hoje.m, hoje.d, 12) + i * 86400000)
    if (!cfg.expediente.dias.includes(dia.wd)) continue
    diasUteis++
    for (let t = hm(cfg.expediente.inicio); t + cfg.duracaoMin <= hm(cfg.expediente.fim); t += cfg.passoMin) {
      if ((cfg.expediente.pausas || []).some(([a, b]) => t < hm(b) && t + cfg.duracaoMin > hm(a))) continue
      if (cfg.horarios?.length && !cfg.horarios.some(h => hm(h) === t)) continue
      const ini = fromLocal(dia.y, dia.m, dia.d, Math.floor(t / 60), t % 60)
      const fim = ini + dur
      if (ini < minIni) continue
      if (ocupados.some(o => ini < o.fim + folga && fim > o.ini - folga)) continue
      out.push({ ini, fim, label: rotulo(ini, agora) })
    }
  }
  return out
}

// ---------- preferência do lead ("terça à tarde", "a partir das 16h") ----------

export interface Preferencia { dias?: number[]; datas?: string[]; aPartirDeMin?: number; ateMin?: number; turno?: 'manha' | 'tarde' }

const RE_DIA_SEMANA: Array<[RegExp, number]> = [
  [/\bseg(unda)?( feira)?\b/, 1], [/\bter(ca)?( feira)?\b/, 2], [/\bqua(rta)?( feira)?\b/, 3],
  [/\bqui(nta)?( feira)?\b/, 4], [/\bsex(ta)?( feira)?\b/, 5], [/\bsab(ado)?\b/, 6], [/\bdom(ingo)?\b/, 0],
]

export function parsePreferencia(texto: string, agora: number): Preferencia {
  // "segunda opção" é ordinal, não dia da semana
  const n = normalizar(texto).replace(/\b(primeira|segunda|terceira) (opcao|op|horario|alternativa)\b/g, ' ')
  const pref: Preferencia = {}
  const dias = RE_DIA_SEMANA.filter(([re]) => re.test(n)).map(([, d]) => d)
  if (dias.length) pref.dias = dias
  const hoje = local(agora)
  const base = fromLocal(hoje.y, hoje.m, hoje.d, 12)
  const datas: string[] = []
  if (/\bdepois de amanha\b/.test(n)) datas.push(diaKey(local(base + 2 * 86400000)))
  else if (/\bamanha\b/.test(n)) datas.push(diaKey(local(base + 86400000)))
  if (/\bhoje\b/.test(n)) datas.push(diaKey(hoje))
  const diaN = n.match(/\bdia (\d{1,2})\b/)
  if (diaN) {
    const d = Number(diaN[1])
    for (let i = 0; i < 40; i++) { const l = local(base + i * 86400000); if (l.d === d) { datas.push(diaKey(l)); break } }
  }
  if (datas.length) pref.datas = datas
  if (/\bmanha\b/.test(n)) pref.turno = 'manha'
  else if (/\btarde\b/.test(n)) pref.turno = 'tarde'
  const aPartir = n.match(/\b(a partir d[ae]s?|depois d[ae]s?|apos as?|mais tarde que|so consigo d[ae]pois d[ae]s?)\s*(\d{1,2})\s*(?:h(?:oras?)?)?\s*(\d{2})?\b/)
  if (aPartir) pref.aPartirDeMin = Number(aPartir[2]) * 60 + Number(aPartir[3] || 0) + (/depois|apos|mais tarde/.test(aPartir[1]) ? 1 : 0)
  const ate = n.match(/\b(ate as?|antes d[ae]s?)\s*(\d{1,2})\s*(?:h(?:oras?)?)?\s*(\d{2})?\b/)
  if (ate) pref.ateMin = Number(ate[2]) * 60 + Number(ate[3] || 0)
  return pref
}

function atende(s: Slot, p: Preferencia): boolean {
  const l = local(s.ini)
  const t = l.h * 60 + l.min
  if (p.dias && !p.dias.includes(l.wd)) return false
  if (p.datas && !p.datas.includes(diaKey(l))) return false
  if (p.turno === 'manha' && t >= 12 * 60) return false
  if (p.turno === 'tarde' && t < 12 * 60) return false
  if (p.aPartirDeMin !== undefined && t < p.aPartirDeMin) return false
  if (p.ateMin !== undefined && t >= p.ateMin) return false
  return true
}

/**
 * Escolhe as opções a oferecer: respeita a preferência; sem preferência, espalha
 * (o mais cedo, depois outro dia/turno) para o lead ter escolha de verdade.
 */
export function escolherOpcoes(livres: Slot[], pref: Preferencia, max: number): { opcoes: Slot[]; respeitouPreferencia: boolean } {
  const temPref = Object.keys(pref).length > 0
  const filtrados = temPref ? livres.filter(s => atende(s, pref)) : livres
  const base = filtrados.length ? filtrados : livres
  const opcoes: Slot[] = []
  const usados = new Set<string>()
  for (const s of base) {
    const l = local(s.ini)
    const chave = `${diaKey(l)}-${l.h < 12 ? 'm' : 't'}`
    if (usados.has(chave)) continue
    usados.add(chave)
    opcoes.push(s)
    if (opcoes.length >= max) break
  }
  for (const s of base) { if (opcoes.length >= max) break; if (!opcoes.includes(s)) opcoes.push(s) }
  opcoes.sort((a, b) => a.ini - b.ini)
  return { opcoes, respeitouPreferencia: !temPref || filtrados.length > 0 }
}

// ---------- a escolha do lead, resolvida em código ----------

const AFIRMATIVO = /^(sim|pode ser|pode|fechado|combinado|ok|okay|beleza|blz|perfeito|otimo|isso|esse|essa|serve|da sim|consigo|marcado|bora|vamos|confirmo|confirmado|show|tranquilo|certo)\b/

export function ehAfirmativo(texto: string): boolean {
  return AFIRMATIVO.test(normalizar(texto))
}

/** Hora que o lead citou: "10h", "10:30", "às 9", "meio dia", número seco 7–20. */
export function horaCitada(texto: string): number | null {
  const n = normalizar(texto)
  if (/\bmeio dia\b/.test(n)) return 12 * 60
  const m = n.match(/\b(\d{1,2})\s*(?:h|horas?)\s*(\d{2})?\b/) || n.match(/\b(\d{1,2}) (\d{2})\b/)
  if (m) { const h = Number(m[1]); if (h <= 23) return h * 60 + Number(m[2] || 0) }
  const seco = n.match(/\b(?:as|a|para|pras?|pelas?)?\s*(\d{1,2})\b(?! ?(?:\/|de [a-z]|dias?|anos?|pessoas|usuarios|vendedores))/)
  if (seco) { const h = Number(seco[1]); if (h >= 7 && h <= 20) return h * 60 }
  return null
}

/**
 * Qual slot da OFERTA o texto escolhe. null = ambíguo ou fora da oferta
 * (nunca troca por outro dia com a mesma hora).
 */
export function resolverEscolha(texto: string, oferta: Slot[], agora: number): Slot | null {
  if (!oferta.length || !texto.trim()) return null
  const n = normalizar(texto)
  // com borda de palavra: "9h" não pode casar dentro de "9h30"
  const exato = oferta.find(s => ` ${n} `.includes(` ${normalizar(s.label)} `))
  if (exato) return exato
  const pref = parsePreferencia(texto, agora)
  const hora = horaCitada(texto.replace(/\bdia \d{1,2}\b/gi, ' '))
  let cand = oferta
  if (pref.dias || pref.datas) cand = cand.filter(s => atende(s, { dias: pref.dias, datas: pref.datas }))
  if (hora !== null) cand = cand.filter(s => { const l = local(s.ini); return l.h * 60 + l.min === hora })
  if (hora !== null || pref.dias || pref.datas) return cand.length === 1 ? cand[0] : null
  const ORD: Record<string, number> = { primeir: 0, segund: 1, terceir: 2 }
  const num = n.match(/\b(?:opcao|op|alternativa|horario)\s*(\d)\b/)
  if (num) return oferta[Number(num[1]) - 1] || null
  const o = n.match(/\b(primeir|segund|terceir|ultim)[oa]\s*(?:opcao|horario|alternativa)\b/) || n.match(/^(?:a|o|pode ser a|pode ser o|prefiro a|prefiro o|fico com a|fico com o)\s+(primeir|ultim)[oa]\b/)
  if (o) return oferta[o[1] === 'ultim' ? oferta.length - 1 : ORD[o[1]]] || null
  return null
}

/** Os slots da oferta que aparecem escritos na mensagem da IA (para "pode ser" depois de UMA sugestão). */
export function slotsCitados(textoIa: string, oferta: Slot[]): Slot[] {
  const n = normalizar(textoIa)
  return oferta.filter(s => {
    const l = local(s.ini)
    const horaTxt = l.min ? `${l.h}h${String(l.min).padStart(2, '0')}` : `${l.h}h`
    return ` ${n} `.includes(` ${normalizar(horaTxt)} `) && (n.includes(normalizar(DIAS[l.wd])) || n.includes(`${String(l.d).padStart(2, '0')} ${String(l.m).padStart(2, '0')}`) || /\b(hoje|amanha)\b/.test(n))
  })
}
