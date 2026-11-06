'use strict';
/**
 * Regras ON DELETE das chaves estrangeiras das tabelas de caixa, compras e serviços.
 * Sem elas, apagar um estabelecimento (cascata) falha porque a verificação de `funcionarios` corre antes
 * de a cascata apagar as linhas que os referenciam. Partilhado pela migração 1750200000000 e pelo espelho em db.js.
 * [tabela, coluna, tabela referenciada, acção]
 */
module.exports = [
  ['caixa_sessoes', 'aberta_por', 'funcionarios', 'SET NULL'],
  ['caixa_sessoes', 'fechada_por', 'funcionarios', 'SET NULL'],
  ['cartoes_consumo', 'vendido_por', 'funcionarios', 'SET NULL'],
  ['movimentos_cartao', 'pedido_id', 'pedidos', 'SET NULL'],
  ['caixa_movimentos', 'sessao_id', 'caixa_sessoes', 'CASCADE'],
  ['caixa_movimentos', 'pedido_id', 'pedidos', 'SET NULL'],
  ['caixa_movimentos', 'cliente_id', 'clientes', 'SET NULL'],
  ['caixa_movimentos', 'cartao_id', 'cartoes_consumo', 'SET NULL'],
  ['caixa_movimentos', 'criado_por', 'funcionarios', 'SET NULL'],
  ['caixa_movimentos', 'compra_id', 'compras_pontuais', 'SET NULL'],
  ['pedidos', 'pago_por', 'funcionarios', 'SET NULL'],
  ['compras_pontuais', 'sessao_id', 'caixa_sessoes', 'CASCADE'],
  ['compras_pontuais', 'stock_item_id', 'stock_items', 'CASCADE'],
  ['compras_pontuais', 'criado_por', 'funcionarios', 'SET NULL'],
  ['compras_pontuais', 'anulada_por', 'funcionarios', 'SET NULL'],
  ['ocorrencias_servico', 'ativo_id', 'ativos_servico', 'SET NULL'],
  ['ocorrencias_servico', 'reportado_por', 'funcionarios', 'SET NULL'],
  ['manutencoes_plano', 'ativo_id', 'ativos_servico', 'CASCADE'],
  ['manutencoes_registo', 'realizada_por', 'funcionarios', 'SET NULL'],
];
