import { CONFIG } from './config'
import { addLeadTags } from './kommo'
import { k, redis } from './redis'

/**
 * Comando "reset" — SÓ para leads em TEST_LEAD_IDS (lead real que digitar
 * "reset" não apaga nada). Zera memória, porta e estado, e devolve a tag de gate
 * para o teste recomeçar como lead novo.
 */

export const isResetCommand = (leadId: number, text: string) =>
  CONFIG.testLeadIds.includes(leadId) && /^\s*reset\s*$/i.test(text)

export async function resetLead(leadId: number): Promise<void> {
  await redis.del(k('conv', leadId), k('state', leadId), k('done', leadId), k('token', leadId), k('lock', leadId), k('rl', leadId), k('sent', leadId), k('humano', leadId), k('inicio', leadId), k('incoming', leadId))
  if (CONFIG.gateTag) await addLeadTags(leadId, [CONFIG.gateTag])
}
