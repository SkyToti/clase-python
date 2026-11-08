# Clase 1 de programación (Python)

Clase interactiva de 60 minutos para alguien que nunca ha programado.

- `clase.src.html`: la página (texto, estilos y lógica).
- `mini-python.js`: el intérprete de Python propio. El sandbox del Artifact no deja correr Python real
  (sin WebAssembly ni fetch), así que la página trae el suyo, con errores en español y modo paso a paso.
- `node armar.mjs` junta las dos piezas en `clase.html`, que es lo que se publica.

## Pruebas

- `node pruebas/comparar.mjs`: 83 programas contra `python3` real (los 2 distintos son esperados:
  uno sin entradas y otro que Python 3.14 acepta por `-c`).
- `node pruebas/comparar.mjs ./casos-clase.mjs`: todos los programas que salen en la clase (24 de 24).
- `node pruebas/cdp.mjs pruebas/salida/prueba.html 16000`: abre la página en Chrome sin ventana y
  hace clic en todo (retos, paso a paso, robot, rompecabezas). La salida de la prueba se arma con el
  bloque de `node -e` que hay en el historial de la sesión: cabecera + `prueba-pagina.js` + `clase.html`.

Publicada en GitHub Pages: https://skytoti.github.io/clase-python/ (y como Artifact privado).
`node armar.mjs` genera `index.html`, que es lo que sirve Pages: hay que rearmar antes de cada commit.
