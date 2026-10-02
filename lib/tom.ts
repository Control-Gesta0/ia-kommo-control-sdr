import { campoByKey } from './crm-map'
import { cumprimentarDeVolta, cumprimentoDoLead, garantirSaudacao, naturalizar, pedirNomeSeFalta, primeiroNomeDe, saudacao, semGeneralizacaoRepetida, semSolucaoRepetida, tirarApresentacao, tirarSaudacao, vocativoCerto } from './saudacao'

/**
 * Acabamento em código de TODA resposta da Lara (o que o comercial pediu e o
 * modelo às vezes esquece): saudação e apresentação só na primeira mensagem,
 * nome do lead de vez em quando e nunca o de outra pessoa, reação variada,
 * nicho uma vez só, pergunta 1 dupla e pedido do nome quando não se sabe.
 */
export function ajustarResposta(texto: string, o: {
  primeiro: boolean
  nomeCadastro: string
  respondenteNome?: string
  anteriores: string[]
  faltaVendedores: boolean
  handoff: boolean
  agora?: number
  /** o lead contou a dor agora ou perguntou algo: a solução/resposta desta mensagem não é cortada */
  protegerSolucao?: boolean
  /** o lead só cumprimentou ("Bom dia"): a resposta devolve o cumprimento dele (cumprimentoDoLead) */
  cumprimento?: string
}): string {
  const nomeLead = primeiroNomeDe(o.nomeCadastro) || primeiroNomeDe(o.respondenteNome || '')
  let t = o.primeiro
    ? garantirSaudacao(texto, saudacao(o.agora ?? Date.now()), nomeLead)
    : (() => {
      const base = semGeneralizacaoRepetida(naturalizar(tirarApresentacao(tirarSaudacao(texto)), nomeLead, o.anteriores, o.nomeCadastro), o.anteriores)
      const semRepetir = o.protegerSolucao ? base : semSolucaoRepetida(base, o.anteriores)
      return o.cumprimento ? cumprimentarDeVolta(semRepetir, o.cumprimento, nomeLead) : semRepetir
    })()
  t = vocativoCerto(t, nomeLead)
  if (!o.handoff) t = pedirNomeSeFalta(t, !!nomeLead, o.anteriores.length)
  return t
}

/**
 * O que o turno do lead pede do acabamento (o mesmo em produção e nos evals):
 * - protegerSolucao: ele contou o problema agora (novo ou mais específico, como "o pior é orçamento
 *   que ninguém retorna") ou perguntou algo: a solução/resposta desta mensagem não é cortada como repetida;
 * - cumprimento: ele só cumprimentou, a resposta devolve o cumprimento dele.
 */
export function acabamentoDoTurno(textoTurno: string, dorAntes: boolean, dorDepois: boolean): { protegerSolucao: boolean; cumprimento: string } {
  const t = (textoTurno || '').trim()
  const cumprimento = cumprimentoDoLead(t)
  const contouProblema = !cumprimento && t.length >= 15 && !!campoByKey('dor')?.sinal?.test(t)
  return { protegerSolucao: (!dorAntes && dorDepois) || t.includes('?') || contouProblema, cumprimento }
}

/**
 * Resposta + pergunta em DUAS mensagens (pedido do comercial, 02/10): parece gente digitando.
 * Só divide quando há um parágrafo de resposta/solução SEM pergunta seguido do(s) parágrafo(s)
 * com a pergunta. Resposta sem pergunta, ou que já começa perguntando, sai inteira.
 */
export function dividirMensagem(texto: string): string[] {
  const partes = (texto || '').trim().split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  const q = partes.findIndex(p => p.includes('?'))
  if (q < 1) return [texto.trim()]
  const antes = partes.slice(0, q).join('\n\n')
  const depois = partes.slice(q).join('\n\n')
  if (antes.length < 40 || /https?:\/\/|meet\.google/.test(depois)) return [texto.trim()]
  return [antes, depois]
}
