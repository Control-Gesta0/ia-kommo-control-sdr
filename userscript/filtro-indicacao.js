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

  /** "Country: Brazil" da nota da indicação. null = não veio. */
  function extrairPais(texto) {
    var t = String(texto == null ? '' : texto).replace(/\\n/g, '\n')
    var m = /(?:^|[\n|"{,;>]|\s)Country\s*"?\s*:\s*"?([^\n|",}<]+)/i.exec(t)
    return m ? m[1].trim() : null
  }

  var PAISES_ATENDIDOS = ['brazil', 'brasil', 'portugal']

  /** Idioma do texto do Comment pelas palavras mais comuns: 'pt' | 'es' | 'en' | '?' */
  function idiomaComentario(comentario) {
    var n = ' ' + normalizar(comentario) + ' '
    function conta(ws) { var c = 0; for (var i = 0; i < ws.length; i++) if (n.indexOf(' ' + ws[i] + ' ') >= 0) c++; return c }
    var pt = conta(['nao', 'atendimento', 'funil', 'vendas', 'preciso', 'precisamos', 'quero', 'nosso', 'nossa', 'meu', 'minha', 'o', 'e', 'com', 'uma', 'para', 'voces', 'ajuda', 'empresa'])
    var es = conta(['necesitamos', 'necesito', 'embudo', 'ventas', 'nuestro', 'nuestra', 'el', 'y', 'los', 'mi', 'quiero', 'consultoria', 'por', 'favor', 'ayuda', 'empresa', 'para', 'con', 'una'])
    var en = conta(['we', 'need', 'help', 'our', 'the', 'and', 'sales', 'team', 'with', 'want', 'my', 'company', 'to', 'for'])
    if (es > pt && es >= 2) return 'es'
    if (en > pt && en > es && en >= 2) return 'en'
    if (pt >= 1) return 'pt'
    return '?'
  }

  /**
   * A Control Gestão só atende em português. País da nota manda (Brasil/Portugal
   * aceita; outro não). Sem país: decide pelo idioma do Comment (espanhol/inglês = não).
   */
  function foraDoIdioma(texto, comentario) {
    var pais = extrairPais(texto)
    if (pais) {
      var ok = PAISES_ATENDIDOS.indexOf(normalizar(pais)) >= 0
      return { fora: !ok, motivo: ok ? 'país atendido: ' + pais : 'país não atendido: ' + pais }
    }
    var lang = idiomaComentario(comentario)
    if (lang === 'es' || lang === 'en') return { fora: true, motivo: 'Comment em ' + (lang === 'es' ? 'espanhol' : 'inglês') }
    return { fora: false, motivo: 'sem país; Comment em português ou neutro' }
  }

  return { normalizar: normalizar, extrairComentario: extrairComentario, classificarTeste: classificarTeste, extrairPais: extrairPais, idiomaComentario: idiomaComentario, foraDoIdioma: foraDoIdioma }
})();

if (typeof module !== 'undefined' && module.exports) module.exports = FiltroIndicacao
