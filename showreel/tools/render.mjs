// Render quadro a quadro: sobe um servidor local, abre a página no Chromium headless,
// posiciona o tempo exato de cada quadro e salva JPEG. Vários navegadores em paralelo.
// Uso:
//   node tools/render.mjs --fmt v --fps 60 --scale 1 --workers 4 --out ../out/v60
//   node tools/render.mjs --fmt v --stills 0.5,1.2,3.4 --scale 0.5 --out ../out/stills
//   node tools/render.mjs --fmt v --cues ../out/cues.json
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const fmt = args.fmt === 'h' ? 'h' : 'v';
const fps = +(args.fps || 30);
const scale = +(args.scale || 1);
const workers = +(args.workers || 4);
const q = +(args.q || 92);
const t0 = +(args.t0 || 0);
const t1 = +(args.t1 || 43);
const out = args.out ? path.resolve(args.out) : null;
const [W, H] = fmt === 'h' ? [1920, 1080] : [1080, 1920];

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.mp4': 'video/mp4', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'max-age=3600' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/index.html?fmt=${fmt}`;

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: scale });
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.error('[console]', m.text()); });
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  return page;
}
const launch = () => chromium.launch({ args: ['--disable-gpu-vsync', '--disable-lcd-text', '--font-render-hinting=none', '--force-color-profile=srgb'] });

if (out) fs.mkdirSync(out, { recursive: true });

if (args.cues) {
  const b = await launch(); const page = await openPage(b);
  const cues = await page.evaluate(() => window.__cues);
  fs.writeFileSync(path.resolve(args.cues), JSON.stringify(cues.sort((a, b) => a.t - b.t), null, 1));
  console.log('cues:', cues.length);
  await b.close(); server.close(); process.exit(0);
}

if (args.stills) {
  const times = String(args.stills).split(',').map(Number);
  const b = await launch(); const page = await openPage(b);
  for (const t of times) {
    await page.evaluate(tt => window.__seek(tt), t);
    const file = path.join(out, `still_${fmt}_${t.toFixed(2).padStart(6, '0')}.png`);
    await page.screenshot({ path: file, type: 'png' });
  }
  console.log('stills:', times.length, '→', out);
  await b.close(); server.close(); process.exit(0);
}

// Motion blur: cada quadro final é a média de `sub` subquadros espalhados por `shutter` do intervalo
// (0.5 = obturador de 180°). O índice j = quadro*sub + k.
const sub = +(args.sub || 1);
const shutter = +(args.shutter || 0.5);
const timeOf = j => t0 + Math.floor(j / sub) / fps + (sub > 1 ? (j % sub) / sub * shutter / fps : 0);
const N = Math.round((t1 - t0) * fps) * sub;
const per = Math.ceil(N / workers);
const useCdp = !!args.cdp;
const tStart = Date.now();
let done = 0;
await Promise.all(Array.from({ length: workers }, async (_, w) => {
  const a = w * per, z = Math.min(N, a + per);
  if (a >= z) return;
  const b = await launch(); const page = await openPage(b);
  const cdp = useCdp ? await page.context().newCDPSession(page) : null;
  for (let i = a; i < z; i++) {
    const t = timeOf(i);
    const file = path.join(out, `f_${String(i).padStart(5, '0')}.jpg`);
    if (cdp) {
      await page.evaluate(tt => new Promise(r => { window.__seek(tt); requestAnimationFrame(() => requestAnimationFrame(r)); }), t);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: q, optimizeForSpeed: true });
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
    } else {
      await page.evaluate(tt => window.__seek(tt), t);
      await page.screenshot({ path: file, type: 'jpeg', quality: q });
    }
    done++;
    if (done % 100 === 0) {
      const el = (Date.now() - tStart) / 1000;
      console.log(`${done}/${N} quadros · ${(el / done * 1000).toFixed(0)} ms/quadro (efetivo) · faltam ~${Math.round(el / done * (N - done))} s`);
    }
  }
  await b.close();
}));
console.log(`ok: ${N} quadros em ${((Date.now() - tStart) / 1000).toFixed(1)} s → ${out}`);
server.close();
