/** Transcreve um link de mídia como a Lara faria: `npx tsx scripts/testar-midia.ts <link>` */
import { loadEnv } from './env'
loadEnv()

const link = process.argv[2]
if (!link) throw new Error('uso: npx tsx scripts/testar-midia.ts <link>')
import('../lib/media').then(({ mediaToText, tipoPeloLink }) => mediaToText(tipoPeloLink(link) || 'audio', link, '')).then(t => console.log(t))
