import { CONFIG } from './config'
import { cancelarFollowup } from './followup'
import { addLeadTags } from './kommo'
import { k, redis } from './redis'
import { getState } from './state'

/**
 * Comando "reset" (a mensagem inteira é só "reset"): recomeça o teste/demonstração
 * do zero. Vale para leads em TEST_LEAD_IDS e para leads de contato direto (tag
 * ia-sdr colocada à mão). Lead de indicação real que digitar "reset" não apaga nada.
 */

export async function podeResetar(leadId: number, text: string): Promise<boolean> {
  if (!/^\s*reset\s*$/i.test(text)) return false
  if (CONFIG.testLeadIds.includes(leadId)) return true
  const st = await getState(leadId)
  return !st.comentario && !st.iniciadoPor
}

export async function resetLead(leadId: number): Promise<void> {
  await cancelarFollowup(leadId).catch(() => undefined)
  await redis.del(k('conv', leadId), k('state', leadId), k('done', leadId), k('token', leadId), k('lock', leadId), k('rl', leadId), k('sent', leadId), k('humano', leadId), k('inicio', leadId), k('incoming', leadId), k('lem', leadId), k('nota-humano', leadId), k('fu', 'neg', leadId))
  await redis.zrem(k('fila'), `lem24:${leadId}`, `lem1:${leadId}`)
  if (CONFIG.gateTag) await addLeadTags(leadId, [CONFIG.gateTag])
}
