/* global FiltroIndicacao, GM_xmlhttpRequest, GM_notification, unsafeWindow */
/**
 * Indicações Kommo v3 — corpo do userscript. NÃO edite o .user.js gerado:
 * edite este arquivo (e o filtro-indicacao.js) e rode `npm run build:userscript`.
 *
 * O que mudou da v2.1 (e por quê):
 *  1. Filtro de TESTE antes de aceitar: lê o "Comment:" (DOM, API de Incoming
 *     leads, notas e campos do lead) e NÃO aceita indicação de teste.
 *  2. Relógio pelo created_at do Incoming lead, não pela hora em que o DOM
 *     mostrou o card: recarregar a página não zera mais a contagem.
 *  3. Estado em localStorage: reload não reaceita nem esquece o que já decidiu.
 *  4. Detecção por DUAS fontes: MutationObserver (tela do funil) + consulta
 *     periódica a /api/v4/leads/unsorted com a sessão do navegador (funciona com
 *     a aba em qualquer tela do Kommo). Se a API recusar a sessão, segue só no DOM.
 *  5. Relógio num Web Worker: aba em segundo plano não atrasa o disparo.
 *  6. Ritmo de tentativas dentro do limite público da Kommo (7 req/s) e recuo
 *     em 429: a v2.1 chegava a ~20 req/s e arriscava bloqueio de IP.
 *  7. MODO "assistido": o script filtra, marca o card e avisa a hora de aceitar;
 *     o clique é humano (a regra do programa de parceiros pede aceite manual).
 *  8. Depois do aceite, avisa o agente de IA (POST /api/novo-lead) para iniciar
 *     a conversa na hora. O webhook da Kommo é a rota de segurança.
 */
;(function () {
  'use strict'

  // ---------------- CONFIGURAÇÃO ----------------
  var CFG = {
    USER_ID: 12725576,           // responsável que recebe o lead aceito
    STATUS_ID: 55438567,         // etapa de destino do lead aceito

    // 'automatico' = o script aceita sozinho (comportamento da v2.1)
    // 'assistido'  = o script filtra e avisa; você clica em Aceitar
    MODO: 'automatico',

    // Espera contada do created_at do Incoming lead (fallback: hora da detecção).
    // A Kommo liberou o aceite em 5 min (mudança recente, confirmada em 25/09/2026;
    // a página pública do programa ainda diz 15). Aceite antes do prazo volta erro
    // e o loop repete dentro da JANELA_MS.
    ESPERA_MS: 4 * 60 * 1000 + 57400,
    LER_COMENTARIO_ANTES_MS: 30000, // lê e decide o filtro 30s antes do disparo
    JANELA_MS: 8000,                // janela de tentativas depois do disparo
    MIN_INTERVALO_MS: 150,          // ~4 a 6 req/s: abaixo do limite de 7 req/s
    MAX_INTERVALO_MS: 350,
    RECUO_429_MS: 1200,

    // Filtro de teste: 'inteligente' (trial do Kommo passa) ou 'estrito' (qualquer "teste" bloqueia)
    FILTRO_MODO: 'inteligente',
    // Não achou "Comment:" em lugar nenhum: 'aceitar' (não perde lead real) ou 'pular'
    SEM_COMENTARIO: 'aceitar',

    POLL_MS: 20000,                 // consulta à API de Incoming leads (0 = desliga)

    // Agente de IA (deixe vazio para não avisar). O segredo é o INDICACAO_SECRET da Vercel.
    AGENTE_URL: '',
    AGENTE_SECRET: '',

    DEBUG: false,
  }

  var W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window
  var pageFetch = W.fetch.bind(W)
  var STORE_KEY = 'cg-indicacoes-v3'
  var VERSAO = '3.0.0'

  if (W.__INDICACOES__ && W.__INDICACOES__.stop) {
    console.warn('[INDICAÇÕES] já ativo, reiniciando...')
    W.__INDICACOES__.stop()
  }

  // ---------------- UTIL ----------------
  function now() { return Date.now() }
  function hora(ms) { return new Date(ms || now()).toLocaleTimeString('pt-BR', { hour12: false }) }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms) }) }
  function rand(a, b) { return a + Math.floor(Math.random() * Math.max(1, b - a)) }
  function log(icone, msg) { console.log('[INDICAÇÕES ' + hora() + '] ' + icone + ' ' + msg) }
  function dbg(msg, obj) { if (CFG.DEBUG) console.debug('[INDICAÇÕES:DBG ' + hora() + '] ' + msg, obj === undefined ? '' : obj) }

  function avisar(titulo, texto) {
    try {
      if (typeof GM_notification === 'function') GM_notification({ title: titulo, text: texto, timeout: 15000 })
    } catch (_) { /* sem notificação, segue o log */ }
  }

  // ---------------- ESTADO PERSISTENTE ----------------
  // { [leadId]: { visto, criado, estado, comentario, motivo, atualizado } }
  function carregar() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {} } catch (_) { return {} }
  }
  var memo = carregar()
  function salvar() {
    var limite = now() - 48 * 3600 * 1000
    Object.keys(memo).forEach(function (id) { if ((memo[id].atualizado || 0) < limite) delete memo[id] })
    try { localStorage.setItem(STORE_KEY, JSON.stringify(memo)) } catch (_) { /* storage cheio/bloqueado */ }
  }
  function marcar(id, patch) {
    memo[id] = Object.assign({}, memo[id] || {}, patch, { atualizado: now() })
    salvar()
    desenharSelo(id)
  }
  var FINAIS = { aceito: 1, teste: 1, nao_existe: 1, timeout: 1, pulado: 1, liberado: 1 }

  // ---------------- RELÓGIO (Web Worker, com fallback) ----------------
  // Aba em segundo plano estrangula setTimeout; worker dedicado não.
  var tarefas = []
  var worker = null
  var fallbackTimer = null
  function tick() {
    var t = now()
    var vencidas = tarefas.filter(function (x) { return x.em <= t })
    tarefas = tarefas.filter(function (x) { return x.em > t })
    vencidas.forEach(function (x) { try { x.fn() } catch (e) { console.error(e) } })
  }
  function agendar(em, fn) { tarefas.push({ em: em, fn: fn }) }
  try {
    var src = 'setInterval(function(){postMessage(1)},250)'
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })))
    worker.onmessage = tick
  } catch (e) {
    dbg('worker bloqueado (CSP?), usando setInterval', e)
    fallbackTimer = setInterval(tick, 250)
  }

  // ---------------- SELO NO CARD ----------------
  var CORES = { teste: '#c62828', aceito: '#2e7d32', liberado: '#1565c0', aguardando: '#6d4c41', nao_existe: '#757575', timeout: '#ef6c00', pulado: '#757575', aceitando: '#1565c0' }
  function desenharSelo(id) {
    var el = document.getElementById('pipeline_item_' + id) || document.querySelector('.pipeline-unsorted__item[data-id="' + id + '"]')
    var m = memo[id]
    if (!el || !m) return
    var selo = el.querySelector('.cg-indicacao-selo')
    if (!selo) {
      selo = document.createElement('div')
      selo.className = 'cg-indicacao-selo'
      selo.style.cssText = 'margin:4px 0 0;padding:2px 6px;border-radius:4px;font:600 11px/1.4 sans-serif;color:#fff;display:inline-block;max-width:100%;white-space:normal'
      el.appendChild(selo)
    }
    var textos = {
      teste: 'TESTE: não aceito',
      aceito: 'Aceito ' + hora(m.atualizado),
      liberado: 'Pode aceitar a partir de ' + hora(m.libera),
      aguardando: 'Aguardando ' + hora(m.libera),
      aceitando: 'Aceitando...',
      nao_existe: 'Não existe mais',
      timeout: 'Não aceitou na janela',
      pulado: 'Pulado: sem comentário',
    }
    selo.textContent = (textos[m.estado] || m.estado) + (m.motivo ? ' · ' + m.motivo : '')
    selo.title = m.comentario ? 'Comment: ' + m.comentario : ''
    selo.style.background = CORES[m.estado] || '#555'
  }

  // ---------------- API COM A SESSÃO DO NAVEGADOR ----------------
  var apiSessaoOk = true
  function apiGet(path) {
    return pageFetch(path, { credentials: 'include', headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' } })
      .then(function (r) {
        if (r.status === 204) return null
        if (r.status === 401 || r.status === 403) { apiSessaoOk = false; throw new Error('sessão recusada pela API (' + r.status + ')') }
        if (!r.ok) throw new Error(path + ' -> ' + r.status)
        return r.json()
      })
  }

  // leadId -> { criado (ms), texto (metadata) } da última leitura de Incoming leads
  var incoming = {}
  function lerIncoming() {
    return apiGet('/api/v4/leads/unsorted?limit=50&order[created_at]=desc').then(function (j) {
      var itens = (j && j._embedded && j._embedded.unsorted) || []
      itens.forEach(function (u) {
        var leads = (u._embedded && u._embedded.leads) || []
        leads.forEach(function (l) {
          incoming[String(l.id)] = { criado: (u.created_at || 0) * 1000, texto: JSON.stringify(u.metadata || {}) + ' ' + (u.source_name || ''), uid: u.uid }
          registrar(String(l.id), 'api')
        })
      })
      return itens.length
    })
  }

  function textoDoCard(id) {
    var el = document.getElementById('pipeline_item_' + id) || document.querySelector('.pipeline-unsorted__item[data-id="' + id + '"]')
    if (!el) return ''
    // innerText do elemento VIVO (clone destacado perde as quebras de linha e gruda "NomeComment:")
    var texto = el.innerText || el.textContent || ''
    var selo = el.querySelector('.cg-indicacao-selo')
    return selo && selo.textContent ? texto.replace(selo.textContent, '') : texto
  }

  /** Procura o "Comment:" em todas as fontes; para na primeira que achar. */
  function lerComentario(id) {
    var F = FiltroIndicacao
    var fontes = [
      function () { return Promise.resolve(textoDoCard(id)) },
      function () { return Promise.resolve(incoming[id] ? incoming[id].texto : '') },
      function () {
        return apiGet('/api/v4/leads/' + id + '/notes?limit=50').then(function (j) {
          return ((j && j._embedded && j._embedded.notes) || []).map(function (n) { return JSON.stringify(n.params || {}) }).join('\n')
        })
      },
      function () {
        return apiGet('/api/v4/leads/' + id).then(function (j) {
          return ((j && j.custom_fields_values) || []).map(function (f) { return (f.field_name || '') + ': ' + (f.values || []).map(function (v) { return v.value }).join(', ') }).join('\n') + '\n' + ((j && j.name) || '')
        })
      },
    ]
    var i = 0
    function proxima() {
      if (i >= fontes.length) return Promise.resolve(null)
      var nomeFonte = ['card', 'incoming', 'notas', 'campos'][i]
      var f = fontes[i++]
      return f().then(function (texto) {
        var c = F.extrairComentario(texto)
        if (c !== null) { dbg('comentário de ' + id + ' achado em: ' + nomeFonte); return c }
        return proxima()
      }, function (e) { dbg('fonte ' + nomeFonte + ' falhou: ' + e.message); return proxima() })
    }
    return proxima()
  }

  // ---------------- ACEITE (endpoint do próprio Kommo web) ----------------
  function corpoAceite(id) {
    var body = new URLSearchParams({
      'request[unsorted][lang]': (document.documentElement.lang || 'pt').slice(0, 2),
      'request[unsorted][user_id]': String(CFG.USER_ID),
      'request[unsorted][status_id]': String(CFG.STATUS_ID),
    })
    body.append('request[unsorted][accept][]', id)
    return body.toString()
  }

  function tentarAceitar(id) {
    return pageFetch('/ajax/unsorted/accept', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest' },
      body: corpoAceite(id),
    }).then(function (res) {
      return res.text().then(function (t) {
        var json = null
        try { json = JSON.parse(t) } catch (_) { /* não é JSON */ }
        dbg('resposta ' + id + ' HTTP ' + res.status, json)
        return { status: res.status, json: json }
      })
    })
  }

  function interpretar(id, status, json) {
    if (status === 429) return 'recuar'
    var accept = json && json.response && json.response.unsorted && json.response.unsorted.accept
    if (!accept) return 'repetir'
    if (accept.status === 'success') {
      var data = accept.data || {}
      var tem = Object.keys(data).some(function (k) { var d = data[k]; return d && Array.isArray(d.leads) && d.leads.map(Number).indexOf(Number(id)) >= 0 })
      return tem ? 'aceito' : 'repetir'
    }
    if (accept.error === 'Requested lead is not found') return 'nao_existe'
    dbg('recusa ' + id + ': status=' + accept.status + ' error=' + (accept.error || '-'))
    return 'repetir'
  }

  function loopAceite(id) {
    var inicio = now()
    var fim = inicio + CFG.JANELA_MS
    var n = 0
    marcar(id, { estado: 'aceitando' })
    log('🎯', 'disparando ' + id)
    function volta() {
      if (!emAndamento[id]) return Promise.resolve()
      if (now() >= fim) { log('⌛', 'timeout ' + id + ' após ' + n + ' tentativas'); marcar(id, { estado: 'timeout' }); return Promise.resolve() }
      n++
      return tentarAceitar(id).then(function (r) {
        var res = interpretar(id, r.status, r.json)
        if (res === 'aceito') {
          log('✅', 'ACEITO ' + id + ' na tentativa #' + n + ' (+' + ((now() - inicio) / 1000).toFixed(2) + 's)')
          marcar(id, { estado: 'aceito' })
          avisar('Indicação aceita', 'Lead ' + id + (memo[id].comentario ? ': ' + memo[id].comentario.slice(0, 80) : ''))
          return avisarAgente(id)
        }
        if (res === 'nao_existe') { log('🚫', id + ' não existe mais (outros parceiros já aceitaram ou expirou)'); marcar(id, { estado: 'nao_existe' }); return }
        return sleep(res === 'recuar' ? CFG.RECUO_429_MS : rand(CFG.MIN_INTERVALO_MS, CFG.MAX_INTERVALO_MS)).then(volta)
      }, function (e) {
        dbg('erro de rede ' + id + ': ' + e.message)
        return sleep(rand(CFG.MIN_INTERVALO_MS, CFG.MAX_INTERVALO_MS)).then(volta)
      })
    }
    return volta().then(function () { delete emAndamento[id] })
  }

  // ---------------- AVISO AO AGENTE DE IA ----------------
  function avisarAgente(id) {
    if (!CFG.AGENTE_URL || typeof GM_xmlhttpRequest !== 'function') return Promise.resolve()
    return new Promise(function (resolve) {
      GM_xmlhttpRequest({
        method: 'POST',
        url: CFG.AGENTE_URL.replace(/\/+$/, '') + '/api/novo-lead?secret=' + encodeURIComponent(CFG.AGENTE_SECRET),
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ leadId: Number(id), comentario: memo[id] && memo[id].comentario, origem: 'userscript', versao: VERSAO }),
        timeout: 15000,
        onload: function (r) { log('🤖', 'agente avisado sobre ' + id + ' → HTTP ' + r.status); resolve() },
        onerror: function () { log('⚠️', 'falha ao avisar o agente sobre ' + id + ' (o webhook da Kommo cobre)'); resolve() },
        ontimeout: function () { log('⚠️', 'timeout ao avisar o agente sobre ' + id); resolve() },
      })
    })
  }

  // ---------------- DECISÃO POR LEAD ----------------
  var emAndamento = {}

  function decidir(id) {
    return lerComentario(id).then(function (comentario) {
      if (comentario === null) {
        if (CFG.SEM_COMENTARIO === 'pular') { log('⏭️', id + ' sem "Comment:" — pulado'); marcar(id, { estado: 'pulado' }); return false }
        log('❔', id + ' sem "Comment:" em nenhuma fonte — segue (SEM_COMENTARIO=aceitar)')
        return true
      }
      var cls = FiltroIndicacao.classificarTeste(comentario, CFG.FILTRO_MODO)
      marcar(id, { comentario: comentario })
      if (cls.teste) {
        log('🧪', id + ' é TESTE (' + cls.motivo + ') — NÃO será aceito. Comment: "' + comentario.slice(0, 120) + '"')
        marcar(id, { estado: 'teste', motivo: cls.motivo })
        avisar('Indicação de TESTE ignorada', comentario.slice(0, 120))
        return false
      }
      log('📝', id + ' ok (' + cls.motivo + '). Comment: "' + comentario.slice(0, 120) + '"')
      return true
    })
  }

  function registrar(id, fonte) {
    if (!id || emAndamento[id]) return
    var m = memo[id]
    if (m && FINAIS[m.estado]) { desenharSelo(id); return }
    var criado = (incoming[id] && incoming[id].criado) || (m && m.criado) || 0
    var visto = (m && m.visto) || now()
    var base = criado || visto
    var libera = base + CFG.ESPERA_MS
    emAndamento[id] = true
    marcar(id, { visto: visto, criado: criado, libera: libera, estado: 'aguardando' })
    log('👀', 'detectado ' + id + ' via ' + fonte + ' · ' + (criado ? 'criado ' + hora(criado) : 'sem created_at, conta da detecção') + ' · libera ' + hora(libera))

    agendar(Math.max(now(), libera - CFG.LER_COMENTARIO_ANTES_MS), function () {
      decidir(id).then(function (seguir) {
        if (!seguir) { delete emAndamento[id]; return }
        if (CFG.MODO === 'assistido') {
          marcar(id, { estado: 'liberado' })
          agendar(Math.max(now(), libera), function () { avisar('Indicação liberada para aceite', 'Lead ' + id + ': ' + ((memo[id] && memo[id].comentario) || '').slice(0, 100)) })
          delete emAndamento[id]
          return
        }
        agendar(Math.max(now(), libera), function () { loopAceite(id) })
      }, function (e) { log('⚠️', 'falha ao decidir ' + id + ': ' + e.message); delete emAndamento[id] })
    })
  }

  // ---------------- FONTES DE DETECÇÃO ----------------
  function idDo(el) {
    if (el.dataset && el.dataset.id) return el.dataset.id
    if (el.id && el.id.indexOf('pipeline_item_') === 0) return el.id.replace('pipeline_item_', '')
    return null
  }
  function varrer(raiz) {
    if (!(raiz instanceof HTMLElement)) return
    var els = raiz.classList && raiz.classList.contains('pipeline-unsorted__item') ? [raiz] : []
    raiz.querySelectorAll && raiz.querySelectorAll('.pipeline-unsorted__item').forEach(function (e) { els.push(e) })
    els.forEach(function (e) { var id = idDo(e); if (id) { registrar(id, 'tela'); desenharSelo(id) } })
  }
  var observer = new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(varrer) }) })
  observer.observe(document.body, { childList: true, subtree: true })
  varrer(document.body)

  var pollTimer = null
  function poll() {
    if (!CFG.POLL_MS || !apiSessaoOk) return
    lerIncoming().then(function (n) { dbg('incoming: ' + n + ' item(ns)') }, function (e) {
      if (!apiSessaoOk) log('ℹ️', 'API de Incoming leads indisponível com a sessão (' + e.message + '). Seguindo só pela tela do funil.')
      else dbg('poll falhou: ' + e.message)
    })
  }
  if (CFG.POLL_MS) { poll(); pollTimer = setInterval(poll, CFG.POLL_MS) }

  // Retoma o que estava aguardando antes do reload
  Object.keys(memo).forEach(function (id) { if (!FINAIS[memo[id].estado]) registrar(id, 'memória') })

  // ---------------- CONTROLE ----------------
  W.__INDICACOES__ = {
    versao: VERSAO,
    cfg: CFG,
    leads: memo,
    stop: function () {
      observer.disconnect()
      if (pollTimer) clearInterval(pollTimer)
      if (fallbackTimer) clearInterval(fallbackTimer)
      if (worker) worker.terminate()
      tarefas = []
      Object.keys(emAndamento).forEach(function (id) { delete emAndamento[id] })
      log('⛔', 'parado')
    },
    /** Testa o filtro no console: __INDICACOES__.testar('Comment: teste') */
    testar: function (texto) {
      var c = FiltroIndicacao.extrairComentario(texto)
      var alvo = c === null ? texto : c
      return { comentario: c, resultado: FiltroIndicacao.classificarTeste(alvo, CFG.FILTRO_MODO) }
    },
    esquecer: function (id) { delete memo[id]; salvar() },
  }

  log('🚀', 'v' + VERSAO + ' ativo · modo ' + CFG.MODO + ' · filtro ' + CFG.FILTRO_MODO + ' · espera ' + (CFG.ESPERA_MS / 1000).toFixed(1) + 's')
  log('💡', 'parar: __INDICACOES__.stop() · testar filtro: __INDICACOES__.testar("Comment: ...") · estado: __INDICACOES__.leads')
})()
