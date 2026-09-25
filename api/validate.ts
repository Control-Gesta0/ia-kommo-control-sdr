import type { VercelRequest, VercelResponse } from '@vercel/node'
import { CONFIG } from '../lib/config'
import { CRM_MAP } from '../lib/crm-map'
import { modoInicio } from '../lib/iniciar'
import { kommoGet } from '../lib/kommo'
import { loadPromptFile } from '../lib/llm'

/**
 * CRM_MAP × Kommo VIVO + coerência interna. Rodar depois de QUALQUER mexida no
 * funil/campos e antes de cada deploy. { ok, problems[], avisos[] }
 */

interface LiveField { id: number; name: string; type: string; enums?: Array<{ id: number; value: string }> | null }
interface LivePipeline { id: number; name: string; _embedded?: { statuses?: Array<{ id: number; name: string }> } }

export function problemasOffline(): { problems: string[]; avisos: string[] } {
  const problems: string[] = []
  const avisos: string[] = []
  if (!CRM_MAP.respostaFieldId) problems.push('respostaFieldId = 0 (sem campo de resposta o Salesbot não tem o que enviar)')
  if (!CONFIG.kommoBotId) problems.push('KOMMO_BOT_ID ausente: a resposta é depositada mas nunca enviada')
  if (!CONFIG.gateTag) avisos.push('GATE_TAG vazio: a IA responde qualquer lead da conta que mandar mensagem. Use uma tag (ex.: ia-sdr); a própria IA põe a tag nos leads que ela inicia.')
  if (!CONFIG.indicacaoSecret) avisos.push('INDICACAO_SECRET vazio: o userscript não consegue avisar o agente (só o webhook da Kommo inicia conversas)')
  if (modoInicio() !== 'ligado') avisos.push(`MODO_INICIO=${modoInicio()}: ${modoInicio() === 'teste' ? 'só leads em TEST_LEAD_IDS recebem a abertura (rampagem)' : 'a IA não inicia nenhuma conversa'}`)

  // Dado do negócio que ainda não temos: nunca sobe com placeholder
  const arquivos = ['nucleo.md', ...CRM_MAP.portas.filter(p => p.promptFile).map(p => `portas/${p.promptFile}`)]
  for (const f of arquivos) {
    try {
      const n = (loadPromptFile(f).match(/\[PREENCHER/g) || []).length
      if (n) problems.push(`prompts/${f}: ${n} placeholder(s) [PREENCHER] sem resposta do negócio`)
    } catch { problems.push(`prompts/${f} não existe`) }
  }
  const mapaTxt = JSON.stringify(CRM_MAP)
  const nMapa = (mapaTxt.match(/\[PREENCHER/g) || []).length
  if (nMapa) problems.push(`lib/crm-map.ts: ${nMapa} placeholder(s) [PREENCHER]`)

  for (const p of CRM_MAP.portas) {
    if (p.ativa && !p.promptFile) problems.push(`porta "${p.id}" ativa sem promptFile`)
    for (const key of [...p.roteiro, ...p.obrigatorios]) if (!CRM_MAP.campos[key]) problems.push(`porta "${p.id}": campo "${key}" não existe em CRM_MAP.campos`)
  }
  if (!CRM_MAP.portas.find(p => p.id === CRM_MAP.menu.portaUnica)) problems.push(`menu.portaUnica "${CRM_MAP.menu.portaUnica}" não existe`)
  for (const key of CRM_MAP.exigirAntesDeAgendar.flat()) if (!CRM_MAP.campos[key]) problems.push(`exigirAntesDeAgendar: campo "${key}" não existe`)

  if (!CRM_MAP.entrada.pipelineId) problems.push('entrada.pipelineId = 0 (funil onde o lead aceito cai)')
  if (CRM_MAP.agenda.ativa) {
    if (!CRM_MAP.agenda.responsavelId) problems.push('agenda.responsavelId = 0 (user_id do closer)')
    if (!CRM_MAP.etapaAgendado.id) avisos.push('etapaAgendado.id = 0: a reunião é criada mas o lead não muda de etapa')
    if (!CRM_MAP.dataReuniaoFieldId) avisos.push('dataReuniaoFieldId = 0: a data da reunião fica só na tarefa e na nota')
    if (!CONFIG.googleServiceAccount || !CONFIG.googleCalendarId) avisos.push('Google free/busy desligado: compromisso criado direto no Google (fora do Kommo) não bloqueia a agenda')
  }
  return { problems, avisos }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (String(req.query.secret || '') !== CONFIG.webhookSecret) return res.status(401).json({ error: 'unauthorized' })
  const { problems, avisos } = problemasOffline()

  try {
    const fd = await kommoGet<{ _embedded?: { custom_fields?: LiveField[] } }>('/api/v4/leads/custom_fields?limit=250')
    const live = new Map((fd._embedded?.custom_fields || []).map(f => [f.id, f]))
    const confereTexto = (id: number, papel: string) => {
      if (!id) return
      const f = live.get(id)
      if (!f) problems.push(`${papel} ${id} NÃO existe no Kommo`)
      else if (!/text/.test(f.type)) problems.push(`${papel} ${id} é ${f.type}, precisa ser text/textarea`)
    }
    confereTexto(CRM_MAP.respostaFieldId, 'campo de resposta')
    confereTexto(CRM_MAP.comentarioFieldId, 'campo do Comment')
    if (CRM_MAP.dataReuniaoFieldId) {
      const f = live.get(CRM_MAP.dataReuniaoFieldId)
      if (!f) problems.push(`campo da data da reunião ${CRM_MAP.dataReuniaoFieldId} NÃO existe`)
      else if (!/date/.test(f.type)) problems.push(`campo da data da reunião é ${f.type}, precisa ser date_time`)
    }
    for (const c of Object.values(CRM_MAP.campos)) {
      if (!c.id) continue
      if (CRM_MAP.camposProibidos.includes(c.id)) problems.push(`campo "${c.key}" aponta para um campo PROIBIDO (${c.id})`)
      const lf = live.get(c.id)
      if (!lf) { problems.push(`campo "${c.key}" (${c.id}) NÃO existe mais`); continue }
      if (c.kommoName && lf.name.trim() !== c.kommoName.trim()) problems.push(`campo ${c.id} renomeado: mapa="${c.kommoName}" kommo="${lf.name}"`)
      const tipoOk = c.type === 'numeric' ? /numeric|text/.test(lf.type) : c.type === 'text' || c.type === 'textarea' ? /text/.test(lf.type) : lf.type === c.type
      if (!tipoOk) problems.push(`campo "${c.key}" é ${lf.type} no Kommo e ${c.type} no mapa`)
      for (const o of c.options || []) {
        const v = (lf.enums || []).find(e => e.id === o.id)
        if (!v) problems.push(`campo "${c.key}": enum ${o.id} ("${o.value}") sumiu`)
        else if (v.value !== o.value) problems.push(`campo "${c.key}": enum ${o.id} é "${v.value}" no Kommo e "${o.value}" no mapa`)
      }
    }

    const pd = await kommoGet<{ _embedded?: { pipelines?: LivePipeline[] } }>('/api/v4/leads/pipelines')
    const pipes = pd._embedded?.pipelines || []
    const etapa = (pipelineId: number, statusId: number) => {
      const p = pipes.find(x => x.id === pipelineId) || pipes.find(x => x._embedded?.statuses?.some(s => s.id === statusId))
      return { p, s: p?._embedded?.statuses?.find(s => s.id === statusId) }
    }
    const ent = etapa(CRM_MAP.entrada.pipelineId, CRM_MAP.entrada.statusId)
    if (!ent.s) problems.push(`etapa de entrada ${CRM_MAP.entrada.statusId} não existe${CRM_MAP.entrada.pipelineId ? ` no funil ${CRM_MAP.entrada.pipelineId}` : ''}`)
    else {
      if (ent.p && ent.p.id !== CRM_MAP.entrada.pipelineId) problems.push(`etapa de entrada ${ent.s.id} ("${ent.s.name}") é do funil ${ent.p.id} ("${ent.p.name}"): ponha esse id em entrada.pipelineId`)
      if (ent.s.name !== CRM_MAP.entrada.name) problems.push(`etapa de entrada ${ent.s.id} chama "${ent.s.name}" no Kommo e "${CRM_MAP.entrada.name}" no mapa`)
    }
    if (CRM_MAP.etapaAgendado.id) {
      const ag = etapa(CRM_MAP.etapaAgendado.pipelineId, CRM_MAP.etapaAgendado.id)
      if (!ag.s || ag.p?.id !== CRM_MAP.etapaAgendado.pipelineId) problems.push(`etapa de reunião ${CRM_MAP.etapaAgendado.id} não existe no funil ${CRM_MAP.etapaAgendado.pipelineId}`)
      else if (ag.s.name !== CRM_MAP.etapaAgendado.name) problems.push(`etapa de reunião chama "${ag.s.name}" no Kommo e "${CRM_MAP.etapaAgendado.name}" no mapa`)
    }

    const users = (await kommoGet<{ _embedded?: { users?: Array<{ id: number; name: string }> } }>('/api/v4/users?limit=250'))._embedded?.users || []
    if (!users.some(u => u.id === CRM_MAP.responsavelEntradaId)) problems.push(`responsavelEntradaId ${CRM_MAP.responsavelEntradaId} não é usuário da conta`)
    if (CRM_MAP.agenda.responsavelId && !users.some(u => u.id === CRM_MAP.agenda.responsavelId)) problems.push(`agenda.responsavelId ${CRM_MAP.agenda.responsavelId} não é usuário da conta`)

    const acc = await kommoGet<{ _embedded?: { task_types?: Array<{ id: number; name: string }> } }>('/api/v4/account?with=task_types')
    const tipos = acc._embedded?.task_types || []
    if (tipos.length && !tipos.some(t => t.id === CRM_MAP.agenda.taskTypeId)) problems.push(`agenda.taskTypeId ${CRM_MAP.agenda.taskTypeId} não existe (tipos: ${tipos.map(t => `${t.id}=${t.name}`).join(', ')})`)
  } catch (e) {
    problems.push(`falha ao consultar o Kommo: ${e instanceof Error ? e.message : String(e)}`)
  }

  return res.status(problems.length ? 500 : 200).json({ ok: problems.length === 0, cliente: CONFIG.clientName, modoInicio: modoInicio(), problems, avisos })
}
