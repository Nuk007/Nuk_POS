'use strict';
/** PWA — manifestos, service worker, ícones e metas de iOS/Android (a app tem de poder instalar-se). */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { app } = require('../server/app');

const pub = f => path.join(__dirname, '..', 'public', f);
const lerPng = f => { const b = fs.readFileSync(pub(f)); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), tipoCor: b[25] }; };

describe('manifesto do POS', () => {
  const m = JSON.parse(fs.readFileSync(pub('manifest.webmanifest'), 'utf8'));
  test('campos exigidos para instalar', () => {
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBeTruthy();
    expect(m.name && m.short_name).toBeTruthy();
    const tamanhos = m.icons.map(i => i.sizes);
    expect(tamanhos).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(m.icons.some(i => i.purpose === 'maskable')).toBe(true);
  });
  test('todos os ícones do manifesto existem e têm o tamanho declarado', () => {
    for (const i of m.icons) {
      const [w, h] = i.sizes.split('x').map(Number);
      expect(lerPng(i.src.replace(/^\//, ''))).toMatchObject({ w, h });
    }
  });
});

describe('iOS', () => {
  test('apple-touch-icon 180x180 sem transparência (RGB), senão o iOS pinta o fundo de preto', () => {
    expect(lerPng('img/apple-touch-icon.png')).toEqual({ w: 180, h: 180, tipoCor: 2 });
  });
  test.each(['index.html', 'cliente.html'])('%s tem as metas de instalação (iOS e Android)', f => {
    const h = fs.readFileSync(pub(f), 'utf8');
    expect(h).toContain('rel="manifest"');
    expect(h).toContain('rel="apple-touch-icon" sizes="180x180"');
    expect(h).toContain('name="apple-mobile-web-app-capable"');
    expect(h).toContain('name="theme-color"');
    expect(h).toContain('viewport-fit=cover');
    expect(h).toContain('/js/pwa.js');
    expect(h).toContain('/css/pwa.css');
  });
});

describe('service worker e manifesto do portal', () => {
  test('GET /sw.js: JavaScript, sem cache, âmbito raiz, com versão e sem tocar em /api', async () => {
    const r = await request(app).get('/sw.js');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/javascript/);
    expect(r.headers['cache-control']).toMatch(/no-cache/);
    expect(r.headers['service-worker-allowed']).toBe('/');
    expect(r.text).not.toContain('__VERSAO__');
    expect(r.text).toContain("startsWith('/api/')");
    expect(r.text).toContain("startsWith('/socket.io')");
  });
  test('manifesto do portal usa o nome e o slug do estabelecimento', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ nome: 'Clube 3D Afro-Grill' }] });
    const r = await request(app).get('/manifest-cliente.webmanifest?r=clube-3d-afro-grill');
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('Clube 3D Afro-Grill');
    expect(r.body.start_url).toBe('/cliente?r=clube-3d-afro-grill');
    expect(r.body.scope).toBe('/cliente');
    expect(r.body.display).toBe('standalone');
  });
  test('slug inválido não chega à base de dados e dá o manifesto genérico', async () => {
    const antes = mockPool.query.mock.calls.length;
    const r = await request(app).get('/manifest-cliente.webmanifest?r=' + encodeURIComponent("x'; DROP TABLE tenants;--"));
    expect(r.body.start_url).toBe('/cliente');
    expect(mockPool.query.mock.calls.length).toBe(antes);
  });
  test('CSP permite o service worker e o manifesto só da própria origem', async () => {
    const r = await request(app).get('/offline.html');
    expect(r.headers['content-security-policy']).toMatch(/worker-src 'self'/);
    expect(r.headers['content-security-policy']).toMatch(/manifest-src 'self'/);
  });
});
