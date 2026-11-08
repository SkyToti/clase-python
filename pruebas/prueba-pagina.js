window.__errores = [];
window.addEventListener('error', (e) => window.__errores.push(e.message));
window.addEventListener('unhandledrejection', (e) => window.__errores.push('promesa: ' + e.reason));
window.addEventListener('load', async () => {
  const P = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = [];
  const q = (s) => document.querySelector(s);
  try {
    // 1. editor hola: correr
    q('[data-editor="e-hola"] [data-a="correr"]').click(); await P(150);
    out.push('hola: ' + q('[data-editor="e-hola"] .ed-consola').textContent);
    // 2. reto print con solución
    const ta = q('#ta-e-reto-print'); ta.value = 'print("Me llamo Ana")\nprint("Pozole")'; ta.dispatchEvent(new Event('input'));
    q('[data-editor="e-reto-print"] [data-a="revisar"]').click(); await P(50);
    out.push('reto print: ' + q('[data-editor="e-reto-print"] .ed-reto-res').textContent);
    // 3. paso a paso de cajas
    q('[data-editor="e-cajas"] [data-a="pasos"]').click(); await P(100);
    for (let i = 0; i < 3; i++) { q('[data-editor="e-cajas"] [data-a="sig"]').click(); await P(80); }
    out.push('cajas paso: ' + q('[data-editor="e-cajas"] .cuenta').textContent + ' | ' + q('[data-editor="e-cajas"] .cajas').textContent);
    q('[data-editor="e-cajas"] [data-a="resto"]').click(); await P(150);
    out.push('cajas fin: ' + q('[data-editor="e-cajas"] .ed-consola').textContent);
    // 4. reto año: original debe fallar, solución debe pasar
    q('[data-editor="e-reto-anio"] [data-a="correr"]').click(); await P(100);
    const f = q('[data-editor="e-reto-anio"] .ed-consola form input'); f.value = '20';
    q('[data-editor="e-reto-anio"] .ed-consola form button').click(); await P(150);
    out.push('anio error: ' + q('[data-editor="e-reto-anio"] .ed-error').textContent);
    q('[data-editor="e-reto-anio"] [data-a="revisar"]').click(); await P(50);
    out.push('anio revisar original: ' + q('[data-editor="e-reto-anio"] .ed-reto-res').textContent);
    // 5. clima paso a paso con input
    q('[data-editor="e-clima"] [data-a="pasos"]').click(); await P(100);
    q('[data-editor="e-clima"] [data-a="sig"]').click(); await P(100);
    const fi = q('[data-editor="e-clima"] .ed-consola form input'); fi.value = '25'; q('[data-editor="e-clima"] .ed-consola form button').click(); await P(100);
    q('[data-editor="e-clima"] [data-a="sig"]').click(); await P(80);
    q('[data-editor="e-clima"] [data-a="sig"]').click(); await P(80);
    out.push('clima decision: ' + [...document.querySelectorAll('[data-editor="e-clima"] .dec')].map((d) => d.parentNode.dataset.n + d.textContent).join(',') + ' | ' + q('[data-editor="e-clima"] .cuenta').textContent);
    // 6. semáforo solución
    const ts = q('#ta-e-reto-semaforo'); ts.value = 'color = input("¿De qué color está el semáforo? ")\nif color == "rojo":\n    print("Alto")\nelif color == "amarillo":\n    print("Precaución")\nelse:\n    print("Avanza")'; 
    q('[data-editor="e-reto-semaforo"] [data-a="revisar"]').click(); await P(50);
    out.push('semaforo: ' + q('[data-editor="e-reto-semaforo"] .ed-reto-res').textContent);
    // 7. tabla con pistas y solución
    q('[data-editor="e-reto-tabla"] [data-a="pista"]').click(); q('[data-editor="e-reto-tabla"] [data-a="pista"]').click();
    q('[data-editor="e-reto-tabla"] [data-a="solucion"]').click();
    q('[data-editor="e-reto-tabla"] [data-a="revisar"]').click(); await P(50);
    out.push('tabla: ' + q('[data-editor="e-reto-tabla"] .ed-reto-res').textContent);
    // 8. cuenta con 75 a mano debe fallar
    const tc = q('#ta-e-reto-cuenta'); tc.value = 'precio = 25\ncantidad = 3\ntotal = 75\nprint("Total a pagar:", total)';
    q('[data-editor="e-reto-cuenta"] [data-a="revisar"]').click(); await P(50);
    out.push('cuenta a mano: ' + q('[data-editor="e-reto-cuenta"] .ed-reto-res').textContent);
    tc.value = 'precio = 25\ncantidad = 3\ntotal = precio * cantidad\nprint("Total a pagar:", total)';
    q('[data-editor="e-reto-cuenta"] [data-a="revisar"]').click(); await P(50);
    out.push('cuenta bien: ' + q('[data-editor="e-reto-cuenta"] .ed-reto-res').textContent);
    // 9. robot nivel 1
    for (let i = 0; i < 3; i++) q('[data-orden="avanza"]').click();
    q('#robot-correr').click(); await P(1800);
    out.push('robot: ' + q('#robot-msg').textContent);
    // 10. parsons en orden correcto
    for (let i = 0; i < 7; i++) { q(`#pz-sueltas [data-i="${i}"]`).click(); }
    q('#pz-probar').click(); await P(50);
    out.push('parsons: ' + q('#pz-msg').textContent);
    // 11. quiz
    q('[data-quiz="q-copia"] [data-i="0"]').click();
    out.push('quiz: ' + q('[data-quiz="q-copia"] .quiz-exp').textContent);
    // 12. error amigable
    const tl = q('#ta-e-lab'); tl.value = 'Print("hola")'; q('[data-editor="e-lab"] [data-a="correr"]').click(); await P(80);
    out.push('lab error: ' + q('[data-editor="e-lab"] .ed-error').textContent);
    tl.value = 'x = 0\nwhile x < 10:\n    print(x)'; q('[data-editor="e-lab"] [data-a="correr"]').click(); await P(2500);
    out.push('lab infinito: ' + q('[data-editor="e-lab"] .ed-error').textContent.slice(0, 120));
    out.push('stickers: ' + q('#estrellas-txt').textContent);
  } catch (e) { out.push('EXCEPCION ' + e.message + ' ' + e.stack); }
  out.push('ERRORES: ' + JSON.stringify(window.__errores));
  const pre = document.createElement('pre'); pre.id = 'RESULTADO'; pre.textContent = out.join('\n'); document.body.append(pre);
});
