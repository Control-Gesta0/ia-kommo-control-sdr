import crypto from 'crypto'
import { adoptToken, currentToken, debounceAndClaim, releaseLock, renewLock } from './buffer'
import { CONFIG } from './config'
import { logExec } from './execlog'
import {
  alreadyAnswered, appendMessage, getHistory, humanSpokeRecently, lastInbound, markAnswered, type ChatMsg,
} from './history'
import { getContact, getLead, leadTags } from './kommo'
import { garantirSaudacao, naturalizar, primeiroNomeDe, saudacao, tirarSaudacao } from './saudacao'
import { createBrain } from './llm'
import { kommoPort } from './port'
import { rotear } from './router'
import { clearState, getState, patchState } from './state'
import { aplicarFinalizacao, type ToolCtx } from './tools'
import { agendarFollowup, cancelarFollowup } from './followup'
import { addLeadNote } from './kommo'
import { nota } from './notas'
import { k, redis } from './redis'
import { sendReply } from './transport'

/**
 * Núcleo: gate → buffer → roteador (código) → cérebro (LLM) → travas → envio.
 * A mensagem inbound JÁ está no histórico quando chega aqui.
 */

const MAX_ROUNDS = 3


const brain = createBrain({ apiKey: CONFIG.openaiApiKey, model: CONFIG.llmModel })

/** Bloco atual do lead: inbounds depois da última outbound. */
function blocoAtual(history: ChatMsg[]): ChatMsg[] {
  const i = history.map(m => m.dir).lastIndexOf('out')
  return history.slice(i + 1).filter(m => m.dir === 'in')
}

async function enviar(leadId: number, text: string): Promise<string> {
  const detail = await sendReply(leadId, text)
  await appendMessage(leadId, { id: crypto.randomUUID(), dir: 'out', text, ts: Date.now() })
  return detail
}

export { brain }

export async function processLead(leadId: number, webhookId: string): Promise<void> {
  const t0 = Date.now()
  let lockOwner: string | undefined
  let nome = ''
  const pular = async (motivo: string, registrar = true) => {
    console.log(`[agente] PULOU lead ${leadId} (${nome}): ${motivo}`)
    if (registrar) await logExec({ tipo: 'pulou', leadId, nome, detalhe: motivo })
  }
  try {
    const lead = await getLead(leadId)
    nome = lead.name || ''
    const contatoId = (lead._embedded?.contacts || []).find(c => c.is_main)?.id || lead._embedded?.contacts?.[0]?.id
    const nomePessoa = contatoId ? (await getContact(contatoId).catch(() => null))?.name || '' : ''
    const tags = leadTags(lead).map(t => t.toLowerCase())
    if (tags.includes(CONFIG.humanTag)) return pular(`tag "${CONFIG.humanTag}"`, false)
    // Gate: sem a tag, silêncio (e sem poluir o diário — a conta inteira manda add_message)
    if (CONFIG.gateTag && !tags.includes(CONFIG.gateTag)) return pular(`sem a tag "${CONFIG.gateTag}"`, false)
    if (await humanSpokeRecently(leadId)) {
      // Nota uma vez por ciclo (não a cada mensagem)
      if ((await redis.set(k('nota-humano', leadId), 1, { nx: true, ex: 6 * 3600 })) === 'OK') {
        await addLeadNote(leadId, nota('Pausada: uma pessoa do time respondeu', ['👤 A Lara não atropela quem está atendendo', '▶️ Volta sozinha 6h depois da última mensagem do time (se a tag ia-sdr continuar)'])).catch(() => undefined)
      }
      return pular('humano falou pelo Kommo nas últimas 6h — a IA não atropela')
    }

    // Tag de gate de volta num lead já finalizado = novo ciclo (lead voltou a entrar)
    const st0 = await getState(leadId)
    if (st0.finalizado) {
      await clearState(leadId)
      console.log(`[agente] lead ${leadId} voltou com a tag de gate — novo ciclo`)
    }

    const claim = await debounceAndClaim(leadId, webhookId)
    if (!claim.proceed) { console.log(`[debounce] lead ${leadId}: ${claim.reason}`); return }
    lockOwner = claim.lockOwner
    let myToken = webhookId

    for (let round = 0; round < MAX_ROUNDS; round++) {
      await renewLock(leadId, lockOwner!)
      const history = await getHistory(leadId)
      const target = lastInbound(history)
      if (!target) return
      if (await alreadyAnswered(leadId, target.id)) return

      const bloco = blocoAtual(history)
      const textoTurno = bloco.map(m => m.text).join('\n')
      const state = await getState(leadId)

      // 1. Roteador em código
      const rota = rotear(state, textoTurno)
      if (rota.tipo === 'mensagem') {
        await patchState(leadId, rota.patch)
        const detail = await enviar(leadId, rota.texto)
        await markAnswered(leadId, target.id)
        await logExec({ tipo: 'menu', leadId, nome, ms: Date.now() - t0, detalhe: `${detail} · ${rota.texto.slice(0, 60)}` })
        return
      }
      const porta = rota.porta
      if (rota.travou) {
        await patchState(leadId, { porta: porta.id, portaEm: bloco[0]?.ts ?? target.ts, aguardandoResumo: false })
        console.log(`[roteador] lead ${leadId} → porta ${porta.id}`)
      }
      const portaEm = (await getState(leadId)).portaEm ?? 0
      const conversa = history.filter(m => m.ts >= portaEm)

      const port = kommoPort(leadId)
      const iLast = conversa.map(m => m.dir).lastIndexOf('in')
      const ctx: ToolCtx = {
        port, porta, gateTag: CONFIG.gateTag,
        // O Comment da indicação foi escrito pelo próprio cliente: vale como evidência dele
        leadText: [(await getState(leadId)).comentario || '', ...conversa.filter(m => m.dir === 'in').map(m => m.text)].join('\n'),
        lastLeadText: textoTurno,
        lastAgentText: [...conversa.slice(0, Math.max(iLast, 0))].reverse().find(m => m.dir === 'out')?.text || '',
      }

      // 2. Porta sem agente: mensagem fixa e finaliza (sem LLM)
      if (!porta.ativa) {
        const texto = porta.mensagemSemAgente || 'Anotei aqui. Alguém da equipe continua a conversa com você por aqui.'
        await aplicarFinalizacao(ctx, 'porta_sem_agente', `Assunto: ${porta.label}. Primeira mensagem: ${textoTurno.slice(0, 300)}`)
        const detail = await enviar(leadId, texto)
        await markAnswered(leadId, target.id)
        await logExec({ tipo: 'finalizou', leadId, nome, porta: porta.id, ms: Date.now() - t0, detalhe: `porta sem agente · ${detail}` })
        return
      }

      // 3. Cérebro
      const primeiroContatoDaPorta = !conversa.some(m => m.dir === 'out')
      const reply = await brain.generateReply(ctx, { nomeContato: nomePessoa, primeiroContatoDaPorta }, conversa)
      if (!reply?.text) {
        await logExec({ tipo: 'erro', leadId, nome, porta: porta.id, detalhe: 'modelo não gerou resposta' })
        return
      }

      // Chegou mensagem nova durante a geração? Reprocessa com o contexto novo
      // (exceto se a IA já finalizou: a tag saiu, a despedida precisa sair)
      const tok = await currentToken(leadId)
      if (tok && tok !== myToken && !reply.handoff) {
        myToken = tok
        await adoptToken(leadId, myToken)
        continue
      }

      // Só a primeira mensagem cumprimenta; nela, saudação certa do horário + primeiro nome de pessoa
      const anteriores = conversa.filter(m => m.dir === 'out').map(m => m.text)
      reply.text = primeiroContatoDaPorta ? garantirSaudacao(reply.text, saudacao(Date.now()), primeiroNomeDe(nomePessoa)) : naturalizar(tirarSaudacao(reply.text), primeiroNomeDe(nomePessoa), anteriores)
      const detail = await enviar(leadId, reply.text)
      await markAnswered(leadId, target.id)
      // Follow-up: finalizou (reunião, suporte, licença...) = para; senão recomeça a contar desta mensagem
      if (reply.handoff) await cancelarFollowup(leadId, ['sdr'])
      else await agendarFollowup(leadId, Date.now())
      await logExec({
        tipo: reply.handoff ? 'finalizou' : 'resposta', leadId, nome, porta: porta.id, ms: Date.now() - t0,
        tools: reply.toolsUsed, guard: reply.guard, usage: reply.usage, urgente: reply.urgente || undefined, detalhe: detail,
      })
      console.log(`[agente] RESPONDEU lead ${leadId} (${porta.id}) em ${Date.now() - t0}ms · tools: ${reply.toolsUsed.join(', ') || '—'}${reply.guard.length ? ` · trava: ${reply.guard.join(' | ')}` : ''}`)
      return
    }
    await pular('MAX_ROUNDS: lead mandando rápido demais — o próximo webhook responde')
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300)
    console.error(`[agente] ERRO lead ${leadId} após ${Date.now() - t0}ms: ${msg}`, e)
    await logExec({ tipo: 'erro', leadId, nome, ms: Date.now() - t0, detalhe: msg })
  } finally {
    await releaseLock(leadId, lockOwner)
  }
}
