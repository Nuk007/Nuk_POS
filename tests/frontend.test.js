'use strict';
/**
 * Contrato frontend ↔ servidor (sem browser): evita regressões que só se viam em produção.
 *  1. A CSP (script-src-attr 'none') bloqueia onclick="" inline → o frontend não pode usá-los.
 *  2. O login devolve { token, funcionario } → o frontend tem de ler essa chave.
 *  3. Todo o data-on-* aponta para uma função que existe e a delegação interpreta-o correctamente.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const pub = path.join(__dirname, '..', 'public');
const ler = f => fs.readFileSync(path.join(pub, f), 'utf8');
const ficheiros = ['index.html', 'cliente.html', 'activate.html', 'superadmin.html', ...fs.readdirSync(path.join(pub, 'js')).map(f => 'js/' + f)];

test('nenhum ficheiro do frontend usa handlers inline (bloqueados pela CSP)', () => {
  const re = /\son(click|change|input|submit|keyup|keydown|blur|focus)\s*=\s*["']/g;
  const achados = ficheiros.filter(f => re.test(ler(f)) && !(re.lastIndex = 0));
  expect(achados).toEqual([]);
});

test('nenhuma página HTML tem <script> inline (script-src sem unsafe-inline)', () => {
  const re = /<script(?![^>]*\ssrc=)[^>]*>\s*\S/i;
  const achados = ficheiros.filter(f => f.endsWith('.html') && re.test(ler(f)));
  expect(achados).toEqual([]);
});

test('o login do frontend lê a chave "funcionario" que a API devolve', () => {
  const src = ler('js/nukpos.js');
  expect(src).toMatch(/NUK\.utilizador\s*=\s*res\.funcionario/);
  expect(src).not.toMatch(/NUK\.utilizador\s*=\s*res\.utilizador/);
});

describe('delegação data-on-*', () => {
  const nuk = ler('js/nukpos.js');
  const bloco = nuk.slice(nuk.indexOf('function _parseArgs'), nuk.indexOf("['click', 'change', 'input']"));
  const chamadas = [];
  const ctx = { window: {}, Error, Number, isNaN, console };
  ['f', 'g'].forEach(n => { ctx.window[n] = (...a) => chamadas.push([n, ...a]); });
  vm.createContext(ctx);
  vm.runInContext(bloco + '\nthis._executar = _executarHandler;', ctx);

  test('argumentos: texto com aspas escapadas, números, booleanos, null e this.value', () => {
    chamadas.length = 0;
    ctx._executar("f('a\\'b', 12, true, null); g(this.value)", { value: 'v' });
    expect(chamadas).toEqual([['f', "a'b", 12, true, null], ['g', 'v']]);
  });
  test('rejeita funções inexistentes e expressões arbitrárias (sem eval)', () => {
    expect(() => ctx._executar('naoExiste()', {})).toThrow(/inválido/);
    expect(() => ctx._executar('f(window.x)', {})).toThrow(/não suportado/);
    expect(() => ctx._executar('alert(1)', {})).toThrow(/inválido/);
  });
  test('todas as funções referidas em data-on-* estão definidas', () => {
    const codigo = ficheiros.map(f => ler(f)).join('\n');
    const nomes = new Set();
    for (const m of codigo.matchAll(/data-on-(?:click|change|input)="([^"]*)"/g))
      for (const parte of m[1].split(';')) { const n = parte.trim().match(/^([A-Za-z_$][\w$]*)\(/); if (n) nomes.add(n[1]); }
    expect(nomes.size).toBeGreaterThan(20);
    const em_falta = [...nomes].filter(n => !new RegExp(`function\\s+${n}\\s*\\(|(?:const|let|var)\\s+${n}\\s*=`).test(codigo));
    expect(em_falta).toEqual([]);
  });
});

describe('portal do cliente (cliente.html ↔ cliente.js)', () => {
  const html = ler('cliente.html');
  const js = ler('js/cliente.js');

  test('todo o data-action do portal tem uma acção registada no JS', () => {
    const usadas = new Set([...html.matchAll(/data-action="([^"]+)"/g)].map(m => m[1]));
    const dinamicas = new Set([...js.matchAll(/dataset\.action\s*=\s*'([^']+)'/g)].map(m => m[1]));
    const registadas = new Set([...js.matchAll(/^\s*'([\w-]+)':\s/gm)].map(m => m[1]));
    const em_falta = [...usadas, ...dinamicas].filter(a => !registadas.has(a));
    expect(usadas.size).toBeGreaterThan(10);
    expect(em_falta).toEqual([]);
  });
  test('sem handlers .onclick= (conflitam com a delegação), sem menu estático nem sucesso simulado', () => {
    expect(js).not.toMatch(/\.onclick\s*=/);
    expect(js).not.toMatch(/const MENU\s*=|\(demo\)|Fallback offline|API indispon/);
  });
  test('pedidos, serviços e eventos só se dão por enviados quando o servidor responde OK', () => {
    expect(js).toMatch(/if \(!r\.ok\) \{[\s\S]*?O pedido NÃO foi enviado[\s\S]*?return;/);
    expect(js).toMatch(/if \(!\(await enviarSolicitacao\('EVENTO'/);
  });
  test('todas as categorias de produto do servidor têm secção e emoji no menu do portal', () => {
    const db = fs.readFileSync(path.join(__dirname, '..', 'server', 'db.js'), 'utf8');
    const m = db.match(/ADD CONSTRAINT produtos_categoria_check\s+CHECK \(categoria IN \(([^)]*)\)\)/);
    const categorias = [...m[1].matchAll(/'([A-Z_]+)'/g)].map(x => x[1]);
    expect(categorias.length).toBeGreaterThanOrEqual(10);
    const ctx = {}; vm.createContext(ctx);
    const corte = (de, ate) => js.slice(js.indexOf(de), js.indexOf(ate));
    vm.runInContext(corte('const SECCOES', 'const METODOS') + corte('function gridDe', 'function buildMenu') + '\nthis.gridDe = gridDe; this.EMOJI_CAT = EMOJI_CAT;', ctx);
    const esperado = { CHURRASCO: 'grid-comidas', PEIXE: 'grid-comidas', PRATO: 'grid-comidas', ENTRADA: 'grid-comidas', ACOMPANHAMENTO: 'grid-comidas',
      BEBIDA: 'grid-bebidas', COCKTAIL: 'grid-bebidas', SHISHA: 'grid-cigarros', SOBREMESA: 'grid-outros', OUTRO: 'grid-outros' };
    categorias.forEach(c => { expect([c, ctx.gridDe(c)]).toEqual([c, esperado[c]]); expect(ctx.EMOJI_CAT[c]).toBeTruthy(); });
    expect(ctx.gridDe('qualquer-coisa-nova')).toBe('grid-outros');
  });
});
