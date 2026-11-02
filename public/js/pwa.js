'use strict';
/* PWA: regista o service worker e mostra como instalar a app.
 *  - Android/Chrome/Edge: usa o pedido nativo (beforeinstallprompt) com um botão «Instalar».
 *  - iPhone/iPad (Safari): o iOS não tem pedido nativo → explica «Partilhar → Adicionar ao ecrã principal».
 * Nada aqui bloqueia a app: tudo em try/catch. Sem JS inline (CSP). */
(function () {
  // manifesto: o POS tem o seu; o portal tem um por estabelecimento (instala directamente o portal certo)
  try {
    var ln = document.querySelector('link[rel="manifest"]') || document.createElement('link');
    ln.rel = 'manifest';
    if (location.pathname.indexOf('/cliente') === 0) {
      var r = new URLSearchParams(location.search).get('r') || '';
      ln.href = '/manifest-cliente.webmanifest' + (r ? '?r=' + encodeURIComponent(r) : '');
    } else { ln.href = '/manifest.webmanifest'; }
    if (!ln.parentNode) document.head.appendChild(ln);
  } catch (e) { /* ignorar */ }
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  var CHAVE = 'nukpos_pwa_dispensado';
  var evento = null;

  function dispensado() {
    try { var t = Number(localStorage.getItem(CHAVE)); return t && Date.now() - t < 7 * 864e5; } catch (e) { return false; }
  }
  function dispensar() { try { localStorage.setItem(CHAVE, String(Date.now())); } catch (e) { /* ignorar */ } }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () { /* sem SW a app funciona na mesma */ });
    });
  }
  if (standalone) return; // já instalada

  var ua = window.navigator.userAgent || '';
  var ios = /iPad|iPhone|iPod/.test(ua) || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
  var safari = ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);

  function caixa(titulo, texto, botoes) {
    if (document.getElementById('pwa-instalar')) return;
    var raiz = document.createElement('div'); raiz.id = 'pwa-instalar'; raiz.className = 'pwa-instalar';
    var c = document.createElement('div'); c.className = 'pwa-instalar__caixa';
    var img = document.createElement('img'); img.src = '/img/icon-192.png'; img.alt = ''; img.width = 44; img.height = 44;
    var t = document.createElement('div'); t.className = 'pwa-instalar__texto';
    var b = document.createElement('b'); b.textContent = titulo;
    var s = document.createElement('span'); s.textContent = texto;
    t.appendChild(b); t.appendChild(s);
    var bs = document.createElement('div'); bs.className = 'pwa-instalar__botoes';
    botoes.forEach(function (x) { var el = document.createElement('button'); el.type = 'button'; el.className = x.cls; el.textContent = x.txt; el.addEventListener('click', x.fn); bs.appendChild(el); });
    c.appendChild(img); c.appendChild(t); c.appendChild(bs); raiz.appendChild(c); document.body.appendChild(raiz);
  }
  function fechar() { var r = document.getElementById('pwa-instalar'); if (r) r.remove(); }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); evento = e;
    if (dispensado()) return;
    caixa('Instalar o Nuk_POS', 'Abre como uma app, direto do ecrã principal.', [
      { cls: 'pwa-sim', txt: 'Instalar', fn: function () {
          if (!evento) return;
          evento.prompt();
          evento.userChoice.then(function () { evento = null; fechar(); }).catch(function () { fechar(); });
      } },
      { cls: 'pwa-nao', txt: 'Agora não', fn: function () { dispensar(); fechar(); } },
    ]);
  });
  window.addEventListener('appinstalled', fechar);

  if (ios && !dispensado()) {
    window.addEventListener('load', function () {
      setTimeout(function () {
        if (safari) {
          caixa('Instalar no iPhone', 'Toque em Partilhar (o quadrado com a seta) e depois em «Adicionar ao ecrã principal».', [
            { cls: 'pwa-nao', txt: 'Fechar', fn: function () { dispensar(); fechar(); } },
          ]);
        } else {
          caixa('Instalar no iPhone', 'Abra esta página no Safari, toque em Partilhar e escolha «Adicionar ao ecrã principal».', [
            { cls: 'pwa-nao', txt: 'Fechar', fn: function () { dispensar(); fechar(); } },
          ]);
        }
      }, 2500);
    });
  }
})();
