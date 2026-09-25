// Prova do userscript num Chromium real contra um Kommo SIMULADO (servidor local).
// Uso: npm i --no-save playwright && node userscript/teste-navegador.mjs
//      (CHROMIUM_PATH=/caminho/do/chrome se o Playwright não baixou o navegador)
//
// Comportamento REAL da Kommo reproduzido (25/09/2026): o aceite SEMPRE responde
// sucesso; se foi antes da liberação, o lead passa a mostrar "The leads is no
// longer available" (queimado). Relógio do servidor 2,5s ATRÁS do PC: quem
// confiar no relógio do PC aceita cedo. Liberação encurtada para 3s.
//
//   101 real no card (sem created_at) → aceita, válido, avisa a Lara
//   102 "Comment: teste" no card → NÃO aceita
//   103 via API, Comment de teste só nas notas → NÃO aceita
//   105 real no card, expirou → "Requested lead is not found" → para
//   107 Comment ambíguo ("testando o Kommo") → IA diz real → aceita
//   108 via API, real → aceita DEPOIS da liberação no relógio do servidor → válido
//   109 via API, real, outros parceiros levaram → aceito mas inválido → Lara NÃO é avisada
//   110 via API, indicação de ontem → ignorada, zero tentativas
//   112 via API, Country: Venezuela → NÃO aceita (só atendemos em português)
//   111 via API E na tela 300 ms depois de criada → dispara pela tela (antes do limite do created_at) e é válido
//   reload → nada é reaceito
import http from 'node:http'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(process.cwd() + '/')
const { chromium } = require('playwright')
const SKEW = -2500 // servidor = PC - 2,5s
const agoraServidor = () => Date.now() + SKEW
const LIBERA = 3000
const criado = { 103: agoraServidor(), 108: agoraServidor(), 109: agoraServidor(), 110: agoraServidor() - 86400000, 112: agoraServidor() }
const inicioTeste = Date.now()
const aceites = []
const invalido = {}
const srv = http.createServer((req, res) => {
  let body = ''
  req.on('data', c => body += c)
  req.on('end', () => {
    res.setHeader('Date', new Date(agoraServidor()).toUTCString())
    const json = o => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)) }
    if (req.url === '/leads/pipeline/4338500/') {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      return res.end(`<html lang="pt"><body><div id="pipe">
        <div class="pipeline-unsorted__item" id="pipeline_item_101">Ana Souza<br>Comment: Preciso organizar o funil e integrar o WhatsApp</div>
        <div class="pipeline-unsorted__item" id="pipeline_item_105">Carla<br>Comment: Preciso de relatórios de vendas</div>
        <div class="pipeline-unsorted__item" id="pipeline_item_107">Davi<br>Comment: Estamos testando o Kommo e precisamos organizar o funil</div>
      </div></body></html>`)
    }
    if (req.url.startsWith('/api/v4/leads/unsorted')) {
      return json({ _embedded: { unsorted: [{ uid: 'mail1', created_at: Math.floor(agoraServidor() / 1000), pipeline_id: 14400320, category: 'mail', metadata: {}, _embedded: { leads: [{ id: 999 }] } }].concat(Object.entries(criado).map(([id, c]) => ({ uid: 'u' + id, created_at: Math.floor(c / 1000), pipeline_id: 4338500, category: 'forms', metadata: {}, _embedded: { leads: [{ id: Number(id) }] } }))) } })
    }
    const notas = req.url.match(/^\/api\/v4\/leads\/(\d+)\/notes/)
    if (notas) {
      const id = notas[1]
      const base = { 103: 'Comment: lead de teste', 108: 'Country: Brazil\nComment: Quero organizar o funil de vendas', 109: 'Comment: Preciso automatizar o atendimento', 112: 'Country: Venezuela\nLanguages: Arabic, English, Portuguese\nComment: Consultoría por favor' }[id]
      const lista = [base && { params: { text: `Name: X\n${base}\nPhone: 1` } }, invalido[id] && { note_type: 'service_message', params: { text: invalido[id] } }].filter(Boolean)
      return lista.length ? json({ _embedded: { notes: lista } }) : (res.statusCode = 204, res.end())
    }
    if (req.url.startsWith('/api/v4/')) { res.statusCode = 204; return res.end() }
    if (req.url === '/ajax/unsorted/accept') {
      const id = new URLSearchParams(body).get('request[unsorted][accept][]')
      // liberação pela criação REAL (em ms), como na Kommo
      const liberado = criado[id] ? agoraServidor() - criado[id] >= LIBERA : true
      aceites.push([id, Date.now(), liberado])
      if (id === '105') return json({ response: { unsorted: { accept: { status: 'error', error: 'Requested lead is not found' } } } })
      if (!liberado) invalido[id] = 'The leads is no longer available'
      if (id === '109') invalido[id] = 'The leads has already been accepted by other partners'
      return json({ response: { unsorted: { accept: { status: 'success', data: { x: { leads: [Number(id)] } } } } } })
    }
    res.statusCode = 404; res.end()
  })
}).listen(0)
const port = srv.address().port
const us = fs.readFileSync(new URL('./kommo-indicacoes.user.js', import.meta.url), 'utf8')
  .replace('LIBERACAO_MS: 5 * 60 * 1000', `LIBERACAO_MS: ${LIBERA}`)
  .replace('CONFERIR_APOS_MS: 6000', 'CONFERIR_APOS_MS: 500')
  .replace('POLL_MS: 15000', 'POLL_MS: 1000')
  .replace("AGENTE_URL: 'https://ia-kommo-control-sdr.vercel.app'", "AGENTE_URL: 'https://agente.test'")

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const p = await b.newPage()
const logs = []
p.on('console', m => logs.push(m.text()))
p.on('pageerror', e => logs.push('PAGEERROR ' + e.message))
const stubs = () => {
  window.__agente = []
  window.GM_notification = () => {}
  window.GM_xmlhttpRequest = o => {
    window.__agente.push({ url: o.url.split('?')[0].replace('https://agente.test', ''), lead: JSON.parse(o.data).leadId })
    const resp = o.url.includes('/api/classificar') ? { teste: false, ambiguo: true, motivo: 'IA: avaliando o Kommo, pedido real', fonte: 'ia' } : { ok: true }
    setTimeout(() => o.onload({ status: 200, responseText: JSON.stringify(resp) }), 30)
  }
}
await p.goto(`http://localhost:${port}/leads/pipeline/4338500/`)
await p.evaluate(stubs)
await p.addScriptTag({ content: us })
await p.evaluate(() => { const d = document.createElement('div'); d.className = 'pipeline-unsorted__item'; d.id = 'pipeline_item_102'; d.innerHTML = 'Beto<br>Comment: teste'; document.getElementById('pipe').appendChild(d) })
// 111 nasce agora no servidor e o card aparece na tela 300 ms depois
criado[111] = agoraServidor()
await p.waitForTimeout(300)
await p.evaluate(() => { const d = document.createElement('div'); d.className = 'pipeline-unsorted__item'; d.id = 'pipeline_item_111'; d.innerHTML = 'Eva<br>Comment: Quero integrar o site e o WhatsApp'; document.getElementById('pipe').appendChild(d) })
await p.waitForTimeout(9000)
console.log(logs.filter(l => !/404/.test(l)).join('\n'))
const selos = await p.$$eval('.cg-indicacao-selo', els => els.map(e => e.parentElement.id.replace('pipeline_item_', '') + ': ' + e.textContent))
console.log('--- selos:\n' + selos.join('\n'))
const est = await p.evaluate(() => Object.fromEntries(Object.entries(window.__INDICACOES__.leads).map(([id, m]) => [id, m.estado])))
console.log('--- estados:', JSON.stringify(est))
console.log('--- 112 (Venezuela):', JSON.stringify(est['112']), 'tentativas:', aceites.filter(a => a[0] === '112').length)
console.log('--- aceites [lead, liberado no servidor?, ms depois da liberação real]:', JSON.stringify(aceites.map(([id, t, l]) => [id, l, criado[id] ? Math.round(t + SKEW - criado[id] - LIBERA) : null])))
console.log('--- avisos à Lara:', JSON.stringify((await p.evaluate(() => window.__agente)).filter(x => x.url === '/api/novo-lead').map(x => x.lead)))
console.log('--- relógio estimado:', JSON.stringify(await p.evaluate(() => window.__INDICACOES__.relogio())), '(real: ' + SKEW + ')')
const antes = aceites.length
await p.reload(); await p.evaluate(stubs); await p.addScriptTag({ content: us }); await p.waitForTimeout(3000)
console.log('--- após reload, novas tentativas:', aceites.length - antes)
await b.close(); srv.close()
