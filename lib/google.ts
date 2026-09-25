import crypto from 'crypto'
import type { Intervalo } from './agenda'

/**
 * Google Agenda — SÓ LEITURA de livre/ocupado (freeBusy), opcional.
 *
 * Por que existe: a integração Kommo ↔ Google leva as tarefas do Kommo para a
 * agenda, mas um compromisso pessoal criado direto no Google não vira tarefa no
 * Kommo. Sem esta leitura a IA poderia oferecer um horário em que o closer já
 * está ocupado fora do Kommo.
 *
 * Como ligar: conta de serviço no Google Cloud (Calendar API ativada), chave
 * JSON em GOOGLE_SERVICE_ACCOUNT_JSON (texto puro ou base64) e a agenda do closer
 * compartilhada com o e-mail da conta de serviço em "Ver apenas livre/ocupado".
 * GOOGLE_CALENDAR_ID = e-mail da agenda do closer.
 *
 * Não cria evento: quem cria é a tarefa do Kommo + a integração (evita evento duplicado).
 */

interface ServiceAccount { client_email: string; private_key: string }

function lerConta(raw: string): ServiceAccount {
  const txt = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf-8')
  const j = JSON.parse(txt) as ServiceAccount
  if (!j.client_email || !j.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON sem client_email/private_key')
  return j
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

let cache: { token: string; exp: number } | null = null

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cache && cache.exp > Date.now() + 60_000) return cache.token
  const iat = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/calendar.freebusy',
    aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600,
  }))
  const assinatura = b64url(crypto.createSign('RSA-SHA256').update(`${header}.${claim}`).sign(sa.private_key))
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claim}.${assinatura}` }),
  })
  const j = await r.json() as { access_token?: string; expires_in?: number; error_description?: string }
  if (!r.ok || !j.access_token) throw new Error(`Google token: ${r.status} ${j.error_description || ''}`)
  cache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 }
  return j.access_token
}

/** Ocupado da agenda do closer. Erro do Google = exceção (fail-closed: sem ver a agenda, não oferece). */
export async function googleOcupados(contaJson: string, calendarId: string, ini: number, fim: number): Promise<Intervalo[]> {
  const token = await accessToken(lerConta(contaJson))
  const r = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeMin: new Date(ini).toISOString(), timeMax: new Date(fim).toISOString(), items: [{ id: calendarId }] }),
  })
  const j = await r.json() as { calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: Array<{ reason: string }> }> }
  const cal = j.calendars?.[calendarId]
  if (!r.ok || !cal) throw new Error(`Google freeBusy: HTTP ${r.status}`)
  if (cal.errors?.length) throw new Error(`Google freeBusy: ${cal.errors.map(e => e.reason).join(', ')} (a agenda foi compartilhada com a conta de serviço?)`)
  return (cal.busy || []).map(b => ({ ini: Date.parse(b.start), fim: Date.parse(b.end) }))
}
