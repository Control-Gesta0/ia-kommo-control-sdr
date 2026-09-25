// Prova do userscript num Chromium real contra um Kommo SIMULADO (servidor local).
// Uso: npm i --no-save playwright && node userscript/teste-navegador.mjs
// Confere: aceita lead real com retry, NÃO aceita teste (card e notas), reload não reaceita.
import http from 'node:http'
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(process.cwd() + '/')
const { chromium } = require('playwright')
const calls = []
let n = 0
const srv = http.createServer((req, res) => {
  let body = ''
  req.on('data', c => body += c)
  req.on('end', () => {
    calls.push(req.method + ' ' + req.url + ' ' + decodeURIComponent(body))
    if (req.url === '/') { res.setHeader('content-type','text/html'); return res.end(`<html lang="pt"><body><div id="pipe"><div class="pipeline-unsorted__item" id="pipeline_item_101">Ana Souza<br>Comment: Preciso organizar o funil e integrar o WhatsApp</div></div></body></html>`) }
    if (req.url.startsWith('/api/v4/leads/unsorted')) { res.setHeader('content-type','application/json'); return res.end(JSON.stringify({_embedded:{unsorted:[{uid:'u1',created_at:Math.floor(Date.now()/1000)-1,metadata:{},_embedded:{leads:[{id:103}]}}]}})) }
    if (req.url === '/api/v4/leads/103/notes?limit=50') { res.setHeader('content-type','application/json'); return res.end(JSON.stringify({_embedded:{notes:[{params:{text:'Name: X\nComment: lead de teste\nPhone: 1'}}]}})) }
    if (req.url.startsWith('/api/v4/leads/')) { res.statusCode = 204; return res.end() }
    if (req.url === '/ajax/unsorted/accept') {
      n++
      const id = new URLSearchParams(body).get('request[unsorted][accept][]')
      res.setHeader('content-type','application/json')
      if (n < 3) return res.end(JSON.stringify({response:{unsorted:{accept:{status:'error',error:'too early'}}}}))
      return res.end(JSON.stringify({response:{unsorted:{accept:{status:'success',data:{a:{leads:[Number(id)]}}}}}}))
    }
    res.statusCode = 404; res.end()
  })
}).listen(0)
const port = srv.address().port
let us = fs.readFileSync(new URL('./kommo-indicacoes.user.js', import.meta.url),'utf8')
  .replace('ESPERA_MS: 4 * 60 * 1000 + 57400', 'ESPERA_MS: 2500').replace('LER_COMENTARIO_ANTES_MS: 30000', 'LER_COMENTARIO_ANTES_MS: 1000').replace("POLL_MS: 20000", "POLL_MS: 60000")
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const p = await b.newPage()
const logs = []
p.on('console', m => logs.push(m.text())); p.on('pageerror', e => logs.push('PAGEERROR ' + e.message))
await p.goto(`http://localhost:${port}/`)
await p.evaluate(() => { window.GM_notification = (o) => console.log('NOTIF ' + o.title); window.GM_xmlhttpRequest = () => {} })
await p.addScriptTag({ content: us })
await p.evaluate(() => { const d = document.createElement('div'); d.className='pipeline-unsorted__item'; d.id='pipeline_item_102'; d.innerHTML='Beto<br>Comment: teste'; document.getElementById('pipe').appendChild(d) })
await p.waitForTimeout(6000)
console.log(logs.join('\n'))
console.log('--- selos:', await p.$$eval('.cg-indicacao-selo', els => els.map(e => e.parentElement.id + ': ' + e.textContent)))
console.log('--- accept calls:', calls.filter(c => c.includes('/ajax/unsorted/accept')).map(c => c.split(' ').slice(-1)[0].match(/accept\]\[\]=(\d+)/)?.[1]))
// reload: não pode reaceitar
calls.length = 0
await p.reload(); await p.evaluate(() => { window.GM_notification = () => {}; window.GM_xmlhttpRequest = () => {} }); await p.addScriptTag({ content: us }); await p.waitForTimeout(3000)
console.log('--- após reload, accept calls:', calls.filter(c => c.includes('accept')).length, await p.$$eval('.cg-indicacao-selo', els => els.map(e => e.textContent)))
await b.close(); srv.close()
