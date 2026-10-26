import { CONFIG } from './config'
import { CRM_MAP } from './crm-map'
import { logExec } from './execlog'
import { getHistory, humanSpokeRecently } from './history'
import { aceitarIncoming, addLeadNote, addLeadTags, leadTags, leadsDoContato, uidIncomingDoLead, type KommoLead } from './kommo'
import { nota } from './notas'
import { k, redis } from './redis'

/**
 * Por que a Lara NÃO assume este lead sozinha (vazio = pode assumir). Só contato novo no
 * Incoming do funil configurado: cliente antigo, parceiro, time ou outro funil fica com o time.
 */
export function motivoParaNaoAssumir(lead: Pick<KommoLead, 'pipeline_id' | 'status_id' | 'created_at'>, tags: string[], agora = Date.now()): string {
  const cfg = CRM_MAP.contatoNovo
  if (!cfg.ativo) return 'desligado'
  if (lead.pipeline_id !== cfg.pipelineId || lead.status_id !== cfg.incomingStatusId) return 'fora do Incoming do funil'
  const t = tags.map(x => x.toLowerCase())
  if (t.includes(CONFIG.humanTag)) return `tag "${CONFIG.humanTag}"`
  if (t.includes(CRM_MAP.tags.indicacao)) return 'indicação (o userscript cuida)'
  if (!lead.created_at || agora - lead.created_at * 1000 > cfg.criadoHaMaxHoras * 3600_000) return `lead criado há mais de ${cfg.criadoHaMaxHoras}h`
  return ''
}

/**
 * Chat novo no Incoming leads do Funil de vendas - SDR (Stevo): aceita para a etapa inicial com o
 * Rodrigo responsável, põe a tag da Lara e devolve true (o agente segue e qualifica pela porta direta).
 */
export async function assumirContatoNovo(lead: KommoLead): Promise<boolean> {
  const cfg = CRM_MAP.contatoNovo
  const tags = leadTags(lead)
  if (motivoParaNaoAssumir(lead, tags)) return false
  const contatoId = (lead._embedded?.contacts || []).find(c => c.is_main)?.id || lead._embedded?.contacts?.[0]?.id
  if (!contatoId || (await leadsDoContato(contatoId)) > 1) return false // contato que já tem outro lead = cliente antigo
  if (await humanSpokeRecently(lead.id)) return false
  const hist = await getHistory(lead.id).catch(() => [])
  if (hist.some(m => m.dir === 'out')) return false // já houve resposta (time ou Lara): não é contato novo
  if ((await redis.set(k('contato-novo', lead.id), 1, { nx: true, ex: 30 * 86400 })) !== 'OK') return false
  const uid = await uidIncomingDoLead(lead.id, cfg.pipelineId)
  if (!uid) { await redis.del(k('contato-novo', lead.id)); return false }
  // Marca como iniciado: o aviso de "tag nova" (webhook/varredura) não manda uma segunda abertura
  await redis.set(k('inicio', lead.id), 'contato-novo', { ex: 30 * 86400 })
  await aceitarIncoming(uid, cfg.responsavelId, cfg.aceitarEm)
  await addLeadTags(lead.id, [CONFIG.gateTag, cfg.tag].filter(Boolean))
  await addLeadNote(lead.id, nota('Contato novo pelo WhatsApp: a Lara assumiu', [
    '✅ Aceito do Incoming leads para INICIAL - ENRIQUECIMENTO',
    '☺️ Responsável: Rodrigo',
    '✍️ A Lara qualifica pela conversa e oferece a análise com o especialista',
  ])).catch(() => undefined)
  await logExec({ tipo: 'inicio', leadId: lead.id, nome: lead.name, detalhe: 'contato novo pelo WhatsApp: aceito do Incoming e tag da Lara' })
  return true
}
