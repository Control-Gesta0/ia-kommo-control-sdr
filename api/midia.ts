import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import { CONFIG } from '../lib/config'
import { logExec } from '../lib/execlog'
import { descreverBuffer, mediaKind, mediaToText, tipoPeloLink, transcreverBuffer } from '../lib/media'
import { amojoIdDaConta, listarPendentes, lerPendente, registrarDiagPonte, resolverPendente } from '../lib/ponte-midia'

/**
 * Ponte de mídia do WhatsApp Lite (ver lib/ponte-midia.ts). Autenticação: ?secret=INDICACAO_SECRET.
 *   GET  → { amojoId, pendentes: [{ id, leadId, chatId, talkId, criadoEm }] }
 *   POST { id, b64?, mime?, tipo?, link?, transcricao?, diag? }
 *        b64 = bytes da mídia baixada pelo navegador · link = URL que o servidor tenta baixar
 *        transcricao = texto que a própria Kommo já mostrou · diag = o que o navegador viu (depuração)
 */
export const config = { api: { bodyParser: { sizeLimit: '4mb' } } }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = String(req.query.secret || req.headers['x-webhook-secret'] || '')
  if (!CONFIG.indicacaoSecret || !safeEq(secret, CONFIG.indicacaoSecret)) return res.status(401).json({ error: 'unauthorized' })

  if (req.method === 'GET') {
    const pendentes = await listarPendentes()
    return res.status(200).json({ amojoId: pendentes.length ? await amojoIdDaConta() : '', pendentes: pendentes.map(p => ({ id: p.id, leadId: p.leadId, chatId: p.chatId, talkId: p.talkId, criadoEm: p.criadoEm })) })
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) || {}
  const id = String(body.id || body.diag?.id || '')
  if (body.diag) await registrarDiagPonte({ id, diag: body.diag, versao: body.versao })
  if (!id) return res.status(200).json({ ok: true, diag: true })
  const p = await lerPendente(id)
  if (!p) return res.status(200).json({ ok: false, motivo: 'não está mais pendente' })
  // O navegador achou a mensagem mas não conseguiu baixar (o link redireciona pro Google Storage):
  // o link do drive da Kommo é público, então o servidor baixa.
  if (!body.b64 && !body.link && body.diag?.mensagem) {
    const achado = linkDaMensagem(String(body.diag.mensagem))
    if (achado.link) { body.link = achado.link; body.tipo = body.tipo || achado.tipo }
  }

  // Só baixa do drive da Kommo (nunca de um link qualquer)
  if (body.link && !LINK_KOMMO.test(String(body.link))) body.link = ''
  const mime = String(body.mime || '')
  const tipo = mediaKind(String(body.tipo || '')) || mediaKind(mime) || tipoPeloLink(String(body.link || '')) || 'audio'
  const rotulo = tipo === 'audio' ? 'áudio' : tipo === 'image' ? 'imagem' : 'documento'
  let lido: string | null = null
  try {
    if (body.b64) {
      const dados = Buffer.from(String(body.b64), 'base64')
      lido = tipo === 'audio' ? await transcreverBuffer(dados, mime, String(body.link || '')) : await descreverBuffer(dados, mime, tipo, String(body.link || ''))
    } else if (body.link) {
      const t = await mediaToText(tipo, String(body.link), '')
      lido = /não consegui abrir/.test(t) ? null : t.replace(/^\[[^\]]*\]:\s*/, '')
    }
  } catch (e) {
    console.error('[midia] falha ao ler:', e)
  }
  if (!lido && body.transcricao) lido = String(body.transcricao).trim()
  if (!lido) {
    await registrarDiagPonte({ id, erro: 'mídia recebida mas não lida', mime, tipo, bytes: body.b64 ? String(body.b64).length : 0, link: String(body.link || '').slice(0, 200) })
    return res.status(200).json({ ok: false, motivo: 'não consegui ler a mídia' })
  }
  const texto = `[${rotulo} do lead]: ${lido}`
  const ok = await resolverPendente(id, texto, crypto.randomUUID())
  if (ok) await logExec({ tipo: 'midia', leadId: p.leadId, detalhe: `${rotulo} via navegador: ${lido.slice(0, 120)}` }).catch(() => undefined)
  return res.status(200).json({ ok, texto: lido.slice(0, 300) })
}

const LINK_KOMMO = /^https:\/\/[\w.-]+\.(kommo|amocrm)\.(com|ru)\//

/** Link e tipo da mídia no JSON da mensagem do chat (message.attachment.media ou message.media). */
export function linkDaMensagem(json: string): { link: string; tipo: string } {
  try {
    const m = JSON.parse(json) as { message?: { media?: string; type?: string; attachment?: { media?: string; type?: string } } }
    const msg = m.message || {}
    const link = msg.attachment?.media || msg.media || ''
    return { link: LINK_KOMMO.test(link) ? link : '', tipo: msg.attachment?.type || msg.type || '' }
  } catch {
    // JSON cortado (o navegador manda no máximo 2.500 caracteres): pega o link pelo texto
    const link = (json.match(/"media":"(https:\/\/[\w.-]+\.(?:kommo|amocrm)\.(?:com|ru)\/[^"\\]+)"/) || [])[1] || ''
    return { link, tipo: (json.match(/"type":"(voice|audio|picture|image|file|video)"/) || [])[1] || '' }
  }
}

function safeEq(a: string, b: string): boolean {
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest())
}
