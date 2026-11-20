'use strict';
/**
 * Rate limiters centralizados — aplicados por rota ou grupo de rotas. Novos limitadores vão para aqui, nunca inline.
 *
 * Revisão de 20/11/2026 (pedido do dono): os limites contavam por endereço IP. Num estabelecimento todos os aparelhos
 * (caixa, ecrã da cozinha, impressoras que consultam o servidor de 15 em 15 s, telemóveis dos clientes no portal)
 * saem pelo mesmo IP — e as operadoras angolanas usam CGNAT, por isso até estabelecimentos diferentes podem partilhar
 * um IP. Com 200 pedidos/15 min por IP, um serviço normal ficava com «Demasiados pedidos» a meio.
 *
 * Agora:
 *   - Pedidos com sessão válida (JWT do funcionário) contam por PESSOA; sem sessão contam por IP, com tectos largos.
 *   - O que protege contra adivinhar palavras-passe/PINs só conta FALHAS e por IP + conta/telefone, mais um tecto por IP.
 *
 *   - globalLimiter:     sessão 3000 / 10 min por pessoa · sem sessão 1500 / 10 min por IP — todas as rotas /api/
 *   - apiWriteLimiter:   sessão 300 / min por pessoa · sem sessão 120 / min por IP — POST/PUT/PATCH/DELETE
 *   - loginLimiter:      10 falhas / 15 min por IP + email — POST /api/auth/login, /api/cadeia/trocar
 *   - loginIpLimiter:    60 falhas / 15 min por IP (várias contas a partir do mesmo sítio)
 *   - portalLimiter:     600 / 10 min por IP — rotas públicas do portal do cliente (clientes na mesma rede Wi-Fi)
 *   - portalPinLimiter:  10 falhas / 15 min por IP + telefone/cliente — rotas do portal que verificam o PIN
 *   - saasLimiter:       5 / 15 min — criação de tenants (superadmin)
 *   - stockMovLimiter:   60 / min por pessoa — movimentos de stock (transacções)
 *   - agenteLimiter:     120 / min por IP — agente local de impressão em rede (fora do global)
 *
 * RATE_LIMIT_GLOBAL_MAX: só para o servidor dos testes de navegador (todos os testes vêm do mesmo IP e da mesma conta).
 */

const rateLimit = require('express-rate-limit');
const { lerTokenOpcional } = require('./auth');

const base = { standardHeaders: true, legacyHeaders: false };
const MSG = 'Demasiados pedidos. Tente novamente dentro de alguns minutos.';

/** Pessoa com sessão válida (assinatura verificada: um token inventado não abre um balde novo) ou, sem ela, o IP. */
function quem(req) {
  if (req._quemLimite) return req._quemLimite;
  const t = lerTokenOpcional(req);
  req._quemLimite = t && t.id ? { chave: `u:${t.id}`, sessao: true } : { chave: `ip:${req.ip}`, sessao: false };
  return req._quemLimite;
}
const chaveQuem = req => quem(req).chave;
const naoAgente = req => req.path.startsWith('/agente-impressao');

const globalLimiter = rateLimit({
  ...base,
  windowMs: 10 * 60 * 1000,
  max: req => Number(process.env.RATE_LIMIT_GLOBAL_MAX) || (quem(req).sessao ? 3000 : 1500),
  keyGenerator: chaveQuem,
  message: { erro: MSG },
  // o agente local de impressão consulta a fila a cada 3 s: tem limitador próprio (agenteLimiter)
  skip: naoAgente,
});

const apiWriteLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  max: req => (quem(req).sessao ? 300 : 120),
  keyGenerator: chaveQuem,
  message: { erro: 'Demasiados pedidos de escrita. Tente novamente em breve.' },
  skip: (req) => req.method === 'GET' || req.method === 'HEAD' || naoAgente(req),
});

/** Agente local de impressão em rede: consulta a fila a cada 3 s e confirma cada trabalho. */
const agenteLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  max: 120,
  message: { erro: 'Demasiados pedidos do agente de impressão.' },
});

// Login: só as falhas contam. Por IP + email, para um funcionário que se engana não bloquear os colegas da mesma rede;
// e um tecto por IP, para não se poder experimentar muitas contas a partir do mesmo sítio.
const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: req => `${req.ip}|${String((req.body && req.body.email) || (req.user && req.user.id) || '').trim().toLowerCase()}`,
  skipSuccessfulRequests: true,
  message: { erro: 'Demasiadas tentativas de login. Aguarde 15 minutos.' },
});
const loginIpLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  max: 60,
  skipSuccessfulRequests: true,
  message: { erro: 'Demasiadas tentativas de login a partir desta rede. Aguarde 15 minutos.' },
});

// Portal do cliente (público): os clientes de um estabelecimento partilham a mesma rede Wi-Fi.
const portalLimiter = rateLimit({
  ...base,
  windowMs: 10 * 60 * 1000,
  max: 600,
  message: { erro: 'Demasiados pedidos. Tente novamente dentro de alguns minutos.' },
});
// Rotas do portal que verificam o PIN (4 dígitos): só as falhas, por IP + telefone/cliente.
const idPortal = req => String((req.body && (req.body.telefone || req.body.cliente_id)) || (req.query && req.query.cliente_id) || '').trim();
const portalPinLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: req => `${req.ip}|${idPortal(req)}`,
  // sem telefone/cliente não há PIN a adivinhar (ex.: pedido de convidado): não conta, para não bloquear os outros clientes
  skip: req => !idPortal(req),
  skipSuccessfulRequests: true,
  message: { erro: 'Demasiadas tentativas com o PIN. Aguarde 15 minutos ou peça ajuda no balcão.' },
});

const saasLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { erro: 'Demasiados pedidos ao painel de administração.' },
});

const stockMovLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: chaveQuem,
  message: { erro: 'Demasiados movimentos de stock em simultâneo.' },
});

module.exports = {
  globalLimiter, agenteLimiter, loginLimiter, loginIpLimiter, portalLimiter, portalPinLimiter,
  saasLimiter, apiWriteLimiter, stockMovLimiter, quem,
};
