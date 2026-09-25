import { CONFIG } from './config'

/**
 * Client da API do Kommo (v4 + endpoint legado v2 do Salesbot).
 * - Retry em 429/5xx. O Salesbot passa retry5xx:false: um 502 pode ter
 *   rodado o bot, e repetir duplicaria a mensagem (kommo/PEGADINHAS §7).
 * - PATCH de tags SUBSTITUI o conjunto inteiro: só addLeadTags/removeLeadTags.
 */

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function kommo<T>(method: string, path: string, body?: unknown, opts?: { retries?: number; retry5xx?: boolean }): Promise<T> {
  const retries = opts?.retries ?? 3
  const retry5xx = opts?.retry5xx ?? true
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${CONFIG.kommoDomain}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${CONFIG.kommoToken}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    if (res.ok) return (text ? JSON.parse(text) : {}) as T
    const retryable = res.status === 429 || (retry5xx && res.status >= 500)
    if (retryable && attempt < retries) {
      await sleep(res.status === 429 ? 2000 * 2 ** attempt : 1000 * (attempt + 1))
      continue
    }
    throw new Error(`Kommo ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`)
  }
}

export const kommoGet = <T>(path: string) => kommo<T>('GET', path)

export interface KommoFieldValue { field_id: number; values: Array<{ value?: unknown; enum_id?: number }> }

export interface KommoLead {
  id: number
  name?: string
  status_id: number
  pipeline_id: number
  responsible_user_id?: number
  created_at?: number
  custom_fields_values?: KommoFieldValue[] | null
  _embedded?: { tags?: Array<{ id: number; name: string }>; contacts?: Array<{ id: number; is_main?: boolean }> }
}

export async function getLead(leadId: number): Promise<KommoLead> {
  return kommo<KommoLead>('GET', `/api/v4/leads/${leadId}?with=contacts`)
}

export const leadTags = (lead: KommoLead) => (lead._embedded?.tags || []).map(t => t.name)

export async function updateLeadFields(leadId: number, values: KommoFieldValue[]): Promise<void> {
  await kommo('PATCH', `/api/v4/leads/${leadId}`, { custom_fields_values: values })
}

export async function updateLeadStatus(leadId: number, statusId: number, pipelineId: number): Promise<void> {
  await kommo('PATCH', `/api/v4/leads/${leadId}`, { status_id: statusId, pipeline_id: pipelineId })
}

async function setLeadTags(leadId: number, names: string[]): Promise<void> {
  // Array vazio não limpa: o Kommo ignora. Para zerar, é preciso tags_to_delete.
  await kommo('PATCH', `/api/v4/leads/${leadId}`, { _embedded: { tags: names.map(name => ({ name })) } })
}

export async function addLeadTags(leadId: number, names: string[]): Promise<void> {
  if (!names.length) return
  const current = leadTags(await getLead(leadId))
  const lower = new Set(current.map(t => t.toLowerCase()))
  const add = names.filter(n => !lower.has(n.toLowerCase()))
  if (add.length) await setLeadTags(leadId, [...current, ...add])
}

/** Remove tags sem apagar as outras. Usa tags_to_delete (funciona mesmo quando sobra zero tag). */
export async function removeLeadTags(leadId: number, names: string[]): Promise<void> {
  if (!names.length) return
  const lead = await getLead(leadId)
  const drop = new Set(names.map(n => n.toLowerCase()))
  const alvo = (lead._embedded?.tags || []).filter(t => drop.has(t.name.toLowerCase()))
  if (!alvo.length) return
  try {
    await kommo('PATCH', `/api/v4/leads/${leadId}`, { tags_to_delete: alvo.map(t => ({ id: t.id })) })
  } catch (e) {
    // Conta sem suporte a tags_to_delete: regrava o conjunto restante (merge local)
    const kept = leadTags(lead).filter(n => !drop.has(n.toLowerCase()))
    if (!kept.length) throw e
    await setLeadTags(leadId, kept)
  }
  // Prova: relê o lead. Tag que "saiu com 200" e continua lá = IA que não desliga.
  const still = leadTags(await getLead(leadId)).filter(n => drop.has(n.toLowerCase()))
  if (still.length) throw new Error(`tags não removidas do lead ${leadId}: ${still.join(', ')}`)
}

export async function addLeadNote(leadId: number, text: string): Promise<void> {
  // A Kommo apaga emoji fora do BMP (📅, 🤖...): tira aqui para a nota não ficar com buracos
  const limpo = text.replace(/[\u{10000}-\u{10FFFF}]\uFE0F?\s?/gu, '')
  await kommo('POST', `/api/v4/leads/${leadId}/notes`, [{ note_type: 'common', params: { text: limpo } }])
}

/**
 * Dispara o Salesbot de envio: endpoint oficial atual POST /api/v4/bots/run (202
 * "Accepted"); o legado /api/v2/salesbot/run fica de reserva se o v4 não existir.
 * Sem retry em 5xx: um 502 pode ter rodado o bot (repetir duplica a mensagem).
 */
export async function runSalesbot(botId: number, leadId: number): Promise<void> {
  const corpo = [{ bot_id: botId, entity_id: leadId, entity_type: 'leads' }]
  try {
    await kommo('POST', '/api/v4/bots/run', corpo, { retry5xx: false })
  } catch (e) {
    if (!/-> (404|405)/.test(e instanceof Error ? e.message : '')) throw e
    await kommo('POST', '/api/v2/salesbot/run', corpo, { retry5xx: false })
  }
}

export async function getTask(taskId: number): Promise<KommoTask | null> {
  try { return await kommo<KommoTask>('GET', `/api/v4/tasks/${taskId}`) } catch { return null }
}

export function fieldValue(lead: KommoLead, fieldId: number): unknown {
  const f = (lead.custom_fields_values || []).find(v => v.field_id === fieldId)
  return f?.values?.[0]?.value ?? null
}

export function fieldEnumIds(lead: KommoLead, fieldId: number): number[] {
  const f = (lead.custom_fields_values || []).find(v => v.field_id === fieldId)
  return (f?.values || []).map(v => v.enum_id).filter((x): x is number => typeof x === 'number')
}

// ---------- Indicação: notas, contato, tarefas ----------

export interface KommoNote { id: number; note_type: string; params?: Record<string, unknown>; created_at?: number }

export async function getLeadNotes(leadId: number): Promise<KommoNote[]> {
  const r = await kommo<{ _embedded?: { notes?: KommoNote[] } }>('GET', `/api/v4/leads/${leadId}/notes?limit=100`)
  return r._embedded?.notes || []
}

/** Texto "achatado" de tudo que o lead carrega (campos + notas): é onde o "Comment:" pode morar. */
export function textoDoLead(lead: KommoLead): string {
  const campos = (lead.custom_fields_values || []).map(f => `${(f as { field_name?: string }).field_name || f.field_id}: ${(f.values || []).map(v => String(v.value ?? '')).join(', ')}`)
  return [lead.name || '', ...campos].join('\n')
}

export function textoDasNotas(notes: KommoNote[]): string[] {
  return notes.map(n => {
    const p = n.params || {}
    const text = typeof p.text === 'string' ? p.text : ''
    return text || JSON.stringify(p)
  })
}

export interface KommoContact {
  id: number
  name?: string
  custom_fields_values?: Array<{ field_code?: string; field_name?: string; values: Array<{ value?: unknown }> }> | null
}

export async function getContact(contactId: number): Promise<KommoContact> {
  return kommo<KommoContact>('GET', `/api/v4/contacts/${contactId}`)
}

export function contactPhones(c: KommoContact): string[] {
  return (c.custom_fields_values || [])
    .filter(f => f.field_code === 'PHONE')
    .flatMap(f => f.values.map(v => String(v.value || '').trim()))
    .filter(Boolean)
}

export function contactEmails(c: KommoContact): string[] {
  return (c.custom_fields_values || [])
    .filter(f => f.field_code === 'EMAIL')
    .flatMap(f => f.values.map(v => String(v.value || '').trim()))
    .filter(Boolean)
}

export interface KommoTask {
  id: number
  entity_id?: number
  entity_type?: string
  responsible_user_id: number
  task_type_id: number
  text?: string
  complete_till: number
  duration?: number
  is_completed: boolean
}

/** Tarefas abertas de um usuário (paginado, até 5 páginas de 250). O filtro de janela é feito no código. */
export async function listOpenTasks(responsibleUserId: number): Promise<KommoTask[]> {
  const out: KommoTask[] = []
  for (let page = 1; page <= 5; page++) {
    const r = await kommo<{ _embedded?: { tasks?: KommoTask[] } }>(
      'GET', `/api/v4/tasks?filter[responsible_user_id]=${responsibleUserId}&filter[is_completed]=0&limit=250&page=${page}`,
    )
    const tasks = r._embedded?.tasks || []
    out.push(...tasks)
    if (tasks.length < 250) break
  }
  return out
}

/** Cria tarefa. `completeTill` e `duration` em SEGUNDOS (ms joga a reunião pro ano 55.000 — kommo/PEGADINHAS §8). */
export async function createTask(t: { leadId: number; responsibleUserId: number; taskTypeId: number; text: string; completeTill: number; duration: number }): Promise<number> {
  if (t.completeTill > 1e11) throw new Error('complete_till parece estar em milissegundos')
  const r = await kommo<{ _embedded?: { tasks?: Array<{ id: number }> } }>('POST', '/api/v4/tasks', [{
    entity_id: t.leadId, entity_type: 'leads', responsible_user_id: t.responsibleUserId,
    task_type_id: t.taskTypeId, text: t.text, complete_till: t.completeTill, duration: t.duration,
  }])
  const id = r._embedded?.tasks?.[0]?.id
  if (!id) throw new Error('Kommo não devolveu o id da tarefa criada')
  return id
}

/** PATCH genérico do lead (status, funil, responsável, motivo de perda...). */
export async function patchLead(leadId: number, body: Record<string, unknown>): Promise<void> {
  await kommo('PATCH', `/api/v4/leads/${leadId}`, body)
}
