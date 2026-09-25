/**
 * Monta userscript/kommo-indicacoes.user.js = header + filtro (fonte única, a
 * mesma que o servidor usa) + corpo. `npm run build:userscript`.
 * `npm test` falha se o .user.js commitado estiver diferente do que este build gera.
 */
import fs from 'node:fs'
import path from 'node:path'

const dir = path.join(__dirname, '..', 'userscript')
const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf-8').replace(/\r\n/g, '\n')

export function buildUserscript(): string {
  const filtro = read('filtro-indicacao.js').replace(/\nif \(typeof module[^\n]*\n?$/, '\n')
  return `${read('header.txt').trimEnd()}\n\n${filtro.trim()}\n\n${read('main.js').trim()}\n`
}

export const USERSCRIPT_PATH = path.join(dir, 'kommo-indicacoes.user.js')

if (require.main === module) {
  fs.writeFileSync(USERSCRIPT_PATH, buildUserscript())
  console.log(`gerado ${path.relative(process.cwd(), USERSCRIPT_PATH)}`)
}
