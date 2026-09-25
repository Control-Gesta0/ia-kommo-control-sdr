/** Tipos do mapa do CRM (asset — o crm-map.ts do cliente importa daqui). */

export type CampoTipo = 'text' | 'textarea' | 'numeric' | 'select' | 'multiselect'

export interface Campo {
  key: string
  /** field_id do lead no Kommo. 0 = só guarda no estado (não grava no card) */
  id: number
  /** nome que o MODELO vê */
  name: string
  /** nome real no Kommo (o validate compara) */
  kommoName?: string
  type: CampoTipo
  /** select/multiselect: enum_id + texto EXATO do Kommo */
  options?: Array<{ id: number; value: string }>
  /** palavras que a evidência do lead precisa conter */
  sinal?: RegExp
  /** a pergunta do roteiro (a regra da resposta curta "sim/não" usa) */
  pergunta?: string
}

export interface Porta {
  id: string
  label: string
  /** número no menu; null = só por classificação de texto */
  menu: number | null
  /** false = sem agente ainda: manda `mensagemSemAgente` e finaliza */
  ativa: boolean
  /** arquivo em prompts/portas/ */
  promptFile?: string
  /** texto do lead que identifica esta porta SEM ambiguidade */
  sinais: RegExp
  /** chaves de CAMPOS na ordem do roteiro */
  roteiro: string[]
  /** chaves que precisam estar respondidas (ou "não sei", se texto) para finalizar como qualificado */
  obrigatorios: string[]
  mensagemSemAgente?: string
  /** texto fixo aprovado: enviado pelo CÓDIGO quando o lead só escolheu o número do menu */
  abertura?: string
}

/** Detecção em CÓDIGO no turno do lead → aviso no contexto do modelo (o modelo age, o código garante que ele saiba). */
export interface Alerta {
  nome: string
  re: RegExp
  aviso: string
  /**
   * Finalização garantida em código: se o alerta disparou, a resposta final casa com
   * `seResposta` (o texto padrão daquele caso) e o modelo NÃO chamou finalizar_atendimento,
   * o código finaliza com `motivo` (kommo/PEGADINHAS §11: finalização é estado).
   */
  finaliza?: { motivo: string; seResposta: RegExp }
}

export interface Etapa { id: number; pipelineId: number; name: string; quando: string }

export type { AgendaConfig } from './agenda'
