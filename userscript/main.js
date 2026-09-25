/* global FiltroIndicacao, GM_xmlhttpRequest, GM_notification, unsafeWindow */
/**
 * Indicações Kommo v3.1: corpo do userscript. NÃO edite o .user.js gerado:
 * edite este arquivo (e o filtro-indicacao.js) e rode `npm run build:userscript`.
 *
 * O aceite é 100% no navegador (a Kommo invalida indicação aceita por API).
 *
 * Como ele pega a liberação (a Kommo NÃO libera em 5 min cravados):
 *   1. SONDA lenta antes da liberação esperada: uma tentativa a cada ~2,5s.
 *      "The leads is no longer available" e "already been accepted by other
 *      partners" nesse período = ainda não liberou PARA NÓS. Segue tentando.
 *   2. RAJADA em volta da liberação esperada: 150 a 300 ms entre tentativas.
 *   3. Depois da rajada, ritmo médio até desistir.
 *   4. Qualquer mudança no card do lead na tela dispara uma tentativa na hora.
 *   5. APRENDE: guarda quanto tempo depois do created_at cada aceite deu certo e
 *      centraliza a rajada na mediana real (não nos 5 min do papel).
 *   6. Limite GLOBAL de 6 req/s somando todos os leads (a Kommo bloqueia IP acima de 7).
 *
 * Filtro de teste: regra instantânea; se o Comment for ambíguo ("teste" dentro de
 * uma frase maior), pergunta a INTENÇÃO para a IA (/api/classificar) antes de aceitar.
 *
 * Depois do aceite, avisa o agente (POST /api/novo-lead) com o Comment. Se o aviso
 * falhar, fica pendente e é reenviado (inclusive depois de recarregar a página).
 *
 * Diagnóstico: `copy(__INDICACOES__.relatorio())` no console copia tudo que o
 * script viu (HTML do card, respostas do aceite com o tempo de cada uma).
 */
;(function () {
  'use strict'

  // ---------------- CONFIGURAÇÃO ----------------
  var CFG = {
    USER_ID: 12725576,           // responsável que recebe o lead aceito
    STATUS_ID: 55438567,         // etapa de destino do lead aceito

    // 'automatico' = o script aceita sozinho · 'assistido' = filtra e avisa, você clica
    MODO: 'automatico',

    // Liberação esperada, contada do created_at do Incoming lead (fallback: hora
    // em que o card apareceu). Ponto de partida: 5 min. Com APRENDER, depois de
    // 3 aceites a mediana real substitui este número.
    LIBERACAO_MS: 5 * 60 * 1000,
    APRENDER: true,
    APRENDER_MIN_AMOSTRAS: 3,

    SONDA_ANTES_MS: 45000,       // começa a sondar 45s antes da liberação esperada
    SONDA_INTERVALO_MS: 2500,    // ritmo da sonda (lento)
    RAJADA_ANTES_MS: 8000,       // rajada de 8s antes...
    RAJADA_DEPOIS_MS: 20000,     // ...até 20s depois da liberação esperada
    RAJADA_MIN_MS: 150,
    RAJADA_MAX_MS: 300,
    DEPOIS_INTERVALO_MS: 800,    // depois da rajada
    DESISTIR_APOS_MS: 2 * 60 * 1000, // desiste 2 min depois da liberação esperada
    TAXA_MAX_POR_SEG: 6,         // somando todos os leads
    RECUO_429_MS: 1500,

    FILTRO_MODO: 'inteligente',  // 'inteligente' (IA decide o ambíguo) ou 'estrito'
    SEM_COMENTARIO: 'aceitar',   // não achou "Comment:": 'aceitar' ou 'pular'

    POLL_MS: 15000,              // consulta à API de Incoming leads (0 = desliga)

    // Agente de IA. AGENTE_SECRET = INDICACAO_SECRET da Vercel.
    AGENTE_URL: '',
    AGENTE_SECRET: '',

    DIAGNOSTICO: true,           // guarda HTML do card e respostas para o relatório
    DEBUG: false,
  }

  var W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window
  var pageFetch = W.fetch.bind(W)
  var STORE_KEY = 'cg-indicacoes-v3'
  var DIAG_KEY = 'cg-indicacoes-v3-diag'
  var VERSAO = '3.1.0'

  if (W.__INDICACOES__ && W.__INDICACOES__.stop) {
    console.warn('[INDICAÇÕES] já ativo, reiniciando...')
    W.__INDICACOES__.stop()
  }

  // ---------------- UTIL ----------------
  function now() { return Date.now() }
  function hora(ms) { return new Date(ms || now()).toLocaleTimeString('pt-BR', { hour12: false }) }
  function seg(ms) { return (ms / 1000).toFixed(1) + 's' }
  function rand(a, b) { return a + Math.floor(Math.random() * Math.max(1, b - a)) }
  function log(icone, msg) { console.log('[INDICAÇÕES ' + hora() + '] ' + icone + ' ' + msg) }
  function dbg(msg, obj) { if (CFG.DEBUG) console.debug('[INDICAÇÕES:DBG ' + hora() + '] ' + msg, obj === undefined ? '' : obj) }
  function mediana(xs) { var a = xs.slice().sort(function (x, y) { return x - y }); var m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2 }

  function avisar(titulo, texto) {
    try { if (typeof GM_notification === 'function') GM_notification({ title: titulo, text: texto, timeout: 15000 }) } catch (_) { /* segue o log */ }
  }

  // ---------------- ESTADO PERSISTENTE ----------------
  function ler(chave, padrao) { try { return JSON.parse(localStorage.getItem(chave) || 'null') || padrao } catch (_) { return padrao } }
  function gravar(chave, v) { try { localStorage.setItem(chave, JSON.stringify(v)) } catch (_) { /* cheio/bloqueado */ } }

  var store = ler(STORE_KEY, {})
  var memo = store.leads || (store.aprendizado ? {} : store) // migra o formato da 3.0
  if (memo.leads || memo.aprendizado) memo = {}
  var aprendizado = store.aprendizado || { sucessos: [] }
  var diag = ler(DIAG_KEY, {})

  function salvar() {
    var limite = now() - 48 * 3600 * 1000
    Object.keys(memo).forEach(function (id) { if ((memo[id].atualizado || 0) < limite) delete memo[id] })
    gravar(STORE_KEY, { leads: memo, aprendizado: aprendizado })
  }
  function marcar(id, patch) {
    memo[id] = Object.assign({}, memo[id] || {}, patch, { atualizado: now() })
    salvar()
    desenharSelo(id)
  }
  var FINAIS = { aceito: 1, teste: 1, nao_existe: 1, perdido: 1, pulado: 1, liberado: 1 }

  // ---------------- DIAGNÓSTICO ----------------
  function registrarDiag(id, tipo, dado) {
    if (!CFG.DIAGNOSTICO) return
    var d = diag[id] || (diag[id] = { eventos: [], htmls: [] })
    var base = baseDe(id)
    var ev = { t: base ? now() - base : null, em: hora(), tipo: tipo }
    if (tipo === 'html') {
      var h = String(dado || '').slice(0, 6000)
      if (d.htmls.length && d.htmls[d.htmls.length - 1].html === h) return
      if (d.htmls.length >= 8) return
      d.htmls.push({ t: ev.t, em: ev.em, html: h })
    } else {
      ev.dado = typeof dado === 'string' ? dado.slice(0, 800) : dado
      d.eventos.push(ev)
      if (d.eventos.length > 400) d.eventos.splice(0, d.eventos.length - 400)
    }
    var ids = Object.keys(diag)
    if (ids.length > 12) ids.slice(0, ids.length - 12).forEach(function (x) { delete diag[x] })
    gravar(DIAG_KEY, diag)
  }

  // ---------------- RELÓGIO (Web Worker a cada 50 ms, com fallback) ----------------
  // Aba em segundo plano estrangula setTimeout (mínimo de 1s); mensagem de worker não.
  var tarefas = []
  var worker = null
  var fallbackTimer = null
  function tick() {
    var t = now()
    var vencidas = tarefas.filter(function (x) { return x.em <= t })
    if (!vencidas.length) return
    tarefas = tarefas.filter(function (x) { return x.em > t })
    vencidas.forEach(function (x) { try { x.fn() } catch (e) { console.error(e) } })
  }
  function agendar(em, fn) { var tarefa = { em: em, fn: fn }; tarefas.push(tarefa); return tarefa }
  function esperar(ms) { return new Promise(function (r) { agendar(now() + ms, r) }) }
  try {
    worker = new Worker(URL.createObjectURL(new Blob(['setInterval(function(){postMessage(1)},50)'], { type: 'text/javascript' })))
    worker.onmessage = tick
  } catch (e) {
    dbg('worker bloqueado (CSP?), usando setInterval', e)
    fallbackTimer = setInterval(tick, 50)
  }

  // Limite global de requisições de aceite (todos os leads juntos): fila única e
  // espaçamento medido pela hora REAL de cada envio (o relógio de 50 ms não embola)
  var proximaVaga = 0
  var filaVagas = Promise.resolve()
  function comVaga() {
    var vez = filaVagas.then(function () {
      var espera = Math.max(0, proximaVaga - now())
      return (espera ? esperar(espera) : Promise.resolve()).then(function () {
        proximaVaga = now() + Math.ceil(1000 / CFG.TAXA_MAX_POR_SEG) + 5
      })
    })
    filaVagas = vez
    return vez
  }

  // ---------------- SELO NO CARD ----------------
  var CORES = { teste: '#c62828', aceito: '#2e7d32', liberado: '#1565c0', aguardando: '#6d4c41', sondando: '#1565c0', rajada: '#0d47a1', nao_existe: '#757575', perdido: '#ef6c00', pulado: '#757575', avaliando: '#6d4c41' }
  function cardDe(id) { return document.getElementById('pipeline_item_' + id) || document.querySelector('.pipeline-unsorted__item[data-id="' + id + '"]') }
  function desenharSelo(id) {
    var el = cardDe(id)
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
      avaliando: 'Lendo o Comment...',
      teste: 'TESTE: não aceito',
      aceito: 'Aceito ' + hora(m.atualizado) + (m.tentativas ? ' (' + m.tentativas + ' tentativas)' : ''),
      liberado: 'Real. Aceite manual a partir de ~' + hora(m.libera),
      aguardando: 'Real. Tenta aceitar a partir de ' + hora(m.inicio),
      sondando: 'Sondando liberação...',
      rajada: 'Aceitando...',
      nao_existe: 'Lead não existe mais',
      perdido: 'Não liberou para nós' + (m.ultimaResposta ? ': ' + m.ultimaResposta : ''),
      pulado: 'Pulado: sem Comment',
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

  // leadId -> { criado (ms), texto, visto } da última leitura de Incoming leads
  var incoming = {}
  var ultimaLeituraOk = 0
  function lerIncoming() {
    return apiGet('/api/v4/leads/unsorted?limit=50&order[created_at]=desc').then(function (j) {
      var itens = (j && j._embedded && j._embedded.unsorted) || []
      ultimaLeituraOk = now()
      itens.forEach(function (u) {
        ((u._embedded && u._embedded.leads) || []).forEach(function (l) {
          var id = String(l.id)
          var novo = !incoming[id]
          incoming[id] = { criado: (u.created_at || 0) * 1000, texto: JSON.stringify(u.metadata || {}) + ' ' + (u.source_name || ''), visto: now() }
          if (novo) registrarDiag(id, 'incoming', JSON.stringify(u).slice(0, 1500))
          registrar(id, 'api')
        })
      })
      return itens.length
    })
  }
  /** Lead que sumiu da lista de Incoming leads (com a API funcionando) já foi embora. */
  function sumiuDoIncoming(id) {
    return apiSessaoOk && incoming[id] && ultimaLeituraOk - incoming[id].visto > CFG.POLL_MS * 1.5
  }

  function textoDoCard(id) {
    var el = cardDe(id)
    if (!el) return ''
    var texto = el.innerText || el.textContent || ''
    var selo = el.querySelector('.cg-indicacao-selo')
    return selo && selo.textContent ? texto.replace(selo.textContent, '') : texto
  }

  /** Procura o "Comment:" em todas as fontes; para na primeira que achar. */
  function lerComentario(id) {
    var F = FiltroIndicacao
    var fontes = [
      ['card', function () { return Promise.resolve(textoDoCard(id)) }],
      ['incoming', function () { return Promise.resolve(incoming[id] ? incoming[id].texto : '') }],
      ['notas', function () {
        return apiGet('/api/v4/leads/' + id + '/notes?limit=50').then(function (j) {
          return ((j && j._embedded && j._embedded.notes) || []).map(function (n) { return JSON.stringify(n.params || {}) }).join('\n')
        })
      }],
      ['campos', function () {
        return apiGet('/api/v4/leads/' + id).then(function (j) {
          return ((j && j.custom_fields_values) || []).map(function (f) { return (f.field_name || '') + ': ' + (f.values || []).map(function (v) { return v.value }).join(', ') }).join('\n') + '\n' + ((j && j.name) || '')
        })
      }],
    ]
    var i = 0
    function proxima() {
      if (i >= fontes.length) return Promise.resolve(null)
      var f = fontes[i++]
      return f[1]().then(function (texto) {
        var c = F.extrairComentario(texto)
        if (c !== null) { dbg('Comment de ' + id + ' achado em: ' + f[0]); return c }
        return proxima()
      }, function (e) { dbg('fonte ' + f[0] + ' falhou: ' + e.message); return proxima() })
    }
    return proxima()
  }

  // ---------------- AGENTE DE IA (classificar intenção / avisar aceite) ----------------
  function postarAgente(caminho, corpo, timeoutMs) {
    if (!CFG.AGENTE_URL || typeof GM_xmlhttpRequest !== 'function') return Promise.reject(new Error('agente não configurado'))
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: 'POST',
        url: CFG.AGENTE_URL.replace(/\/+$/, '') + caminho + '?secret=' + encodeURIComponent(CFG.AGENTE_SECRET),
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify(corpo),
        timeout: timeoutMs,
        onload: function (r) {
          if (r.status >= 200 && r.status < 300) { try { resolve(JSON.parse(r.responseText)) } catch (_) { resolve({}) } } else reject(new Error('HTTP ' + r.status))
        },
        onerror: function () { reject(new Error('rede')) },
        ontimeout: function () { reject(new Error('timeout')) },
      })
    })
  }

  function avisarAgente(id, tentativa) {
    tentativa = tentativa || 1
    if (!CFG.AGENTE_URL) return
    marcar(id, { avisoPendente: true })
    postarAgente('/api/novo-lead', { leadId: Number(id), comentario: memo[id] && memo[id].comentario, origem: 'userscript', versao: VERSAO }, 15000).then(function () {
      log('🤖', 'agente avisado sobre ' + id + ': a IA manda a primeira mensagem')
      marcar(id, { avisoPendente: false })
    }, function (e) {
      var espera = [0, 3000, 10000, 30000, 120000][tentativa]
      if (espera) { log('⚠️', 'aviso ao agente falhou (' + e.message + '), tento de novo em ' + seg(espera)); agendar(now() + espera, function () { avisarAgente(id, tentativa + 1) }) }
      else { log('🚨', 'NÃO consegui avisar o agente sobre ' + id + '. Fica pendente e reenvio ao recarregar a página.'); avisar('Agente de IA não avisado', 'Lead ' + id + ' foi aceito, mas a IA ainda não sabe') }
    })
  }

  function decidirTeste(id, comentario) {
    var cls = FiltroIndicacao.classificarTeste(comentario, CFG.FILTRO_MODO)
    if (!cls.ambiguo || !CFG.AGENTE_URL) return Promise.resolve(cls)
    return postarAgente('/api/classificar', { comentario: comentario }, 8000).then(function (r) {
      return typeof r.teste === 'boolean' ? r : cls
    }, function (e) {
      log('⚠️', 'IA de intenção indisponível (' + e.message + '), vale a regra para ' + id)
      return cls
    })
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
    return comVaga().then(function () {
      return pageFetch('/ajax/unsorted/accept', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest' },
        body: corpoAceite(id),
      })
    }).then(function (res) {
      return res.text().then(function (t) {
        var json = null
        try { json = JSON.parse(t) } catch (_) { /* não é JSON */ }
        return { status: res.status, json: json, texto: t }
      })
    })
  }

  /**
   * aceito · nao_existe (fim) · cedo ("no longer available") · outros ("already been
   * accepted by other partners") · recuar (429) · repetir (qualquer outra coisa)
   */
  function interpretar(id, r) {
    if (r.status === 429) return 'recuar'
    var accept = r.json && r.json.response && r.json.response.unsorted && r.json.response.unsorted.accept
    if (accept && accept.status === 'success') {
      var data = accept.data || {}
      var tem = Object.keys(data).some(function (k) { var d = data[k]; return d && Array.isArray(d.leads) && d.leads.map(Number).indexOf(Number(id)) >= 0 })
      if (tem) return 'aceito'
    }
    var t = String(r.texto || '').toLowerCase()
    if (t.indexOf('requested lead is not found') >= 0) return 'nao_existe'
    if (t.indexOf('no longer available') >= 0) return 'cedo'
    if (t.indexOf('already been accepted') >= 0 || t.indexOf('accepted by other partners') >= 0) return 'outros'
    return 'repetir'
  }
  var ROTULO = { cedo: 'ainda não liberou (no longer available)', outros: 'outros parceiros aceitaram (already accepted)', repetir: 'resposta inesperada', recuar: '429, recuando' }

  // ---------------- APRENDIZADO DA LIBERAÇÃO ----------------
  function liberacaoEsperada() {
    var s = aprendizado.sucessos || []
    if (CFG.APRENDER && s.length >= CFG.APRENDER_MIN_AMOSTRAS) return Math.max(60000, mediana(s.slice(-15)) - 1500)
    return CFG.LIBERACAO_MS
  }
  function aprender(offset) {
    if (!CFG.APRENDER || !(offset > 30000 && offset < 20 * 60000)) return
    aprendizado.sucessos = (aprendizado.sucessos || []).concat([offset]).slice(-30)
    salvar()
    log('📈', 'aceite em ' + seg(offset) + ' depois do created_at · liberação esperada agora: ' + seg(liberacaoEsperada()))
  }

  function baseDe(id) {
    var m = memo[id] || {}
    return m.criado || (incoming[id] && incoming[id].criado) || m.visto || 0
  }

  // ---------------- LOOP DE ACEITE ----------------
  var emAndamento = {}   // id -> true enquanto há loop/avaliação
  var acordar = {}       // id -> função que antecipa a próxima tentativa

  function loopAceite(id) {
    var n = 0
    var contagem = {}
    var inicio = now()
    log('🔎', 'sondando ' + id + ' (liberação esperada ' + hora(baseDe(id) + liberacaoEsperada()) + ')')
    function volta() {
      if (!emAndamento[id]) return Promise.resolve()
      var base = baseDe(id)
      var esperado = base + liberacaoEsperada()
      var t = now()
      if (t > esperado + CFG.DESISTIR_APOS_MS) return fim('perdido')
      if (sumiuDoIncoming(id)) return fim('perdido', 'sumiu dos Incoming leads')
      var fase = t < esperado - CFG.RAJADA_ANTES_MS ? 'sondando' : t < esperado + CFG.RAJADA_DEPOIS_MS ? 'rajada' : 'depois'
      if (memo[id].estado !== fase && fase !== 'depois') marcar(id, { estado: fase })
      n++
      return tentarAceitar(id).then(function (r) {
        var res = interpretar(id, r)
        contagem[res] = (contagem[res] || 0) + 1
        registrarDiag(id, 'aceite:' + res, { n: n, http: r.status, resposta: String(r.texto || '').slice(0, 600) })
        if (res === 'aceito') {
          var off = base ? now() - base : 0
          log('✅', 'ACEITO ' + id + ' na tentativa #' + n + (base ? ' · ' + seg(off) + (memo[id].criado ? ' depois do created_at' : ' depois de aparecer na tela') : ''))
          if (memo[id].criado) aprender(off)
          marcar(id, { estado: 'aceito', tentativas: n, offsetAceite: off })
          avisar('Indicação aceita', 'Lead ' + id + (memo[id].comentario ? ': ' + memo[id].comentario.slice(0, 80) : ''))
          avisarAgente(id)
          return
        }
        if (res === 'nao_existe') return fim('nao_existe')
        if (contagem[res] === 1) log('·', id + ': ' + ROTULO[res] + ' (+' + seg(now() - inicio) + ')')
        marcar(id, { ultimaResposta: ROTULO[res] })
        return proximaEspera(id, fase, res).then(volta)
      }, function (e) {
        dbg('erro de rede ' + id + ': ' + e.message)
        return proximaEspera(id, fase, 'rede').then(volta)
      })
    }
    function fim(estado, motivo) {
      log(estado === 'perdido' ? '⌛' : '🚫', id + ': ' + (motivo || estado) + ' após ' + n + ' tentativas · ' + JSON.stringify(contagem))
      marcar(id, { estado: estado, tentativas: n, motivo: motivo || '' })
      return Promise.resolve()
    }
    return volta().then(function () { delete emAndamento[id]; delete acordar[id] })
  }

  function proximaEspera(id, fase, res) {
    var esperado = baseDe(id) + liberacaoEsperada()
    var ms = res === 'recuar' ? CFG.RECUO_429_MS
      : fase === 'sondando' ? Math.min(CFG.SONDA_INTERVALO_MS, Math.max(0, esperado - CFG.RAJADA_ANTES_MS - now()))
        : fase === 'rajada' ? rand(CFG.RAJADA_MIN_MS, CFG.RAJADA_MAX_MS)
          : CFG.DEPOIS_INTERVALO_MS
    return new Promise(function (resolve) {
      var tarefa = agendar(now() + ms, pronto)
      function pronto() { delete acordar[id]; tarefas = tarefas.filter(function (x) { return x !== tarefa }); resolve() }
      acordar[id] = pronto
    })
  }

  // ---------------- DECISÃO POR LEAD ----------------
  function avaliar(id) {
    var inicioSonda = baseDe(id) + liberacaoEsperada() - CFG.SONDA_ANTES_MS
    return lerComentario(id).then(function (comentario) {
      if (comentario === null) {
        if (now() < inicioSonda - 10000) { agendar(now() + 8000, function () { avaliar(id) }); return }
        if (CFG.SEM_COMENTARIO === 'pular') { log('⏭️', id + ' sem "Comment:", pulado'); marcar(id, { estado: 'pulado' }); delete emAndamento[id]; return }
        log('❔', id + ' sem "Comment:" em nenhuma fonte, segue (SEM_COMENTARIO=aceitar)')
        return seguir(id)
      }
      marcar(id, { comentario: comentario })
      return decidirTeste(id, comentario).then(function (cls) {
        registrarDiag(id, 'filtro', cls)
        if (cls.teste) {
          log('🧪', id + ' é TESTE (' + cls.motivo + '), NÃO será aceito. Comment: "' + comentario.slice(0, 120) + '"')
          marcar(id, { estado: 'teste', motivo: cls.motivo })
          avisar('Indicação de TESTE ignorada', comentario.slice(0, 120))
          delete emAndamento[id]
          return
        }
        log('📝', id + ' é real (' + cls.motivo + '). Comment: "' + comentario.slice(0, 120) + '"')
        return seguir(id)
      })
    }).catch(function (e) { log('⚠️', 'falha ao avaliar ' + id + ': ' + e.message); delete emAndamento[id] })
  }

  function seguir(id) {
    var base = baseDe(id)
    var libera = base + liberacaoEsperada()
    var inicio = libera - CFG.SONDA_ANTES_MS
    if (CFG.MODO === 'assistido') {
      marcar(id, { estado: 'liberado', libera: libera })
      agendar(Math.max(now(), libera), function () { avisar('Indicação perto de liberar', 'Lead ' + id + ': ' + ((memo[id] && memo[id].comentario) || '').slice(0, 100)) })
      delete emAndamento[id]
      return
    }
    marcar(id, { estado: 'aguardando', inicio: inicio, libera: libera })
    agendar(Math.max(now(), inicio), function () { loopAceite(id) })
  }

  function registrar(id, fonte) {
    if (!id || emAndamento[id]) return
    var m = memo[id]
    if (m && FINAIS[m.estado]) { desenharSelo(id); return }
    emAndamento[id] = true
    var criado = (incoming[id] && incoming[id].criado) || (m && m.criado) || 0
    marcar(id, { visto: (m && m.visto) || now(), criado: criado, estado: 'avaliando' })
    registrarDiag(id, 'detectado', fonte)
    var el = cardDe(id)
    if (el) registrarDiag(id, 'html', el.outerHTML)
    log('👀', 'detectado ' + id + ' via ' + fonte + ' · ' + (criado ? 'criado ' + hora(criado) : 'sem created_at, conta da detecção') + ' · liberação esperada ' + hora(baseDe(id) + liberacaoEsperada()))
    agendar(now() + 1500, function () { avaliar(id) })
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
  /** Mudança DENTRO de um card em sondagem = talvez a Kommo liberou: tenta na hora. */
  var ultimoGatilho = {}
  function gatilhoDoCard(node) {
    var el = node && (node.nodeType === 1 ? node : node.parentElement)
    var card = el && el.closest && el.closest('.pipeline-unsorted__item')
    if (!card || (el.closest && el.closest('.cg-indicacao-selo'))) return
    var id = idDo(card)
    if (!id || !acordar[id]) return
    registrarDiag(id, 'html', card.outerHTML)
    if (now() - (ultimoGatilho[id] || 0) < 1000) return
    ultimoGatilho[id] = now()
    dbg('card ' + id + ' mudou: tentativa imediata')
    acordar[id]()
  }
  var observer = new MutationObserver(function (ms) {
    ms.forEach(function (m) {
      m.addedNodes.forEach(varrer)
      gatilhoDoCard(m.target)
    })
  })
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true, attributeFilter: ['class', 'disabled', 'data-status', 'style'] })
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

  // Retoma o que ficou no meio antes do reload e reenvia avisos pendentes ao agente
  Object.keys(memo).forEach(function (id) {
    if (!FINAIS[memo[id].estado]) registrar(id, 'memória')
    else if (memo[id].estado === 'aceito' && memo[id].avisoPendente && now() - memo[id].atualizado < 2 * 3600 * 1000) avisarAgente(id)
  })

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && Object.keys(emAndamento).length) dbg('aba em segundo plano com leads em andamento: o relógio do worker segue')
  })

  // ---------------- CONTROLE ----------------
  W.__INDICACOES__ = {
    versao: VERSAO,
    cfg: CFG,
    leads: memo,
    aprendizado: aprendizado,
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
      return decidirTeste('console', c === null ? texto : c).then(function (r) { console.log(r); return r })
    },
    /** copy(__INDICACOES__.relatorio()) e cole para o suporte */
    relatorio: function () {
      return JSON.stringify({ versao: VERSAO, gerado: new Date().toISOString(), url: location.pathname, apiSessaoOk: apiSessaoOk, liberacaoEsperadaMs: liberacaoEsperada(), aprendizado: aprendizado, cfg: CFG, leads: memo, diag: diag }, null, 1)
    },
    esquecer: function (id) { delete memo[id]; delete diag[id]; salvar(); gravar(DIAG_KEY, diag) },
    zerarAprendizado: function () { aprendizado.sucessos = []; salvar() },
  }

  log('🚀', 'v' + VERSAO + ' ativo · modo ' + CFG.MODO + ' · filtro ' + CFG.FILTRO_MODO + ' · liberação esperada ' + seg(liberacaoEsperada()) + ((aprendizado.sucessos || []).length ? ' (aprendida de ' + aprendizado.sucessos.length + ' aceites)' : ''))
  log('💡', 'parar: __INDICACOES__.stop() · testar filtro: __INDICACOES__.testar("Comment: ...") · relatório: copy(__INDICACOES__.relatorio())')
})();
