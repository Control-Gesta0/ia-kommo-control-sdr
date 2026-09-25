/**
 * DESCOBERTA AO VIVO (somente leitura) — `npm run discover`
 *
 * Lê a conta Kommo e responde as perguntas que decidem o desenho:
 *  - funis/etapas, campos do lead (com enum_id), tags, usuários
 *  - webhooks: quem mais consome a conta (n8n antigo? outro sistema?)
 *  - canal: WhatsApp oficial (origin "waba") ou não
 *  - qual campo uma integração muda com frequência (candidato ao campo de resposta do n8n)
 *
 * Grava o bruto em discovery/ (fora do git: tem dado de lead).
 * Usa Node fetch: no Git Bash, curl com [] na URL faz "globbing" e falha calado.
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadEnv } from './env'

loadEnv()
const domain = (process.env.KOMMO_DOMAIN || '').replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://')
const token = process.env.KOMMO_TOKEN || ''
if (!domain || !token) { console.error('Defina KOMMO_DOMAIN e KOMMO_TOKEN no .env.local'); process.exit(1) }
if (!token.startsWith('eyJ')) console.warn('⚠️  KOMMO_TOKEN não parece JWT (eyJ...). A "chave secreta" de 64 caracteres NÃO é o token de longa duração.')

const out = path.join(process.cwd(), 'discovery')
fs.mkdirSync(out, { recursive: true })

async function get(p: string): Promise<any> {
  const r = await fetch(`${domain}/api/v4/${p}`, { headers: { Authorization: `Bearer ${token}` } })
  if (r.status === 204) return {}
  if (!r.ok) throw new Error(`${p} -> ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const j = await r.json()
  fs.writeFileSync(path.join(out, `${p.replace(/[^a-z0-9]+/gi, '_')}.json`), JSON.stringify(j, null, 2))
  return j
}

async function main() {
  const account = await get('account')
  console.log(`\nConta: ${account.name} · account_id ${account.id}`)

  const pipelines = (await get('leads/pipelines'))._embedded?.pipelines || []
  console.log('\n== Funis ==')
  for (const p of pipelines) {
    console.log(`${p.id} · ${p.name}${p.is_main ? ' (principal)' : ''}`)
    for (const s of p._embedded.statuses) console.log(`    ${s.id} [${s.sort}] ${s.name}`)
  }

  const fields = (await get('leads/custom_fields?limit=250'))._embedded?.custom_fields || []
  console.log('\n== Campos do lead ==')
  for (const f of fields) console.log(`${f.id} · ${f.type} · ${f.name}${f.enums ? ` · ${f.enums.map((e: any) => `${e.id}=${e.value}`).join(' | ')}` : ''}`)
  const nomes = new Map<string, number>()
  for (const f of fields) nomes.set(f.name.trim().toLowerCase(), (nomes.get(f.name.trim().toLowerCase()) || 0) + 1)
  const dup = [...nomes].filter(([, n]) => n > 1).map(([n]) => n)
  if (dup.length) console.log(`⚠️  Campos com nome DUPLICADO (confirme qual vale): ${dup.join(' · ')}`)
  const sensiveis = fields.filter((f: any) => /cpf|senha|rg\b|processo|protocolo|banc|cart[aã]o/i.test(f.name))
  if (sensiveis.length) console.log(`🚫 Candidatos a camposProibidos: ${sensiveis.map((f: any) => `${f.id} (${f.name})`).join(' · ')}`)

  const tags = (await get('leads/tags?limit=250'))._embedded?.tags || []
  console.log(`\n== Tags (${tags.length}) ==\n${tags.map((t: any) => t.name).join(' · ')}`)

  const users = (await get('users?limit=250'))._embedded?.users || []
  console.log(`\n== Usuários ==\n${users.map((u: any) => `${u.id} ${u.name}`).join(' · ')}`)

  try {
    const hooks = (await get('webhooks'))._embedded?.webhooks || []
    console.log('\n== Webhooks (quem mais escuta a conta) ==')
    for (const h of hooks) console.log(`${h.id} · ${h.destination} · ${JSON.stringify(h.settings)}${h.disabled ? ' · DESATIVADO' : ''}`)
    if (hooks.some((h: any) => (h.settings || []).includes('add_message'))) console.log('⚠️  Já existe consumidor de add_message: gates DISJUNTOS durante a rampagem, e na virada desativar o antigo.')
  } catch (e) { console.log(`webhooks: ${(e as Error).message}`) }

  const events = (await get('events?limit=100'))._embedded?.events || []
  const origins = new Set(events.filter((e: any) => /chat_message/.test(e.type)).map((e: any) => e.value_after?.[0]?.message?.origin))
  console.log(`\n== Canal ==\norigens de chat: ${[...origins].join(', ') || '(sem mensagens recentes)'}`)
  if (origins.has('waba')) console.log('→ WhatsApp OFICIAL (WABA): Desenho A e janela de 24h da Meta para qualquer follow-up.')
  const mudancas = new Map<string, number>()
  for (const e of events) if (/^custom_field_\d+_value_changed$/.test(e.type) && e.created_by === 0) mudancas.set(e.type, (mudancas.get(e.type) || 0) + 1)
  const top = [...mudancas].sort((a, b) => b[1] - a[1]).slice(0, 3)
  if (top.length) {
    console.log('Campos alterados por INTEGRAÇÃO nos últimos 100 eventos (candidato ao campo de resposta do bot antigo):')
    for (const [t, n] of top) {
      const id = Number(t.match(/\d+/)![0])
      console.log(`   ${id} (${fields.find((f: any) => f.id === id)?.name || '?'}) · ${n}x`)
    }
  }
  // ---- Indicações de parceiro: onde mora o "Comment:"? ----
  const { extrairComentario, classificarTeste } = await import('../lib/indicacao')
  try {
    const acc = await get('account?with=task_types')
    console.log(`\n== Tipos de tarefa ==\n${(acc._embedded?.task_types || []).map((t: any) => `${t.id}=${t.name}`).join(' · ')}  (agenda.taskTypeId)`)
  } catch (e) { console.log(`tipos de tarefa: ${(e as Error).message}`) }
  try {
    const unsorted = (await get('leads/unsorted?limit=50&order[created_at]=desc'))._embedded?.unsorted || []
    console.log(`\n== Incoming leads pendentes (${unsorted.length}) ==`)
    for (const u of unsorted.slice(0, 15)) {
      const c = extrairComentario(JSON.stringify(u.metadata || {}))
      console.log(`uid ${u.uid} · lead ${u._embedded?.leads?.[0]?.id} · ${u.category} · ${u.source_name || '-'} · pipeline ${u.pipeline_id} · Comment no metadata: ${c === null ? 'não' : `"${c.slice(0, 60)}"`}`)
    }
  } catch (e) { console.log(`incoming leads: ${(e as Error).message}`) }
  const statusEntrada = Number(process.env.STATUS_ENTRADA || 55438567)
  try {
    const leads = (await get(`leads?filter[statuses][0][status_id]=${statusEntrada}&limit=10&order[created_at]=desc`))._embedded?.leads || []
    const pipeEntrada = pipelines.find((p: any) => p._embedded.statuses.some((st: any) => st.id === statusEntrada))
    console.log(`\n== Leads aceitos na etapa de entrada ${statusEntrada} (funil ${pipeEntrada?.id ?? '?'} "${pipeEntrada?.name ?? '?'}") ==`)
    for (const l of leads) {
      const notas = (await get(`leads/${l.id}/notes?limit=50`))._embedded?.notes || []
      const hitNota = notas.find((n: any) => extrairComentario(typeof n.params?.text === 'string' ? n.params.text : JSON.stringify(n.params || {})) !== null)
      const campos = (l.custom_fields_values || []).map((f: any) => `${f.field_name}: ${(f.values || []).map((v: any) => v.value).join(', ')}`).join('\n')
      const cCampo = extrairComentario(campos)
      const c = cCampo ?? (hitNota ? extrairComentario(typeof hitNota.params?.text === 'string' ? hitNota.params.text : JSON.stringify(hitNota.params)) : null)
      const onde = cCampo !== null ? 'campo do lead' : hitNota ? `nota ${hitNota.note_type}` : 'NÃO ACHADO'
      console.log(`lead ${l.id} "${l.name}" · Comment em: ${onde}${c ? ` · "${c.slice(0, 70)}" · teste? ${classificarTeste(c).teste}` : ''}`)
    }
    if (!leads.length) console.log('(nenhum lead nessa etapa agora)')
  } catch (e) { console.log(`leads da entrada: ${(e as Error).message}`) }

  console.log('\n💡 O bot_id do Salesbot NÃO aparece na API: leia no nó do n8n que chama salesbot/run, ou na URL do bot no Kommo.')
  console.log(`\nBruto salvo em ${out}`)
}

main().catch(e => { console.error(e); process.exit(1) })
