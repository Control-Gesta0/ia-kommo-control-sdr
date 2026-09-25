import crypto from 'crypto'
import type { Intervalo } from './agenda'

/**
 * Google Agenda do closer (Rodrigo): livre/ocupado, criação do evento COM link do
 * Google Meet (um por reunião) e leitura do evento (remarcado/cancelado).
 *
 * Acesso preferido: OAuth do próprio usuário (quem cria o Meet precisa ser uma
 * pessoa; conta de serviço não gera Meet fora de Workspace com delegação).
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN (escopo
 *   https://www.googleapis.com/auth/calendar), GOOGLE_CALENDAR_ID (padrão "primary").
 * Alternativa só-leitura: GOOGLE_SERVICE_ACCOUNT_JSON (livre/ocupado, sem criar evento).
 *
 * Com o Google ligado, a reunião é criada SÓ no Google (não vira tarefa do Kommo),
 * senão a integração Kommo ↔ Google duplicaria o evento na agenda.
 */

const env = (k: string) => (process.env[k] || '').trim()
export const calendarId = () => env('GOOGLE_CALENDAR_ID') || 'primary'
export const googleOAuth = () => !!(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET') && env('GOOGLE_REFRESH_TOKEN'))
export const googleLeitura = () => googleOAuth() || !!env('GOOGLE_SERVICE_ACCOUNT_JSON')

let cache: { token: string; exp: number } | null = null

async function tokenOAuth(): Promise<string> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), refresh_token: env('GOOGLE_REFRESH_TOKEN'), grant_type: 'refresh_token' }),
  })
  const j = await r.json() as { access_token?: string; expires_in?: number; error?: string; error_description?: string }
  if (!r.ok || !j.access_token) throw new Error(`Google OAuth: ${r.status} ${j.error || ''} ${j.error_description || ''}`.trim())
  cache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 }
  return j.access_token
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

async function tokenContaServico(): Promise<string> {
  const raw = env('GOOGLE_SERVICE_ACCOUNT_JSON')
  const sa = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf-8')) as { client_email: string; private_key: string }
  const iat = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/calendar.freebusy', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }))
  const assinatura = b64url(crypto.createSign('RSA-SHA256').update(`${header}.${claim}`).sign(sa.private_key))
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claim}.${assinatura}` }) })
  const j = await r.json() as { access_token?: string; expires_in?: number }
  if (!r.ok || !j.access_token) throw new Error(`Google conta de serviço: HTTP ${r.status}`)
  cache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 }
  return j.access_token
}

async function token(): Promise<string> {
  if (cache && cache.exp > Date.now() + 60_000) return cache.token
  return googleOAuth() ? tokenOAuth() : tokenContaServico()
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`Google ${method} ${path.split('?')[0]} -> ${r.status}: ${text.slice(0, 200)}`)
  return (text ? JSON.parse(text) : {}) as T
}

/** Ocupado da agenda. Erro = exceção (fail-closed: sem ver a agenda, não oferece horário). */
export async function googleOcupados(ini: number, fim: number): Promise<Intervalo[]> {
  const id = calendarId()
  const j = await api<{ calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: Array<{ reason: string }> }> }>('POST', '/freeBusy', {
    timeMin: new Date(ini).toISOString(), timeMax: new Date(fim).toISOString(), timeZone: 'America/Sao_Paulo', items: [{ id }],
  })
  const cal = j.calendars?.[id] || Object.values(j.calendars || {})[0]
  if (!cal) throw new Error('Google freeBusy: agenda não voltou na resposta')
  if (cal.errors?.length) throw new Error(`Google freeBusy: ${cal.errors.map(e => e.reason).join(', ')}`)
  return (cal.busy || []).map(b => ({ ini: Date.parse(b.start), fim: Date.parse(b.end) }))
}

export interface EventoGoogle { id: string; link: string; htmlLink: string; ini: number; fim: number; status: string }

interface EventoApi {
  id: string; status: string; htmlLink?: string; hangoutLink?: string
  start?: { dateTime?: string }; end?: { dateTime?: string }
  conferenceData?: { entryPoints?: Array<{ entryPointType: string; uri: string }> }
}

function paraEvento(e: EventoApi): EventoGoogle {
  const meet = e.hangoutLink || e.conferenceData?.entryPoints?.find(p => p.entryPointType === 'video')?.uri || ''
  return { id: e.id, link: meet, htmlLink: e.htmlLink || '', ini: Date.parse(e.start?.dateTime || ''), fim: Date.parse(e.end?.dateTime || ''), status: e.status }
}

/** Cria o evento com Google Meet. Com e-mail do cliente, o Google manda o convite. */
export async function criarEventoGoogle(r: { ini: number; fim: number; titulo: string; descricao: string; emailConvidado?: string; chave: string }): Promise<EventoGoogle> {
  const body = {
    summary: r.titulo,
    description: r.descricao,
    start: { dateTime: new Date(r.ini).toISOString(), timeZone: 'America/Sao_Paulo' },
    end: { dateTime: new Date(r.fim).toISOString(), timeZone: 'America/Sao_Paulo' },
    attendees: r.emailConvidado ? [{ email: r.emailConvidado }] : undefined,
    // requestId idempotente: repetir a chamada não cria um segundo Meet
    conferenceData: { createRequest: { requestId: r.chave.slice(0, 60), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    reminders: { useDefault: true },
  }
  const e = await api<EventoApi>('POST', `/calendars/${encodeURIComponent(calendarId())}/events?conferenceDataVersion=1&sendUpdates=${r.emailConvidado ? 'all' : 'none'}`, body)
  return paraEvento(e)
}

/** Lê o evento (para lembrete): null = não existe mais. */
export async function lerEventoGoogle(id: string): Promise<EventoGoogle | null> {
  try { return paraEvento(await api<EventoApi>('GET', `/calendars/${encodeURIComponent(calendarId())}/events/${encodeURIComponent(id)}`)) } catch (e) {
    if (/-> (404|410)/.test(e instanceof Error ? e.message : '')) return null
    throw e
  }
}
