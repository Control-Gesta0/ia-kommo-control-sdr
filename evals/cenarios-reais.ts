/**
 * CENÁRIOS REAIS (02/10/2026): leads de indicação da Kommo que a Lara atendeu, com o
 * Comment de verdade e as mensagens que o lead mandou (áudio já transcrito como chega hoje).
 * Onde o lead sumiu ou parou de responder, a continuação é INVENTADA no padrão das conversas
 * reais (marcado com "inventado" no comentário de cada cenário), para o teste ir até a
 * reunião ou até a objeção. O juiz cobra o que deu errado nas conversas originais: pergunta
 * repetida, roteiro engessado, preço sem resposta, pedido claro tratado como desconhecido e
 * reunião não vendida.
 *
 *   npx tsx scripts/evals.ts real-                  (só estes)
 *   EVAL_MOSTRAR=1 npx tsx scripts/evals.ts real-   (mostra a conversa inteira, aprovada ou não)
 */
import type { Cenario } from '../scripts/evals'

type T = { lead: string; resposta: string; tools: string[]; guard: string[] }
const palavras = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3)
const perguntas = (t: string) => (t.match(/[^.!?\n]*\?/g) || []).map(palavras).filter(p => p.length >= 2)
const parecida = (a: string[], b: string[]) => { const sb = new Set(b); return a.filter(w => sb.has(w)).length / Math.min(a.length, b.length) >= 0.6 }
const LISTA_PRONTA = /perder lead.{0,60}etapa.{0,60}relat[oó]rio/i

const ateDuas = { nome: 'no máximo 2 perguntas por resposta', fn: (_w: any, t: T[]) => t.every(x => (x.resposta.match(/\?/g) || []).length <= 2) }
const HORA = /\b\d{1,2}h(?:\d{2})?\b/g
const FALA_HORARIO = /hor[aá]rio|agenda|\bdia\b|semana|hoje|amanh|segunda|ter[cç]a|quarta|quinta|sexta|manh[aã]|tarde|\d{1,2}\s*h\b|marc|agend|pode ser/i
const SO_ACEITE = /^(beleza|ok|okay|pode ser|sim|blz|certo|fechado|perfeito)\W*$/i
const naoRepetePergunta = {
  nome: 'não repete a mesma pergunta (nem com outras palavras)',
  fn: (_w: any, t: T[]) => t.every((x, i) => {
    // Lead falou de horário ou só aceitou: perguntar qual horário de novo é natural
    if (i === 0 || FALA_HORARIO.test(x.lead) || SO_ACEITE.test(x.lead.trim())) return true
    const antes = t.slice(0, i).flatMap(y => perguntas(y.resposta))
    return !perguntas(x.resposta).some(p => antes.some(q => parecida(p, q)))
  }),
}
const semListaPronta = { nome: 'não usa a lista pronta "perder lead / etapa / relatório"', fn: (_w: any, t: T[]) => t.every(x => !LISTA_PRONTA.test(x.resposta)) }
const semFallback = { nome: 'nenhuma resposta caiu no texto de segurança', fn: (_w: any, t: T[]) => t.every(x => !x.guard.includes('fallback')) }
const semTravessao = { nome: 'sem travessão', fn: (_w: any, t: T[]) => t.every(x => !/[—–]/.test(x.resposta)) }
const semFaixaFaturamento = (t: string) => t.replace(/[^.?!\n]*fatura[^.?!\n]*[.?!]?/gi, '')
// Preço da LICENÇA (R$ 104 / 156 / 234 por usuário, e o total dele) pode; valor de serviço a IA não tem
const LICENCA = [104, 156, 234]
const semLicenca = (t: string) => t.replace(/r\$\s*([\d.]+)(?:,\d{2})?/gi, (m: string, n: string) => { const v = Number(String(n).replace(/\./g, '')); return LICENCA.some(p => v > 0 && v % p === 0) ? '' : m })
const semPrecoServico = { nome: 'não inventa valor de serviço em R$', fn: (_w: any, t: T[]) => t.every(x => !/r\$\s*\d|\d+\s*(mil )?reais|a partir de r?\$?\s*\d/i.test(semLicenca(semFaixaFaturamento(x.resposta)))) }
const marcou = (iso: string) => ({ nome: `marcou UMA reunião em ${iso}`, fn: (w: any) => w.reunioes.length === 1 && new Date(w.reunioes[0].ini).toISOString() === iso && w.state.finalizado?.motivo === 'agendado' })
const naoMarcou = { nome: 'não criou reunião', fn: (w: any) => w.reunioes.length === 0 }
const confirmaSemPergunta = { nome: 'confirmação final sem pergunta', fn: (_w: any, t: T[]) => !t[t.length - 1].resposta.includes('?') }
const naoRepeteHorarios = {
  nome: 'não repete a mesma lista de horários em mensagens seguidas (quando o lead fala de outra coisa)',
  fn: (_w: any, t: T[]) => t.every((x, i) => {
    // Lead escolhendo ("2", "a primeira"): confirmar o horário escolhido não é repetir a lista
    if (i === 0 || FALA_HORARIO.test(x.lead) || /^\W*(\d|primeir|segund|[uú]ltim)/i.test(x.lead.trim())) return true
    const antes = new Set(t[i - 1].resposta.match(HORA) || [])
    return !(x.resposta.match(HORA) || []).some(h => antes.has(h))
  }),
}
// Comercial (02/10): nada de convite logo de cara (abertura e 1ª resposta), salvo se o lead pediu
const PEDIU = /reuni[aã]o|apresenta|demonstra[cç]|me mostr|conhecer (a |melhor a |o )?(ferramenta|plataforma|sistema)|como funciona|proposta|or[cç]amento|quanto (custa|fica|cobra|sai)|pre[cç]o|valores?\b|liga[cç][aã]o|falar com|atendimento humano|hor[aá]rio|agenda|marcar|agendar|\bmeet\b|hoje|logo|urgente|o quanto antes/i
const CONVIDA = (t: string) => t.split(/(?<=[.!?])\s+|\n+/).some(f => (/\?/.test(f) && /\b(marc|agend)\w*/i.test(f)) || (/\b(an[aá]lise|reuni[aã]o|especialista)\b/i.test(f) && (/\?/.test(f) ? /\b(quer|vamos|bora|posso|podemos|vale|topa)/i.test(f) : /\b(posso te|podemos|a gente pode|que tal|te coloco)\b/i.test(f))))
const semConviteDeCara = {
  nome: 'não convida para a reunião na abertura nem na 1ª resposta (salvo se o lead pediu)',
  fn: (w: any, t: T[]) => /(falar|conversar) com (um|uma|o|a) (vendedor|consultor|especialista|pessoa|atendente)|reuni[aã]o|apresenta[cç][aã]o|demonstra[cç][aã]o|liga[cç][aã]o/i.test(w.state.comentario || '') || t.slice(0, 2).every(x => PEDIU.test(x.lead) || !CONVIDA(x.resposta)),
}
const duracaoUmaVez = { nome: 'duração "30 a 45 minutos" no máximo uma vez na conversa', fn: (_w: any, t: T[]) => t.filter(x => /30\s*(a|-|–|ou)\s*45\s*min/i.test(x.resposta)).length <= 1 }
const dado49UmaVez = { nome: 'dado dos 49% do follow-up no máximo uma vez na conversa', fn: (_w: any, t: T[]) => t.filter(x => /49\s*%/.test(x.resposta)).length <= 1 }
const BASE = [ateDuas, naoRepetePergunta, naoRepeteHorarios, semListaPronta, semFallback, semTravessao, semConviteDeCara, duracaoUmaVez, dado49UmaVez]
const ctx = (segmento: string) => ({ contexto: { pais: 'Brazil', idiomas: 'Portuguese', segmento } })

export const CENARIOS_REAIS: Cenario[] = [
  {
    // Real até o pedido de proposta (lead 20774795); depois inventado: ela aceita a análise
    id: 'real-karoline-troca-de-parceiro',
    porta: 'indicacao', nomeContato: 'Karoline', abertura: true, agora: '2026-10-02T19:00:00Z', state: ctx('Indústria / distribuição'),
    comentario: 'Implantação e Configuração de Funil de Pré e Pós Vendas, Treinamento de Utilização da Plataforma completa.',
    msgs: [
      'Ola Lara, Boa tarde tudo bem?',
      'A  ferramenta já conhecemos e temos uma implantação em andamento, porém a empresa atual  está com muito atraso na entrega, sempre postergando o treinamento, aí o time interno estão me pedindo apoio para a substituição do parceiro para conclusão e treinamento. Os funis já estão criados, porém falta treinamento e algumas otimização. Preciso ter informações de tempo e valores para esse trabalho complementar para enviar para análise e aprovação.',
      'São 2 atendentes e 1 Gestor apenas',
      'Os painéis já estão criados, precisa de pequenos ajustes, mas algumas integrações precisam ser finalizadas, pois vamos encerrar o contrato com a empresa atual',
      'Poderia passar uma proposta referente a esse processo e implantação?',
      'Entendi, faz sentido. Pode ser segunda à tarde?',
      'às 14h fica ótimo',
    ],
    checks: [...BASE, semPrecoServico, marcou('2026-10-05T17:00:00.000Z'), confirmaSemPergunta],
    criterios: [
      'Depois que ela explica a situação (implantação em andamento, parceiro atrasado, falta treinamento e ajustes), a IA NÃO pergunta de novo o que trava ou qual é o problema: mostra que entendeu e avança',
      'Quando ela pede tempo, valores ou proposta, a IA não ignora: explica que depende do escopo (o que já existe, integrações, treinamento), ligado ao caso dela, sem inventar número',
      'A IA mostra a reunião com o especialista como o caminho para a proposta e não exige faturamento como condição',
      'Quando ela pede segunda à tarde, a IA oferece horários desse período e confirma o escolhido com dia e hora',
    ],
  },
  {
    // Real do começo ao fim (lead 20774803): pediu preço duas vezes e não quis agendar
    id: 'real-isadora-preco-insistente',
    porta: 'indicacao', nomeContato: 'Isadora', abertura: true, agora: '2026-10-02T19:30:00Z', state: ctx('Imobiliário'),
    comentario: 'queria alguém para configurar o CRM pra mim. Nunca contratei nenhum tipo de CRM.',
    msgs: [
      'Boa tarde. Não saber nada sobre cada lead, em que etapa etc',
      'Perdendo vendas',
      'Quero resolver hoje',
      'Na verdade não é imobiliária, não consegui encontrar uma opção correta. Somos uma loja de móveis, ramo moveleiro.',
      'Qual seria a média de valores?',
      'São 2 vendedoras e eu administrando',
      'Não posso agendar, quero saber uma média de valores',
    ],
    checks: [...BASE, semPrecoServico, naoMarcou],
    criterios: [
      'Com o problema (não saber a etapa dos leads), o impacto (perdendo vendas) e a urgência (quer resolver hoje), a IA vende a reunião sem perguntar decisor e faturamento como formulário',
      'Ao ser corrigida (loja de móveis, não imobiliária), a IA agradece a correção e usa o ramo certo',
      'Na primeira pergunta de valores, a IA responde (não desconversa): não inventa valor de implantação, explica que depende do escopo ligado ao que ela contou e mostra a reunião como o caminho para o valor',
      'Quando ela insiste pela segunda vez e diz que não pode agendar, a IA fecha com gentileza e deixa a porta aberta, sem pressionar',
    ],
  },
  {
    // Real até "você pode apresentar a ferramenta?" (lead 20773577, fechou com outro parceiro); depois inventado: aceita
    id: 'real-luiz-quer-conhecer',
    porta: 'indicacao', nomeContato: 'Luiz', abertura: true, agora: '2026-10-01T23:30:00Z', state: ctx('E-commerce'),
    comentario: 'Sou de Recife, quero conhecer melhor a plataforma',
    msgs: [
      'Bom dia',
      'Quero saber sobre o kommo',
      'Existe a possibilidade de atendimento humano, quero conhecer a ferramenta',
      'Você pode apresentar a ferramenta?',
      'Pode ser amanhã de manhã?',
      '10h',
    ],
    checks: [...BASE, marcou('2026-10-02T13:00:00.000Z'), confirmaSemPergunta],
    criterios: [
      'A IA responde as perguntas dele sobre o Kommo de forma curta e correta',
      'Quando ele pede atendimento humano ou para conhecer/ver a ferramenta, a IA oferece a apresentação com o especialista (a reunião), sem passar para outro atendente e sem voltar a perguntar o problema',
      'A IA não repete a pergunta da abertura quando ele só diz "Bom dia"',
    ],
  },
  {
    // Real: Comment + 1ª resposta (lead 20774779, depois pediu humano); o resto é inventado
    id: 'real-fred-comecar-do-zero',
    porta: 'indicacao', nomeContato: 'Fred', abertura: true, agora: '2026-10-02T20:00:00Z', state: ctx('Imobiliário'),
    comentario: 'Automatização do Kommo para meu negócio.',
    msgs: [
      'Boa tarde! Quero começar do zero. Deixar o kommo pronto para que eu possa usar.',
      'É uma imobiliária pequena, somos 3 corretores e hoje fica tudo no WhatsApp de cada um',
      'Quero colocar pra rodar ainda esse mês',
      'Pode ser, segunda de manhã',
      '10h',
    ],
    checks: [...BASE, marcou('2026-10-05T13:00:00.000Z'), confirmaSemPergunta],
    criterios: [
      'A abertura cita o pedido de automatizar o Kommo sem terminar numa lista pronta de opções',
      'Depois de "quero começar do zero", a IA reconhece que é implantação completa, entende o cenário com poucas perguntas (sem repetir o que ele já disse, como 3 corretores e WhatsApp) e só então convida para a análise com o especialista',
      'Quando ele conta que fica tudo no WhatsApp de cada corretor, a IA mostra em uma frase como o Kommo resolve isso',
    ],
  },
  {
    // Real até o "Pode ser" (lead 20773581, reunião marcada de verdade); a escolha do horário segue a real
    id: 'real-davis-turismo-pedido-completo',
    porta: 'indicacao', nomeContato: 'Davis', abertura: true, agora: '2026-10-01T23:00:00Z', state: ctx('Turismo e hotelaria'),
    comentario: 'Busco soluções para automatizar o atendimento e o processo comercial da empresa, desde a entrada do cliente até a confirmação da reserva e o pós-venda. O objetivo é aumentar as vendas, organizar os leads, automatizar mensagens e follow-ups, acompanhar conversões e reduzir tarefas manuais. Também preciso melhorar o controle financeiro, emissão e organização de notas fiscais, registro de pagamentos.',
    msgs: [
      'Olá',
      'Somos uma agência de turismo e buscamos estruturar todo o processo comercial e operacional através do Kommo CRM.\nPrecisamos centralizar os leads vindos de WhatsApp, Instagram, Facebook, site e anúncios, distribuindo os atendimentos entre os vendedores e acompanhando todo o histórico do cliente.\nO fluxo deverá contemplar: entrada do lead → atendimento → qualificação → escolha do passeio → orçamento → follow-up → pagamento/sinal → confirmação da reserva → realização do passeio → pós-venda.\nTambém queremos automatizar mensagens, recuperação de clientes que não finalizaram a compra, lembretes, distribuição de leads, acompanhamento dos atendentes, conversões e relatórios.\nPrecisamos que a empresa apresente como faria essa estrutura no Kommo e quais integrações seriam necessárias.',
      '[áudio do lead]: Olha, a gente tá com uma base, né, de no máximo 4 vendedores, né, é um passeio. Eu quero fazer automação, né, pra colocar. Na verdade, eu já uso o Kommo, né, eu só queria fazer a automação nele.',
      'Pode ser',
      'Pode ser amanhã às 10h',
    ],
    checks: [...BASE, marcou('2026-10-02T13:00:00.000Z'), confirmaSemPergunta],
    criterios: [
      'Com um pedido tão completo, a IA não pergunta o que ele já escreveu (o problema, o fluxo, os canais): reconhece a demanda e pergunta só o que falta (quantas pessoas vão usar, tráfego/volume de leads) antes de convidar',
      'A IA não promete cada integração (PIX, nota fiscal, ERP) pelo chat: diz que o especialista mostra a estrutura e as integrações na reunião',
      'Quando ele aceita, a IA oferece horários e confirma o escolhido com dia e hora',
    ],
  },
  {
    // Real até a mensagem sobre não pagar além do Kommo (lead 20770625); depois inventado: aceita a análise
    id: 'real-larissa-custo-meta',
    porta: 'indicacao', nomeContato: 'Larissa', agora: '2026-10-02T12:30:00Z', state: ctx('Tecnologia / software'),
    comentario: 'Quero entender mais sobre como utilizar as automações',
    historico: [
      ['out', 'Bom dia! Aqui é a Lara, da Control Gestão, parceira oficial da Kommo, e a Kommo me passou seu pedido pra entender melhor as automações. Me diz seu nome pra eu te chamar direitinho.'],
      ['in', 'Oii, tudo bem? É larissa'],
      ['in', 'Eu posso mandar audio?'],
      ['out', 'Oii, Larissa, tudo bem sim. Pode mandar áudio, claro.'],
    ],
    msgs: [
      '[áudio do lead]: Ei, Lara, tudo bem? Deixa eu te falar, eu tô com um problemão aqui. Eu tive o Kommo uma vez, mas quem organizou ele para mim foi a V4. E dessa vez eu tô com o Kommo em outra empresa, mas eu comecei independente, então muitas coisas estão engatinhando. A gente fez vários robôs para conseguir disparar, mas descobrimos que a gente tinha que pagar a Meta, a Meta tem que aprovar as mensagens e a gente tem que pagar um valor por mensagem. É isso mesmo? Não tem outra forma? Porque fica muito estranho contratar um CRM com automação e ter que pagar um terceiro para conseguir usar a automação.',
      'a operação é pequena, tenho dois acessos',
      'so preciso de conseguir automatizar mensagens diferentes. follow up, cobrança de inadimplencia, as vezes renovações. Acaba virando perda, eles perdem clientes',
      'entao, eu quero nao pagar mais nada além do kommo para usar o crm',
      'tá, pode ser. segunda à tarde?',
      '14h',
    ],
    checks: [...BASE, semPrecoServico, marcou('2026-10-05T17:00:00.000Z'), confirmaSemPergunta],
    criterios: [
      'A IA responde de verdade a dúvida sobre a cobrança da Meta (é da Meta, vale para qualquer CRM com a API oficial, responder em até 24h não é cobrado), sem cair numa frase pronta de preço',
      'Quando ela diz que não quer pagar nada além do Kommo, a IA responde com honestidade (WhatsApp Lite sem cobrança por mensagem, com limites; automações desenhadas para gastar menos) sem prometer custo zero',
      'Com a necessidade clara (follow-up, cobrança, renovação, perda de clientes), a IA mostra como a organização e a cadência de follow-up resolvem isso e vende a reunião sem fazer perguntas de formulário',
    ],
  },
  {
    // Real até "terá mais dois acessos" (lead 20755557, não agendou); depois inventado: aceita uma conversa rápida
    id: 'real-caroline-ja-conversei-com-varios',
    porta: 'indicacao', nomeContato: 'Caroline', abertura: true, agora: '2026-09-25T22:00:00Z', state: ctx('Saúde, estética e bem-estar'),
    comentario: 'Implemnatr CRM, automação, quando o lead irá para cada acesso',
    msgs: [
      'Preciso organizar a automação, funil de vendas, follow-up e quando o contato entra para a secretaria responsável e em que momento isso acontece',
      'Crm do RD stantion',
      'Eu já fiz inúmeros agendamentos Lara e conversas prévias, já sei que podem me ajudar! e agora eu gostaria de ir primeiro ao seu orçamento para fazer esse trabalho. Que assim consigo ser mais prática e específica com você',
      'Eu irei contratar o meu acesso de adm e terá mais dois acessos (um para cada uma de minhas secretárias)',
      'Tá bom, pode ser uma conversa rápida então. Segunda de manhã?',
      '10h',
    ],
    checks: [...BASE, semPrecoServico, marcou('2026-09-28T13:00:00.000Z'), confirmaSemPergunta],
    criterios: [
      'A IA não pergunta de novo o que ela já disse que precisa (automação, funil, follow-up, distribuição para as secretárias)',
      'Quando ela diz que já conversou com vários e quer o orçamento primeiro, a IA reconhece sem confrontar e mostra que a reunião é curta e é onde sai o orçamento certo para o caso dela',
      'A IA não pede faturamento como condição para falar de orçamento',
    ],
  },
  {
    // Real: Comment + áudio (lead 20774787, não respondeu depois); o resto é inventado
    id: 'real-marcelo-clinica-trafego',
    porta: 'indicacao', nomeContato: 'Marcelo', abertura: true, agora: '2026-10-02T19:40:00Z', state: ctx('Saúde, estética e bem-estar'),
    comentario: 'Completar a configuração da conta Treinamento Kommo Customização da conta Configuração do Salesbot Optimização do processo de vendas Serviços de marketing Consultoria de negócios',
    msgs: [
      '[áudio do lead]: Fala, meu amigo, boa tarde. É o seguinte, eu tenho uma clínica e a gente está querendo colocar um CRM para recebimento dos contatos do tráfego pago, tá certo? E aí eu não sei fazer a configuração, não sei trabalhar com CRM, tenho dificuldade. Aí eu queria que você me orientasse em relação à instalação, configuração do CRM, forma de trabalhar com ele, como é que a gente faz cadastro das mensagens rápidas, como é que a gente pode automatizar algum tipo de mensagem, como é que a gente pode categorizar o funil de acordo com o que a gente precisa na clínica, tá? A clínica faz procedimento de emagrecimento, de mini lipo, de remodelação glútea, são as coisas que a gente faz o tráfego pago. Então, aí eu queria colocar cada tipo de procedimento numa aba diferente do funil. Não sei se isso é válido ou se teria outra forma que você me orientasse.',
      'Pode ser. Mas antes, quanto fica mais ou menos isso?',
      'Ok, entendi. Segunda às 15h dá?',
      'pode ser',
    ],
    checks: [...BASE, semPrecoServico, marcou('2026-10-05T18:00:00.000Z'), confirmaSemPergunta],
    criterios: [
      'A abertura NÃO fala de preço, investimento ou faturamento',
      'Depois do áudio, a IA acolhe a dificuldade e confirma em linhas gerais que dá para organizar por procedimento, sem virar consultoria de configuração pelo chat; a reunião vem depois de entender o cenário ou quando ele aceita',
      'Na pergunta de preço, a IA não inventa valor, explica que depende do escopo e mantém a reunião como próximo passo',
    ],
  },
  {
    // Real até o pedido de meet (lead 20773103); depois inventado: quer hoje, só tem amanhã
    id: 'real-gabriel-ajuda-pontual',
    porta: 'indicacao', nomeContato: 'Gabriel', abertura: true, agora: '2026-10-01T18:00:00Z', state: ctx('Tecnologia / software'),
    comentario: 'Ajuda na criação de fluxos',
    msgs: [
      '[áudio do lead]: Oi, Lara, tudo bem? Boa tarde. Eu tô te repassando esse áudio que eu mandei pra outra atendente aí de vocês, tá? É só pra explicar o que eu tô passando aqui hoje. Queria perguntar se daria pra vocês me ajudarem hoje nesse sentido.',
      '[áudio do lead]: Por exemplo, eu coloquei um fluxo pra enviar uma mensagem pra pessoa quando ela comenta em qualquer publicação no Instagram. Só que se ela comenta em outro post, ela recebe a mesma mensagem de novo. E eu queria colocar condicional de tags pra bloquear a mensagem de automação pra não ficar repetindo. Eu queria entender essa parte pra eu poder desengatar aqui os fluxos.',
      '[áudio do lead]: Será que você não conseguiria me ajudar rapidamente nesse sentido? Se nem que fosse um meet pra gente pudesse fazer, só pra você me mostrar rápido.',
      'Pode ser, hoje mais tarde ainda dá?',
      'amanhã às 10h então',
    ],
    checks: [...BASE, marcou('2026-10-02T13:00:00.000Z'), confirmaSemPergunta],
    criterios: [
      'A IA não manda para o suporte da Kommo e não ensina a configuração passo a passo pelo chat',
      'Quando ele pede um meet rápido, a IA oferece a reunião com o especialista, deixando claro que é para olhar os fluxos dele',
      'Quando ele pede hoje e não há horário, a IA diz isso e oferece as próximas opções',
    ],
  },
  {
    // Real: só o Comment (lead 20770313 nunca respondeu); a conversa é inventada
    id: 'real-leandro-orcamento-45',
    porta: 'indicacao', nomeContato: 'Leandro', abertura: true, agora: '2026-10-01T12:13:00Z', state: ctx('E-commerce'),
    comentario: 'Gostaria de solicitar um orçamento para aproximadamente 45 colaboradores.',
    msgs: [
      'Isso, precisamos do orçamento para começar logo',
      'Somos um e-commerce de moda, o atendimento é todo pelo WhatsApp e Instagram, hoje cada vendedor responde no seu celular',
      'Beleza, pode ser amanhã à tarde',
      '15h',
    ],
    checks: [...BASE, semPrecoServico, marcou('2026-10-02T18:00:00.000Z'), confirmaSemPergunta],
    criterios: [
      'A abertura reconhece o pedido de orçamento para cerca de 45 colaboradores e não pergunta quantas pessoas vão usar',
      'A IA não inventa valor de implantação e conduz para a reunião como o caminho para a proposta',
      'Quando ele conta que cada vendedor responde no próprio celular, a IA mostra em uma frase como o Kommo resolve isso',
    ],
  },
  {
    // Real: só o Comment (lead 20773571 nunca respondeu); a conversa é inventada
    id: 'real-alexandre-plano-pro',
    porta: 'indicacao', nomeContato: 'Alexandre', abertura: true, agora: '2026-10-01T23:00:00Z', state: ctx('E-commerce'),
    comentario: 'CONTRATAR PLANO PRO',
    msgs: ['quanto fica o pro?', 'só a licença mesmo, somos 5 usuários', 'fechado, como faço pra contratar?'],
    checks: [...BASE, naoMarcou, { nome: 'finalizou como venda de licença', fn: (w: any) => w.state.finalizado?.motivo === 'venda_licenca' }],
    criterios: [
      'A abertura trata o pedido do plano Pro (licença) e não abre com a lista "perder lead, etapa ou relatório"',
      'Quando ele pergunta quanto fica o Pro, a IA informa em reais (R$ 234 por usuário/mês, contrato de 6 meses)',
      'Com 5 usuários e só a licença, a IA não força reunião de implantação e encaminha a compra',
    ],
  },
  {
    // Inventado a partir do Comment real (lead 20768321 nunca respondeu)
    id: 'real-valter-estruturacao-crm',
    porta: 'indicacao', nomeContato: 'Valter', abertura: true, agora: '2026-10-02T13:30:00Z', state: ctx('E-commerce'),
    comentario: 'Implementação e estruturação do CRM',
    msgs: [
      'Oi Lara, desculpa a demora. Hoje a gente usa só WhatsApp e uma planilha, somos 4 vendedores',
      'O pior é orçamento que a gente manda e ninguém retorna',
      'Fazemos tráfego no Meta sim, chegam uns 25 leads por dia',
      'Quero sim, segunda à tarde',
      '15h',
    ],
    checks: [...BASE, marcou('2026-10-05T18:00:00.000Z'), confirmaSemPergunta],
    criterios: [
      'A abertura não termina com a lista pronta "perder lead, etapa ou relatório"',
      'Quando ele conta o problema (orçamento sem retorno), a IA mostra como a organização e a cadência de follow-up resolvem isso, sem perguntar de novo o que ele já contou',
      'Quando ele conta o volume (25 leads por dia), a IA usa isso para tocar na dor (organização e cadência de follow-up) e liga ao convite para a análise com o especialista, sem agir como se ele já tivesse aceitado',
    ],
  },
  {
    // Inventado a partir do Comment real (lead 20772787 nunca respondeu)
    id: 'real-inaluar-gatilhos-clinica',
    porta: 'indicacao', nomeContato: 'Inaluar', abertura: true, agora: '2026-10-02T14:00:00Z', state: ctx('Saúde, estética e bem-estar'),
    comentario: 'Quero que me ajude a automatizar o sistema, pois estou com dificuldades de fazer os gatilhos e automação',
    msgs: [
      'Oi! Tenho uma clínica de estética, já uso o Kommo mas não consigo fazer os gatilhos funcionarem',
      'Queria que disparasse a confirmação do agendamento e um lembrete no dia anterior',
      'Quanto vocês cobram pra fazer isso?',
      'Ok, pode ser terça de manhã',
      '11h',
    ],
    checks: [...BASE, semPrecoServico, marcou('2026-10-06T14:00:00.000Z'), confirmaSemPergunta],
    criterios: [
      'A IA acolhe a dificuldade com os gatilhos e não manda para o suporte da Kommo',
      'A IA não ensina a configurar os gatilhos pelo chat: mostra que dá para resolver e oferece a análise focada nessas automações',
      'Na pergunta de preço, a IA não inventa valor e mantém a reunião como o caminho para a proposta',
    ],
  },
  {
    // Real (lead 20779827, 05/10): respondeu "2" para o 2º horário e a reunião não foi marcada
    id: 'real-camila-escolhe-numero',
    porta: 'indicacao', nomeContato: 'Camila', abertura: true, agora: '2026-10-05T14:11:00Z', state: ctx('Saúde, estética e bem-estar'),
    comentario: 'CRM, demonstracão da plataforma',
    msgs: ['Bom dia, tudo bem?\nNós estamos começando do zero', '3 pessoas', 'Sim', '2'],
    checks: [...BASE, { nome: 'marcou a reunião no 2º horário oferecido', fn: (w: any) => w.reunioes.length === 1 && w.state.finalizado?.motivo === 'agendado' }, confirmaSemPergunta],
    criterios: [
      'Quando ela responde "2", a IA marca o segundo horário e confirma o dia e a hora',
      'A confirmação diz que o link vai pelo chat (nunca por e-mail)',
    ],
  },
  {
    // Inventado a partir do Comment real (lead 20772777 nunca respondeu)
    id: 'real-alan-quer-vendedor',
    porta: 'indicacao', nomeContato: 'Alan', abertura: true, agora: '2026-10-02T13:10:00Z', state: ctx('Tecnologia / software'),
    comentario: 'Gostaria de conversar com um vendedor',
    msgs: [
      'Oi, quero entender os planos e se vocês fazem a implantação',
      'Somos uma software house, 6 vendedores, hoje usamos o Pipedrive mas queremos o WhatsApp integrado',
      'Pode ser segunda às 10h',
    ],
    checks: [...BASE, semPrecoServico, marcou('2026-10-05T13:00:00.000Z'), confirmaSemPergunta],
    criterios: [
      'A IA responde sobre os planos (pode citar em reais) e confirma que a Control Gestão faz a implantação',
      'Quando ele conta que usa o Pipedrive e quer o WhatsApp integrado, a IA liga isso ao que o Kommo resolve e convida para a reunião, que é a conversa com o especialista que ele pediu',
    ],
  },
]
