// Corre cada caso en Python 3 de verdad y en Mini-Python, y compara la salida.
// Uso: node pruebas/comparar.mjs [archivo-de-casos.mjs]
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const MiniPy = require('../mini-python.js');

const archivo = process.argv[2] || './casos.mjs';
const { casos } = await import(path.resolve(path.dirname(new URL(import.meta.url).pathname), archivo));

let bien = 0, mal = 0;
for (const [i, c] of casos.entries()) {
  const codigo = typeof c === 'string' ? c : c.codigo;
  const entradas = c.entradas || [];
  const py = spawnSync('python3', ['-I', '-c', codigo], { input: entradas.join('\n') + '\n', encoding: 'utf8' });
  const esperado = py.stdout + (py.status !== 0 ? `<<ERROR ${(py.stderr.trim().split('\n').pop() || '').split(':')[0]}>>` : '');
  const r = MiniPy.correrSincrono(codigo, { entradas, eco: false });
  const obtenido = r.salida + (r.error ? `<<ERROR ${r.error.tipo}>>` : '');
  if (esperado === obtenido) bien++;
  else {
    mal++;
    console.log(`\n✗ caso ${i}: ${(c.nombre || codigo.split('\n')[0]).slice(0, 70)}`);
    console.log('  Python :', JSON.stringify(esperado));
    console.log('  Mini   :', JSON.stringify(obtenido));
    if (r.error) console.log('  Mensaje:', r.error.linea, r.error.message, '|', r.error.pista);
  }
}
console.log(`\n${bien} iguales, ${mal} distintos (de ${casos.length})`);
process.exitCode = mal ? 1 : 0;
