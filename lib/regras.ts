/**
 * TRAVAS DO CLIENTE (patch). O que é regra de negócio, ética ou jurídica vira
 * CÓDIGO: a resposta que casar com uma destas não sai — o modelo reescreve
 * uma vez e, se insistir, sai o texto seguro.
 *
 * Toda regra nova precisa de um caso em scripts/test-guards.ts (deve bloquear)
 * e um caso do texto aprovado do cliente (deve passar).
 */
export const REGRAS_CLIENTE: Array<{ regra: string; re: RegExp }> = [
  { regra: 'prometeu resultado', re: /\bgarant(o|imos|ido|ida)\b/i },
]
