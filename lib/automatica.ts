import { normalizar } from './indicacao'

/**
 * Resposta automática de empresa ("TD MOTOS agradece seu contato. Em breve lhe
 * atenderemos."): não é o lead falando. A Lara não responde e a cadência de
 * follow-up continua valendo (quem vai ler ainda não leu).
 */
const PADROES = [
  /\bagradece (o |seu |pelo |a sua |sua )?(contato|mensagem|preferencia)\b/,
  /\b(obrigad[oa]|agradecemos) (pelo|por entrar em|por seu|pelo seu|por sua|pela sua|pela) (contato|mensagem)\b.{0,80}\b(em breve|retorn|respond|atender|aguarde)/,
  /\bem breve (lhe |te |vamos |iremos |um de nossos|uma de nossas|nossa equipe|nosso time|retornaremos|responderemos|entraremos|daremos|seu atendimento)/,
  /\b(mensagem|resposta) automatica\b/,
  /\bfora do (nosso )?horario (de atendimento|comercial)\b/,
  /\b(nosso|o) horario de (atendimento|funcionamento) (e|eh|:)/,
  /\bno momento (nao (podemos|estamos|conseguimos)|estamos (ausentes|indisponiveis|fora|em atendimento))/,
  /\bretornaremos (o mais breve|assim que|em breve|seu contato|sua mensagem)/,
  /\bseja bem vind[oa] (a|ao|à)\b/,
  /\b(digite|escolha|selecione) (o numero|a opcao|uma (das )?opcoes|uma opcao|1\b)/,
  /\bestamos (ausentes|de ferias|fora do escritorio)\b/,
]

export function ehRespostaAutomatica(texto: string): boolean {
  const n = normalizar(texto)
  if (!n || n.length > 600) return false
  return PADROES.some(re => re.test(n))
}
