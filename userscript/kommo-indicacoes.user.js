// ==UserScript==
// @name         Kommo · Indicações de parceiro (Control Gestão)
// @namespace    https://controlgestao.com.br/
// @version      3.3.0
// @description  Filtra indicações de TESTE pelo "Comment:", aceita no tempo certo (ou avisa, no modo assistido) e aciona o agente de IA SDR.
// @match        https://*.kommo.com/*
// @run-at       document-idle
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      vercel.app
// @noframes
// ==/UserScript==
//
// ARQUIVO GERADO por scripts/build-userscript.ts a partir de userscript/filtro-indicacao.js
// + userscript/main.js. Edite as fontes e rode `npm run build:userscript`.

/**
 * FILTRO DE INDICAÇÃO — fonte ÚNICA da regra "é teste?".
 *
 * Roda em dois lugares com o MESMO código:
 *   1. no navegador, embutido no userscript (scripts/build-userscript.ts copia este bloco);
 *   2. no servidor, via require() em lib/indicacao.ts (segunda trava: mesmo que o
 *      lead seja aceito à mão, a IA não inicia conversa com teste).
 *
 * Sem dependência e sem sintaxe que o Tampermonkey não entenda.
 */
var FiltroIndicacao = (function () {
  'use strict'

  function normalizar(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  }

  /**
   * Acha o texto depois de "Comment:" (ou "Comentário:"). Para no próximo rótulo
   * de linha ("Phone: ...", "E-mail: ...") ou no fim. null = não achou o marcador.
   */
  function extrairComentario(texto) {
    var t = String(texto == null ? '' : texto).replace(/\r/g, '').replace(/\\n/g, '\n')
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    var re = /(?:^|[\s"'{,;|>])(?:comment|comments|coment[aá]rio|coment[aá]rios)\s*"?\s*:\s*"?/i
    var m = re.exec(t)
    if (!m) return null
    var resto = t.slice(m.index + m[0].length)
    var fim = resto.search(/\n\s*[A-Za-zÀ-ú][A-Za-zÀ-ú _\-]{1,30}:\s|"\s*[,}]\s*"?[A-Za-z_]+"?\s*:/)
    var out = (fim >= 0 ? resto.slice(0, fim) : resto).replace(/\s+/g, ' ').trim().replace(/^"|"$/g, '')
    return out.slice(0, 2000)
  }

  // Frases que, sozinhas, já dizem "isto é teste" (comparadas no texto normalizado)
  var FRASES_TESTE = [
    'lead de teste', 'lead teste', 'teste de lead', 'test lead', 'lead test', 'testing lead',
    'isso e um teste', 'isto e um teste', 'e so um teste', 'e apenas um teste', 'apenas um teste',
    'apenas teste', 'somente teste', 'so teste', 'so um teste', 'teste interno', 'teste kommo',
    'this is a test', 'just a test', 'only a test', 'just testing', 'test only', 'test message',
    'nao e real', 'not real', 'ignore this', 'ignorar este', 'ignorar esse', 'desconsiderar este',
    'desconsiderar esse', 'favor desconsiderar', 'pode desconsiderar', 'lorem ipsum', 'asdf', 'qwerty',
    'nao aceitar', 'nao aceite', 'naao aceitar', 'nao e para aceitar', 'do not accept', 'dont accept'
  ]

  // Palavras que, se forem TUDO o que o comentário diz, é teste ("teste", "test 123", "teste teste")
  var SO_LIXO = /^(?:(?:teste?s?|tests?|testing|testando|lead|de|do|da|um|uma|e|is|a|this|just|only|apenas|so|somente|isso|isto|qa|ok|ignore|ignorar|x+|a+|abc|asdf|qwerty|\d+)\s*)+$/

  var PALAVRA_TESTE = /\b(teste|testes|test|tests|testando|testar|testing)\b/

  // Contexto de TRIAL/avaliação da Kommo: lead real que está "testando o sistema"
  var EXCECOES_TRIAL = [
    /\b(periodo|versao|conta|fase|prazo|dias?) (de |do |da )?(teste|testes|avaliacao|trial)\b/,
    /\bteste (gratis|gratuito|gratuita)\b/,
    /\b(free trial|trial)\b/,
    /\b(testando|testar|testei|testamos|teste|testes|test|testing) (o |a |os |as |do |da |no |na |com o |com a )?(kommo|amocrm|sistema|plataforma|crm|ferramenta|software|integracao|integracoes|automacao|automacoes|bot|salesbot|whatsapp|funil|app|aplicativo)\b/
  ]

  /**
   * Camada 1 (regras, instantânea, igual no navegador e no servidor):
   *   - frase de teste explícita ou comentário só com "teste"  → teste, certeza
   *   - nenhuma palavra de teste                                → real, certeza
   *   - a palavra aparece dentro de uma frase maior             → AMBÍGUO
   * Ambíguo é decidido pela INTENÇÃO (camada 2: IA em /api/classificar). Sem a IA,
   * vale o palpite abaixo: contexto de trial/avaliação do sistema passa, o resto bloqueia.
   * modo "estrito": qualquer ocorrência da palavra bloqueia, sem ambíguo.
   * Retorna { teste, ambiguo, nivel: 'frase'|'so-lixo'|'palavra'|'nenhum', motivo }
   */
  function classificarTeste(comentario, modo) {
    var n = normalizar(comentario)
    if (!n) return { teste: false, ambiguo: false, nivel: 'nenhum', motivo: 'comentário vazio' }
    for (var i = 0; i < FRASES_TESTE.length; i++) {
      if ((' ' + n + ' ').indexOf(' ' + FRASES_TESTE[i] + ' ') >= 0) return { teste: true, ambiguo: false, nivel: 'frase', motivo: 'frase de teste: "' + FRASES_TESTE[i] + '"' }
    }
    if (SO_LIXO.test(n) && PALAVRA_TESTE.test(n)) return { teste: true, ambiguo: false, nivel: 'so-lixo', motivo: 'comentário só com palavra de teste' }
    if (SO_LIXO.test(n) && n.length <= 12) return { teste: true, ambiguo: false, nivel: 'so-lixo', motivo: 'comentário sem conteúdo ("' + n + '")' }
    var m = PALAVRA_TESTE.exec(n)
    if (!m) return { teste: false, ambiguo: false, nivel: 'nenhum', motivo: 'sem sinal de teste' }
    if (modo !== 'estrito') {
      for (var j = 0; j < EXCECOES_TRIAL.length; j++) {
        if (EXCECOES_TRIAL[j].test(n)) return { teste: false, ambiguo: true, nivel: 'palavra', motivo: 'palavra "' + m[1] + '" em contexto de trial/avaliação do sistema' }
      }
    }
    return { teste: true, ambiguo: modo !== 'estrito', nivel: 'palavra', motivo: 'palavra de teste: "' + m[1] + '"' }
  }

  return { normalizar: normalizar, extrairComentario: extrairComentario, classificarTeste: classificarTeste }
})();

/* global FiltroIndicacao, GM_xmlhttpRequest, GM_notification, unsafeWindow */
/**
 * Indicações Kommo v3.3: corpo do userscript. NÃO edite o .user.js gerado:
 * edite este arquivo (e o filtro-indicacao.js) e rode `npm run build:userscript`.
 *
 * O aceite é 100% no navegador (a Kommo invalida indicação aceita por API).
 *
 * REGRA QUE MANDA EM TUDO (confirmada em 25/09/2026): aceite ANTES da liberação
 * volta "sucesso" e QUEIMA a indicação (o lead passa a mostrar "The leads is no
 * longer available"). Não existe "tentar de novo": o primeiro aceite que dá
 * sucesso é o único tiro.
 *
 * MEDIDO na conta (62 indicações, ago a set/2026, eventos da API): a Kommo libera
 * EXATAMENTE 300s depois da chegada. Aceites aos 299s: 11 queimados em 16. Aos
 * 300 a 301s: válidos, mas 8 perdidos para outros parceiros por milissegundos.
 * O v2.1 disparava 4min57s depois de o card APARECER NA TELA: caía às vezes nos 299s.
 *
 * Por isso:
 *   1. Nenhuma tentativa antes da liberação. O disparo é o MENOR de dois limites
 *      que nunca saem cedo:
 *        a) hora em que o card apareceu na tela + 300s (o card só aparece DEPOIS
 *           de o lead existir, então isto nunca é cedo, qualquer que seja o relógio);
 *        b) created_at + 301s no relógio do servidor (created_at vem em segundos
 *           inteiros), convertido com o limite SEGURO da diferença de relógio
 *           medida pelo cabeçalho Date das respostas.
 *      + MARGEM (40 ms).
 *   2. Repete rápido só enquanto a resposta NÃO for sucesso (rede, erro genérico).
 *   3. Depois do aceite, CONFERE o lead (notas e eventos): "no longer available"
 *      = foi cedo → a margem sobe 1s; "already been accepted by other partners"
 *      = perdeu a corrida; limpo = válido. 5 válidos seguidos → a margem desce 0,25s.
 *   4. Lead que já passou da janela (indicação antiga parada em Incoming) é
 *      ignorado em silêncio.
 *   5. Limite GLOBAL de 6 req/s somando todos os leads.
 *
 * Filtro de teste: regra instantânea; Comment ambíguo vai para a IA de intenção
 * (/api/classificar) antes de aceitar.
 *
 * Depois do aceite VÁLIDO, avisa a Lara (POST /api/novo-lead) com o Comment. Se o
 * aviso falhar, fica pendente e é reenviado (inclusive depois de recarregar).
 *
 * Diagnóstico: `copy(__INDICACOES__.relatorio())` no console.
 */
;(function () {
  'use strict'

  // ---------------- CONFIGURAÇÃO ----------------
  var CFG = {
    USER_ID: 12725576,           // responsável que recebe o lead aceito
    STATUS_ID: 55438567,         // etapa de destino do lead aceito
    PIPELINE_ID: 4338500,        // funil das indicações: Incoming leads de OUTROS funis nunca são tocados
    // Incoming leads destas categorias não são indicação de parceiro (chat, e-mail, ligação)
    CATEGORIAS_IGNORADAS: ['chats', 'mail', 'sip'],

    // 'automatico' = o script aceita sozinho · 'assistido' = filtra e avisa, você clica
    MODO: 'automatico',

    // Liberação medida: exatamente 300s depois da chegada do lead
    LIBERACAO_MS: 5 * 60 * 1000,
    // Folga depois do limite seguro. Sobe sozinha 300 ms se algum aceite sair cedo.
    MARGEM_MS: 40,
    AJUSTAR_MARGEM: true,
    MARGEM_MIN_MS: 0,
    MARGEM_MAX_MS: 5000,

    JANELA_MS: 8000,             // depois do disparo, repete só enquanto não houver sucesso
    MIN_INTERVALO_MS: 150,
    MAX_INTERVALO_MS: 300,
    TAXA_MAX_POR_SEG: 6,         // somando todos os leads
    RECUO_429_MS: 1500,
    CONFERIR_APOS_MS: 6000,      // confere se o lead aceito ficou válido

    FILTRO_MODO: 'inteligente',  // 'inteligente' (IA decide o ambíguo) ou 'estrito'
    SEM_COMENTARIO: 'aceitar',   // não achou "Comment:": 'aceitar' ou 'pular'

    POLL_MS: 15000,              // consulta à API de Incoming leads (0 = desliga)

    // Lara (agente de IA). AGENTE_SECRET = INDICACAO_SECRET da Vercel.
    AGENTE_URL: '',
    AGENTE_SECRET: '',

    DIAGNOSTICO: true,
    DEBUG: false,
  }

  var W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window
  var pageFetch = W.fetch.bind(W)
  var STORE_KEY = 'cg-indicacoes-v3'
  var DIAG_KEY = 'cg-indicacoes-v3-diag'
  var VERSAO = '3.3.0'

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
  var aprendizado = store.aprendizado || {}
  if (typeof aprendizado.margem !== 'number') aprendizado = { margem: CFG.MARGEM_MS, validosSeguidos: 0, historico: [] }
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
  var FINAIS = { aceito: 1, aceito_invalido: 1, teste: 1, nao_existe: 1, perdido: 1, pulado: 1, liberado: 1, expirado: 1 }

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
  var CORES = { teste: '#c62828', aceito: '#2e7d32', aceito_invalido: '#ad1457', conferindo: '#2e7d32', liberado: '#1565c0', aguardando: '#6d4c41', aceitando: '#0d47a1', nao_existe: '#757575', perdido: '#ef6c00', pulado: '#757575', avaliando: '#6d4c41', expirado: '#9e9e9e' }
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
      aceito: 'Aceito e válido ' + hora(m.atualizado),
      conferindo: 'Aceito, conferindo se ficou válido...',
      aceito_invalido: 'Aceito, mas INVÁLIDO: ' + (m.motivo || ''),
      liberado: 'Real. Aceite manual a partir de ' + hora(m.libera),
      aguardando: 'Real. Aceita às ' + hora(m.libera),
      aceitando: 'Aceitando...',
      nao_existe: 'Lead não existe mais',
      perdido: 'Não aceitou' + (m.ultimaResposta ? ': ' + m.ultimaResposta : ''),
      pulado: 'Pulado: sem Comment',
      expirado: 'Indicação antiga (fora da janela)',
    }
    selo.textContent = (textos[m.estado] || m.estado) + (m.motivo && m.estado !== 'aceito_invalido' ? ' · ' + m.motivo : '')
    selo.title = m.comentario ? 'Comment: ' + m.comentario : ''
    selo.style.background = CORES[m.estado] || '#555'
  }

  // ---------------- RELÓGIO DO SERVIDOR DA KOMMO ----------------
  // created_at é hora do servidor. Se o PC estiver 3s adiantado, "5 min" no PC
  // viram 4min57s na Kommo e o aceite queima o lead. O cabeçalho Date de cada
  // resposta dá a hora do servidor (em segundos): a mediana das amostras dá a
  // diferença com ±0,5s.
  // Cada resposta prova: servidor - local ∈ [Date - chegada, Date + 1s - envio].
  // A interseção das amostras aperta o intervalo; para disparar usamos o limite
  // que NUNCA adianta (relogioLo).
  var amostrasRelogio = []
  var relogioLo = null
  var relogioHi = null
  function amostrarRelogio(res, t0) {
    try {
      var d = Date.parse(res.headers.get('date') || '')
      if (!d) return
      amostrasRelogio.push([d - now(), d + 1000 - t0])
      if (amostrasRelogio.length > 60) amostrasRelogio.shift()
      var lo = -Infinity, hi = Infinity
      amostrasRelogio.forEach(function (a) { lo = Math.max(lo, a[0]); hi = Math.min(hi, a[1]) })
      if (lo > hi) { amostrasRelogio = amostrasRelogio.slice(-1); lo = amostrasRelogio[0][0]; hi = amostrasRelogio[0][1] } // relógio do PC mudou
      relogioLo = lo; relogioHi = hi
    } catch (_) { /* sem cabeçalho */ }
  }
  function difServidor() { return relogioLo === null ? 0 : (relogioLo + relogioHi) / 2 }
  /** hora do servidor (ms) → hora local equivalente */
  function paraLocal(msServidor) { return msServidor - difServidor() }

  // ---------------- API COM A SESSÃO DO NAVEGADOR ----------------
  var apiSessaoOk = true
  function apiGet(path) {
    var t0 = now()
    return pageFetch(path, { credentials: 'include', headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' } })
      .then(function (r) {
        amostrarRelogio(r, t0)
        if (r.status === 204) return null
        if (r.status === 401 || r.status === 403) { apiSessaoOk = false; throw new Error('sessão recusada pela API (' + r.status + ')') }
        if (!r.ok) throw new Error(path + ' -> ' + r.status)
        return r.json()
      })
  }

  // leadId -> { criado (ms), texto, visto } da última leitura de Incoming leads
  var incoming = {}
  var naoIndicacao = {}   // id -> motivo (outro funil ou categoria que não é indicação)
  var ultimaLeituraOk = 0
  function lerIncoming() {
    return apiGet('/api/v4/leads/unsorted?limit=50&order[created_at]=desc').then(function (j) {
      var itens = (j && j._embedded && j._embedded.unsorted) || []
      ultimaLeituraOk = now()
      itens.forEach(function (u) {
        var ehIndicacao = Number(u.pipeline_id) === CFG.PIPELINE_ID && CFG.CATEGORIAS_IGNORADAS.indexOf(u.category) < 0
        ;((u._embedded && u._embedded.leads) || []).forEach(function (l) {
          var id = String(l.id)
          if (!ehIndicacao) { naoIndicacao[id] = (u.category || '?') + ' · funil ' + u.pipeline_id; return }
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
    var t0
    return comVaga().then(function () {
      t0 = now()
      return pageFetch('/ajax/unsorted/accept', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest' },
        body: corpoAceite(id),
      })
    }).then(function (res) {
      amostrarRelogio(res, t0)
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

  // ---------------- QUANDO DISPARAR ----------------
  function margem() { return CFG.AJUSTAR_MARGEM ? aprendizado.margem : CFG.MARGEM_MS }
  /** Hora LOCAL do disparo. null = ainda não sei (sem created_at nem detecção). */
  function horaDisparo(id) {
    var m = memo[id] || {}
    var criado = m.criado || (incoming[id] && incoming[id].criado) || 0
    var limites = []
    // a) card na tela: o lead já existia quando o card apareceu
    if (m.vistoTela) limites.push(m.vistoTela + CFG.LIBERACAO_MS)
    // b) created_at (segundos inteiros) + 1s, no pior caso do relógio
    if (criado && relogioLo !== null) limites.push(criado + 1000 + CFG.LIBERACAO_MS - relogioLo)
    // sem os dois: hora em que o script viu o lead (API) + 300s, também nunca cedo
    if (!limites.length && m.visto) limites.push(m.visto + CFG.LIBERACAO_MS)
    return limites.length ? Math.min.apply(null, limites) + margem() : null
  }
  function baseDe(id) {
    var m = memo[id] || {}
    return m.criado || (incoming[id] && incoming[id].criado) || m.visto || 0
  }

  /** Ajuste automático da margem pelo resultado conferido de cada aceite. */
  function registrarResultado(id, resultado, offset) {
    aprendizado.historico = (aprendizado.historico || []).concat([{ id: id, resultado: resultado, offsetMs: offset, margemMs: margem(), em: new Date().toISOString() }]).slice(-30)
    if (CFG.AJUSTAR_MARGEM) {
      if (resultado === 'cedo') {
        aprendizado.margem = Math.min(CFG.MARGEM_MAX_MS, aprendizado.margem + 300)
        aprendizado.validosSeguidos = 0
        log('📈', 'aceite saiu CEDO: margem sobe para ' + seg(aprendizado.margem))
      } else if (resultado === 'valido') {
        aprendizado.validosSeguidos = (aprendizado.validosSeguidos || 0) + 1
        if (aprendizado.validosSeguidos >= 5 && aprendizado.margem > CFG.MARGEM_MS) {
          aprendizado.margem = Math.max(CFG.MARGEM_MS, aprendizado.margem - 100)
          aprendizado.validosSeguidos = 0
          log('📉', '5 aceites válidos seguidos: margem desce para ' + seg(aprendizado.margem))
        }
      }
    }
    salvar()
  }

  // ---------------- CONFERÊNCIA DEPOIS DO ACEITE ----------------
  /** Procura nas notas e eventos do lead a marca de aceite inválido. */
  function conferirLead(id) {
    var FALHOU = {}
    var fontes = [
      apiGet('/api/v4/leads/' + id + '/notes?limit=50').catch(function () { return FALHOU }),
      apiGet('/api/v4/events?filter[entity]=lead&filter[entity_id]=' + id + '&limit=50').catch(function () { return FALHOU }),
      apiGet('/api/v4/leads/' + id).catch(function () { return FALHOU }),
    ]
    return Promise.all(fontes).then(function (rs) {
      var t = rs.map(function (r) { return r && r !== FALHOU ? JSON.stringify(r) : '' }).join('\n').toLowerCase()
      registrarDiag(id, 'conferencia', t.slice(0, 1500))
      // 204 (lista vazia) é resposta válida; só é "desconhecido" se TODAS as leituras falharam
      if (rs.every(function (r) { return r === FALHOU })) return 'desconhecido'
      if (t.indexOf('no longer available') >= 0) return 'cedo'
      if (t.indexOf('already been accepted') >= 0 || t.indexOf('accepted by other partners') >= 0) return 'outros'
      return 'valido'
    })
  }

  // ---------------- DISPARO ----------------
  var emAndamento = {}   // id -> true enquanto há avaliação/disparo

  function disparar(id) {
    var n = 0
    var inicio = now()
    var fimJanela = inicio + CFG.JANELA_MS
    var base = baseDe(id)
    marcar(id, { estado: 'aceitando' })
    log('🎯', 'disparando ' + id + (memo[id].vistoTela ? ' · ' + seg(inicio - memo[id].vistoTela) + ' depois de aparecer na tela' : '') + (memo[id].criado ? ' · ~' + seg(inicio + difServidor() - memo[id].criado) + ' depois do created_at' : ''))
    function volta() {
      if (!emAndamento[id]) return Promise.resolve()
      if (now() > fimJanela) return fim('perdido', 'sem sucesso na janela de ' + seg(CFG.JANELA_MS))
      n++
      return tentarAceitar(id).then(function (r) {
        var res = interpretar(id, r)
        registrarDiag(id, 'aceite:' + res, { n: n, http: r.status, resposta: String(r.texto || '').slice(0, 600) })
        if (res === 'aceito') {
          var off = memo[id].criado ? now() + difServidor() - memo[id].criado : null
          log('✅', 'ACEITO ' + id + ' na tentativa #' + n + ', conferindo se ficou válido...')
          marcar(id, { estado: 'conferindo', tentativas: n, offsetAceite: off })
          agendar(now() + CFG.CONFERIR_APOS_MS, function () { conferir(id, off, 1) })
          return
        }
        if (res === 'nao_existe') return fim('nao_existe')
        // Se a própria resposta do aceite já disser isso, a indicação acabou para nós
        if (res === 'cedo' || res === 'outros') { if (res === 'cedo' && memo[id].criado) registrarResultado(id, 'cedo', now() + difServidor() - memo[id].criado); return fim('perdido', ROTULO[res]) }
        marcar(id, { ultimaResposta: ROTULO[res] })
        return esperar(res === 'recuar' ? CFG.RECUO_429_MS : rand(CFG.MIN_INTERVALO_MS, CFG.MAX_INTERVALO_MS)).then(volta)
      }, function (e) {
        dbg('erro de rede ' + id + ': ' + e.message)
        return esperar(rand(CFG.MIN_INTERVALO_MS, CFG.MAX_INTERVALO_MS)).then(volta)
      })
    }
    function fim(estado, motivo) {
      log(estado === 'perdido' ? '⌛' : '🚫', id + ': ' + (motivo || estado) + ' (' + n + ' tentativas)')
      marcar(id, { estado: estado, tentativas: n, motivo: motivo || '' })
      return Promise.resolve()
    }
    return volta().then(function () { if (memo[id].estado !== 'conferindo') delete emAndamento[id] }, function () { delete emAndamento[id] })
  }

  function conferir(id, off, vez) {
    conferirLead(id).then(function (r) {
      if (r === 'desconhecido' && vez < 3) { agendar(now() + 5000, function () { conferir(id, off, vez + 1) }); return }
      delete emAndamento[id]
      if (r === 'cedo' || r === 'outros') {
        var motivo = r === 'cedo' ? 'aceito cedo demais (no longer available)' : 'outros parceiros já tinham aceitado'
        log('❌', id + ': ' + motivo + '. A Lara NÃO vai falar com esse lead.')
        marcar(id, { estado: 'aceito_invalido', motivo: motivo })
        if (off !== null) registrarResultado(id, r, off)
        avisar('Indicação aceita mas inválida', 'Lead ' + id + ': ' + motivo)
        return
      }
      log(r === 'valido' ? '🟢' : '🟡', id + (r === 'valido' ? ' válido' : ' sem como conferir (API), segue') + (off !== null ? ' · aceito ' + seg(off) + ' depois do created_at' : ''))
      if (r === 'valido' && off !== null) registrarResultado(id, 'valido', off)
      marcar(id, { estado: 'aceito', validacao: r })
      avisar('Indicação aceita', 'Lead ' + id + (memo[id].comentario ? ': ' + memo[id].comentario.slice(0, 80) : ''))
      avisarAgente(id)
    })
  }

  // ---------------- DECISÃO POR LEAD ----------------
  function avaliar(id) {
    var libera = horaDisparo(id)
    return lerComentario(id).then(function (comentario) {
      if (comentario === null) {
        if (libera && now() < libera - 15000) { agendar(now() + 8000, function () { avaliar(id) }); return }
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
    var libera = horaDisparo(id) || now()
    if (CFG.MODO === 'assistido') {
      marcar(id, { estado: 'liberado', libera: libera })
      agendar(Math.max(now(), libera), function () { avisar('Indicação liberada', 'Lead ' + id + ': ' + ((memo[id] && memo[id].comentario) || '').slice(0, 100)) })
      delete emAndamento[id]
      return
    }
    marcar(id, { estado: 'aguardando', libera: libera })
    log('⏳', id + ' aceita às ' + hora(libera) + ' (em ' + seg(Math.max(0, libera - now())) + ')')
    // Reagenda perto da hora: o relógio do servidor vai ficando mais preciso com as amostras
    agendar(Math.max(now(), libera - 10000), function () {
      if (naoIndicacao[id]) { log('⏭️', id + ' não é indicação (' + naoIndicacao[id] + '), não aceito'); marcar(id, { estado: 'pulado', motivo: 'não é indicação' }); delete emAndamento[id]; return }
      var exato = horaDisparo(id) || libera
      marcar(id, { libera: exato })
      agendar(Math.max(now(), exato), function () { disparar(id) })
    })
  }

  /** A tela aberta é o funil das indicações? (/leads/pipeline/4338500 ou o funil principal sem id) */
  function telaDoFunil() {
    var m = location.pathname.match(/\/leads\/pipeline\/(\d+)/)
    return m ? Number(m[1]) === CFG.PIPELINE_ID : /\/leads\/pipeline\/?$/.test(location.pathname)
  }

  function registrar(id, fonte) {
    if (!id || emAndamento[id]) return
    if (naoIndicacao[id]) { dbg(id + ' ignorado: não é indicação (' + naoIndicacao[id] + ')'); return }
    if (fonte === 'tela' && !telaDoFunil()) { dbg(id + ' ignorado: card de outro funil na tela'); return }
    var m = memo[id]
    if (m && FINAIS[m.estado]) { desenharSelo(id); return }
    var criado = (incoming[id] && incoming[id].criado) || (m && m.criado) || 0
    // Indicação antiga parada em Incoming (já passou da janela): ignora em silêncio
    if (criado && paraLocal(criado + CFG.LIBERACAO_MS + margem()) + CFG.JANELA_MS + 60000 < now()) {
      if (!m || m.estado !== 'expirado') { marcar(id, { visto: now(), criado: criado, estado: 'expirado' }); dbg(id + ' é antiga (criada ' + new Date(criado).toLocaleString('pt-BR') + '), ignorada') }
      return
    }
    emAndamento[id] = true
    marcar(id, { visto: (m && m.visto) || now(), criado: criado, estado: 'avaliando' })
    registrarDiag(id, 'detectado', fonte)
    var el = cardDe(id)
    if (el) registrarDiag(id, 'html', el.outerHTML)
    var libera = horaDisparo(id)
    log('👀', 'detectado ' + id + ' via ' + fonte + ' · ' + (criado ? 'criado ' + new Date(criado).toLocaleString('pt-BR') : 'sem created_at, conta da detecção') + ' · aceita às ' + (libera ? hora(libera) : '?'))
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
    els.forEach(function (e) {
      var id = idDo(e)
      if (!id) return
      // 1ª vez que o card aparece na tela = o lead já existe: base segura dos 300s
      if (telaDoFunil() && (!memo[id] || !memo[id].vistoTela)) {
        memo[id] = Object.assign({}, memo[id] || {}, { vistoTela: now(), atualizado: now() }); salvar()
      }
      registrar(id, 'tela'); desenharSelo(id)
    })
  }
  /** Mudança dentro do card: guarda o HTML no relatório (NÃO dispara aceite: aceite cedo queima o lead). */
  function capturarCard(node) {
    var el = node && (node.nodeType === 1 ? node : node.parentElement)
    var card = el && el.closest && el.closest('.pipeline-unsorted__item')
    if (!card || (el.closest && el.closest('.cg-indicacao-selo'))) return
    var id = idDo(card)
    if (id && memo[id] && !FINAIS[memo[id].estado]) registrarDiag(id, 'html', card.outerHTML)
  }
  var observer = new MutationObserver(function (ms) {
    ms.forEach(function (m) {
      m.addedNodes.forEach(varrer)
      if (CFG.DIAGNOSTICO) capturarCard(m.target)
    })
  })
  // Cards que JÁ estavam na tela quando o script carregou apareceram antes:
  // a hora de agora é tarde demais como base (seguro, só mais lento), então vale.
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
    // Aceito antes do reload: nunca reaceita, só termina a conferência
    if (memo[id].estado === 'conferindo') { emAndamento[id] = true; agendar(now() + 2000, function () { conferir(id, typeof memo[id].offsetAceite === 'number' ? memo[id].offsetAceite : null, 1) }); return }
    // Recarregou no meio do disparo: pergunta à API se o lead já saiu dos Incoming (aceito) antes de qualquer coisa
    if (memo[id].estado === 'aceitando') {
      emAndamento[id] = true
      apiGet('/api/v4/leads/' + id).then(function (l) {
        if (l && Number(l.status_id) === CFG.STATUS_ID) conferir(id, null, 1)
        else { delete emAndamento[id]; marcar(id, { estado: 'perdido', motivo: 'página recarregada no meio do disparo' }) }
      }, function () { delete emAndamento[id]; marcar(id, { estado: 'perdido', motivo: 'página recarregada no meio do disparo' }) })
      return
    }
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
      return JSON.stringify({ versao: VERSAO, gerado: new Date().toISOString(), url: location.pathname, apiSessaoOk: apiSessaoOk, difServidorMs: Math.round(difServidor()), relogioIntervaloMs: relogioLo === null ? null : [Math.round(relogioLo), Math.round(relogioHi)], amostrasRelogio: amostrasRelogio.length, margemMs: margem(), aprendizado: aprendizado, cfg: CFG, leads: memo, diag: diag }, null, 1)
    },
    esquecer: function (id) { delete memo[id]; delete diag[id]; salvar(); gravar(DIAG_KEY, diag) },
    zerarMargem: function () { aprendizado = { margem: CFG.MARGEM_MS, validosSeguidos: 0, historico: [] }; salvar() },
    relogio: function () { return { difServidorMs: Math.round(difServidor()), intervaloMs: relogioLo === null ? null : [Math.round(relogioLo), Math.round(relogioHi)], amostras: amostrasRelogio.length } },
  }

  log('🚀', 'v' + VERSAO + ' ativo · modo ' + CFG.MODO + ' · filtro ' + CFG.FILTRO_MODO + ' · aceita 300s depois de o lead chegar (tela ou created_at, o que for mais cedo e seguro) + ' + margem() + ' ms')
  log('💡', 'parar: __INDICACOES__.stop() · testar filtro: __INDICACOES__.testar("Comment: ...") · relatório: copy(__INDICACOES__.relatorio())')
})();
