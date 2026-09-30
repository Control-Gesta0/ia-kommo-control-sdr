/**
 * TESTE ÚNICO: aceita UMA indicação de parceiro pela API oficial v4
 * (POST /api/v4/leads/unsorted/{uid}/accept) no mesmo instante em que o userscript
 * aceitaria, e confere se o lead ficou válido. Sai depois do primeiro lead.
 *
 *   npx tsx scripts/teste-aceite-api.ts
 *
 * Antes: DESLIGAR o userscript no Tampermonkey (senão ele aceita primeiro e o teste
 * não prova nada). Depois do resultado: religar.
 *
 * Resultado: aceito-valido · aceito-cedo ("no longer available") · outros ("already been
 * accepted by other partners") · recusado (a API respondeu erro) · pulado (teste/suporte/idioma).
 */
import { loadEnv } from './env'
loadEnv()

const USER_ID = 12725576
const STATUS_ID = 55438567
const PIPELINE_ID = 4338500
const CATEGORIAS_IGNORADAS = ['chats', 'mail', 'sip']
// Mesmo instante do userscript 3.7.x: created_at + 1s + 300s − 2s (ANTECIPAR) + 40ms (margem), no relógio da Kommo
const DISPARO_MS = 1000 + 300_000 - 2000 + 40
const JANELA_MS = 8000
const POLL_MS = 3000

const dom = process.env.KOMMO_DOMAIN!
const H = { Authorization: `Bearer ${process.env.KOMMO_TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json' }
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 23), ...a)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Relógio da Kommo pelo cabeçalho Date (segundos inteiros): intervalo [lo, hi] de (servidor − local)
let lo = -Infinity
let hi = Infinity
async function req(method: string, path: string, body?: unknown) {
  const t0 = Date.now()
  const r = await fetch(`${dom}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  const t1 = Date.now()
  const d = r.headers.get('date')
  if (d) {
    const s = Date.parse(d)
    lo = Math.max(lo, s - t1)
    hi = Math.min(hi, s + 1000 - t0)
    if (lo > hi) { lo = s - t1; hi = s + 1000 - t0 } // amostra ruim: recomeça
  }
  const texto = await r.text()
  let json: any = null
  try { json = texto ? JSON.parse(texto) : null } catch { /* não é JSON */ }
  return { status: r.status, json, texto, t0, t1 }
}

async function comentarioDo(leadId: number, metadata: unknown): Promise<string> {
  const F = require('../userscript/filtro-indicacao.js')
  const notas = await req('GET', `/api/v4/leads/${leadId}/notes?limit=50`)
  const partes = ((notas.json?._embedded?.notes || []) as Array<{ params?: { text?: string } }>).map(n => n.params?.text || JSON.stringify(n.params || {}))
  const texto = [...partes, JSON.stringify(metadata || {})].join('\n')
  return F.extrairComentario(texto) ?? ''
}

async function conferir(leadId: number): Promise<string> {
  const [notas, eventos] = await Promise.all([
    req('GET', `/api/v4/leads/${leadId}/notes?limit=50`),
    req('GET', `/api/v4/events?filter%5Bentity%5D=lead&filter%5Bentity_id%5D=${leadId}&limit=50`),
  ])
  const t = `${notas.texto}\n${eventos.texto}`.toLowerCase()
  if (t.includes('no longer available')) return 'aceito-cedo'
  if (t.includes('already been accepted') || t.includes('accepted by other partners')) return 'outros'
  const contato = ((eventos.json?._embedded?.events || []) as Array<{ type: string; value_after?: any }>).some(e => e.type === 'entity_linked' && JSON.stringify(e.value_after).includes('"contact"'))
  return contato ? 'aceito-valido' : 'aceito-sem-contato-ainda'
}

async function main() {
  const inicio = Math.floor(Date.now() / 1000)
  const vistos = new Set<string>()
  log(`esperando a próxima indicação (funil ${PIPELINE_ID}) criada depois de agora...`)
  for (;;) {
    const r = await req('GET', '/api/v4/leads/unsorted?limit=50&order%5Bcreated_at%5D=desc')
    for (const u of (r.json?._embedded?.unsorted || []) as any[]) {
      if (vistos.has(u.uid)) continue
      vistos.add(u.uid)
      if (Number(u.pipeline_id) !== PIPELINE_ID || CATEGORIAS_IGNORADAS.includes(u.category) || u.created_at < inicio) continue
      const leadId = Number(u._embedded?.leads?.[0]?.id)
      log(`nova indicação: lead ${leadId} · uid ${u.uid} · criada ${new Date(u.created_at * 1000).toISOString().slice(11, 19)}`)
      await sleep(4000) // a nota com o Comment chega ~2s depois
      const F = require('../userscript/filtro-indicacao.js')
      const comentario = await comentarioDo(leadId, u.metadata)
      const teste = F.classificarTeste(comentario, 'inteligente')
      const suporte = F.classificarSuporte(comentario)
      const idioma = F.foraDoIdioma('', comentario)
      log(`Comment: ${JSON.stringify(comentario.slice(0, 200))}`)
      if (teste.teste || suporte.suporte || idioma.fora) {
        log(`PULADO (o script também não aceitaria): ${teste.teste ? teste.motivo : suporte.suporte ? suporte.motivo : idioma.motivo}`)
        continue
      }
      // Instante local do disparo (pior caso do relógio: nunca antes do que o script faria)
      const alvo = u.created_at * 1000 + DISPARO_MS - (Number.isFinite(lo) ? lo : 0)
      log(`relógio Kommo−local: [${lo}, ${hi}] ms · disparo em ${((alvo - Date.now()) / 1000).toFixed(1)} s`)
      while (Date.now() < alvo - 50) await sleep(Math.min(1000, alvo - Date.now() - 50))
      while (Date.now() < alvo) { /* espera ativa nos últimos ms */ }
      const fim = Date.now() + JANELA_MS
      let tentativa = 0
      let resultado = ''
      while (Date.now() < fim) {
        tentativa++
        const a = await req('POST', `/api/v4/leads/unsorted/${u.uid}/accept`, { user_id: USER_ID, status_id: STATUS_ID })
        const offset = a.t0 - u.created_at * 1000 - (Number.isFinite(lo) ? (lo + hi) / 2 : 0)
        log(`tentativa ${tentativa} (+${(offset / 1000).toFixed(2)} s do created_at): HTTP ${a.status} · ${a.texto.slice(0, 400)}`)
        if (a.status >= 200 && a.status < 300) { resultado = 'aceito'; break }
        const t = a.texto.toLowerCase()
        if (t.includes('already been accepted') || t.includes('accepted by other partners')) { resultado = 'outros'; break }
        if (a.status === 429) { await sleep(1500); continue }
        if (!t.includes('no longer available') && !t.includes('not available')) { resultado = `recusado (HTTP ${a.status})`; break }
        await sleep(250)
      }
      if (resultado === 'aceito') {
        await sleep(6000)
        resultado = await conferir(leadId)
        if (resultado === 'aceito-sem-contato-ainda') { await sleep(10000); resultado = await conferir(leadId) }
        if (resultado === 'aceito-valido') {
          const ag = await fetch(`${process.env.PUBLIC_URL || process.env.DEPLOY_URL}/api/novo-lead?secret=${encodeURIComponent(process.env.INDICACAO_SECRET || '')}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leadId, comentario, origem: 'teste-api-aceite' }),
          })
          log(`Lara avisada: HTTP ${ag.status}`)
        }
      }
      log(`RESULTADO lead ${leadId}: ${resultado || 'sem resposta conclusiva'} · https://controlgestao.kommo.com/leads/detail/${leadId}`)
      return
    }
    await sleep(POLL_MS)
  }
}

main().catch(e => { log('ERRO', e); process.exit(1) })
