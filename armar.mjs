// Junta la página con el intérprete:
//   clase.html -> lo que se publica como Artifact (el Artifact le pone su propio <head>)
//   index.html -> documento completo para GitHub Pages
import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync(new URL('./clase.src.html', import.meta.url), 'utf8');
const py = readFileSync(new URL('./mini-python.js', import.meta.url), 'utf8');
const cuerpo = src.replace('/*__MINIPY__*/', () => py);
writeFileSync(new URL('./clase.html', import.meta.url), cuerpo);
const cabeza = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Clase interactiva de Python de 60 minutos para quien nunca ha programado: robot, variables paso a paso, retos que se revisan solos y un juego final.">
<meta name="theme-color" content="#f7f1e3">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><rect x='3' y='3' width='34' height='34' rx='9' fill='%232f6fed'/><path d='M12 15l6 5-6 5' fill='none' stroke='white' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'/><path d='M21 26h8' stroke='%23f7c33f' stroke-width='3.2' stroke-linecap='round'/></svg>">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}[hidden]{display:none!important}</style>
</head>
<body>
`;
writeFileSync(new URL('./index.html', import.meta.url), cabeza + cuerpo + '\n</body>\n</html>\n');
console.log('clase.html e index.html', (cuerpo.length / 1024).toFixed(1), 'KB');
