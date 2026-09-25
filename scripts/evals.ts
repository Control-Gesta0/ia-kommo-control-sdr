/**
 * O EXAME DO CÉREBRO — roda os prompts LOCAIS com as tools REAIS numa porta em
 * memória (zero efeito no CRM). Cenários em evals/cenarios.ts (patch do cliente).
 *
 * Cada cenário: checagens em CÓDIGO (tool, campo gravado, finalização, trava) +
 * critérios para um juiz cego. Portão: qualquer checagem falhando ou critério
 * reprovado → exit 1. Rode com 3 repetições antes de publicar (comum §49).
 *
 *   npx tsx scripts/evals.ts                  # todos, 1 rodada
 *   npx tsx scripts/evals.ts bpc urgencia     # filtra por id
 *   EVAL_REPS=3 npx tsx scripts/evals.ts
 */
import { loadEnv } from './env'

loadEnv()
for (const [key, val] of Object.entries({ KOMMO_DOMAIN: 'https://eval.kommo.com', KOMMO_TOKEN: 'x', KOMMO_ACCOUNT_ID: '1', UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'x', WEBHOOK_SECRET: 'x' })) process.env[key] ||= val

export interface World {
  statusId: number
  pipelineId: number
  fields: Record<number, { value?: unknown; enumIds: number[] }>
  tags: Set<string>
  notes: string[]
  state: Record<string, any>
  log: string[]
  /** agenda em memória */
  ocupados: Array<{ ini: number; fim: number }>
  reunioes: Array<{ ini: number; fim: number; texto: string }>
}

export interface Turno { lead: string; resposta: string; tools: string[]; guard: string[]; handoff: boolean }

export interface Cenario {
  id: string
  porta: string
  nomeContato?: string
  /** conversa anterior na porta (já travada) */
  historico?: Array<['in' | 'out', string]>
  state?: Record<string, any>
  /** Comment da indicação (vira state.comentario e evidência do lead) */
  comentario?: string
  /** true = antes das msgs, a IA gera a ABERTURA ativa (ela fala primeiro) */
  abertura?: boolean
  /** relógio fixo do cenário (ISO). Padrão: segunda 28/09/2026 10h de Brasília */
  agora?: string
  /** compromissos já na agenda do closer */
  ocupados?: Array<[string, string]>
  msgs: string[]
  checks: Array<{ nome: string; fn: (w: World, t: Turno[]) => boolean }>
  criterios: string[]
}

async function main() {
  if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY ausente no .env.local'); process.exit(1) }
  const { createBrain } = await import('../lib/llm')
  const { portaById, CRM_MAP } = await import('../lib/crm-map')
  // Exame roda com um closer de teste se o mapa ainda não tem o real (porta em memória, nada vai ao Kommo)
  if (CRM_MAP.agenda.ativa && !CRM_MAP.agenda.responsavelId) CRM_MAP.agenda.responsavelId = 999
  const { costUsd } = await import('../lib/execlog')
  const OpenAI = (await import('openai')).default
  const { CENARIOS } = await import('../evals/cenarios')
  type LeadPort = import('../lib/tools').LeadPort
  type ChatMsg = import('../lib/history').ChatMsg

  const MODEL = process.env.LLM_MODEL || 'gpt-5.4-mini-2026-03-17'
  const JUDGE = process.env.EVAL_JUDGE_MODEL || 'gpt-5.4-2026-03-05'
  const REPS = Number(process.env.EVAL_REPS || 1)
  const filtros = process.argv.slice(2)
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  let mundoAtual: World | null = null
  const brain = createBrain({
    apiKey: process.env.OPENAI_API_KEY!, model: MODEL,
    onTool: (nome, input, out) => { mundoAtual?.log.push(`${nome}(${JSON.stringify(input).slice(0, 200)}) → ${out.isError ? 'ERRO ' : ''}${out.content.slice(0, 200)}`) },
  })
  const GATE = (process.env.GATE_TAG || 'gate').toLowerCase()

  function memoryPort(w: World): LeadPort {
    return {
      async getLead() { return { id: 1, statusId: w.statusId, pipelineId: w.pipelineId, fields: structuredClone(w.fields), tags: [...w.tags] } },
      async writeFields(vs) { for (const v of vs) { w.fields[v.field_id] = { value: v.values[0]?.value, enumIds: v.values.map(x => x.enum_id).filter((x): x is number => typeof x === 'number') }; w.log.push(`write ${v.field_id}=${JSON.stringify(v.values)}`) } },
      async moveStage(s, p) { w.statusId = s; w.pipelineId = p; w.log.push(`stage ${s}`) },
      async addTags(t) { t.forEach(x => w.tags.add(x.toLowerCase())) },
      async removeTags(t) { t.forEach(x => w.tags.delete(x.toLowerCase())); w.log.push(`removeTags ${t.join(',')}`) },
      async addNote(n) { w.notes.push(n) },
      async buscarOcupados() { return [...w.ocupados, ...w.reunioes] },
      async criarReuniao(r) { w.reunioes.push(r); w.log.push(`reuniao ${new Date(r.ini).toISOString()}`); return `t${w.reunioes.length}` },
      async getState() { return structuredClone(w.state) },
      async patchState(p) { Object.assign(w.state, p); return structuredClone(w.state) },
    }
  }

  let reprovados = 0
  let custo = 0
  const lista = CENARIOS.filter(c => !filtros.length || filtros.some(f => c.id.includes(f)))
  for (const c of lista) {
    for (let rep = 1; rep <= REPS; rep++) {
      const porta = portaById(c.porta)
      if (!porta) throw new Error(`cenário ${c.id}: porta ${c.porta} não existe`)
      const agora = Date.parse(c.agora || '2026-09-28T13:00:00Z')
      const w: World = {
        statusId: 1, pipelineId: 1, fields: {}, tags: new Set([GATE]), notes: [], log: [],
        state: { porta: porta.id, portaEm: 0, ...(c.comentario ? { comentario: c.comentario } : {}), ...(c.state || {}) },
        ocupados: (c.ocupados || []).map(([a, b]) => ({ ini: Date.parse(a), fim: Date.parse(b) })), reunioes: [],
      }
      const history: ChatMsg[] = (c.historico || []).map(([dir, text], i) => ({ id: `h${i}`, dir, text, ts: i + 1 }))
      const turnos: Turno[] = []
      mundoAtual = w
      if (c.abertura) {
        const ab = await brain.generateOpening({ port: memoryPort(w), porta, gateTag: GATE, leadText: c.comentario || '', lastLeadText: '', lastAgentText: '', agora }, { nomeContato: c.nomeContato || '', primeiroContatoDaPorta: true })
        const texto = ab?.text || '(abertura reprovada: cairia na abertura fixa)'
        custo += ab ? costUsd(MODEL, ab.usage) || 0 : 0
        turnos.push({ lead: '(a IA inicia a conversa)', resposta: texto, tools: [], guard: ab?.guard || ['fallback'], handoff: false })
        history.push({ id: 'abertura', dir: 'out', text: texto, ts: history.length + 1 })
      }
      for (const msg of c.msgs) {
        if (w.state.finalizado) break
        history.push({ id: `m${history.length}`, dir: 'in', text: msg, ts: history.length + 1 })
        const iOut = history.map(m => m.dir).lastIndexOf('out')
        const bloco = history.slice(iOut + 1).map(m => m.text).join('\n')
        const reply = await brain.generateReply({
          port: memoryPort(w), porta, gateTag: GATE,
          leadText: [c.comentario || '', ...history.filter(m => m.dir === 'in').map(m => m.text)].join('\n'),
          lastLeadText: bloco,
          lastAgentText: iOut >= 0 ? history[iOut].text : '',
          agora,
        }, { nomeContato: c.nomeContato || '', primeiroContatoDaPorta: !history.some(m => m.dir === 'out') }, history)
        const resposta = reply?.text || ''
        custo += reply ? costUsd(MODEL, reply.usage) || 0 : 0
        turnos.push({ lead: msg, resposta, tools: reply?.toolsUsed || [], guard: reply?.guard || [], handoff: !!reply?.handoff })
        history.push({ id: `r${history.length}`, dir: 'out', text: resposta, ts: history.length + 1 })
      }

      const falhasCodigo = c.checks.filter(ch => { try { return !ch.fn(w, turnos) } catch { return true } }).map(ch => ch.nome)
      const transcript = turnos.map(t => `LEAD: ${t.lead}\nIA: ${t.resposta}`).join('\n\n')
      const juiz = await openai.chat.completions.create({
        model: JUDGE,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Você avalia a conversa de um atendente virtual de WhatsApp. Para CADA critério responda se foi atendido. Seja rigoroso e literal. JSON: {"criterios":[{"criterio":"...","ok":true|false,"porque":"..."}]}' },
          { role: 'user', content: `CRITÉRIOS:\n${c.criterios.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\nCONVERSA:\n${transcript}` },
        ],
      })
      const veredito = JSON.parse(juiz.choices[0].message.content || '{"criterios":[]}') as { criterios: Array<{ criterio: string; ok: boolean; porque: string }> }
      const falhasJuiz = (veredito.criterios || []).filter(x => !x.ok)
      const nota = c.criterios.length ? Math.round(((c.criterios.length - falhasJuiz.length) / c.criterios.length) * 100) / 10 : 10
      const passou = !falhasCodigo.length && !falhasJuiz.length && (veredito.criterios || []).length >= c.criterios.length
      if (!passou) reprovados++
      console.log(`\n${passou ? '✅' : '❌'} ${c.id} [${rep}/${REPS}] nota ${nota}/10`)
      if (!passou) {
        console.log(transcript.split('\n').map(l => `   ${l}`).join('\n'))
        for (const f of falhasCodigo) console.log(`   ⛔ código: ${f}`)
        for (const f of falhasJuiz) console.log(`   ⛔ juiz: ${f.criterio} — ${f.porque}`)
        for (const l of w.log) console.log(`   · ${l}`)
      }
    }
  }
  console.log(`\n${reprovados ? `❌ ${reprovados} reprovado(s)` : '✅ Todos aprovados'} · ${lista.length} cenário(s) × ${REPS} · custo do agente US$ ${custo.toFixed(4)} (juiz não incluso)`)
  process.exit(reprovados ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
