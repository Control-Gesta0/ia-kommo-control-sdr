import type OpenAI from 'openai'
import { ehAfirmativo, escolherOpcoes, gerarLivres, parsePreferencia, resolverEscolha, slotsCitados, type Intervalo, type Slot } from './agenda'
import { CRM_MAP, campoByKey, type Campo, type Porta } from './crm-map'
import { avancar, champCompleto, NOMES } from './etapas'
import { nota } from './notas'
import { DISSE_NAO_SEI, evidenceFound, matchOption, overlap, parseNumeroBR } from './guards'
import type { KommoFieldValue } from './kommo'
import { classificar } from './router'
import type { LeadState } from './state'

/**
 * As tools falam com o CRM por uma PORTA DE DADOS. Produção = Kommo + Redis
 * (lib/port.ts); evals/testes = memória. A regra de negócio é a MESMA.
 */

export interface LeadView { id: number; statusId: number; pipelineId: number; fields: Record<number, { value?: unknown; enumIds: number[] }>; tags: string[] }

export interface LeadPort {
  getLead(): Promise<LeadView>
  writeFields(values: KommoFieldValue[]): Promise<void>
  moveStage(statusId: number, pipelineId: number): Promise<void>
  addTags(tags: string[]): Promise<void>
  removeTags(tags: string[]): Promise<void>
  addNote(text: string): Promise<void>
  /** agenda: ocupado do closer entre ini e fim (ms). Erro = não consegue ver a agenda */
  buscarOcupados(ini: number, fim: number): Promise<Intervalo[]>
  /** agenda: cria a reunião (tarefa no Kommo). Devolve o id */
  /** Cria a reunião (Google com Meet, ou tarefa do Kommo). id 'g:…' = evento do Google; link vazio = sem Meet */
  criarReuniao(r: { ini: number; fim: number; texto: string }): Promise<{ id: string; link: string }>
  /** tarefa simples para o closer (ex.: preencher o link da reunião) */
  criarTarefaCloser(texto: string): Promise<void>
  /** WhatsApp pessoal do closer (reunião marcada). Opcional: sem ele, não avisa */
  avisarCloser?(texto: string, chave: string): Promise<void>
  /** agenda os lembretes da reunião para o cliente (24h e 1h antes) */
  agendarLembretes(r: { ini: number; taskId: string }): Promise<void>
  getState(): Promise<LeadState>
  patchState(p: Partial<LeadState>): Promise<LeadState>
}

export interface ToolCtx {
  port: LeadPort
  porta: Porta
  gateTag: string
  /** tudo que o lead escreveu (trava anti-invenção) */
  leadText: string
  /** último bloco do lead (o turno atual) */
  lastLeadText: string
  /** última mensagem da IA antes do turno (a pergunta respondida) */
  lastAgentText: string
  /** relógio (evals fixam; produção = Date.now()) */
  agora?: number
}

export interface ToolOutcome { content: string; isError: boolean; handoff?: boolean; urgente?: boolean }

const ok = (content: string, extra: Partial<ToolOutcome> = {}): ToolOutcome => ({ content, isError: false, ...extra })
const err = (content: string): ToolOutcome => ({ content, isError: true })

/**
 * Motivos que o MODELO pode usar. "agendado" não está aqui de propósito: só a
 * tool agendar_reuniao finaliza assim, depois da tarefa criada de verdade.
 */
export const MOTIVOS = ['qualificado_sem_reuniao', 'venda_licenca', 'suporte', 'ja_tem_parceiro', 'fora_do_escopo', 'pediu_humano', 'desistiu'] as const
type Motivo = typeof MOTIVOS[number]

/** Sinal mínimo que a evidência precisa ter para cada motivo de finalização. */
const SINAL_MOTIVO: Partial<Record<Motivo, RegExp>> = {
  ja_tem_parceiro: /parceir|consultor|consultoria|outra empresa|outra ag[eê]ncia|j[aá] (fechei|fechamos|contratei|contratamos|estou com|estamos com|tenho algu|temos algu)/i,
  desistiu: /desist|n[aã]o (quero|tenho interesse|preciso|vou precisar) mais|deixa (pra|para) l[aá]|pode encerrar|n[aã]o quero continuar|n[aã]o vou (querer|continuar)|sem interesse|n[aã]o tenho interesse/i,
  suporte: /whats|conect|mensage|envi|caiu|cai|erro|n[aã]o (funciona|envia|chega|aparece|consigo|carrega)|parou|travou|trava|desconect|bug|problema|integra[cç]|login|senha|acesso|cobran/i,
  pediu_humano: /humano|pessoa|atendente|consultor|especialista|vendedor|algu[eé]m|falar com|me liga|liga[cç][aã]o|telefone|reclam/i,
}

const NUM_PALAVRA: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 }

/** "5", "uns 3 vendedores", "só eu" → número. null = não dá para saber. */
export function numeroVendedores(texto: string | undefined): number | null {
  if (!texto) return null
  const t = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (/\b(so eu|somente eu|apenas eu|sozinh[oa]|eu mesm[oa])\b/.test(t)) return 1
  const d = t.match(/\b(\d{1,4})\b/)
  if (d) return Number(d[1])
  const w = t.match(/\b(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\b/)
  return w ? NUM_PALAVRA[w[1]] : null
}

export function buildTools(porta: Porta): OpenAI.Chat.ChatCompletionTool[] {
  const tools: OpenAI.Chat.ChatCompletionTool[] = []
  if (porta.roteiro.length) {
    tools.push({
      type: 'function',
      function: {
        name: 'salvar_respostas',
        description: 'Grava TODAS as respostas do roteiro que o lead já deu (várias de uma vez se ele respondeu muita coisa numa mensagem). Chame ANTES de fazer a próxima pergunta. O retorno diz o que falta.',
        parameters: {
          type: 'object',
          properties: {
            respostas: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  campo: { type: 'string', enum: porta.roteiro },
                  evidencia: { type: 'string', description: 'Trecho LITERAL do que o lead escreveu que comprova a resposta. Sem trecho do lead = não salve.' },
                  valor: { type: 'string', description: 'Opção: o texto EXATO de uma das opções. Número: algarismos. Texto: como o lead disse. "Não sabe" só se ele disse que não sabe.' },
                },
                required: ['campo', 'evidencia', 'valor'],
                additionalProperties: false,
              },
            },
          },
          required: ['respostas'],
          additionalProperties: false,
        },
      },
    })
  }
  tools.push(
    {
      type: 'function',
      function: {
        name: 'registrar_respondente',
        description: 'Registra QUEM está digitando quando não é quem pediu a indicação (ex.: a secretária falando pelo dono). Depois chame a pessoa pelo nome dela.',
        parameters: {
          type: 'object',
          properties: { nome: { type: 'string' }, relacao: { type: 'string', description: 'sócio, secretária, gerente, funcionário, o próprio...' } },
          required: ['nome', 'relacao'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'finalizar_atendimento',
        description: 'Encerra a participação da IA SEM reunião marcada (reunião marcada quem encerra é agendar_reuniao). Chame ANTES de escrever a mensagem de encerramento. Motivos: qualificado_sem_reuniao (qualificou mas a agenda falhou ou o lead não quer marcar agora); venda_licenca (o lead só precisa da LICENÇA, sem implantação, e quer comprar: o time manda o link/proposta; ponha plano e nº de usuários no resumo); suporte (pedido de suporte técnico: WhatsApp caiu, mensagem não envia, conectar número); ja_tem_parceiro (já fechou com outro parceiro/consultoria); fora_do_escopo (não é implantação/uso do Kommo); pediu_humano; desistiu. Depois envie a mensagem de encerramento e NÃO faça perguntas.',
        parameters: {
          type: 'object',
          properties: {
            motivo: { type: 'string', enum: [...MOTIVOS] },
            evidencia: { type: 'string', description: 'Trecho literal do lead que justifica o motivo (dispensado para "qualificado_sem_reuniao")' },
            resumo: { type: 'string', description: '2 a 4 frases para a equipe: quem é, a situação e o que busca' },
          },
          required: ['motivo', 'resumo'],
          additionalProperties: false,
        },
      },
    },
  )
  // Só faz sentido com mais de uma porta (assunto de OUTRA área atendida)
  if (CRM_MAP.portas.filter(p => p.ativa).length > 1) {
    tools.push(
      {
        type: 'function',
        function: {
          name: 'registrar_outro_assunto',
          description: 'O lead trouxe um assunto de OUTRA ÁREA atendida pelo escritório (outro serviço, não uma dúvida do assunto atual). Registra para a equipe; você continua no assunto atual.',
          parameters: {
            type: 'object',
            properties: { assunto: { type: 'string' }, evidencia: { type: 'string', description: 'Trecho literal do lead' } },
            required: ['assunto', 'evidencia'],
            additionalProperties: false,
          },
        },
      },
    )
  }
  if (CRM_MAP.agenda.ativa) {
    tools.push(
      {
        type: 'function',
        function: {
          name: 'consultar_horarios',
          description: 'Busca horários LIVRES reais na agenda do especialista para a reunião. Chame quando for oferecer a reunião ou quando o lead disser um dia/turno/horário que prefere. Ofereça ao lead SÓ as opções que esta tool devolver, com as palavras exatas (hoje/amanhã/dia da semana).',
          parameters: {
            type: 'object',
            properties: { preferencia: { type: 'string', description: 'O que o lead disse sobre dia/turno/horário, com as palavras dele ("terça à tarde", "a partir das 16h"). Vazio se ele não disse nada.' } },
            required: ['preferencia'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'agendar_reuniao',
          description: 'Marca a reunião no horário que o LEAD ESCOLHEU entre as opções oferecidas. Só chame depois que ele escolheu ou confirmou um horário. Se der erro, siga a instrução do erro. Depois do sucesso, confirme dia e hora ao lead e NÃO faça pergunta.',
          parameters: {
            type: 'object',
            properties: {
              horario: { type: 'string', description: 'O horário escolhido, exatamente como foi oferecido (ex.: "amanhã, quinta 26/09 às 10h")' },
              decisor_convidado: { type: 'string', description: 'Se quem decide é OUTRA pessoa: nome/cargo dela, que foi convidada para a reunião. Vazio se o próprio lead decide.' },
            },
            required: ['horario', 'decisor_convidado'],
            additionalProperties: false,
          },
        },
      },
    )
  }
  if (CRM_MAP.etapas.length) {
    tools.push({
      type: 'function',
      function: {
        name: 'mover_etapa',
        description: `Move o lead de etapa. Opções: ${CRM_MAP.etapas.map(e => `"${e.name}" (${e.quando})`).join('; ')}`,
        parameters: {
          type: 'object',
          properties: { etapa: { type: 'string', enum: CRM_MAP.etapas.map(e => e.name) } },
          required: ['etapa'],
          additionalProperties: false,
        },
      },
    })
  }
  return tools
}

// ---------- Snapshot do roteiro ----------

export interface Snapshot { preenchidos: Array<{ campo: Campo; valor: string }>; abertos: Campo[] }

export function snapshot(porta: Porta, state: LeadState): Snapshot {
  const preenchidos: Snapshot['preenchidos'] = []
  const abertos: Campo[] = []
  for (const key of porta.roteiro) {
    const campo = campoByKey(key)
    if (!campo) continue
    const v = state.respostas?.[key]
    if (v) preenchidos.push({ campo, valor: v })
    else if (!(state.semResposta || []).includes(key)) abertos.push(campo)
  }
  return { preenchidos, abertos }
}

export function describeOpen(porta: Porta, s: Snapshot, prioridade: string[] = []): string {
  if (!porta.roteiro.length) return ''
  if (!s.abertos.length) return 'Roteiro COMPLETO: agora VENDA a reunião (ligue a dor dele ao que fazemos e ofereça a análise gratuita com o especialista, perguntando se ele quer marcar). Só chame consultar_horarios depois que ele topar ou se ele já pediu horário.'
  const aberto = (k: string) => s.abertos.some(c => c.key === k)
  // Onde organizam + quantos vendedores vão juntos numa mensagem só (menos mensagens de qualificação)
  if (!prioridade.length && aberto('organizacao') && aberto('vendedores')) {
    return `Faltam: ${s.abertos.map(c => c.name).join(' · ')}. Próximo → as DUAS perguntas juntas, numa mensagem só: "Hoje vocês organizam os leads onde: WhatsApp, planilha ou outro CRM? E quantos vendedores usariam o sistema?" (adapte ao que ele já contou; se ele já respondeu uma, pergunte só a outra). Se o Comment ou as mensagens já respondem algum item, grave com salvar_respostas ANTES e pule.`
  }
  const prox = s.abertos.find(c => prioridade.includes(c.key)) || s.abertos[0]
  const opc = prox.options ? ` (grave com uma destas opções EXATAS: ${prox.options.map(o => o.value).join(' | ')})` : ''
  return `Faltam: ${s.abertos.map(c => c.name).join(' · ')}. Próximo que falta → ${prox.name}${prox.pergunta ? ` (use esta pergunta, com o mínimo de ajuste: "${prox.pergunta}")` : ''}${opc}. Se o Comment ou as mensagens já respondem algum desses, grave com salvar_respostas ANTES e pule. Pode seguir outra ordem se ficar mais natural.`
}

// ---------- Execução ----------

function coerce(campo: Campo, raw: string, atual?: number[]): { values: KommoFieldValue['values']; texto: string } | { error: string } {
  if (campo.type === 'select' || campo.type === 'multiselect') {
    const opts = campo.options || []
    const escolhidas = campo.type === 'multiselect' ? raw.split(/\s*[,;|]\s*/) : [raw]
    const ids: number[] = []
    for (const e of escolhidas) {
      const m = matchOption(e, opts)
      if (!m) return { error: `"${e}" não é opção de "${campo.name}" — use uma destas: ${opts.map(o => o.value).join(' | ')}` }
      ids.push(m.id)
    }
    // multiselect: PATCH substitui → UNION com o que já existe (kommo §2)
    const all = campo.type === 'multiselect' ? [...new Set([...(atual || []), ...ids])] : ids
    return { values: all.map(enum_id => ({ enum_id })), texto: escolhidas.map(e => matchOption(e, opts)!.value).join(', ') }
  }
  if (campo.type === 'numeric') {
    const n = parseNumeroBR(raw)
    return n === null ? { error: `"${raw}" não é número para "${campo.name}"` } : { values: [{ value: n }], texto: String(n) }
  }
  const t = raw.trim().slice(0, campo.type === 'textarea' ? 2000 : 250)
  return t ? { values: [{ value: t }], texto: t } : { error: `valor vazio para "${campo.name}"` }
}

const MOTIVO_TXT: Record<string, string> = {
  agendado: '📅 Reunião agendada', qualificado_sem_reuniao: '✅ Qualificado (reunião a combinar)', venda_licenca: '🛒 Venda de licença',
  suporte: '🛠️ Pedido de suporte técnico', ja_tem_parceiro: '🤝 Já tem parceiro', fora_do_escopo: '🚫 Fora do escopo',
  pediu_humano: '🙋 Pediu para falar com uma pessoa', desistiu: '👋 Desistiu', sem_resposta: '🔕 Sem resposta',
}

/** Efeitos no CRM ao finalizar. Ordem importa: primeiro desliga (tag), depois marca o estado. */
export async function aplicarFinalizacao(ctx: ToolCtx, motivo: string, resumoRaw: string, urgente = false, linhasExtras: Array<string | false | null | undefined> = [], moveuParaAgendado = false): Promise<void> {
  const { port, porta } = ctx
  const state = await port.getState()
  const resumo = resumoRaw.trim().slice(0, 1500)
  if (CRM_MAP.finalizar.removerGate && ctx.gateTag) await port.removeTags([ctx.gateTag])
  const porMotivo: Record<string, string> = { suporte: CRM_MAP.tags.suporte, venda_licenca: CRM_MAP.tags.licenca }
  const extras = [...CRM_MAP.finalizar.tags, ...(porMotivo[motivo] ? [porMotivo[motivo]] : []), ...(urgente && CRM_MAP.finalizar.tagUrgente ? [CRM_MAP.finalizar.tagUrgente] : [])]
  if (extras.length) await port.addTags(extras)
  if (CRM_MAP.finalizar.nota) {
    const linhas = snapshot(porta, state).preenchidos.map(p => `• ${p.campo.curto || p.campo.name}: ${p.valor}`)
    const titulo = motivo === 'agendado'
      ? `${moveuParaAgendado ? `Etapa: ${NOMES.agendado} · ` : ''}Atendimento finalizado, transferido para humano`
      : `Atendimento finalizado, transferido para humano · ${MOTIVO_TXT[motivo] || motivo}${urgente ? ' · 🚨 URGENTE' : ''}`
    await port.addNote(nota(titulo, [
      ...linhasExtras,
      resumo && motivo !== 'agendado' && `🧾 ${resumo}`,
      state.respondenteNome && `👤 Quem conversou: ${state.respondenteNome} (${state.respondenteRelacao || '—'})`,
      state.outroAssunto && `💡 Outro assunto citado: ${state.outroAssunto}`,
      linhas.length > 0 && `\n📋 Resumo da qualificação:\n${linhas.join('\n')}`,
      state.comentario && `\n📝 Pedido da indicação: "${state.comentario}"`,
      '\n✋ Lara saiu da conversa (tag ia-sdr removida). Daqui pra frente é com o time.',
    ]))
  }
  await port.patchState({ finalizado: { motivo, resumo, em: new Date().toISOString() } })
}

export async function runTool(ctx: ToolCtx, name: string, input: Record<string, unknown>): Promise<ToolOutcome> {
  const { port, porta } = ctx
  try {
    switch (name) {
      case 'salvar_respostas': {
        const state = await port.getState()
        const lead = await port.getLead()
        const lista = Array.isArray(input.respostas) ? input.respostas as Array<Record<string, unknown>> : []
        const writes: KommoFieldValue[] = []
        const respostas = { ...(state.respostas || {}) }
        const semResposta = new Set(state.semResposta || [])
        const salvos: string[] = []
        const erros: string[] = []
        for (const r of lista) {
          const key = String(r.campo || '')
          const campo = porta.roteiro.includes(key) ? campoByKey(key) : undefined
          if (!campo) { erros.push(`"${key}" não é do roteiro desta porta`); continue }
          const ev = String(r.evidencia || '')
          // Já respondido não se regrava (o modelo às vezes reaproveita uma frase qualquer para sobrescrever)
          if (state.respostas?.[key]) { erros.push(`${campo.name} já estava respondido (${state.respostas[key]}) — não pergunte de novo`); continue }
          const valor = String(r.valor ?? '')
          const naoSei = DISSE_NAO_SEI.test(ev)
          // "sim"/"não" curto vale quando responde exatamente a pergunta deste campo
          const respondeuPergunta = !!campo.pergunta && overlap(ctx.lastAgentText, campo.pergunta) >= 0.6 && evidenceFound(ev, ctx.lastLeadText)
          if (!evidenceFound(ev, ctx.leadText)) { erros.push(`${campo.name}: a evidência "${ev}" não aparece no que o lead escreveu — NÃO invente; pergunte`); continue }
          if (campo.sinal && !campo.sinal.test(ev) && !naoSei && !respondeuPergunta) { erros.push(`${campo.name}: a evidência "${ev}" não fala deste assunto — NÃO invente; pergunte`); continue }
          if (/^\s*n[aã]o (sei|sabe)\s*\.?\s*$/i.test(valor) && !naoSei) { erros.push(`${campo.name}: "Não sabe" só quando o lead disser que não sabe`); continue }
          if (naoSei && campo.type !== 'select' && campo.type !== 'multiselect') {
            semResposta.add(key)
            salvos.push(`${campo.name} = (não sabe)`)
            continue
          }
          // Texto: guarda as PALAVRAS DO LEAD. Se o modelo resumiu ("Outra pessoa da família"), vale a evidência literal.
          // Texto guarda as PALAVRAS DO LEAD (a evidência literal), nunca o resumo do modelo
          const bruto = campo.type === 'text' || campo.type === 'textarea' ? ev : valor
          const c = coerce(campo, bruto, lead.fields[campo.id]?.enumIds)
          if ('error' in c) { erros.push(c.error); continue }
          respostas[key] = c.texto
          salvos.push(`${campo.name} = ${c.texto}`)
          if (campo.id > 0 && !CRM_MAP.camposProibidos.includes(campo.id)) writes.push({ field_id: campo.id, values: c.values })
        }
        if (writes.length) await port.writeFields(writes)
        const next = await port.patchState({ respostas, semResposta: [...semResposta] })
        // CHAMP fechado: o lead vai para QUALIFICAÇÃO (só para frente, só no funil de indicações)
        if (salvos.length && champCompleto(next.respostas, next.semResposta)) {
          const champ = snapshot(porta, next).preenchidos.map(p => `• ${p.campo.curto || p.campo.name}: ${p.valor}`)
          await avancar(port, 'qualificado', ['✅ CHAMP completo', ...champ]).catch(e => console.warn('[etapa] qualificado:', e))
        }
        return {
          isError: erros.length > 0 && salvos.length === 0,
          content: [salvos.length ? `Salvo: ${salvos.join(' · ')}.` : '', erros.length ? `Não salvo: ${erros.join(' · ')}.` : '', describeOpen(porta, snapshot(porta, next))].filter(Boolean).join(' '),
        }
      }

      case 'registrar_respondente': {
        const nome = String(input.nome || '').trim().slice(0, 60)
        if (!nome || !evidenceFound(nome, ctx.leadText)) return err('Nome não registrado: ele não aparece no que o lead escreveu.')
        await port.patchState({ respondenteNome: nome, respondenteRelacao: String(input.relacao || '').trim().slice(0, 60) })
        return ok(`Anotado: quem está falando é ${nome}. Chame por este nome.`)
      }

      case 'registrar_outro_assunto': {
        const citado = `${input.assunto || ''} ${input.evidencia || ''}`
        if (!evidenceFound(String(input.evidencia || ''), ctx.leadText)) return err('Não registrado: o lead não citou esse assunto.')
        // Só vale assunto de OUTRA área atendida (sinal de outra porta). Renda, saúde, dúvida do roteiro NÃO são outro assunto.
        if (!classificar(citado).some(p => p.id !== porta.id)) return err('Não registrado: isso faz parte do assunto atual, não de outra área. Responda dentro do roteiro.')
        await port.patchState({ outroAssunto: String(input.assunto || '').slice(0, 200) })
        return ok('Registrado para a equipe. Diga ao lead que a equipe também verá esse assunto e SIGA o roteiro atual.')
      }

      case 'finalizar_atendimento': {
        const motivo = String(input.motivo || '') as Motivo
        if (!MOTIVOS.includes(motivo)) return err(`Motivo inválido: ${motivo}`)
        const state = await port.getState()
        if (motivo === 'venda_licenca') {
          const n = numeroVendedores(state.respostas?.vendedores)
          if (n === null) return err('Antes de encaminhar a licença, grave quantos vendedores vão usar (salvar_respostas).')
        } else if (motivo === 'qualificado_sem_reuniao') {
          // "Não sabe" só vale se foi registrado por salvar_respostas com a fala do lead — nunca declarado na finalização
          const sem = new Set(state.semResposta || [])
          const faltando = porta.obrigatorios.filter(key => !state.respostas?.[key] && !(sem.has(key) && !campoByKey(key)?.options))
          if (faltando.length) return err(`Ainda falta: ${faltando.map(key => campoByKey(key)?.name || key).join('; ')}. ${describeOpen(porta, snapshot(porta, state))} Se o lead disse que não sabe, grave com salvar_respostas usando a fala dele como evidência.`)
        } else {
          const ev = String(input.evidencia || '')
          const sinal = SINAL_MOTIVO[motivo]
          if (!evidenceFound(ev, ctx.leadText) || (sinal && !sinal.test(ev))) {
            return err(`NÃO finalizado: a evidência "${ev}" não comprova "${motivo}" no que o lead escreveu. Continue o atendimento.`)
          }
        }
        await aplicarFinalizacao(ctx, motivo, String(input.resumo || ''))
        return ok(`Atendimento da IA finalizado (${motivo}). Envie a mensagem de encerramento prevista no prompt para este caso. NÃO faça perguntas e NÃO prometa contato em prazo específico.`, { handoff: true })
      }

      case 'consultar_horarios': {
        const cfg = CRM_MAP.agenda
        if (!cfg.ativa || !cfg.responsavelId) return err('Agenda não configurada. Diga que o time confirma o horário e chame finalizar_atendimento(qualificado_sem_reuniao).')
        const state = await port.getState()
        if (state.reuniao) return err(`A reunião já está marcada (${state.reuniao.label}). Não marque outra.`)
        const agora = ctx.agora ?? Date.now()
        const fimJanela = agora + (cfg.diasUteisJanela + 4) * 86400000
        let ocupados: Intervalo[]
        try { ocupados = await port.buscarOcupados(agora, fimJanela) } catch (e) {
          return err(`Não consegui ler a agenda agora (${e instanceof Error ? e.message : String(e)}). Diga ao lead que o time confirma o horário por aqui e chame finalizar_atendimento(qualificado_sem_reuniao).`)
        }
        const livres = gerarLivres(agora, cfg, ocupados)
        if (!livres.length) return err('Sem horário livre na janela. Diga que o time vai propor um horário por aqui e chame finalizar_atendimento(qualificado_sem_reuniao).')
        const pref = parsePreferencia(`${String(input.preferencia || '')}\n${ctx.lastLeadText}`, agora)
        const { opcoes, respeitouPreferencia } = escolherOpcoes(livres, pref, cfg.maxOpcoes)
        await port.patchState({ oferta: opcoes, ofertaEm: agora })
        const lista = opcoes.map((o, i) => `${i + 1}) ${o.label}`).join(' · ')
        return ok(`${respeitouPreferencia ? '' : 'Não há horário livre na preferência do lead; diga isso e ofereça estes. '}Horários livres (ofereça exatamente estes, sem inventar outros): ${lista}. Reunião de ${cfg.duracaoMin} minutos. Pergunte qual fica melhor.`)
      }

      case 'agendar_reuniao': {
        const cfg = CRM_MAP.agenda
        if (!cfg.ativa || !cfg.responsavelId) return err('Agenda não configurada.')
        const state = await port.getState()
        if (state.reuniao) return err(`A reunião já está marcada (${state.reuniao.label}). Confirme esse horário ao lead.`)
        const respondido = (key: string) => !!state.respostas?.[key] || (state.semResposta || []).includes(key)
        const faltando = CRM_MAP.exigirAntesDeAgendar.filter(grupo => !grupo.some(respondido))
        if (faltando.length) return err(`Antes de marcar, falta (CHAMP): ${faltando.map(g => g.map(key => campoByKey(key)?.name || key).join(' OU ')).join('; ')}. Pergunte o próximo item (uma pergunta) e grave com salvar_respostas.`)
        const oferta: Slot[] = state.oferta || []
        const agora = ctx.agora ?? Date.now()
        if (!oferta.length) return err('Nenhum horário foi oferecido ainda. Chame consultar_horarios e ofereça as opções.')
        // A escolha tem que vir do LEAD: resolvida no texto dele contra a oferta gravada
        let slot = resolverEscolha(ctx.lastLeadText, oferta, agora)
        if (!slot && ehAfirmativo(ctx.lastLeadText)) {
          const citados = slotsCitados(ctx.lastAgentText, oferta)
          if (citados.length === 1) slot = citados[0]
        }
        if (!slot) return err('O lead ainda não escolheu um dos horários oferecidos de forma clara. Pergunte qual das opções ele prefere (repita as opções). Não marque por conta própria.')
        const pedido = resolverEscolha(String(input.horario || ''), oferta, agora)
        if (pedido && pedido.ini !== slot.ini) return err(`O lead escolheu "${slot.label}", não "${pedido.label}". Chame de novo com o horário que ele escolheu.`)
        if (slot.ini < agora + cfg.antecedenciaMinHoras * 3600000) return err('Esse horário ficou em cima da hora. Chame consultar_horarios e ofereça novas opções.')
        // Revalida na fonte imediatamente antes de criar (outra reunião pode ter entrado)
        let ocupados: Intervalo[]
        try { ocupados = await port.buscarOcupados(slot.ini - 86400000, slot.fim + 86400000) } catch (e) {
          return err(`Não consegui confirmar a agenda agora (${e instanceof Error ? e.message : String(e)}). Diga que o time confirma esse horário por aqui e chame finalizar_atendimento(qualificado_sem_reuniao).`)
        }
        const folga = cfg.folgaMin * 60000
        if (ocupados.some(o => slot!.ini < o.fim + folga && slot!.fim > o.ini - folga)) {
          await port.patchState({ oferta: [] })
          return err('Esse horário acabou de ser ocupado. Peça desculpa, chame consultar_horarios e ofereça novas opções.')
        }
        const resumoCampos = snapshot(porta, state).preenchidos.map(p => `${p.campo.curto || p.campo.name}: ${p.valor}`).join(' · ')
        const convidado = String(input.decisor_convidado || '').trim().slice(0, 120)
        const texto = `Reunião (indicação Kommo) · ${convidado ? `Decisor convidado: ${convidado} · ` : ''}${resumoCampos}${state.comentario ? ` · Comment: ${state.comentario.slice(0, 300)}` : ''}`.slice(0, 1000)
        const criada = await port.criarReuniao({ ini: slot.ini, fim: slot.fim, texto })
        const taskId = criada.id
        await port.patchState({ reuniao: { ...slot, taskId, em: new Date(agora).toISOString() }, oferta: [] })
        const linkCampo = CRM_MAP.linkReuniaoFieldId ? (await port.getLead()).fields[CRM_MAP.linkReuniaoFieldId]?.value : undefined
        // Link novo da reunião (Meet) vence o campo antigo; sem Meet, vale o campo ou o link fixo
        const link = String(criada.link || linkCampo || process.env.LINK_REUNIAO || '').trim()
        if (link && link !== linkCampo && CRM_MAP.linkReuniaoFieldId) await port.writeFields([{ field_id: CRM_MAP.linkReuniaoFieldId, values: [{ value: link }] }])
        // Link é por reunião: sem link ainda, o closer recebe a tarefa de preencher o campo (os lembretes usam o campo)
        if (!link) await port.criarTarefaCloser(`Preencher o campo "Link da Reunião" do lead (reunião ${slot.label}). Os lembretes de 24h e 1h mandam esse link para o cliente.`).catch(e => console.warn('[tarefa link]', e))
        await port.agendarLembretes({ ini: slot.ini, taskId }).catch(e => console.warn('[lembretes]', e))
        // Efeitos que só acontecem DEPOIS da reunião existir
        if (CRM_MAP.dataReuniaoFieldId) await port.writeFields([{ field_id: CRM_MAP.dataReuniaoFieldId, values: [{ value: Math.floor(slot.ini / 1000) }] }])
        await port.addTags([CRM_MAP.tags.reuniao]).catch(() => undefined)
        const reuniaoLinhas = [
          `📅 ${slot.label.replace(/^./, c => c.toUpperCase())} (reserva de 1h, reunião de 30 a 45 min)`,
          '👨‍💼 Especialista: Rodrigo Campeoti',
          convidado && `👥 Decisor convidado: ${convidado}`,
          link ? `🔗 ${link}` : '⚠️ Sem link ainda: tarefa criada para preencher o campo "Link da Reunião"',
          `⏰ Lembretes para o cliente: ${CRM_MAP.lembretes.horasAntes.map(h => `${h}h antes`).join(' e ')}`,
        ]
        const moveu = CRM_MAP.etapaAgendado.id ? await avancar(port, 'agendado', [], true) : false
        if (port.avisarCloser) {
          const lead = await port.getLead()
          // Texto simples (o campo da Kommo apaga emoji) e um link só: o do card (o Meet está na agenda)
          await port.avisarCloser([
            '*Nova reunião marcada pela Lara*',
            `Quando: ${slot.label.replace(/^./, c => c.toUpperCase())}`,
            convidado && `Decisor convidado: ${convidado}`,
            resumoCampos && `\n${resumoCampos.split(' · ').join('\n')}\n`,
            state.comentario && `Pedido: "${state.comentario.slice(0, 200)}"`,
            `Card: https://controlgestao.kommo.com/leads/detail/${lead.id}`,
          ].filter(Boolean).join('\n'), `${lead.id}-${slot.ini}`).catch(e => console.warn('[aviso closer]', e))
        }
        await aplicarFinalizacao(ctx, 'agendado', `Reunião marcada para ${slot.label}.`, false, reuniaoLinhas, moveu)
        return ok(`Reunião marcada: ${slot.label} (30 a 45 min). Confirme ao lead o dia e a hora com essas palavras${link ? `, mande o link da reunião ${link} pedindo que ele confira se abre certinho` : ', diga que o especialista manda o link da reunião por aqui'}${convidado ? `, reforce que ${convidado} participa junto` : ''} e NÃO faça pergunta.`, { handoff: true })
      }

      case 'mover_etapa': {
        const etapa = CRM_MAP.etapas.find(e => e.name === input.etapa)
        if (!etapa) return err('Etapa fora da alçada.')
        const lead = await port.getLead()
        // Fail-closed: outro funil ou etapa protegida = não mexe
        if (lead.pipelineId !== etapa.pipelineId) return err('O lead está em outro funil — não vou mover.')
        if (CRM_MAP.etapasProtegidas.includes(lead.statusId)) return err('O lead já está numa etapa da equipe — não vou mover.')
        if (lead.statusId !== etapa.id) await port.moveStage(etapa.id, etapa.pipelineId)
        return ok(`Lead em "${etapa.name}".`)
      }

      default:
        return err(`Tool desconhecida "${name}".`)
    }
  } catch (e) {
    return err(`Falha ao executar ${name}: ${e instanceof Error ? e.message : String(e)}`)
  }
}
