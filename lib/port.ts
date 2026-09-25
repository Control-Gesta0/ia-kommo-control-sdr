import type { Intervalo } from './agenda'
import { CRM_MAP } from './crm-map'
import { agendarLembretes } from './followup'
import { criarEventoGoogle, googleLeitura, googleOAuth, googleOcupados } from './google'
import { addLeadNote, addLeadTags, contactEmails, createTask, getContact, getLead, leadTags, listOpenTasks, removeLeadTags, updateLeadFields, updateLeadStatus, type KommoFieldValue } from './kommo'
import { getState, patchState } from './state'
import { k, redis } from './redis'
import { sendReply } from './transport'
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
    async criarTarefaCloser(texto) {
      await createTask({ leadId, responsibleUserId: CRM_MAP.agenda.responsavelId, taskTypeId: 1, text: texto, completeTill: Math.floor(Date.now() / 1000) + 2 * 3600, duration: 0 })
    },
    agendarLembretes: r => agendarLembretes(leadId, r.ini, r.taskId),
    async avisarCloser(texto, chave) {
      const alvo = CRM_MAP.avisoCloser.leadId
      if (!alvo || alvo === leadId) return
      // Uma vez por reunião, mesmo se a ferramenta rodar de novo
      if ((await redis.set(k('aviso-closer', chave), 1, { nx: true, ex: 30 * 86400 })) !== 'OK') return
      const lead = await getLead(leadId).catch(() => null)
      const contatoId = (lead?._embedded?.contacts || []).find(c => c.is_main)?.id
      const nome = (contatoId ? (await getContact(contatoId).catch(() => null))?.name : '') || lead?.name
      await sendReply(alvo, texto.replace('{{CLIENTE}}', nome || `Lead #${leadId}`))
    },
    async criarReuniao(r) {
      const cfg = CRM_MAP.agenda
      if (googleOAuth()) {
        // Evento direto no Google do closer, com Meet próprio (um link por reunião).
        // Não cria tarefa no Kommo: a integração Kommo ↔ Google duplicaria o evento.
        const lead = await getLead(leadId)
        const contatoId = (lead._embedded?.contacts || []).find(c => c.is_main)?.id
        const contato = contatoId ? await getContact(contatoId).catch(() => null) : null
        const nome = (contato?.name || lead.name || `Lead ${leadId}`).trim()
        const email = contato ? contactEmails(contato).find(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) : undefined
        const ev = await criarEventoGoogle({
          ini: r.ini, fim: r.fim, titulo: `Reunião Control Gestão · ${nome}`.slice(0, 200),
          descricao: `${r.texto}\n\nLead no Kommo: #${leadId}`, emailConvidado: email, chave: `lead-${leadId}-${r.ini}`,
        })
        return { id: `g:${ev.id}`, link: ev.link }
      }
      const id = await createTask({
        leadId, responsibleUserId: cfg.responsavelId, taskTypeId: cfg.taskTypeId, text: r.texto,
        completeTill: Math.floor(r.ini / 1000), duration: Math.round((r.fim - r.ini) / 1000),
      })
      return { id: String(id), link: '' }
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
  if (googleLeitura()) out.push(...await googleOcupados(ini, fim))
  return out
}
