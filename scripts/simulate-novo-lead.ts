/**
 * Simula o aviso do userscript no deploy: a IA inicia a conversa com o lead.
 *   npx tsx scripts/simulate-novo-lead.ts <LEAD_ID> "Comment do lead"
 * O lead precisa estar na etapa de entrada, com telefone, e (com MODO_INICIO=teste)
 * em TEST_LEAD_IDS. A abertura REAL sai pelo Salesbot para o WhatsApp do lead.
 */
import { loadEnv } from './env'

loadEnv()
const [leadId, ...rest] = process.argv.slice(2)
const url = (process.env.DEPLOY_URL || '').replace(/\/+$/, '')
const secret = process.env.INDICACAO_SECRET || ''
if (!leadId || !url || !secret) { console.error('uso: tsx scripts/simulate-novo-lead.ts <LEAD_ID> "comment"  (DEPLOY_URL e INDICACAO_SECRET no .env.local)'); process.exit(1) }
fetch(`${url}/api/novo-lead?secret=${encodeURIComponent(secret)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ leadId: Number(leadId), comentario: rest.join(' ') || null, origem: 'simulacao' }),
}).then(async r => console.log(r.status, await r.text()))
