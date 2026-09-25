// Prova do userscript num Chromium real contra um Kommo SIMULADO (servidor local).
// Uso: npm i --no-save playwright && node userscript/teste-navegador.mjs
//      (CHROMIUM_PATH=/caminho/do/chrome se o Playwright não baixou o navegador)
//
// Cenários (relógio encurtado: liberação esperada em 3s):
//   101 real no card, a Kommo libera em 4,2s → sonda, rajada, aceita, avisa o agente
//   102 "Comment: teste" no card → NÃO aceita
//   103 via API, Comment de teste só nas notas → NÃO aceita
//   104 real, outros parceiros levam antes → "already accepted" até desistir (perdido)
//   105 real, expira → "Requested lead is not found" → para na hora
//   107 Comment ambíguo ("testando o Kommo") → IA diz real → aceita
//   reload → nada é reaceito
import http from 'node:http'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(process.cwd() + '/')
const { chromium } = require('playwright')
const aceites = []
const t0 = Date.now()
const LIBERA = { 101: 4200, 107: 3000 }
const srv = http.createServer((req, res) => {
  let body = ''
  req.on('data', c => body += c)
  req.on('end', () => {
    const json = o => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)) }
    if (req.url === '/') {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      return res.end(`<html lang="pt"><body><div id="pipe">
        <div class="pipeline-unsorted__item" id="pipeline_item_101">Ana Souza<br>Comment: Preciso organizar o funil e integrar o WhatsApp</div>
        <div class="pipeline-unsorted__item" id="pipeline_item_104">Bruno<br>Comment: Quero automatizar o atendimento</div>
        <div class="pipeline-unsorted__item" id="pipeline_item_105">Carla<br>Comment: Preciso de relatórios de vendas</div>
        <div class="pipeline-unsorted__item" id="pipeline_item_107">Davi<br>Comment: Estamos testando o Kommo e precisamos organizar o funil</div>
      </div></body></html>`)
    }
    if (req.url.startsWith('/api/v4/leads/unsorted')) return json({ _embedded: { unsorted: [{ uid: 'u1', created_at: Math.floor(t0 / 1000), metadata: {}, _embedded: { leads: [{ id: 103 }] } }] } })
    if (req.url === '/api/v4/leads/103/notes?limit=50') return json({ _embedded: { notes: [{ params: { text: 'Name: X\nComment: lead de teste\nPhone: 1' } }] } })
    if (req.url.startsWith('/api/v4/leads/')) { res.statusCode = 204; return res.end() }
    if (req.url === '/ajax/unsorted/accept') {
      const id = new URLSearchParams(body).get('request[unsorted][accept][]')
      const dt = Date.now() - t0
      aceites.push([id, dt])
      if (id === '104') return json({ response: { unsorted: { accept: { status: 'error', error: 'The leads has already been accepted by other partners' } } } })
      if (id === '105') return json({ response: { unsorted: { accept: { status: 'error', error: 'Requested lead is not found' } } } })
      if (dt < (LIBERA[id] || 0)) return json({ response: { unsorted: { accept: { status: 'error', error: 'The leads is no longer available' } } } })
      return json({ response: { unsorted: { accept: { status: 'success', data: { x: { leads: [Number(id)] } } } } } })
    }
    res.statusCode = 404; res.end()
  })
}).listen(0)
const port = srv.address().port
const us = fs.readFileSync(new URL('./kommo-indicacoes.user.js', import.meta.url), 'utf8')
  .replace('LIBERACAO_MS: 5 * 60 * 1000', 'LIBERACAO_MS: 3000')
  .replace('SONDA_ANTES_MS: 45000', 'SONDA_ANTES_MS: 2000')
  .replace('SONDA_INTERVALO_MS: 2500', 'SONDA_INTERVALO_MS: 600')
  .replace('RAJADA_ANTES_MS: 8000', 'RAJADA_ANTES_MS: 500')
  .replace('RAJADA_DEPOIS_MS: 20000', 'RAJADA_DEPOIS_MS: 2500')
  .replace('DESISTIR_APOS_MS: 2 * 60 * 1000', 'DESISTIR_APOS_MS: 4000')
  .replace("AGENTE_URL: ''", "AGENTE_URL: 'https://agente.test'")

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const p = await b.newPage()
const logs = []
p.on('console', m => logs.push(m.text()))
p.on('pageerror', e => logs.push('PAGEERROR ' + e.message))
const stubs = () => {
  window.__agente = []
  window.GM_notification = () => {}
  window.GM_xmlhttpRequest = o => {
    window.__agente.push({ url: o.url.split('?')[0], data: JSON.parse(o.data) })
    const resp = o.url.includes('/api/classificar') ? { teste: false, ambiguo: true, motivo: 'IA: avaliando o Kommo, pedido real', fonte: 'ia' } : { ok: true }
    setTimeout(() => o.onload({ status: 200, responseText: JSON.stringify(resp) }), 30)
  }
}
await p.goto(`http://localhost:${port}/`)
await p.evaluate(stubs)
await p.addScriptTag({ content: us })
await p.evaluate(() => { const d = document.createElement('div'); d.className = 'pipeline-unsorted__item'; d.id = 'pipeline_item_102'; d.innerHTML = 'Beto<br>Comment: teste'; document.getElementById('pipe').appendChild(d) })
await p.waitForTimeout(9000)
console.log(logs.filter(l => !/404/.test(l)).join('\n'))
const selos = await p.$$eval('.cg-indicacao-selo', els => els.map(e => e.parentElement.id.replace('pipeline_item_', '') + ': ' + e.textContent))
console.log('--- selos:\n' + selos.join('\n'))
const por = id => aceites.filter(a => a[0] === id)
console.log('--- tentativas de aceite por lead:', Object.fromEntries(['101', '102', '103', '104', '105', '107'].map(id => [id, por(id).length])))
console.log('--- 101: 1ª tentativa em', por('101')[0]?.[1], 'ms · aceito em', por('101').at(-1)?.[1], 'ms (liberou em 4200)')
const agente = await p.evaluate(() => window.__agente)
console.log('--- chamadas ao agente:', JSON.stringify(agente))
const pico = Math.max(...aceites.map(([, t]) => aceites.filter(([, u]) => u > t - 1000 && u <= t).length))
console.log('--- pico de requisições de aceite em 1s (limite 6):', pico)
const antes = aceites.length
await p.reload(); await p.evaluate(stubs); await p.addScriptTag({ content: us }); await p.waitForTimeout(3000)
console.log('--- após reload, novas tentativas:', aceites.length - antes)
const rel = JSON.parse(await p.evaluate(() => window.__INDICACOES__.relatorio()))
console.log('--- relatório: leads', Object.keys(rel.leads).join(','), '· eventos de diagnóstico do 101:', rel.diag['101']?.eventos.length, '· htmls:', rel.diag['101']?.htmls.length)
await b.close(); srv.close()
