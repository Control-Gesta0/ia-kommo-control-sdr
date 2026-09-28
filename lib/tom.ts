import { garantirSaudacao, naturalizar, pedirNomeSeFalta, primeiroNomeDe, saudacao, semGeneralizacaoRepetida, semSolucaoRepetida, tirarApresentacao, tirarSaudacao, vocativoCerto } from './saudacao'

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
}): string {
  const nomeLead = primeiroNomeDe(o.nomeCadastro) || primeiroNomeDe(o.respondenteNome || '')
  let t = o.primeiro
    ? garantirSaudacao(texto, saudacao(o.agora ?? Date.now()), nomeLead)
    : (() => {
      const base = semGeneralizacaoRepetida(naturalizar(tirarApresentacao(tirarSaudacao(texto)), nomeLead, o.anteriores, o.nomeCadastro), o.anteriores)
      return o.protegerSolucao ? base : semSolucaoRepetida(base, o.anteriores)
    })()
  t = vocativoCerto(t, nomeLead)
  if (!o.handoff) t = pedirNomeSeFalta(t, !!nomeLead, o.anteriores.length)
  return t
}
