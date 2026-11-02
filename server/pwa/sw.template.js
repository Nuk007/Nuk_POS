/* Service worker do Nuk_POS — versão __VERSAO__ (gerado por server/routes/pwa.js)
 * Regras: nunca intercepta /api/ nem /socket.io (dados e tempo real vão sempre à rede);
 * páginas e JS/CSS: rede primeiro, com a cópia guardada só como recurso offline (assim um deploy novo vê-se logo);
 * imagens: cache primeiro. Sem funcionalidades que o iOS não suporte (sem background sync nem push). */
const VERSAO = '__VERSAO__';
const CACHE = 'nukpos-' + VERSAO;
const BASE = ['/offline.html', '/css/nukpos.css', '/css/marca.css', '/css/pwa.css', '/img/icon-192.png', '/img/logo-nukpos-texto.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(BASE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('nukpos-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io') || url.pathname === '/sw.js') return;

  // páginas: rede primeiro; offline → última cópia ou página «sem ligação»
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(k => k.put(req, c)).catch(() => {}); return r; })
      .catch(() => caches.match(req).then(m => m || caches.match('/offline.html'))));
    return;
  }
  const ext = url.pathname.split('.').pop();
  if (ext === 'js' || ext === 'css' || ext === 'webmanifest') {
    e.respondWith(fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(k => k.put(req, c)).catch(() => {}); } return r; })
      .catch(() => caches.match(req)));
    return;
  }
  if (['png', 'jpg', 'jpeg', 'svg', 'webp', 'ico', 'woff2'].includes(ext)) {
    e.respondWith(caches.match(req).then(m => m || fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(k => k.put(req, c)).catch(() => {}); } return r; })));
  }
});
