import crypto from 'crypto'
import OpenAI from 'openai'
import { CONFIG } from './config'
import { classificarTeste, type Classificacao } from './indicacao'
import { k, redis } from './redis'

/**
 * "É teste?" pela INTENÇÃO. A regra (userscript/filtro-indicacao.js) resolve o
 * óbvio de graça; só o AMBÍGUO ("teste" dentro de uma frase maior) vem para o
 * modelo. "Estamos testando o Kommo e queremos ajuda com o funil" é lead real;
 * "teste de integração, ignorar" não é.
 *
 * Falhou o modelo → vale o palpite da regra (nunca trava o aceite).
 * Cache por hash do comentário: o userscript e o servidor perguntam a mesma
 * coisa com minutos de diferença e pagam uma vez só.
 */

const openai = new OpenAI({ apiKey: CONFIG.openaiApiKey })

const SISTEMA = `Você recebe o texto que uma empresa escreveu ao pedir um parceiro de implantação do CRM Kommo (campo "Comment"). Decida a INTENÇÃO: é um pedido REAL de ajuda/serviço, ou é um TESTE (alguém testando o formulário, a distribuição de leads ou a integração, sem necessidade real)?
- Pessoa que diz estar testando/avaliando o Kommo, no período de teste, e quer ajuda para configurar, implantar ou decidir: REAL.
- Texto que só serve para testar o envio ("teste", "teste de integração", "lead de teste", "ignorar", texto sem sentido): TESTE.
- Na dúvida entre os dois, prefira REAL: perder um cliente custa mais que conversar com um teste.
Responda só JSON: {"teste": true|false, "confianca": 0 a 1, "motivo": "até 15 palavras"}`

export async function classificarIntencao(comentario: string, modo = CONFIG.filtroTesteModo): Promise<Classificacao> {
  const regra = { ...classificarTeste(comentario, modo), fonte: 'regra' as const }
  if (!regra.ambiguo) return regra
  const chave = k('intencao', crypto.createHash('sha1').update(comentario.trim().toLowerCase()).digest('hex').slice(0, 20))
  try {
    const cache = await redis.get<Classificacao>(chave)
    if (cache) return cache
    const r = await openai.chat.completions.create({
      model: CONFIG.llmModel,
      max_completion_tokens: 120,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SISTEMA }, { role: 'user', content: `Comment: """${comentario.slice(0, 1500)}"""` }],
    })
    const j = JSON.parse(r.choices[0]?.message?.content || '{}') as { teste?: boolean; confianca?: number; motivo?: string }
    if (typeof j.teste !== 'boolean') return regra
    const out: Classificacao = { teste: j.teste, ambiguo: true, nivel: regra.nivel, motivo: `IA: ${String(j.motivo || '').slice(0, 120)} (confiança ${Number(j.confianca ?? 0).toFixed(2)})`, fonte: 'ia' }
    await redis.set(chave, out, { ex: 30 * 86400 })
    return out
  } catch (e) {
    console.warn('[intencao] modelo falhou, vale a regra:', e instanceof Error ? e.message : e)
    return regra
  }
}
