import { CRM_MAP } from './crm-map'
import { getContact, getLead } from './kommo'
import { k, redis } from './redis'
import { sendReply } from './transport'

/** Nota que entra no histórico quando a mídia chega sem arquivo (a Lara não responde no escuro). */
export const NOTA_MIDIA_SEM_ARQUIVO = '[o lead mandou uma mídia (áudio, foto ou arquivo) que não carregou; o especialista vai ver e responder]'

/**
 * Mídia que chegou só como aviso, sem o arquivo (o canal não entregou o anexo):
 * avisa o time no lead de avisos, uma vez a cada 2h por lead.
 */
export async function avisarMidiaSemArquivo(leadId: number): Promise<void> {
  const alvo = CRM_MAP.avisoCloser.leadId
  if (!alvo || alvo === leadId) return
  if ((await redis.set(k('aviso-audio', leadId), 1, { nx: true, ex: 7200 })) !== 'OK') return
  const lead = await getLead(leadId).catch(() => null)
  const contatoId = (lead?._embedded?.contacts || []).find(c => c.is_main)?.id
  const nome = (contatoId ? (await getContact(contatoId).catch(() => null))?.name : '') || lead?.name || `Lead #${leadId}`
  await sendReply(alvo, `✉️ *Mídia para você ver*\n\n${nome} mandou uma mídia (áudio, foto ou arquivo) que chegou sem o arquivo, então a Lara não conseguiu abrir. Ela não respondeu.\nVeja no WhatsApp e responda pelo card:\n\n➡️ https://controlgestao.kommo.com/leads/detail/${leadId}`)
}
