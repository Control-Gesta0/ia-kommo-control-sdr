import type { Intervalo } from './agenda'
import { CONFIG } from './config'
import { CRM_MAP } from './crm-map'
import { agendarLembretes } from './followup'
import { googleOcupados } from './google'
import { addLeadNote, addLeadTags, createTask, getLead, leadTags, listOpenTasks, removeLeadTags, updateLeadFields, updateLeadStatus, type KommoFieldValue } from './kommo'
import { getState, patchState } from './state'
import type { LeadPort, LeadView } from './tools'

/** Porta de produção: Kommo + Redis. Relê o lead depois de toda escrita. */
export function kommoPort(leadId: number): LeadPort {
  let cached: LeadView | undefined
  return {
    async getLead() {
      if (!cached) {
        const lead = await getLead(leadId)
        const fields: LeadView['fields'] = {}
        for (const f of lead.custom_fields_values || []) {
          fields[f.field_id] = {
            value: f.values?.[0]?.value,
            enumIds: (f.values || []).map(v => v.enum_id).filter((x): x is number => typeof x === 'number'),
          }
        }
        cached = { id: lead.id, statusId: lead.status_id, pipelineId: lead.pipeline_id, fields, tags: leadTags(lead) }
      }
      return cached
    },
    async writeFields(values: KommoFieldValue[]) {
      const permitidos = values.filter(v => !CRM_MAP.camposProibidos.includes(v.field_id))
      if (permitidos.length) await updateLeadFields(leadId, permitidos)
      cached = undefined
    },
    async moveStage(statusId, pipelineId) { await updateLeadStatus(leadId, statusId, pipelineId); cached = undefined },
    async addTags(tags) { await addLeadTags(leadId, tags); cached = undefined },
    async removeTags(tags) { await removeLeadTags(leadId, tags); cached = undefined },
    async addNote(text) { await addLeadNote(leadId, text) },
    buscarOcupados: ocupadosDoCloser,
    agendarLembretes: r => agendarLembretes(leadId, r.ini, Number(r.taskId)),
    async criarReuniao(r) {
      const cfg = CRM_MAP.agenda
      const id = await createTask({
        leadId, responsibleUserId: cfg.responsavelId, taskTypeId: cfg.taskTypeId, text: r.texto,
        completeTill: Math.floor(r.ini / 1000), duration: Math.round((r.fim - r.ini) / 1000),
      })
      return String(id)
    },
    getState: () => getState(leadId),
    patchState: p => patchState(leadId, p),
  }
}

/**
 * Ocupado do closer = tarefas abertas com hora no Kommo (+ Google free/busy se
 * configurado). Tarefa sem duração só conta se for do tipo reunião (tarefa de
 * "ligar" com prazo 23:59 não bloqueia a agenda).
 */
export async function ocupadosDoCloser(ini: number, fim: number): Promise<Intervalo[]> {
  const cfg = CRM_MAP.agenda
  const tarefas = await listOpenTasks(cfg.responsavelId)
  const out: Intervalo[] = []
  for (const t of tarefas) {
    const a = t.complete_till * 1000
    const dur = (t.duration || 0) * 1000 || (t.task_type_id === cfg.taskTypeId ? cfg.duracaoMin * 60000 : 0)
    if (!dur || a + dur < ini || a > fim) continue
    out.push({ ini: a, fim: a + dur })
  }
  if (CONFIG.googleServiceAccount && CONFIG.googleCalendarId) {
    out.push(...await googleOcupados(CONFIG.googleServiceAccount, CONFIG.googleCalendarId, ini, fim))
  }
  return out
}
