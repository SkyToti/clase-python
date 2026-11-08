/* ============================================================
   Mini-Python: un intérprete pequeño de Python escrito en JS.
   - Sin eval ni WebAssembly: corre dentro del sandbox del Artifact.
   - Ejecuta con generadores: se puede pausar en cada renglón
     (modo paso a paso) y esperar un input() del usuario.
   - Los errores salen en español y para alguien que nunca ha
     programado.
   Enteros = BigInt (como Python: 2**100 sale exacto),
   decimales = number, bool = boolean, None = null, listas = Array.
   ============================================================ */
const MiniPy = (() => {
  'use strict';

  class PyError extends Error {
    constructor(tipo, linea, mensaje, pista) {
      super(mensaje);
      this.tipo = tipo; this.linea = linea; this.pista = pista || '';
    }
  }
  class Romper { }
  class Seguir { }
  const ROMPER = new Romper(), SEGUIR = new Seguir();

  const PALABRAS = new Set(['if', 'elif', 'else', 'while', 'for', 'in', 'and', 'or', 'not', 'True', 'False', 'None',
    'break', 'continue', 'pass', 'import', 'from', 'def', 'return', 'is', 'lambda', 'class', 'try', 'except', 'as', 'with', 'global']);

  const ESPANOL = {
    imprimir: 'print', escribir: 'print', mostrar: 'print', imprime: 'print', leer: 'input', entrada: 'input',
    pedir: 'input', si: 'if', sino: 'else', mientras: 'while', para: 'for', verdadero: 'True', falso: 'False',
    entero: 'int', texto: 'str', largo: 'len', longitud: 'len', rango: 'range'
  };

  /* ---------------- Tokenizador ---------------- */
  function tokenizar(src) {
    src = src.replace(/\r\n?/g, '\n')
      .replace(/[“”„«»]/g, '"')
      .replace(/[‘’‚]/g, "'")
      .replace(/ /g, ' ');
    if (!src.endsWith('\n')) src += '\n';
    const toks = [];
    const sangrias = [0];
    const abiertos = [];
    let i = 0, linea = 1, inicio = true;
    const push = (t, v, extra) => toks.push(Object.assign({ t, v, linea }, extra));

    while (i < src.length) {
      if (inicio && abiertos.length === 0) {
        let n = 0, j = i, hayTab = false;
        while (j < src.length && (src[j] === ' ' || src[j] === '\t')) { if (src[j] === '\t') { n += 4; hayTab = true; } else n++; j++; }
        if (j >= src.length) break;
        if (src[j] === '\n' || src[j] === '#') {
          while (j < src.length && src[j] !== '\n') j++;
          i = j + 1; linea++; continue;
        }
        const tope = sangrias[sangrias.length - 1];
        if (n > tope) { sangrias.push(n); push('INDENT'); }
        else if (n < tope) {
          while (n < sangrias[sangrias.length - 1]) { sangrias.pop(); push('DEDENT'); }
          if (n !== sangrias[sangrias.length - 1])
            throw new PyError('IndentationError', linea,
              'La sangría (los espacios al inicio) de este renglón no coincide con ningún bloque de arriba.',
              'Alinéalo exactamente con el renglón con el que debe ir: mismos espacios. Lo normal es usar 4.');
        }
        i = j; inicio = false; continue;
      }
      const c = src[i];
      if (c === '\n') {
        if (abiertos.length === 0) { push('NL'); inicio = true; }
        linea++; i++; continue;
      }
      if (c === ' ' || c === '\t') { i++; continue; }
      if (c === '#') { while (src[i] !== '\n') i++; continue; }
      if (c === '\\' && src[i + 1] === '\n') { i += 2; linea++; continue; }

      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1]))) {
        const m = /^(?:\d[\d_]*)?(?:\.\d[\d_]*|\.)?(?:[eE][+-]?\d+)?/.exec(src.slice(i));
        let txt = m[0];
        if (txt === '.' ) { push('OP', '.'); i++; continue; }
        const limpio = txt.replace(/_/g, '');
        if (/[.eE]/.test(limpio)) push('NUM', parseFloat(limpio));
        else push('NUM', BigInt(limpio));
        i += txt.length;
        if (/[\p{L}_]/u.test(src[i] || ''))
          throw new PyError('SyntaxError', linea, 'Un nombre de variable no puede empezar con un número.',
            'Pon primero letras: por ejemplo «edad2» en vez de «2edad».');
        continue;
      }

      if (/[\p{L}_]/u.test(c)) {
        let j = i;
        while (j < src.length && /[\p{L}\p{N}_]/u.test(src[j])) j++;
        const nombre = src.slice(i, j);
        if ((nombre === 'f' || nombre === 'F') && (src[j] === '"' || src[j] === "'")) {
          i = j; const s = leerTexto(); push('FSTR', s.v); continue;
        }
        i = j;
        if (PALABRAS.has(nombre)) push('KW', nombre); else push('NAME', nombre);
        continue;
      }

      if (c === '"' || c === "'") { const s = leerTexto(); push('STR', s.v); continue; }

      const dos = src.substr(i, 2), tres = src.substr(i, 3);
      if (['**=', '//='].includes(tres)) { push('OP', tres); i += 3; continue; }
      if (['**', '//', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%='].includes(dos)) { push('OP', dos); i += 2; continue; }
      if ('+-*/%<>=()[]{},:.;'.includes(c)) {
        if ('([{'.includes(c)) abiertos.push({ c, linea });
        if (')]}'.includes(c)) {
          const par = { ')': '(', ']': '[', '}': '{' }[c];
          const top = abiertos.pop();
          if (!top) throw new PyError('SyntaxError', linea, `Sobra un «${c}»: no hay ningún «${par}» abierto antes.`, 'Borra ese símbolo o abre el que falta.');
          if (top.c !== par) throw new PyError('SyntaxError', linea, `Abriste «${top.c}» y lo cerraste con «${c}».`, 'Los paréntesis ( ) y los corchetes [ ] se cierran con su pareja.');
        }
        push('OP', c); i++; continue;
      }
      if (c === '!') throw new PyError('SyntaxError', linea, 'En Python el «!» solo va en «!=» (diferente de).', 'Para negar algo se usa la palabra «not».');
      if (c === '&' || c === '|') throw new PyError('SyntaxError', linea, `En Python no se usa «${c}${c}». Se escribe con palabras: «and» y «or».`);
      throw new PyError('SyntaxError', linea, `No entiendo el símbolo «${c}».`, 'Bórralo o revisa que esté escrito igual que en el ejemplo.');
    }
    if (abiertos.length) {
      const a = abiertos[abiertos.length - 1];
      const cierra = { '(': ')', '[': ']', '{': '}' }[a.c];
      throw new PyError('SyntaxError', a.linea, `Abriste un «${a.c}» en este renglón y nunca lo cerraste.`, `Agrega el «${cierra}» que falta al final.`);
    }
    if (toks.length && toks[toks.length - 1].t !== 'NL') push('NL');
    while (sangrias.length > 1) { sangrias.pop(); push('DEDENT'); }
    push('EOF');
    return toks;

    function leerTexto() {
      let q = src[i];
      let triple = src.substr(i, 3) === q + q + q;
      const lineaIni = linea;
      i += triple ? 3 : 1;
      let v = '';
      while (true) {
        if (i >= src.length) throw new PyError('SyntaxError', lineaIni, 'Abriste comillas y nunca las cerraste.', `Pon otra ${q} al final del texto.`);
        const ch = src[i];
        if (!triple && ch === '\n') throw new PyError('SyntaxError', lineaIni, 'Abriste comillas y no las cerraste en este renglón.', `El texto tiene que terminar con la misma comilla con que empezó: ${q}`);
        if (triple && src.substr(i, 3) === q + q + q) { i += 3; break; }
        if (!triple && ch === q) { i++; break; }
        if (ch === '\\') {
          const n = src[i + 1];
          const mapa = { n: '\n', t: '\t', '\\': '\\', "'": "'", '"': '"', '\n': '' };
          if (n in mapa) { v += mapa[n]; if (n === '\n') linea++; i += 2; continue; }
          v += ch; i++; continue;
        }
        if (ch === '\n') linea++;
        v += ch; i++;
      }
      return { v };
    }
  }

  /* ---------------- Parser ---------------- */
  function analizar(src) {
    const toks = tokenizar(src);
    let p = 0;
    const ver = () => toks[p];
    const sig = () => toks[p++];
    const es = (t, v) => { const k = toks[p]; return k.t === t && (v === undefined || k.v === v); };
    const describe = (k) => k.t === 'NL' || k.t === 'EOF' ? 'el final del renglón' : k.t === 'INDENT' ? 'una sangría' :
      k.t === 'STR' ? 'un texto' : k.t === 'NUM' ? 'un número' : `«${k.v}»`;
    const err = (linea, msg, pista) => new PyError('SyntaxError', linea, msg, pista);

    function programa() {
      const cuerpo = [];
      while (!es('EOF')) {
        if (es('NL')) { sig(); continue; }
        if (es('DEDENT')) { sig(); continue; }
        cuerpo.push(sentencia());
      }
      return cuerpo;
    }
    function bloque(lineaCab, kw) {
      if (!es('NL')) { const s = simple(); finRenglon(); return [s]; }
      sig();
      while (es('NL')) sig();
      if (!es('INDENT')) throw new PyError('IndentationError', ver().t === 'EOF' ? lineaCab : ver().linea,
        `Después de los dos puntos «:» del ${kw} (renglón ${lineaCab}) tiene que venir un renglón con sangría.`,
        'Mueve ese renglón 4 espacios a la derecha: así Python sabe que está «dentro» del ' + kw + '.');
      sig();
      const cuerpo = [];
      while (!es('DEDENT') && !es('EOF')) {
        if (es('NL')) { sig(); continue; }
        cuerpo.push(sentencia());
      }
      if (es('DEDENT')) sig();
      return cuerpo;
    }
    function dosPuntos(kw, linea) {
      if (es('OP', '=')) throw err(linea, 'Para comparar se usan dos iguales: «==».', 'Un solo «=» sirve para guardar un valor en una variable.');
      if (!es('OP', ':')) throw err(linea, `Al ${kw} le faltan los dos puntos «:» al final del renglón.`, `Ejemplo: ${kw === 'else' ? 'else:' : kw + ' ... :'}`);
      sig();
    }
    function finRenglon() {
      if (es('OP', ';')) { sig(); }
      if (es('EOF')) return;
      if (!es('NL')) {
        const k = ver();
        throw err(k.linea, `No esperaba ${describe(k)} aquí.`, '¿Te faltó una coma, un operador (+, -) o cerrar algo?');
      }
      sig();
    }
    function sentencia() {
      const k = ver();
      if (k.t === 'INDENT') throw new PyError('IndentationError', k.linea, 'Este renglón tiene sangría (espacios al inicio) y no debería.',
        'Solo llevan sangría los renglones que van dentro de un if, for o while. Quítale los espacios del inicio.');
      if (k.t === 'KW') {
        if (k.v === 'if') return siStmt();
        if (k.v === 'while') {
          const l = sig().linea; const cond = expr(); dosPuntos('while', l);
          return { k: 'while', linea: l, cond, cuerpo: bloque(l, 'while') };
        }
        if (k.v === 'for') {
          const l = sig().linea;
          if (!es('NAME')) throw err(l, 'Después de «for» va el nombre de una variable.', 'Ejemplo: for i in range(5):');
          const nombre = sig().v;
          if (!es('KW', 'in')) throw err(l, 'Al for le falta la palabra «in».', 'Ejemplo: for i in range(5):');
          sig();
          const iter = expr(); dosPuntos('for', l);
          return { k: 'for', linea: l, nombre, iter, cuerpo: bloque(l, 'for') };
        }
        if (k.v === 'elif' || k.v === 'else') throw err(k.linea, `Este «${k.v}» no tiene un if arriba con la misma sangría.`,
          `El ${k.v} tiene que ir alineado exactamente con su if.`);
        if (k.v === 'def' || k.v === 'class' || k.v === 'return' || k.v === 'try' || k.v === 'lambda')
          throw err(k.linea, `«${k.v}» es Python de verdad, pero en esta clase todavía no lo usamos.`, 'Eso queda para la siguiente clase.');
      }
      const s = simple(); finRenglon(); return s;
    }
    function siStmt() {
      const l = sig().linea; const cond = expr(); dosPuntos('if', l);
      const pruebas = [{ cond, cuerpo: bloque(l, 'if'), linea: l }];
      let sino = null, lineaSino = 0;
      while (es('KW', 'elif')) {
        const le = sig().linea; const c = expr(); dosPuntos('elif', le);
        pruebas.push({ cond: c, cuerpo: bloque(le, 'elif'), linea: le });
      }
      if (es('KW', 'else')) { lineaSino = sig().linea; dosPuntos('else', lineaSino); sino = bloque(lineaSino, 'else'); }
      return { k: 'if', linea: l, pruebas, sino, lineaSino };
    }
    function simple() {
      const k = ver();
      if (k.t === 'KW' && k.v === 'pass') { sig(); return { k: 'pass', linea: k.linea }; }
      if (k.t === 'KW' && k.v === 'break') { sig(); return { k: 'break', linea: k.linea }; }
      if (k.t === 'KW' && k.v === 'continue') { sig(); return { k: 'continue', linea: k.linea }; }
      if (k.t === 'KW' && k.v === 'import') {
        sig(); const mods = [];
        do { if (!es('NAME')) throw err(k.linea, 'Después de import va el nombre de un módulo.', 'Ejemplo: import random'); mods.push(sig().v); } while (es('OP', ',') && sig());
        return { k: 'import', linea: k.linea, mods };
      }
      if (k.t === 'KW' && k.v === 'from') {
        sig(); if (!es('NAME')) throw err(k.linea, 'Después de from va el nombre de un módulo.');
        const mod = sig().v;
        if (!es('KW', 'import')) throw err(k.linea, 'Falta la palabra import.', 'Ejemplo: from random import randint');
        sig(); const nombres = [];
        do { if (!es('NAME')) throw err(k.linea, 'Falta qué importar.'); nombres.push(sig().v); } while (es('OP', ',') && sig());
        return { k: 'from', linea: k.linea, mod, nombres };
      }
      const izq = expr();
      if (es('OP', '=')) {
        const l = sig().linea;
        if (izq.k !== 'nombre' && izq.k !== 'indice')
          throw err(l, 'Del lado izquierdo del «=» va el nombre de una variable.',
            izq.k === 'num' || izq.k === 'str' ? 'Se escribe al revés: primero el nombre y luego el valor, por ejemplo: edad = 20' : 'Ejemplo: nombre = "Ana"');
        if (es('NL') || es('EOF')) throw err(l, 'Después del «=» falta el valor que quieres guardar.');
        const valor = expr();
        if (es('OP', '=')) throw err(l, 'Hay dos «=» en el mismo renglón.', 'Si querías comparar, eso va dentro de un if y con «==».');
        return { k: 'asigna', linea: l, objetivo: izq, valor };
      }
      if (ver().t === 'OP' && ['+=', '-=', '*=', '/=', '//=', '%=', '**='].includes(ver().v)) {
        const op = sig();
        if (izq.k !== 'nombre' && izq.k !== 'indice') throw err(op.linea, `Antes de «${op.v}» va el nombre de una variable.`);
        return { k: 'aumenta', linea: op.linea, objetivo: izq, op: op.v.slice(0, -1), valor: expr() };
      }
      if (izq.k === 'nombre' && (es('STR') || es('NAME') || es('NUM') || es('FSTR')))
        throw err(ver().linea, `Después de «${izq.n}» esperaba un paréntesis.`, `Se escribe así: ${izq.n}("Hola")`);
      return { k: 'expr', linea: k.linea, e: izq };
    }

    function expr() { return o(); }
    function o() {
      let a = y();
      while (es('KW', 'or')) { const l = sig().linea; a = { k: 'o', a, b: y(), linea: l }; }
      return a;
    }
    function y() {
      let a = no();
      while (es('KW', 'and')) { const l = sig().linea; a = { k: 'y', a, b: no(), linea: l }; }
      return a;
    }
    function no() {
      if (es('KW', 'not')) { const l = sig().linea; return { k: 'no', a: no(), linea: l }; }
      return comparacion();
    }
    function comparacion() {
      const primero = aritmetica();
      const ops = [], vals = [primero];
      while (true) {
        const k = ver();
        let op = null;
        if (k.t === 'OP' && ['==', '!=', '<', '>', '<=', '>='].includes(k.v)) { sig(); op = k.v; }
        else if (k.t === 'KW' && k.v === 'in') { sig(); op = 'in'; }
        else if (k.t === 'KW' && k.v === 'not' && toks[p + 1].t === 'KW' && toks[p + 1].v === 'in') { sig(); sig(); op = 'not in'; }
        else if (k.t === 'KW' && k.v === 'is') { sig(); if (es('KW', 'not')) { sig(); op = 'is not'; } else op = 'is'; }
        else break;
        ops.push(op); vals.push(aritmetica());
      }
      return ops.length ? { k: 'cmp', ops, vals, linea: primero.linea } : primero;
    }
    function aritmetica() {
      let a = termino();
      while (ver().t === 'OP' && (ver().v === '+' || ver().v === '-')) { const op = sig(); a = { k: 'bin', op: op.v, a, b: termino(), linea: op.linea }; }
      return a;
    }
    function termino() {
      let a = unario();
      while (ver().t === 'OP' && ['*', '/', '//', '%'].includes(ver().v)) { const op = sig(); a = { k: 'bin', op: op.v, a, b: unario(), linea: op.linea }; }
      return a;
    }
    function unario() {
      if (ver().t === 'OP' && (ver().v === '-' || ver().v === '+')) { const op = sig(); return { k: 'un', op: op.v, a: unario(), linea: op.linea }; }
      return potencia();
    }
    function potencia() {
      const a = postfijo();
      if (es('OP', '**')) { const op = sig(); return { k: 'bin', op: '**', a, b: unario(), linea: op.linea }; }
      return a;
    }
    function postfijo() {
      let a = atomo();
      while (true) {
        if (es('OP', '(')) {
          const l = sig().linea; const args = [], kw = {};
          while (!es('OP', ')')) {
            if (es('NAME') && toks[p + 1].t === 'OP' && toks[p + 1].v === '=') { const n = sig().v; sig(); kw[n] = expr(); }
            else args.push(expr());
            if (es('OP', ',')) { sig(); continue; }
            if (!es('OP', ')')) {
              const k = ver();
              throw err(k.linea, `Dentro de los paréntesis esperaba una coma o «)», pero encontré ${describe(k)}.`,
                k.t === 'STR' || k.t === 'NAME' || k.t === 'NUM' || k.t === 'FSTR' ? 'Si son varias cosas, sepáralas con comas: print("Hola", nombre)' : 'Revisa que cierres el paréntesis.');
            }
          }
          sig();
          a = { k: 'llamada', f: a, args, kw, linea: l };
        } else if (es('OP', '[')) {
          const l = sig().linea;
          let ini = null, fin = null, paso = null, rebanada = false;
          if (!es('OP', ':')) ini = expr();
          if (es('OP', ':')) {
            rebanada = true; sig();
            if (!es('OP', ']') && !es('OP', ':')) fin = expr();
            if (es('OP', ':')) { sig(); if (!es('OP', ']')) paso = expr(); }
          }
          if (!es('OP', ']')) throw err(l, 'Falta cerrar el corchete «]».');
          sig();
          a = rebanada ? { k: 'rebanada', obj: a, ini, fin, paso, linea: l } : { k: 'indice', obj: a, i: ini, linea: l };
        } else if (es('OP', '.')) {
          const l = sig().linea;
          if (!es('NAME')) throw err(l, 'Después del punto va el nombre de un método.', 'Ejemplo: nombre.upper()');
          a = { k: 'attr', obj: a, n: sig().v, linea: l };
        } else break;
      }
      return a;
    }
    function atomo() {
      const k = ver();
      if (k.t === 'NUM') { sig(); return { k: 'num', v: k.v, linea: k.linea }; }
      if (k.t === 'STR') {
        sig(); let v = k.v;
        while (es('STR')) v += sig().v;
        return { k: 'str', v, linea: k.linea };
      }
      if (k.t === 'FSTR') { sig(); return { k: 'fstr', partes: partirF(k.v, k.linea), linea: k.linea }; }
      if (k.t === 'NAME') { sig(); return { k: 'nombre', n: k.v, linea: k.linea }; }
      if (k.t === 'KW' && (k.v === 'True' || k.v === 'False')) { sig(); return { k: 'const', v: k.v === 'True', linea: k.linea }; }
      if (k.t === 'KW' && k.v === 'None') { sig(); return { k: 'const', v: null, linea: k.linea }; }
      if (es('OP', '(')) {
        sig(); const e = expr();
        if (es('OP', ',')) throw err(k.linea, 'Esta mini-Python no usa tuplas (valores separados por coma entre paréntesis).', 'Usa una lista con corchetes: [1, 2, 3]');
        if (!es('OP', ')')) throw err(k.linea, 'Falta cerrar el paréntesis «)».');
        sig(); return e;
      }
      if (es('OP', '[')) {
        sig(); const items = [];
        while (!es('OP', ']')) {
          items.push(expr());
          if (es('OP', ',')) { sig(); continue; }
          if (!es('OP', ']')) throw err(k.linea, 'En una lista los elementos van separados por comas.', 'Ejemplo: frutas = ["mango", "pera"]');
        }
        sig(); return { k: 'lista', items, linea: k.linea };
      }
      if (es('OP', '{')) throw err(k.linea, 'Las llaves { } (diccionarios) quedan para otra clase.', 'Por hoy usa listas con corchetes [ ].');
      if (k.t === 'NL' || k.t === 'EOF') throw err(k.linea, 'El renglón se acabó antes de tiempo: falta algo al final.', '¿Te faltó un número, un texto o una variable después del operador?');
      if (k.t === 'KW') throw err(k.linea, `«${k.v}» es una palabra reservada de Python y no puede ir aquí.`, k.v === 'in' || k.v === 'is' || k.v === 'and' || k.v === 'or' ? 'Falta algo antes de ella.' : 'Si querías una variable, ponle otro nombre.');
      throw err(k.linea, `No esperaba ${describe(k)} aquí.`);
    }
    function partirF(txt, linea) {
      const partes = [];
      let i = 0, lit = '';
      while (i < txt.length) {
        const c = txt[i];
        if (c === '{' && txt[i + 1] === '{') { lit += '{'; i += 2; continue; }
        if (c === '}' && txt[i + 1] === '}') { lit += '}'; i += 2; continue; }
        if (c === '{') {
          if (lit) { partes.push(lit); lit = ''; }
          let j = i + 1, prof = 0, comilla = null;
          while (j < txt.length) {
            const d = txt[j];
            if (comilla) { if (d === comilla) comilla = null; }
            else if (d === '"' || d === "'") comilla = d;
            else if (d === '(' || d === '[') prof++;
            else if (d === ')' || d === ']') prof--;
            else if (d === '}' && prof === 0) break;
            j++;
          }
          if (j >= txt.length) throw new PyError('SyntaxError', linea, 'En el f-string abriste una llave «{» y no la cerraste.', 'Cada {variable} lleva su llave de cierre.');
          let dentro = txt.slice(i + 1, j), formato = '';
          const dp = buscarDosPuntos(dentro);
          if (dp >= 0) { formato = dentro.slice(dp + 1); dentro = dentro.slice(0, dp); }
          if (!dentro.trim()) throw new PyError('SyntaxError', linea, 'En el f-string hay unas llaves { } vacías.', 'Adentro va el nombre de una variable: {nombre}');
          let sub;
          try { sub = analizarExpr(dentro); }
          catch (e) { if (e instanceof PyError) { e.linea = linea; } throw e; }
          partes.push({ e: sub, formato });
          i = j + 1; continue;
        }
        if (c === '}') throw new PyError('SyntaxError', linea, 'En el f-string hay una llave «}» que sobra.');
        lit += c; i++;
      }
      if (lit) partes.push(lit);
      return partes;
    }
    function buscarDosPuntos(s) {
      let prof = 0, comilla = null;
      for (let i = 0; i < s.length; i++) {
        const d = s[i];
        if (comilla) { if (d === comilla) comilla = null; continue; }
        if (d === '"' || d === "'") comilla = d;
        else if (d === '(' || d === '[') prof++;
        else if (d === ')' || d === ']') prof--;
        else if (d === ':' && prof === 0) return i;
      }
      return -1;
    }
    const cuerpo = programa();
    return cuerpo;
  }
  function analizarExpr(src) {
    const ast = analizar(src);
    if (ast.length !== 1 || ast[0].k !== 'expr') throw new PyError('SyntaxError', 1, 'Dentro de las llaves del f-string solo va una variable o una cuenta.');
    return ast[0].e;
  }

  /* ---------------- Valores ---------------- */
  class Rango { constructor(a, b, c) { this.a = a; this.b = b; this.c = c; }
    largo() { const { a, b, c } = this; if (c > 0n) return a < b ? (b - a + c - 1n) / c : 0n; return a > b ? (a - b - c - 1n) / (-c) : 0n; }
    *[Symbol.iterator]() { const { a, b, c } = this; if (c > 0n) for (let x = a; x < b; x += c) yield x; else for (let x = a; x > b; x += c) yield x; }
  }
  class Builtin { constructor(nombre, fn) { this.nombre = nombre; this.fn = fn; } }
  class Metodo { constructor(obj, nombre) { this.obj = obj; this.nombre = nombre; } }
  class Modulo { constructor(nombre, attrs) { this.nombre = nombre; this.attrs = attrs; } }
  class Tipo { constructor(nombre) { this.nombre = nombre; } }

  function tipoDe(v) {
    if (v === null) return 'NoneType';
    if (typeof v === 'bigint') return 'int';
    if (typeof v === 'number') return 'float';
    if (typeof v === 'boolean') return 'bool';
    if (typeof v === 'string') return 'str';
    if (Array.isArray(v)) return 'list';
    if (v instanceof Rango) return 'range';
    if (v instanceof Builtin || v instanceof Metodo) return 'builtin_function_or_method';
    if (v instanceof Modulo) return 'module';
    if (v instanceof Tipo) return 'type';
    return 'object';
  }
  const NOMBRE_TIPO = { int: 'número entero (int)', float: 'número decimal (float)', str: 'texto (str)', bool: 'booleano (bool)', list: 'lista (list)', NoneType: 'None', range: 'range' };
  const nt = (v) => NOMBRE_TIPO[tipoDe(v)] || tipoDe(v);

  function flotante(x) {
    if (Number.isNaN(x)) return 'nan';
    if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
    if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
    const e = Math.floor(Math.log10(Math.abs(x)));
    if (e < -4 || e >= 16) {
      let s = x.toExponential();
      s = s.replace(/e([+-])(\d)$/, 'e$10$2');
      return s;
    }
    const s = String(x);
    if (/e/.test(s)) return x.toFixed(20).replace(/0+$/, '');
    return Number.isInteger(x) ? s + '.0' : s;
  }
  function repr(v) {
    if (typeof v === 'string') {
      const q = v.includes("'") && !v.includes('"') ? '"' : "'";
      let s = v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
      if (q === "'") s = s.replace(/'/g, "\\'");
      return q + s + q;
    }
    if (Array.isArray(v)) return '[' + v.map(repr).join(', ') + ']';
    return str(v);
  }
  function str(v) {
    if (v === null) return 'None';
    if (v === true) return 'True';
    if (v === false) return 'False';
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'number') return flotante(v);
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return repr(v);
    if (v instanceof Rango) return v.c === 1n ? `range(${v.a}, ${v.b})` : `range(${v.a}, ${v.b}, ${v.c})`;
    if (v instanceof Builtin) return `<built-in function ${v.nombre}>`;
    if (v instanceof Metodo) return `<built-in method ${v.nombre}>`;
    if (v instanceof Modulo) return `<module '${v.nombre}'>`;
    if (v instanceof Tipo) return `<class '${v.nombre}'>`;
    return String(v);
  }
  function verdad(v) {
    if (v === null || v === false) return false;
    if (v === true) return true;
    if (typeof v === 'bigint') return v !== 0n;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string' || Array.isArray(v)) return v.length > 0;
    if (v instanceof Rango) return v.largo() > 0n;
    return true;
  }
  const esNum = (v) => typeof v === 'bigint' || typeof v === 'number' || typeof v === 'boolean';
  const aEntero = (v) => typeof v === 'boolean' ? (v ? 1n : 0n) : v;
  const aNum = (v) => typeof v === 'number' ? v : Number(aEntero(v));

  function igual(a, b) {
    if (esNum(a) && esNum(b)) {
      a = aEntero(a); b = aEntero(b);
      if (typeof a === 'bigint' && typeof b === 'bigint') return a === b;
      return aNum(a) === aNum(b);
    }
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => igual(x, b[i]));
    return a === b;
  }

  function binop(op, a, b, linea) {
    if (op === '+') {
      if (typeof a === 'string' && typeof b === 'string') return a + b;
      if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
      if (esNum(a) && esNum(b)) return arit(op, a, b, linea);
      if ((typeof a === 'string' && esNum(b)) || (esNum(a) && typeof b === 'string'))
        throw new PyError('TypeError', linea, `No puedo sumar ${nt(a)} con ${nt(b)}.`,
          typeof a === 'string' && typeof b === 'string' ? '' : 'Si querías pegar un número a un texto, conviértelo con str(...), o usa un f-string: f"Tienes {edad} años". Si querías sumar números y uno vino de input(), conviértelo con int(...).');
      throw new PyError('TypeError', linea, `No puedo sumar ${nt(a)} con ${nt(b)}.`);
    }
    if (op === '*') {
      if (typeof a === 'string' && esNum(b) && typeof aEntero(b) === 'bigint') return a.repeat(Math.max(0, Number(aEntero(b))));
      if (esNum(a) && typeof aEntero(a) === 'bigint' && typeof b === 'string') return b.repeat(Math.max(0, Number(aEntero(a))));
      if (Array.isArray(a) && esNum(b) && typeof aEntero(b) === 'bigint') { let r = []; for (let i = 0n; i < aEntero(b); i++) r = r.concat(a); return r; }
      if (typeof a === 'string' && typeof b === 'string') throw new PyError('TypeError', linea, 'No puedo multiplicar un texto por otro texto.', '¿Uno de los dos vino de input()? Conviértelo con int(...).');
      if (typeof a === 'string' || typeof b === 'string') throw new PyError('TypeError', linea, `No puedo multiplicar ${nt(a)} por ${nt(b)}.`, 'Un texto solo se puede multiplicar por un número entero: "ja" * 3 da "jajaja".');
    }
    if (esNum(a) && esNum(b)) return arit(op, a, b, linea);
    const signo = { '-': 'una resta', '/': 'una división', '//': 'una división', '%': 'un residuo', '**': 'una potencia', '*': 'una multiplicación' }[op] || 'esa operación';
    throw new PyError('TypeError', linea, `No puedo hacer ${signo} entre ${nt(a)} y ${nt(b)}.`,
      typeof a === 'string' || typeof b === 'string' ? 'Las cuentas son con números. Si el dato vino de input(), conviértelo con int(...) o float(...).' : '');
  }
  function arit(op, a, b, linea) {
    a = aEntero(a); b = aEntero(b);
    const enteros = typeof a === 'bigint' && typeof b === 'bigint';
    const cero = enteros ? b === 0n : aNum(b) === 0;
    if ((op === '/' || op === '//' || op === '%') && cero)
      throw new PyError('ZeroDivisionError', linea, 'No se puede dividir entre cero.', 'Revisa qué valor tiene el número de abajo de la división.');
    if (enteros) {
      switch (op) {
        case '+': return a + b; case '-': return a - b; case '*': return a * b;
        case '/': return Number(a) / Number(b);
        case '//': { const q = a / b; return (a % b !== 0n && ((a < 0n) !== (b < 0n))) ? q - 1n : q; }
        case '%': { const r = a % b; return (r !== 0n && ((r < 0n) !== (b < 0n))) ? r + b : r; }
        case '**':
          if (b < 0n) return Math.pow(Number(a), Number(b));
          if (b > 100000n) throw new PyError('OverflowError', linea, 'Ese número es demasiado grande hasta para Python en el navegador.');
          return a ** b;
      }
    }
    const x = aNum(a), y = aNum(b);
    switch (op) {
      case '+': return x + y; case '-': return x - y; case '*': return x * y; case '/': return x / y;
      case '//': return Math.floor(x / y);
      case '%': { const r = x % y; return (r !== 0 && ((r < 0) !== (y < 0))) ? r + y : r; }
      case '**': return Math.pow(x, y);
    }
  }
  function compara(op, a, b, linea) {
    switch (op) {
      case '==': return igual(a, b);
      case '!=': return !igual(a, b);
      case 'is': return a === b || (a === null && b === null);
      case 'is not': return !(a === b);
      case 'in': case 'not in': {
        let r;
        if (typeof b === 'string') {
          if (typeof a !== 'string') throw new PyError('TypeError', linea, 'Para buscar dentro de un texto, lo que buscas también tiene que ser texto.');
          r = b.includes(a);
        } else if (Array.isArray(b)) r = b.some((x) => igual(x, a));
        else if (b instanceof Rango) r = esNum(a) && [...b].some((x) => igual(x, a));
        else throw new PyError('TypeError', linea, `No puedo buscar dentro de ${nt(b)} con «in».`);
        return op === 'in' ? r : !r;
      }
    }
    if (esNum(a) && esNum(b)) {
      a = aEntero(a); b = aEntero(b);
      if (typeof a === 'bigint' && typeof b === 'bigint') {
        switch (op) { case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b; }
      }
      const x = aNum(a), y = aNum(b);
      switch (op) { case '<': return x < y; case '>': return x > y; case '<=': return x <= y; case '>=': return x >= y; }
    }
    if (typeof a === 'string' && typeof b === 'string') {
      switch (op) { case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b; }
    }
    throw new PyError('TypeError', linea, `No puedo comparar ${nt(a)} con ${nt(b)} usando «${op}».`,
      typeof a === 'string' || typeof b === 'string' ? 'Seguro uno de los dos vino de input() y es texto. Conviértelo: int(input("..."))' : '');
  }

  function indiceReal(seq, i, linea, paraAsignar) {
    i = aEntero(i);
    if (typeof i !== 'bigint') throw new PyError('TypeError', linea, `El índice entre corchetes tiene que ser un número entero, no ${nt(i)}.`);
    const n = seq.length;
    let k = Number(i);
    if (k < 0) k += n;
    if (k < 0 || k >= n) {
      const que = typeof seq === 'string' ? `El texto tiene ${n} letra${n === 1 ? '' : 's'}` : `La lista tiene ${n} elemento${n === 1 ? '' : 's'}`;
      throw new PyError('IndexError', linea, `${que}: la posición ${i} no existe.`,
        n ? `Las posiciones van de 0 a ${n - 1}: se empieza a contar desde 0.` : 'Está vacía: todavía no tiene nada adentro.');
    }
    return k;
  }

  function aEnteroPy(v, linea) {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'boolean') return v ? 1n : 0n;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new PyError('ValueError', linea, 'No puedo convertir infinito en número entero.');
      return BigInt(Math.trunc(v));
    }
    if (typeof v === 'string') {
      const t = v.trim().replace(/_/g, '');
      if (/^[+-]?\d+$/.test(t)) return BigInt(t);
      if (/^[+-]?\d*\.\d+$/.test(t)) throw new PyError('ValueError', linea, `int() no acepta decimales escritos como texto: '${v}'.`, 'Para números con punto usa float(...).');
      throw new PyError('ValueError', linea, v.trim() === '' ? 'int() recibió un texto vacío: no se escribió ningún número.' : `No puedo convertir '${v}' en número entero.`,
        'Escribe solo dígitos, por ejemplo 25.');
    }
    throw new PyError('TypeError', linea, `int() no puede convertir ${nt(v)}.`);
  }
  function aFloatPy(v, linea) {
    if (typeof v === 'number') return v;
    if (esNum(v)) return aNum(v);
    if (typeof v === 'string') {
      const t = v.trim().replace(/_/g, '');
      if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return parseFloat(t);
      if (/^[+-]?inf(inity)?$/i.test(t)) return t.startsWith('-') ? -Infinity : Infinity;
      if (/^\d+,\d+$/.test(t)) throw new PyError('ValueError', linea, `No puedo convertir '${v}' en número decimal.`, 'En Python los decimales llevan punto, no coma: 3.5');
      throw new PyError('ValueError', linea, `No puedo convertir '${v}' en número decimal.`, 'Escribe un número, por ejemplo 3.5');
    }
    throw new PyError('TypeError', linea, `float() no puede convertir ${nt(v)}.`);
  }
  function iterable(v, linea, para) {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') return [...v];
    if (v instanceof Rango) return v;
    throw new PyError('TypeError', linea, `No puedo recorrer ${nt(v)} ${para || 'con for'}.`,
      esNum(v) ? 'Para repetir N veces usa range: for i in range(5):' : '');
  }
  function redondear(x, n) {
    if (n === undefined) {
      const f = Math.floor(x), d = x - f;
      if (d > 0.5) return BigInt(f + 1);
      if (d < 0.5) return BigInt(f);
      return BigInt(f % 2 === 0 ? f : f + 1);
    }
    return Number(x.toFixed(Math.max(0, Math.min(20, n))));
  }

  /* ---------------- Intérprete ---------------- */
  class Interprete {
    constructor(ast, op = {}) {
      this.ast = ast;
      this.vars = new Map();
      this.orden = [];
      this.salida = op.salida || (() => { });
      this.pasos = 0;
      this.maxPasos = op.maxPasos || 300000;
      this.azar = op.azar || Math.random;
      this.lineaActual = 0;
      this.builtins = this.crearBuiltins();
    }
    tic(linea) {
      this.lineaActual = linea;
      if (++this.pasos > this.maxPasos)
        throw new PyError('Bucle', linea, 'Tu programa lleva demasiados pasos y no termina: parece un ciclo infinito.',
          'Revisa que la condición del while en algún momento se vuelva falsa (¿cambias la variable dentro del ciclo?).');
    }
    *correr() { yield* this.bloque(this.ast); }
    *bloque(b) { for (const s of b) yield* this.sentencia(s); }
    *sentencia(s) {
      this.tic(s.linea);
      yield { k: 'linea', linea: s.linea };
      switch (s.k) {
        case 'expr': yield* this.ev(s.e); return;
        case 'pass': return;
        case 'break': throw ROMPER;
        case 'continue': throw SEGUIR;
        case 'asigna': { const v = yield* this.ev(s.valor); yield* this.guardar(s.objetivo, v); return; }
        case 'aumenta': {
          const actual = yield* this.ev(s.objetivo);
          const v = yield* this.ev(s.valor);
          const r = s.op === '+' && Array.isArray(actual) && Array.isArray(v) ? (actual.push(...v), actual) : binop(s.op, actual, v, s.linea);
          yield* this.guardar(s.objetivo, r); return;
        }
        case 'import': for (const m of s.mods) this.asignar(m, this.modulo(m, s.linea)); return;
        case 'from': {
          const mod = this.modulo(s.mod, s.linea);
          for (const n of s.nombres) {
            if (!(n in mod.attrs)) throw new PyError('ImportError', s.linea, `El módulo ${s.mod} no tiene nada llamado '${n}'.`);
            this.asignar(n, mod.attrs[n]);
          }
          return;
        }
        case 'if': {
          for (let i = 0; i < s.pruebas.length; i++) {
            const t = s.pruebas[i];
            if (i > 0) { this.tic(t.linea); yield { k: 'linea', linea: t.linea }; }
            const c = yield* this.ev(t.cond);
            yield { k: 'decision', linea: t.linea, valor: verdad(c) };
            if (verdad(c)) { yield* this.bloque(t.cuerpo); return; }
          }
          if (s.sino) yield* this.bloque(s.sino);
          return;
        }
        case 'while': {
          let primera = true;
          while (true) {
            if (!primera) { this.tic(s.linea); yield { k: 'linea', linea: s.linea }; }
            primera = false;
            const c = yield* this.ev(s.cond);
            yield { k: 'decision', linea: s.linea, valor: verdad(c) };
            if (!verdad(c)) break;
            try { yield* this.bloque(s.cuerpo); }
            catch (e) { if (e === ROMPER) break; if (e === SEGUIR) continue; throw e; }
          }
          return;
        }
        case 'for': {
          const it = iterable(yield* this.ev(s.iter), s.linea);
          let primera = true;
          if (Array.isArray(it)) {
            for (let i = 0; i < it.length; i++) {
              if (!primera) { this.tic(s.linea); yield { k: 'linea', linea: s.linea }; }
              primera = false;
              this.asignar(s.nombre, it[i]);
              try { yield* this.bloque(s.cuerpo); }
              catch (e) { if (e === ROMPER) break; if (e === SEGUIR) continue; throw e; }
            }
          } else {
            for (const x of it) {
              if (!primera) { this.tic(s.linea); yield { k: 'linea', linea: s.linea }; }
              primera = false;
              this.asignar(s.nombre, x);
              try { yield* this.bloque(s.cuerpo); }
              catch (e) { if (e === ROMPER) break; if (e === SEGUIR) continue; throw e; }
            }
          }
          return;
        }
      }
    }
    asignar(n, v) {
      if (!this.vars.has(n)) this.orden.push(n);
      this.vars.set(n, v);
    }
    *guardar(obj, v) {
      if (obj.k === 'nombre') {
        if (this.builtins[obj.n] && ['print', 'input', 'int', 'str', 'len', 'range'].includes(obj.n))
          throw new PyError('SyntaxError', obj.linea, `«${obj.n}» ya es una función de Python: no la uses como nombre de variable.`, 'Ponle otro nombre, por ejemplo «mi_' + obj.n + '».');
        this.asignar(obj.n, v); return;
      }
      const seq = yield* this.ev(obj.obj);
      const i = yield* this.ev(obj.i);
      if (typeof seq === 'string') throw new PyError('TypeError', obj.linea, 'Los textos no se pueden cambiar letra por letra.', 'Arma un texto nuevo, por ejemplo con + o con replace().');
      if (!Array.isArray(seq)) throw new PyError('TypeError', obj.linea, `No puedo usar corchetes para cambiar ${nt(seq)}.`);
      seq[indiceReal(seq, i, obj.linea)] = v;
    }
    modulo(m, linea) {
      const az = this.azar;
      if (m === 'random') return new Modulo('random', {
        randint: new Builtin('randint', (args, kw, l) => {
          if (args.length !== 2) throw new PyError('TypeError', l, 'randint necesita dos números: el menor y el mayor.', 'Ejemplo: random.randint(1, 10)');
          const a = aEnteroPy(args[0], l), b = aEnteroPy(args[1], l);
          if (a > b) throw new PyError('ValueError', l, 'En randint el primer número tiene que ser el menor.');
          return a + BigInt(Math.floor(az() * Number(b - a + 1n)));
        }),
        choice: new Builtin('choice', (args, kw, l) => {
          const s = args[0];
          if (!(typeof s === 'string' || Array.isArray(s)) || !s.length) throw new PyError('IndexError', l, 'random.choice necesita una lista que no esté vacía.');
          return s[Math.floor(az() * s.length)];
        }),
        random: new Builtin('random', () => az()),
        shuffle: new Builtin('shuffle', (args) => { const s = args[0]; for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(az() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; } return null; })
      });
      if (m === 'math') return new Modulo('math', {
        pi: Math.PI, e: Math.E,
        sqrt: new Builtin('sqrt', (a, k, l) => { const x = aNum(a[0]); if (x < 0) throw new PyError('ValueError', l, 'No hay raíz cuadrada de un número negativo (en los números reales).'); return Math.sqrt(x); }),
        floor: new Builtin('floor', (a) => BigInt(Math.floor(aNum(a[0])))),
        ceil: new Builtin('ceil', (a) => BigInt(Math.ceil(aNum(a[0])))),
      });
      if (m === 'time') return new Modulo('time', {
        sleep: new Builtin('sleep', null)
      });
      throw new PyError('ModuleNotFoundError', linea, `En esta clase no está el módulo '${m}'.`, 'Los que sí hay: random, math y time.');
    }
    crearBuiltins() {
      const B = (n, fn) => new Builtin(n, fn);
      const unArg = (n, a, l) => { if (a.length !== 1) throw new PyError('TypeError', l, `${n}() recibe exactamente un valor entre los paréntesis.`); };
      return {
        print: B('print', null),
        input: B('input', null),
        int: B('int', (a, k, l) => { if (!a.length) return 0n; unArg('int', a, l); return aEnteroPy(a[0], l); }),
        float: B('float', (a, k, l) => { if (!a.length) return 0; unArg('float', a, l); return aFloatPy(a[0], l); }),
        str: B('str', (a, k, l) => a.length ? str(a[0]) : ''),
        bool: B('bool', (a) => a.length ? verdad(a[0]) : false),
        len: B('len', (a, k, l) => {
          unArg('len', a, l); const v = a[0];
          if (typeof v === 'string' || Array.isArray(v)) return BigInt(v.length);
          if (v instanceof Rango) return v.largo();
          throw new PyError('TypeError', l, `len() no funciona con ${nt(v)}.`, esNum(v) ? 'Los números no tienen largo. Si quieres contar sus dígitos: len(str(numero))' : '');
        }),
        range: B('range', (a, k, l) => {
          if (a.length < 1 || a.length > 3) throw new PyError('TypeError', l, 'range() recibe de 1 a 3 números.', 'range(5), range(1, 6) o range(0, 10, 2)');
          const n = a.map((x) => {
            x = aEntero(x);
            if (typeof x !== 'bigint') throw new PyError('TypeError', l, `range() solo acepta números enteros, y le diste ${nt(x)}.`, typeof x === 'string' ? '¿Vino de input()? Conviértelo con int(...).' : 'Sin decimales: range(5), no range(5.0).');
            return x;
          });
          const [ini, fin, paso] = n.length === 1 ? [0n, n[0], 1n] : [n[0], n[1], n[2] ?? 1n];
          if (paso === 0n) throw new PyError('ValueError', l, 'El paso de range() no puede ser 0.');
          return new Rango(ini, fin, paso);
        }),
        abs: B('abs', (a, k, l) => { const v = aEntero(a[0]); if (typeof v === 'bigint') return v < 0n ? -v : v; if (typeof v === 'number') return Math.abs(v); throw new PyError('TypeError', l, `abs() necesita un número, no ${nt(v)}.`); }),
        max: B('max', (a, k, l) => this.extremo(a, l, 1)),
        min: B('min', (a, k, l) => this.extremo(a, l, -1)),
        sum: B('sum', (a, k, l) => { let t = 0n; for (const x of iterable(a[0], l, 'con sum')) t = binop('+', t, x, l); return t; }),
        round: B('round', (a, k, l) => {
          const x = aEntero(a[0]);
          if (typeof x === 'bigint') return x;
          if (typeof x !== 'number') throw new PyError('TypeError', l, `round() necesita un número, no ${nt(x)}.`);
          return a.length > 1 ? redondear(x, Number(aEntero(a[1]))) : redondear(x);
        }),
        type: B('type', (a) => new Tipo(tipoDe(a[0]))),
        list: B('list', (a, k, l) => a.length ? [...iterable(a[0], l, 'con list')] : []),
        sorted: B('sorted', (a, k, l) => this.ordenar([...iterable(a[0], l, 'con sorted')], l, kw0(k))),
      };
      function kw0(k) { return k && verdad(k.reverse ?? false); }
    }
    extremo(a, l, signo) {
      const xs = a.length === 1 ? [...iterable(a[0], l, signo > 0 ? 'con max' : 'con min')] : a;
      if (!xs.length) throw new PyError('ValueError', l, `${signo > 0 ? 'max' : 'min'}() recibió una lista vacía.`);
      let m = xs[0];
      for (const x of xs.slice(1)) if (compara(signo > 0 ? '>' : '<', x, m, l)) m = x;
      return m;
    }
    ordenar(xs, l, reves) {
      xs.sort((x, y) => compara('<', x, y, l) ? -1 : compara('>', x, y, l) ? 1 : 0);
      if (reves) xs.reverse();
      return xs;
    }
    *ev(n) {
      switch (n.k) {
        case 'num': case 'str': return n.v;
        case 'const': return n.v;
        case 'lista': { const r = []; for (const e of n.items) r.push(yield* this.ev(e)); return r; }
        case 'fstr': {
          let s = '';
          for (const p of n.partes) {
            if (typeof p === 'string') { s += p; continue; }
            const v = yield* this.ev(p.e);
            s += formatear(v, p.formato, n.linea);
          }
          return s;
        }
        case 'nombre': {
          if (this.vars.has(n.n)) return this.vars.get(n.n);
          if (n.n in this.builtins) return this.builtins[n.n];
          throw this.noExiste(n.n, n.linea);
        }
        case 'o': { const a = yield* this.ev(n.a); return verdad(a) ? a : yield* this.ev(n.b); }
        case 'y': { const a = yield* this.ev(n.a); return !verdad(a) ? a : yield* this.ev(n.b); }
        case 'no': return !verdad(yield* this.ev(n.a));
        case 'un': {
          const a = aEntero(yield* this.ev(n.a));
          if (!esNum(a)) throw new PyError('TypeError', n.linea, `No puedo ponerle signo «${n.op}» a ${nt(a)}.`);
          return n.op === '-' ? -a : a;
        }
        case 'bin': { const a = yield* this.ev(n.a); const b = yield* this.ev(n.b); return binop(n.op, a, b, n.linea); }
        case 'cmp': {
          let a = yield* this.ev(n.vals[0]);
          for (let i = 0; i < n.ops.length; i++) {
            const b = yield* this.ev(n.vals[i + 1]);
            if (!compara(n.ops[i], a, b, n.linea)) return false;
            a = b;
          }
          return true;
        }
        case 'indice': {
          const s = yield* this.ev(n.obj); const i = yield* this.ev(n.i);
          if (typeof s === 'string' || Array.isArray(s)) return s[indiceReal(s, i, n.linea)];
          if (s instanceof Rango) { const arr = [...s]; return arr[indiceReal(arr, i, n.linea)]; }
          throw new PyError('TypeError', n.linea, `${cap(nt(s))} no se puede leer con corchetes [ ].`, esNum(s) ? 'Los corchetes son para textos y listas.' : '');
        }
        case 'rebanada': {
          const s = yield* this.ev(n.obj);
          if (!(typeof s === 'string' || Array.isArray(s))) throw new PyError('TypeError', n.linea, `${cap(nt(s))} no se puede rebanar con [ : ].`);
          const num = function* (e, def) { if (!e) return def; const v = aEntero(yield* this.ev(e)); if (typeof v !== 'bigint') throw new PyError('TypeError', n.linea, 'Los números de la rebanada [a:b] tienen que ser enteros.'); return Number(v); }.bind(this);
          const paso = yield* num(n.paso, 1);
          if (paso === 0) throw new PyError('ValueError', n.linea, 'El paso de la rebanada no puede ser 0.');
          const L = s.length;
          const norm = (x, def) => { if (x === null) return def; if (x < 0) x += L; return paso > 0 ? Math.min(Math.max(x, 0), L) : Math.min(Math.max(x, -1), L - 1); };
          const ini = norm(n.ini ? yield* num(n.ini) : null, paso > 0 ? 0 : L - 1);
          const fin = norm(n.fin ? yield* num(n.fin) : null, paso > 0 ? L : -1);
          const r = [];
          if (paso > 0) for (let i = ini; i < fin; i += paso) r.push(s[i]); else for (let i = ini; i > fin; i += paso) r.push(s[i]);
          return typeof s === 'string' ? r.join('') : r;
        }
        case 'attr': {
          const o = yield* this.ev(n.obj);
          if (o instanceof Modulo) {
            if (n.n in o.attrs) return o.attrs[n.n];
            throw new PyError('AttributeError', n.linea, `El módulo ${o.nombre} no tiene nada llamado '${n.n}'.`, o.nombre === 'random' ? 'Lo más usado: random.randint(1, 10)' : '');
          }
          const metodos = METODOS[tipoDe(o)];
          if (metodos && metodos.includes(n.n)) return new Metodo(o, n.n);
          const parecido = metodos && metodos.find((m) => m.toLowerCase() === n.n.toLowerCase());
          throw new PyError('AttributeError', n.linea, `${cap(nt(o))} no tiene el método '${n.n}'.`,
            parecido ? `¿Quisiste decir '${parecido}'? Python distingue mayúsculas y minúsculas.` : metodos ? `Algunos que sí tiene: ${metodos.slice(0, 5).join(', ')}.` : '');
        }
        case 'llamada': {
          const f = yield* this.ev(n.f);
          const args = []; for (const a of n.args) args.push(yield* this.ev(a));
          const kw = {}; for (const k in n.kw) kw[k] = yield* this.ev(n.kw[k]);
          if (f instanceof Builtin) {
            if (f.nombre === 'print') {
              const sep = 'sep' in kw ? (kw.sep === null ? ' ' : String(kw.sep)) : ' ';
              const fin = 'end' in kw ? (kw.end === null ? '\n' : String(kw.end)) : '\n';
              this.salida(args.map(str).join(sep) + fin);
              return null;
            }
            if (f.nombre === 'input') {
              if (args.length > 1) throw new PyError('TypeError', n.linea, 'input() recibe solo un texto: la pregunta.', 'Si quieres juntar cosas en la pregunta, usa un f-string: input(f"¿Cuántos años tienes, {nombre}? ")');
              const pregunta = args.length ? str(args[0]) : '';
              const r = yield { k: 'input', linea: n.linea, pregunta };
              return r == null ? '' : String(r);
            }
            if (f.nombre === 'sleep') {
              const s = aNum(args[0] ?? 0n);
              yield { k: 'espera', ms: Math.min(Math.max(0, s * 1000), 5000) };
              return null;
            }
            for (const k in kw) if (!(f.nombre === 'sorted' && k === 'reverse')) throw new PyError('TypeError', n.linea, `${f.nombre}() no recibe «${k}=».`);
            return f.fn(args, kw, n.linea);
          }
          if (f instanceof Metodo) return llamarMetodo(f.obj, f.nombre, args, n.linea, this);
          if (f instanceof Tipo) throw new PyError('TypeError', n.linea, 'Eso es un tipo de dato, no se puede llamar así.');
          throw new PyError('TypeError', n.linea, `${cap(nt(f))} no es una función: no lleva paréntesis después.`,
            n.f.k === 'nombre' ? `¿Usaste «${n.f.n}» como variable y como función? Ponles nombres distintos.` : '');
        }
      }
      throw new PyError('Error', n.linea, 'Algo en este renglón no lo entiendo.');
    }
    noExiste(nombre, linea) {
      const conocidos = [...this.vars.keys(), ...Object.keys(this.builtins), 'True', 'False', 'None', 'if', 'for', 'while', 'else'];
      let pista = '';
      const low = nombre.toLowerCase();
      const mayus = conocidos.find((c) => c.toLowerCase() === low && c !== nombre);
      if (mayus) pista = `¿Quisiste decir «${mayus}»? Python distingue mayúsculas y minúsculas.`;
      else if (ESPANOL[low]) pista = `Python se escribe en inglés: en vez de «${nombre}» va «${ESPANOL[low]}».`;
      else {
        const cerca = conocidos.find((c) => c.length > 2 && distancia(c, nombre) <= (nombre.length > 5 ? 2 : 1));
        if (cerca) pista = `¿Quisiste decir «${cerca}»? Revisa cómo lo escribiste.`;
        else pista = 'Si es un texto, ponlo entre comillas: "' + nombre + '". Si es una variable, primero hay que darle un valor con «=».';
      }
      return new PyError('NameError', linea, `No conozco nada llamado «${nombre}».`, pista);
    }
    variables() {
      return this.orden.filter((n) => !(this.vars.get(n) instanceof Modulo) && !(this.vars.get(n) instanceof Builtin)).map((n) => ({ nombre: n, valor: this.vars.get(n) }));
    }
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const METODOS = {
    str: ['upper', 'lower', 'strip', 'title', 'capitalize', 'replace', 'split', 'count', 'startswith', 'endswith', 'isdigit', 'find', 'join'],
    list: ['append', 'pop', 'insert', 'remove', 'sort', 'reverse', 'count', 'index'],
  };
  function llamarMetodo(o, m, a, l, interp) {
    const pideTexto = (x, que) => { if (typeof x !== 'string') throw new PyError('TypeError', l, `${que} tiene que ser un texto, no ${nt(x)}.`); return x; };
    if (typeof o === 'string') switch (m) {
      case 'upper': return o.toUpperCase();
      case 'lower': return o.toLowerCase();
      case 'strip': return o.trim();
      case 'title': return o.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (x, a1, b1) => a1 + b1.toUpperCase());
      case 'capitalize': return o.charAt(0).toUpperCase() + o.slice(1).toLowerCase();
      case 'replace': return o.split(pideTexto(a[0], 'Lo que quieres reemplazar')).join(pideTexto(a[1], 'El reemplazo'));
      case 'split': return a.length && a[0] !== null ? o.split(pideTexto(a[0], 'El separador')) : o.trim().split(/\s+/).filter(Boolean);
      case 'count': return BigInt(o.split(pideTexto(a[0], 'Lo que cuentas')).length - 1);
      case 'startswith': return o.startsWith(pideTexto(a[0], 'El inicio'));
      case 'endswith': return o.endsWith(pideTexto(a[0], 'El final'));
      case 'isdigit': return o.length > 0 && /^\d+$/.test(o);
      case 'find': return BigInt(o.indexOf(pideTexto(a[0], 'Lo que buscas')));
      case 'join': return [...iterable(a[0], l, 'con join')].map((x) => pideTexto(x, 'Cada elemento que juntas')).join(o);
    }
    if (Array.isArray(o)) switch (m) {
      case 'append':
        if (a.length !== 1) throw new PyError('TypeError', l, 'append() agrega UNA cosa a la vez.', 'Si son varias, usa append varias veces.');
        o.push(a[0]); return null;
      case 'pop': {
        if (!o.length) throw new PyError('IndexError', l, 'No puedo sacar nada: la lista está vacía.');
        const k = a.length ? indiceReal(o, a[0], l) : o.length - 1;
        return o.splice(k, 1)[0];
      }
      case 'insert': { let k = Number(aEntero(a[0])); if (k < 0) k = Math.max(0, o.length + k); o.splice(Math.min(k, o.length), 0, a[1]); return null; }
      case 'remove': {
        const k = o.findIndex((x) => igual(x, a[0]));
        if (k < 0) throw new PyError('ValueError', l, `No puedo quitar ${repr(a[0])}: no está en la lista.`);
        o.splice(k, 1); return null;
      }
      case 'sort': interp.ordenar(o, l, false); return null;
      case 'reverse': o.reverse(); return null;
      case 'count': return BigInt(o.filter((x) => igual(x, a[0])).length);
      case 'index': {
        const k = o.findIndex((x) => igual(x, a[0]));
        if (k < 0) throw new PyError('ValueError', l, `${repr(a[0])} no está en la lista.`);
        return BigInt(k);
      }
    }
    throw new PyError('AttributeError', l, `No existe el método ${m}.`);
  }
  function formatear(v, f, linea) {
    if (!f) return str(v);
    const m = /^([<>^]?)(\d*)(?:\.(\d+))?([fd%]?)$/.exec(f);
    if (!m) return str(v);
    let [, al, ancho, dec, tipo] = m;
    let s;
    if (tipo === 'f' || (dec && !tipo)) {
      if (!esNum(v)) throw new PyError('ValueError', linea, `El formato «:${f}» es para números, y esto es ${nt(v)}.`);
      s = aNum(aEntero(v)).toFixed(dec ? Number(dec) : 6);
    } else if (tipo === '%') { s = (aNum(aEntero(v)) * 100).toFixed(dec ? Number(dec) : 6) + '%'; }
    else s = str(v);
    if (ancho) {
      const w = Number(ancho);
      const izq = al ? al === '<' : !(esNum(v));
      if (al === '^') { const t = w - s.length; if (t > 0) s = ' '.repeat(Math.floor(t / 2)) + s + ' '.repeat(Math.ceil(t / 2)); }
      else s = izq ? s.padEnd(w) : s.padStart(w);
    }
    return s;
  }
  function distancia(a, b) {
    const m = a.length, n = b.length; const d = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  function semilla(s) {
    let a = s >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  /* Corre un programa de una sola vez con entradas ya dadas (para revisar retos y para las pruebas). */
  function correrSincrono(codigo, { entradas = [], azar, maxPasos, eco = true } = {}) {
    let out = '';
    const ent = [...entradas];
    try {
      const ast = analizar(codigo);
      const it = new Interprete(ast, { salida: (t) => { out += t; }, azar, maxPasos });
      const g = it.correr();
      let r = g.next();
      while (!r.done) {
        let envio;
        if (r.value.k === 'input') {
          out += r.value.pregunta;
          if (!ent.length) throw new PyError('SinEntradas', r.value.linea, 'El programa pidió más respuestas de las que le dimos.');
          envio = String(ent.shift());
          if (eco) out += envio + '\n';
        }
        r = g.next(envio);
      }
      return { salida: out, error: null, vars: it.vars, interp: it };
    } catch (e) {
      if (e instanceof PyError) return { salida: out, error: e };
      throw e;
    }
  }

  return { analizar, Interprete, PyError, str, repr, tipoDe, correrSincrono, semilla, verdad };
})();
if (typeof module !== 'undefined') module.exports = MiniPy;
