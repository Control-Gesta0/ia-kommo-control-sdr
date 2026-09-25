import { CRM_MAP } from './crm-map'
import { nota } from './notas'
import type { LeadPort } from './tools'

/**
 * Etapas do funil que a Lara move, SEMPRE para frente e só dentro do funil de
 * indicações (fail-closed: outro funil, etapa desconhecida ou etapa depois da
 * alçada = não mexe). Ordem real do funil 4338500 (25/09/2026):
 *   INICIAL - ENRIQUECIMENTO → em contato → QUALIFICAÇÃO → APRESENTAÇÃO agendada
 * Daí para frente é o Rodrigo quem move.
 */
export type EtapaSdr = 'entrada' | 'emContato' | 'qualificado' | 'agendado'

export function ordemSdr(): Array<{ nome: EtapaSdr; id: number }> {
  const f = CRM_MAP.funilSdr
  return [
    { nome: 'entrada', id: CRM_MAP.entrada.statusId },
    { nome: 'emContato', id: f.emContato },
    { nome: 'qualificado', id: f.qualificado },
    { nome: 'agendado', id: CRM_MAP.etapaAgendado.id },
  ]
}

/** Decisão pura: pode mover de `statusAtual` para `alvo`? */
export function podeAvancar(pipelineAtual: number, statusAtual: number, alvo: EtapaSdr): boolean {
  if (pipelineAtual !== CRM_MAP.entrada.pipelineId) return false
  const ordem = ordemSdr()
  const iAtual = ordem.findIndex(e => e.id === statusAtual)
  const iAlvo = ordem.findIndex(e => e.nome === alvo)
  if (iAtual < 0 || iAlvo < 0 || !ordem[iAlvo].id) return false
  return iAlvo > iAtual
}

export const NOMES: Record<EtapaSdr, string> = { entrada: 'INICIAL - ENRIQUECIMENTO', emContato: 'EM CONTATO', qualificado: 'QUALIFICAÇÃO', agendado: 'APRESENTAÇÃO AGENDADA' }

export async function avancar(port: LeadPort, alvo: EtapaSdr, linhas: Array<string | false | null | undefined | 0> = [], semNota = false): Promise<boolean> {
  const lead = await port.getLead()
  if (!podeAvancar(lead.pipelineId, lead.statusId, alvo)) return false
  const destino = ordemSdr().find(e => e.nome === alvo)!
  await port.moveStage(destino.id, CRM_MAP.entrada.pipelineId)
  if (!semNota) await port.addNote(nota(`Etapa: ${NOMES[alvo]}`, linhas)).catch(() => undefined)
  return true
}

/** CHAMP completo = todo grupo de exigirAntesDeAgendar tem ao menos uma resposta. */
export function champCompleto(respostas: Record<string, string> = {}, semResposta: string[] = []): boolean {
  return CRM_MAP.exigirAntesDeAgendar.every(g => g.some(k => !!respostas[k] || semResposta.includes(k)))
}
