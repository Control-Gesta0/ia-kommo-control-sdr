import { rotulo } from './agenda'
import { CONFIG } from './config'
import { CRM_MAP } from './crm-map'
import { avancar, NOMES } from './etapas'
import { logExec } from './execlog'
import { agendarLembretes, cancelarFollowup } from './followup'
import { lerEventoGoogle, moverEventoGoogle } from './google'
import { appendMessage } from './history'
import { getContact, getLead, kommoGet } from './kommo'
import { nota } from './notas'
import { kommoPort } from './port'
import { k, redis } from './redis'
import { primeiroNomeDe } from './saudacao'
import { sendReply } from './transport'
import { rotuloLembretes } from './tools'

/**
 * Reunião marcada À MÃO pelo campo "Reunião" (data e hora) do card: cria o evento
 * na agenda do Rodrigo com Meet, avisa o cliente com o link, agenda os lembretes
 * (24h, 1h e 10 min com o link), move para APRESENTAÇÃO agendada e tira a Lara.
 * Alterar o campo de novo = remarca (move o evento e os lembretes).
 *
 * Só vale mudança feita por uma PESSOA há pouco (evento da Kommo com autor humano):
 * reunião antiga no campo ou a escrita da própria Lara não disparam nada.
 */

const JANELA = 15 * 60_000

interface EventoCampo { created_at: number; created_by: number; value_after?: Array<{ custom_field_value?: { text?: string } }> }

/** Chamado pelo webhook update_lead quando o campo aparece no payload (valor bruto só para dedupe). */
export async function conferirReuniaoManual(leadId: number, valorBruto: string): Promise<string> {
  const fieldId = CRM_MAP.dataReuniaoFieldId
  if (!fieldId) return 'sem campo'
  // Mesmo valor que já vimos = nada mudou (a Kommo manda o campo em toda alteração do lead)
  const chave = k('reuniao-vista', leadId)
  if ((await redis.get<string>(chave)) === valorBruto) return 'sem mudança'
  await redis.set(chave, valorBruto, { ex: 90 * 86400 })

  const ev = await kommoGet<{ _embedded?: { events?: EventoCampo[] } }>(`/api/v4/events?filter[entity]=lead&filter[entity_id]=${leadId}&filter[type]=custom_field_${fieldId}_value_changed&limit=1`).catch(() => null)
  const ultimo = ev?._embedded?.events?.[0]
  if (!ultimo || !ultimo.created_by || Date.now() - ultimo.created_at * 1000 > JANELA) return 'mudança antiga ou automática'

  const lead = await getLead(leadId)
  const v = (lead.custom_fields_values || []).find(f => f.field_id === fieldId)?.values?.[0]?.value
  const ini = typeof v === 'number' ? v * 1000 : Number(v) * 1000
  if (!ini || !Number.isFinite(ini)) return 'campo vazio'
  return agendarManual(leadId, ini, ultimo.created_by)
}

export async function agendarManual(leadId: number, ini: number, autor = 0): Promise<string> {
  if ((await redis.set(k('manual', leadId, ini), 1, { nx: true, ex: 86400 })) !== 'OK') return 'já tratado'
  const port = kommoPort(leadId)
  const state = await port.getState()
  const agora = Date.now()
  const fim = ini + CRM_MAP.agenda.duracaoMin * 60_000
  const label = rotulo(ini, agora)
  if (state.reuniao?.ini === ini) return 'mesma reunião (escrita da própria Lara)'
  if (ini < agora + 10 * 60_000) {
    await port.addNote(nota('Reunião NÃO marcada: horário no passado ou em menos de 10 min', [`⏰ Campo "Reunião": ${new Date(ini).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`])).catch(() => undefined)
    return 'horário no passado'
  }

  const lead = await getLead(leadId)
  const contatoId = (lead._embedded?.contacts || []).find(c => c.is_main)?.id || lead._embedded?.contacts?.[0]?.id
  const contato = contatoId ? await getContact(contatoId).catch(() => null) : null
  const nome = primeiroNomeDe(contato?.name || '') || primeiroNomeDe(state.respondenteNome || '')

  // Remarcação: move o evento que já existe
  let id = ''
  let link = ''
  let remarcou = false
  if (state.reuniao?.taskId?.startsWith('g:')) {
    const atual = await lerEventoGoogle(state.reuniao.taskId.slice(2)).catch(() => null)
    if (atual && atual.status !== 'cancelled') {
      const ev = await moverEventoGoogle(atual.id, ini, fim)
      id = `g:${ev.id}`; link = ev.link || atual.link; remarcou = true
    }
  }
  if (!id) {
    const criada = await port.criarReuniao({ ini, fim, texto: `Reunião marcada pelo time no card (lead #${leadId}).${state.comentario ? ` Pedido: ${state.comentario.slice(0, 300)}` : ''}` })
    id = criada.id; link = criada.link
  }
  if (!link) link = String((await port.getLead()).fields[CRM_MAP.linkReuniaoFieldId]?.value || CONFIG.linkReuniao || '')
  if (link && CRM_MAP.linkReuniaoFieldId) await port.writeFields([{ field_id: CRM_MAP.linkReuniaoFieldId, values: [{ value: link }] }]).catch(() => undefined)

  await port.patchState({ reuniao: { ini, fim, label, taskId: id, em: new Date(agora).toISOString() }, oferta: [], finalizado: { motivo: 'agendado', resumo: `Reunião marcada à mão para ${label}.`, em: new Date(agora).toISOString() } })
  await agendarLembretes(leadId, ini, id, agora)
  await cancelarFollowup(leadId, ['sdr']).catch(() => undefined)
  // A Lara sai da conversa: daqui pra frente é com o time
  if (CONFIG.gateTag) await port.removeTags([CONFIG.gateTag]).catch(() => undefined)
  await port.addTags([CRM_MAP.tags.reuniao]).catch(() => undefined)

  const n = nome ? `, ${nome}` : ''
  const texto = remarcou
    ? `Oi${n}! Sua reunião com o especialista da Control Gestão foi remarcada para ${label}.${link ? ` O link continua este: ${link}` : ''}\nQualquer coisa é só me chamar por aqui.`
    : `Oi${n}! Aqui é a Lara, da Control Gestão. Sua reunião com o nosso especialista ficou marcada para ${label}.${link ? `\nO link é este: ${link}\nConfere se abre certinho aí?` : '\nO especialista te chama por aqui no horário.'} Te lembro um pouco antes.`
  const detalhe = await sendReply(leadId, texto)
  await appendMessage(leadId, { id: `manual:${ini}`, dir: 'out', text: texto, ts: agora })

  const moveu = await avancar(port, 'agendado', [], true).catch(() => false)
  await port.addNote(nota(`${moveu ? `Etapa: ${NOMES.agendado} · ` : ''}Reunião ${remarcou ? 'REMARCADA' : 'marcada'} pelo time (campo "Reunião")`, [
    `⏰ ${label.replace(/^./, c => c.toUpperCase())}`,
    link ? `➡️ ${link}` : '⚠️ Sem link: preencha o campo "Link da Reunião"',
    id.startsWith('g:') ? '⭐ Evento no Google Agenda com Google Meet' : '☑️ Tarefa de reunião no Kommo',
    `✉️ Cliente avisado no WhatsApp`,
    `⏳ Lembretes para o cliente: ${rotuloLembretes()}`,
  ])).catch(() => undefined)
  await logExec({ tipo: 'finalizou', leadId, nome: contato?.name || '', detalhe: `reunião ${remarcou ? 'remarcada' : 'marcada'} à mão (${label}) por ${autor} · ${detalhe}` })
  return remarcou ? 'remarcada' : 'marcada'
}
