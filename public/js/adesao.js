// Nuk_POS — Contrato de Adesão à Plataforma Nuk_POS da GESTNUK AI (decisão do dono de 13/11/2026).
// O administrador titular lê e assina no primeiro acesso; os restantes vêem o texto e o aviso.
// Sem handlers inline (CSP): tudo por addEventListener; o texto entra por textContent.
'use strict';

let _adesaoActiva = false;

/** Devolve true se a adesão está por assinar (e mostra o ecrã); false para arrancar a operação. */
async function verificarAdesao() {
  try {
    const a = await api('GET', '/adesao');
    if (!a || !a.pendente) return false;
    desenharAdesao(a);
    return true;
  } catch (_) {
    return false; // sem resposta não se bloqueia aqui: o servidor responde 428 nas rotas
  }
}

async function mostrarAdesao() {
  if (_adesaoActiva) return;
  try { const a = await api('GET', '/adesao'); if (a && a.pendente) desenharAdesao(a); } catch (_) { /* fica o erro da rota */ }
}

function desenharAdesao(a) {
  _adesaoActiva = true;
  document.getElementById('app').style.display = 'none';
  document.getElementById('tela-adesao').style.display = 'flex';
  document.getElementById('adesao-intro').textContent =
    `Antes de começar, leia o contrato entre o estabelecimento e a ${a.titular}, titular da plataforma. ` +
    `Versão ${a.versao}. Ao assinar ficam registados o nome escrito, a data e hora, o dispositivo e uma impressão digital do texto.`;
  const caixa = document.getElementById('adesao-texto');
  caixa.replaceChildren(...(a.texto || ['O contrato fica disponível quando houver um administrador titular.']).map((p, i) => {
    const el = document.createElement(i === 0 ? 'h3' : 'p');
    const m = i > 0 && p.match(/^((?:Cláusula \d+\.ª — [^.]+\.)|(?:ANEXO [IV]+ — [^.]+\.)|(?:\d+\. [^.]+\.))(.*)$/s);
    if (m) { const b = document.createElement('strong'); b.textContent = m[1]; el.append(b, m[2]); } else el.textContent = p;
    return el;
  }));
  document.getElementById('form-adesao').style.display = a.pode_assinar ? 'block' : 'none';
  document.getElementById('adesao-aviso').style.display = a.pode_assinar ? 'none' : 'block';
  const nome = document.getElementById('adesao-nome');
  if (a.pode_assinar && !nome.value && NUK.utilizador) nome.value = NUK.utilizador.nome || '';
}

document.getElementById('adesao-sair').addEventListener('click', () => { _adesaoActiva = false; logout(); });

document.getElementById('form-adesao').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btn-adesao');
  const erroEl = document.getElementById('adesao-erro');
  erroEl.style.display = 'none';
  btn.disabled = true; btn.textContent = 'A assinar...';
  try {
    await api('POST', '/adesao/assinar', { nome: document.getElementById('adesao-nome').value, aceito: document.getElementById('adesao-aceito').checked });
    _adesaoActiva = false;
    toast('Contrato assinado. Pode descarregá-lo em Configurações.');
    arrancarOperacao();
  } catch (err) {
    erroEl.textContent = err.message; erroEl.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Assinar o contrato';
  }
});
