// Abre una página en Chrome sin ventana por CDP, espera, lee #RESULTADO y toma capturas.
// Uso: node pruebas/cdp.mjs <archivo.html> <ms-espera> [ancho:alto:archivo.png:oscuro ...]
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [archivo, espera, ...capturas] = process.argv.slice(2);
const dir = mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'cdp-'));
const ch = spawn('google-chrome', ['--headless=new', `--user-data-dir=${dir}`, '--no-first-run', '--remote-debugging-port=9333', 'about:blank'], { stdio: 'ignore' });
const P = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 40; i++) { try { const l = await (await fetch('http://127.0.0.1:9333/json')).json(); const p = l.find((x) => x.type === 'page'); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch { } await P(250); }
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pend = new Map();
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } if (d.method === 'Runtime.exceptionThrown') console.log('EXCEPCIÓN:', d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') console.log('console.error:', d.params.args.map((a) => a.value || a.description).join(' ')); });
const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await cmd('Runtime.enable');
const ancho0 = capturas[0] ? +capturas[0].split(':')[0] : 1280;
await cmd('Emulation.setDeviceMetricsOverride', { width: ancho0, height: 900, deviceScaleFactor: 1, mobile: ancho0 < 500 });
await cmd('Page.enable');
await cmd('Page.navigate', { url: 'file://' + path.resolve(archivo) });
await P(+espera);
const r = await cmd('Runtime.evaluate', { expression: 'document.getElementById("RESULTADO")?.textContent || "(sin #RESULTADO)"' });
console.log(r.result.result.value);
const anchoDoc = await cmd('Runtime.evaluate', { expression: 'document.documentElement.scrollWidth + " de " + innerWidth' });
console.log('ancho del documento:', anchoDoc.result.result.value);
for (const c of capturas) {
  const [w, h, f, oscuro] = c.split(':');
  await cmd('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 500 });
  await cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: oscuro ? 'dark' : 'light' }] });
  await P(600);
  const sw = await cmd('Runtime.evaluate', { expression: 'document.documentElement.scrollWidth' });
  console.log(`captura ${f}: scrollWidth ${sw.result.result.value} (ventana ${w})`);
  const s = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: +w, height: +h, scale: 1 } });
  writeFileSync(f, Buffer.from(s.result.data, 'base64'));
}
ch.kill();
process.exit(0);
