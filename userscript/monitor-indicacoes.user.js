// ==UserScript==
// @name         Kommo · Monitor de indicações (só observa, não aceita)
// @namespace    https://controlgestao.com.br/
// @version      1.0.0
// @description  Mede quanto tempo cada indicação de parceiro fica em Incoming leads antes de sumir e o que aconteceu com ela. NÃO aceita nada.
// @match        https://*.kommo.com/*
// @run-at       document-idle
// @grant        unsafeWindow
// @noframes
// ==/UserScript==
/* global unsafeWindow */
/**
 * Monitor das indicações de parceiro (27/10/2026). Não clica, não aceita, não recusa.
 *
 * Para cada indicação nova no Incoming leads do Funil de vendas - SDR, registra:
 *   - criado: created_at da Kommo (segundos inteiros, relógio da Kommo);
 *   - na tela: quando o card apareceu (relógio do computador, convertido para o da Kommo);
 *   - saiu: quando a indicação deixou de aparecer na lista de Incoming (consulta a cada 2 s);
 *   - resultado: etapa do lead depois, quem mudou a etapa e as notas da Kommo
 *     ("no longer available", "already been accepted by other partners", limite diário).
 *
 * Relatório: copy(__MONITOR__.relatorio())  ·  tabela no console: __MONITOR__.tabela()
 */
;(function () {
  'use strict'
  var CFG = { PIPELINE_ID: 4338500, POLL_MS: 2000, NOSSO_USER_ID: 12725576, GUARDAR: 60 }
  var W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window
  var pageFetch = W.fetch.bind(W)
  var CHAVE = 'cg-monitor-indicacoes'
  if (W.__MONITOR__ && W.__MONITOR__.parar) W.__MONITOR__.parar()

  function ler() { try { return JSON.parse(localStorage.getItem(CHAVE) || '{}') || {} } catch (_) { return {} } }
  function gravar() { try { localStorage.setItem(CHAVE, JSON.stringify(leads)) } catch (_) { /* cheio */ } }
  var leads = ler() // id -> registro

  // Diferença de relógio (Kommo − computador) pelo cabeçalho Date: intervalo [lo, hi] em ms
  var lo = -Infinity, hi = Infinity
  function amostra(res, t0, t1) {
    var d = Date.parse(res.headers.get('date') || '')
    if (!d) return
    lo = Math.max(lo, d - t1); hi = Math.min(hi, d + 1000 - t0)
    if (lo > hi) { lo = d - t1; hi = d + 1000 - t0 }
  }
  function difKommo() { return isFinite(lo) && isFinite(hi) ? (lo + hi) / 2 : 0 }
  function agoraKommo() { return Date.now() + difKommo() }
  function hora(ms) { return new Date(ms).toLocaleTimeString('pt-BR', { hour12: false }) }
  function s(ms) { return ms === null || ms === undefined ? '—' : (ms / 1000).toFixed(1) + ' s' }
  function log(msg) { console.log('%c[MONITOR ' + hora(Date.now()) + '] ' + msg, 'color:#1565c0') }

  function api(path) {
    var t0 = Date.now()
    return pageFetch(path, { credentials: 'include', headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' } }).then(function (r) {
      amostra(r, t0, Date.now())
      if (r.status === 204) return null
      if (!r.ok) throw new Error('HTTP ' + r.status + ' em ' + path.split('?')[0])
      return r.json()
    })
  }

  function ehIndicacao(u) {
    var md = u.metadata || {}
    return u.pipeline_id === CFG.PIPELINE_ID && u.category === 'forms' && (u.source_name === 'PartnersService' || /partners/i.test(md.form_id || ''))
  }

  // ---- 1. Lista de Incoming a cada 2 s: entrada e saída de cada indicação ----
  var timer = null
  function passo() {
    api('/api/v4/leads/unsorted?filter[pipeline_id]=' + CFG.PIPELINE_ID + '&limit=50&order[created_at]=desc').then(function (j) {
      var agora = agoraKommo()
      var presentes = {}
      ;((j && j._embedded && j._embedded.unsorted) || []).filter(ehIndicacao).forEach(function (u) {
        var id = String(((u._embedded || {}).leads || [])[0] && u._embedded.leads[0].id || '')
        if (!id) return
        presentes[id] = true
        var r = leads[id]
        if (!r) {
          var criado = u.created_at * 1000
          if (agora - criado > 15 * 60 * 1000) return // indicação antiga parada em Incoming: não interessa
          r = leads[id] = { id: id, uid: u.uid, criado: criado, vistoApi: agora, ultimaVez: agora, telaKommo: telaPendente[id] || null }
          log('🆕 indicação ' + id + ' · criada ' + hora(criado) + ' (Kommo) · vista na API ' + s(agora - criado) + ' depois')
          gravar()
        } else if (!r.saiu) { r.ultimaVez = agora }
      })
      Object.keys(leads).forEach(function (id) {
        var r = leads[id]
        if (r.saiu || presentes[id]) return
        // sumiu da lista: o ponto médio entre a última vez vista e agora é a melhor estimativa
        r.saiu = Math.round((r.ultimaVez + agora) / 2)
        r.tempoIncoming = r.saiu - r.criado
        log('🚪 indicação ' + id + ' saiu do Incoming ' + s(r.tempoIncoming) + ' depois de criada · conferindo o que aconteceu...')
        gravar()
        setTimeout(function () { conferir(id) }, 4000)
      })
      var ids = Object.keys(leads)
      if (ids.length > CFG.GUARDAR) ids.sort(function (a, b) { return leads[a].criado - leads[b].criado }).slice(0, ids.length - CFG.GUARDAR).forEach(function (x) { delete leads[x] })
    }).catch(function (e) { log('⚠️ ' + e.message) })
  }

  // ---- 2. Depois de sair: etapa, quem mudou, notas da Kommo ----
  function conferir(id) {
    var r = leads[id]
    Promise.all([
      api('/api/v4/leads/' + id).catch(function () { return null }),
      api('/api/v4/leads/' + id + '/notes?limit=50').catch(function () { return null }),
      api('/api/v4/events?filter[entity]=lead&filter[entity_id]=' + id + '&limit=50').catch(function () { return null }),
    ]).then(function (x) {
      var lead = x[0] || {}, notas = ((x[1] || {})._embedded || {}).notes || [], evs = ((x[2] || {})._embedded || {}).events || []
      var texto = notas.map(function (n) { return (n.params && n.params.text) || '' }).join(' | ')
      var mudou = evs.filter(function (e) { return e.type === 'lead_status_changed' }).sort(function (a, b) { return a.created_at - b.created_at })[0]
      r.etapa = lead.pipeline_id + '/' + lead.status_id
      r.mudouPor = mudou ? mudou.created_by : null
      r.mudouEm = mudou ? mudou.created_at * 1000 - r.criado : null
      r.notaKommo = (texto.match(/(no longer available|already been accepted by other partners|daily leads limit[^|]*)/i) || [])[1] || ''
      r.resultado = /already been accepted/i.test(texto) ? 'outro parceiro aceitou'
        : /no longer available/i.test(texto) ? (r.mudouPor === CFG.NOSSO_USER_ID ? 'aceito por nós, mas queimou (no longer available)' : 'indisponível (no longer available)')
        : /daily leads limit/i.test(texto) ? 'limite diário da Kommo'
        : r.mudouPor === CFG.NOSSO_USER_ID ? 'aceito por nós' + ((lead._embedded && lead._embedded.contacts && lead._embedded.contacts.length) ? ' (válido)' : '')
        : lead.status_id === 143 ? 'fechado/perdido sem aceite (expirou ou outro parceiro)'
        : 'outro: etapa ' + r.etapa
      log('📋 ' + id + ' · ' + r.resultado + ' · ficou ' + s(r.tempoIncoming) + ' no Incoming' + (r.mudouEm !== null ? ' · etapa mudou aos ' + s(r.mudouEm) + (r.mudouPor ? ' por ' + r.mudouPor : ' pelo sistema') : ''))
      gravar()
    })
  }

  // ---- 3. Quando o card aparece na tela ----
  var telaPendente = {}
  var obs = new MutationObserver(function () {
    var cards = document.querySelectorAll('[id^="pipeline_item_"].pipeline-unsorted__item')
    for (var i = 0; i < cards.length; i++) {
      var id = cards[i].getAttribute('data-id')
      if (!id) continue
      if (leads[id] && !leads[id].telaKommo) { leads[id].telaKommo = agoraKommo(); gravar() }
      else if (!leads[id] && !telaPendente[id]) telaPendente[id] = agoraKommo()
    }
  })
  obs.observe(document.body, { childList: true, subtree: true })

  timer = setInterval(passo, CFG.POLL_MS)
  passo()

  function linhas() {
    return Object.keys(leads).map(function (id) { return leads[id] }).sort(function (a, b) { return a.criado - b.criado }).map(function (r) {
      return {
        lead: r.id,
        criada: hora(r.criado),
        'na tela (s)': r.telaKommo ? +((r.telaKommo - r.criado) / 1000).toFixed(1) : null,
        'no Incoming (s)': r.tempoIncoming ? +(r.tempoIncoming / 1000).toFixed(1) : (r.saiu ? null : 'ainda lá'),
        'etapa mudou (s)': r.mudouEm !== null && r.mudouEm !== undefined ? +(r.mudouEm / 1000).toFixed(0) : null,
        resultado: r.resultado || (r.saiu ? 'conferindo' : '—'),
      }
    })
  }
  W.__MONITOR__ = {
    tabela: function () { console.table(linhas()) },
    relatorio: function () { return JSON.stringify({ gerado: new Date().toISOString(), relogioKommoMenosPcMs: Math.round(difKommo()), incerteza: isFinite(hi - lo) ? Math.round(hi - lo) : null, leads: linhas(), bruto: leads }, null, 1) },
    limpar: function () { leads = {}; gravar() },
    parar: function () { clearInterval(timer); obs.disconnect(); log('⛔ parado') },
  }
  log('👀 monitor ativo (não aceita nada) · tabela: __MONITOR__.tabela() · relatório: copy(__MONITOR__.relatorio())')
})()
