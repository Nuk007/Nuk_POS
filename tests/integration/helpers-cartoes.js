'use strict';
/**
 * Ajuda dos testes: como só o Administrador gera códigos (lotes), «vender um cartão» nos testes = gerar um lote
 * de uma folha (10) e vender o primeiro pelo código. `pedido(T, metodo, url, corpo)` é o pedido autenticado do teste.
 */
async function novoCodigo(pedido, T, valor) {
  const l = await pedido(T, 'post', '/api/caixa/cartoes/lotes', { valor, quantidade: 10 });
  if (l.status !== 201) throw new Error(`lote: ${l.status} ${JSON.stringify(l.body)}`);
  return (await pedido(T, 'get', `/api/caixa/cartoes/lotes/${l.body.id}`)).body.cartoes[0].codigo;
}
async function venderCartaoNovo(pedido, T, valor, metodo = 'CASH') {
  const codigo = await novoCodigo(pedido, T, valor);
  const r = await pedido(T, 'post', '/api/caixa/cartoes/vender', { valor, metodo, codigos: [codigo] });
  return { status: r.status, body: r.status === 200 ? r.body.cartoes[0] : r.body, codigo };
}
module.exports = { novoCodigo, venderCartaoNovo };
