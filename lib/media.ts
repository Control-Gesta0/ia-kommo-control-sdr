import OpenAI, { toFile } from 'openai'
import { CONFIG } from './config'
import { CRM_MAP } from './crm-map'

/**
 * Ouvido e olho, NA ENTRADA e uma vez só: áudio, imagem e PDF viram texto
 * gravado no histórico. O cérebro nunca paga mídia em cada turno.
 * O link do attachment do Kommo é público (baixa sem auth).
 * Falhou? Nunca fingir leitura: o marcador diz que não abriu (kommo §15).
 */

const openai = new OpenAI({ apiKey: CONFIG.openaiApiKey })
const MAX_BYTES = 20 * 1024 * 1024

async function download(url: string): Promise<{ data: ArrayBuffer; type: string } | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 20_000)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) return null
    const data = await res.arrayBuffer()
    if (!data.byteLength || data.byteLength > MAX_BYTES) return null
    return { data, type: res.headers.get('content-type') || '' }
  } finally {
    clearTimeout(t)
  }
}

async function transcribe(url: string): Promise<string | null> {
  const file = await download(url)
  if (!file) return null
  const ext = (url.split('?')[0].split('.').pop() || 'ogg').slice(0, 5)
  const r = await openai.audio.transcriptions.create({
    file: await toFile(Buffer.from(file.data), `audio.${ext}`),
    model: CONFIG.sttModel,
    language: 'pt',
  })
  return (r.text || '').trim() || null
}

async function describe(url: string, kind: 'image' | 'document'): Promise<string | null> {
  const file = await download(url)
  if (!file) return null
  const isPdf = kind === 'document' || /pdf/i.test(file.type) || /\.pdf($|\?)/i.test(url)
  const b64 = Buffer.from(file.data).toString('base64')
  const content: OpenAI.Chat.ChatCompletionContentPart[] = isPdf
    ? [{ type: 'file', file: { filename: 'documento.pdf', file_data: `data:application/pdf;base64,${b64}` } }]
    : [{ type: 'image_url', image_url: { url: `data:${file.type || 'image/jpeg'};base64,${b64}` } }]
  const r = await openai.chat.completions.create({
    model: CONFIG.visionModel,
    max_completion_tokens: 400,
    messages: [{ role: 'system', content: CRM_MAP.midia.instrucaoVisao }, { role: 'user', content }],
  })
  return (r.choices[0]?.message?.content || '').trim() || null
}

export type MediaKind = 'audio' | 'image' | 'document'

export function mediaKind(attachType: string): MediaKind | null {
  if (/voice|audio/i.test(attachType)) return 'audio'
  if (/picture|image|photo/i.test(attachType)) return 'image'
  if (/file|document/i.test(attachType)) return 'document'
  return null
}

/** Texto que entra no histórico no lugar da mídia. */
export async function mediaToText(kind: MediaKind, url: string, caption: string): Promise<string> {
  const label = kind === 'audio' ? 'áudio' : kind === 'image' ? 'imagem' : 'documento'
  try {
    const text = !url ? null : kind === 'audio' ? await transcribe(url) : await describe(url, kind)
    const base = text ? `[${label} do lead]: ${text}` : `[${label} recebido, mas não consegui abrir]`
    return caption ? `${caption}\n${base}` : base
  } catch (e) {
    console.error(`[media] falha (${kind}):`, e)
    return `[${label} recebido, mas não consegui abrir]`
  }
}
