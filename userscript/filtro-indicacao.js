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

  // Palavras que só existem (ou quase só) em cada idioma. Compartilhadas ("para", "empresa",
  // "como", "de", "que", "clientes", "negocio") ficam de fora para não confundir.
  var PT = ['nao', 'atendimento', 'funil', 'funis', 'preciso', 'precisamos', 'quero', 'queria', 'gostaria', 'nosso', 'nossa', 'meu', 'minha', 'meus', 'minhas', 'o', 'e', 'com', 'uma', 'um', 'voces', 'voce', 'ajuda', 'ajudar', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas', 'em', 'ao', 'sao', 'esta', 'estou', 'estamos', 'tenho', 'temos', 'organizar', 'vendas', 'automacao', 'automacoes', 'configuracao', 'configurar', 'implantacao', 'implementacao', 'integracao', 'equipe', 'ola', 'oi', 'obrigado', 'obrigada', 'tambem', 'mais', 'etapas', 'orcamento']
  var ES = ['necesito', 'necesitamos', 'embudo', 'ventas', 'nuestro', 'nuestra', 'el', 'y', 'los', 'las', 'mi', 'mis', 'quiero', 'queria', 'ayuda', 'una', 'un', 'con', 'del', 'hola', 'gracias', 'tengo', 'tenemos', 'estoy', 'estamos', 'equipo', 'configuracion', 'automatizacion', 'integracion', 'usted', 'ustedes', 'hacer', 'puede', 'pueden', 'informacion', 'precio', 'cuanto', 'tambien', 'mas', 'presupuesto', 'implementacion', 'pero', 'muy']
  var EN = ['we', 'need', 'help', 'our', 'the', 'and', 'sales', 'team', 'with', 'want', 'my', 'company', 'to', 'for', 'i', 'am', 'is', 'are', 'have', 'hello', 'hi', 'please', 'business', 'would', 'like', 'setup', 'set', 'up', 'how', 'thanks', 'looking', 'integration', 'automation', 'pipeline', 'this', 'that', 'it']

  /** Idioma do texto do Comment pelas palavras típicas: 'pt' | 'es' | 'en' | '?' */
  function idiomaComentario(comentario) {
    var n = ' ' + normalizar(comentario) + ' '
    function conta(ws) { var c = 0; for (var i = 0; i < ws.length; i++) if (n.indexOf(' ' + ws[i] + ' ') >= 0) c++; return c }
    var pt = conta(PT), es = conta(ES), en = conta(EN)
    // Estrangeiro só com evidência clara: 2+ palavras típicas e nenhuma de português
    // (ou predominância forte). Na dúvida é '?', e na dúvida a indicação é aceita.
    if (es >= 2 && (pt === 0 || es >= 3 * pt) && es >= en) return 'es'
    if (en >= 2 && (pt === 0 || en >= 3 * pt) && en > es) return 'en'
    if (pt >= 1) return 'pt'
    return '?'
  }

  /** "Country: Brazil" da nota da indicação (só informativo: não decide mais nada). */
  function extrairPais(texto) {
    var t = String(texto == null ? '' : texto).replace(/\\n/g, '\n')
    var m = /(?:^|[\n|"{,;>]|\s)Country\s*"?\s*:\s*"?([A-Za-zÀ-ú .'-]+?)(?=\s*(?:\n|$|[|",}<]|\s+(?:Cluster|Languages?|Industry|Comment)\s*:))/i.exec(t)
    return m ? m[1].trim() : null
  }

  /**
   * A Control Gestão só atende em português, mas o Country/Languages da Kommo não é
   * confiável (cliente do Brasil marca EUA/inglês; a tela cola as linhas da nota).
   * Decide SÓ pelo Comment: recusa quando ele está claramente em espanhol ou inglês.
   * Português, curto, vazio ou na dúvida = aceita (melhor atender do que perder o lead).
   */
  function foraDoIdioma(texto, comentario) {
    var lang = idiomaComentario(comentario || '')
    if (lang === 'es' || lang === 'en') return { fora: true, motivo: 'Comment em ' + (lang === 'es' ? 'espanhol' : 'inglês') }
    return { fora: false, motivo: lang === 'pt' ? 'Comment em português' : 'idioma do Comment indefinido: aceita' }
  }

  // Suporte BÁSICO da própria Kommo (não é lead de implantação). Só frases fortes.
  var SUPORTE = [
    /\b(whats(app)?|wpp|zap|numero|chip|instagram|insta|facebook|canal)\b.{0,40}\b(caiu|cai|desconect\w*|deslog\w*|nao (conecta|envia|recebe|funciona|chega|aparece|sincroniza)|parou|bloquead\w*|banid\w*|sumiu|fora do ar|expirou)\b/,
    /\b(caiu|desconect\w*|parou de funcionar|bloquead\w*|banid\w*)\b.{0,30}\b(whats(app)?|wpp|zap|numero|instagram|conta)\b/,
    /\b(nao|n) (consigo|estou conseguindo|to conseguindo|conseguimos|estamos conseguindo) (mais )?(acessar|entrar|logar|conectar|reconectar|enviar|receber|integrar|vincular|sincronizar|ver as mensagens|mandar mensage\w*)\b/,
    /\b(mensage(m|ns)|conversas?)\b.{0,25}\bnao (estao |esta |tao |ta )?(chegando|saindo|indo|enviando|aparecendo|sendo enviadas?)\b/,
    /\b(esqueci|recuperar|redefinir|resetar) (a |minha |de )?senha\b/,
    /\b(cancelar|cancelamento|reembolso|estorno|estornar)\b/,
    /\b(cobranca|cobrado|cobrada|fatura|boleto|pagamento)\b.{0,30}\b(indevid\w*|errad\w*|duplicad\w*|nao reconhe\w*|em dobro)\b/,
    /\b(reconectar|conectar|vincular) (o |meu |nosso |a )?(numero|whats(app)?|wpp|instagram)\b/
  ]
  // Qualquer sinal de projeto/implantação tira do corte (na dúvida, a Lara conversa)
  var IMPLANTACAO = /\b(funil|funis|pipeline|etapa|etapas|implant\w*|automa\w*|robo|robos|bot|bots|chatbot|salesbot|ia|inteligencia artificial|agente|organiz\w*|equipe|vendedor\w*|vendas|processo\w*|relatorio\w*|dashboard|treinamento|consultoria|projeto|estrutur\w*|campanha\w*|disparo\w*|parceiro|configurar o (kommo|crm|sistema)|montar)\b/

  /** Pedido de suporte básico? { suporte, motivo }. Só com frase forte e nenhum sinal de implantação. */
  function classificarSuporte(comentario) {
    var n = normalizar(comentario)
    if (!n) return { suporte: false, motivo: 'comentário vazio' }
    if (IMPLANTACAO.test(n)) return { suporte: false, motivo: 'tem sinal de implantação' }
    for (var i = 0; i < SUPORTE.length; i++) {
      var m = SUPORTE[i].exec(n)
      if (m) return { suporte: true, motivo: 'suporte básico: "' + m[0].slice(0, 60) + '"' }
    }
    return { suporte: false, motivo: 'sem sinal de suporte' }
  }

  return { normalizar: normalizar, extrairComentario: extrairComentario, classificarTeste: classificarTeste, extrairPais: extrairPais, idiomaComentario: idiomaComentario, foraDoIdioma: foraDoIdioma, classificarSuporte: classificarSuporte }
})();

if (typeof module !== 'undefined' && module.exports) module.exports = FiltroIndicacao
