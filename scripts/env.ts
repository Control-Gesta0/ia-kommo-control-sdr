import fs from 'node:fs'
import path from 'node:path'

/** Carrega .env.local (e .env) para os scripts locais, sem sobrescrever o ambiente. */
export function loadEnv(): void {
  for (const nome of ['.env.local', '.env']) {
    const file = path.join(process.cwd(), nome)
    if (!fs.existsSync(file)) continue
    for (const linha of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
      const i = linha.indexOf('=')
      if (i <= 0 || linha.trim().startsWith('#')) continue
      const key = linha.slice(0, i).trim()
      const val = linha.slice(i + 1).replace(/\s+#.*$/, '').trim().replace(/^"|"$/g, '')
      if (!process.env[key]) process.env[key] = val
    }
  }
}
