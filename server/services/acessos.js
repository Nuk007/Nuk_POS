'use strict';
/**
 * Acessos (módulos e capacidades) e a regra de delegação:
 *  - o TITULAR (1.º administrador) tem tudo e define os acessos dos outros administradores;
 *  - um administrador não titular só atribui aos restantes funcionários acessos que ele próprio tem
 *    (o seu limite foi fixado pelo titular) e não cria nem edita administradores.
 * `permissoes` NULL = predefinição do nível (comportamento anterior à delegação).
 */
const MODULOS = ['dashboard', 'pedidos', 'mesas', 'quartos', 'solicitacoes', 'produtos', 'stock', 'financeiro', 'clientes', 'funcionarios', 'configuracoes'];
const CAPACIDADES = ['vender_quartos', 'arrumar_quartos']; // limite para atribuir os perfis de quartos
const TODAS = [...MODULOS, ...CAPACIDADES];
const ROTULOS = {
  dashboard: 'Dashboard', pedidos: 'Pedidos', mesas: 'Mesas', quartos: 'Quartos', solicitacoes: 'Solicitações', produtos: 'Menu / Produtos',
  stock: 'Stock', financeiro: 'Financeiro', clientes: 'Clientes', funcionarios: 'Funcionários', configuracoes: 'Configurações',
  vender_quartos: 'Atribuir «vender quartos»', arrumar_quartos: 'Atribuir «arrumar quartos»',
};
const PADRAO = {
  ADMIN: TODAS,
  GERENTE: TODAS.filter(p => p !== 'configuracoes'),
  OPERADOR: TODAS.filter(p => !['funcionarios', 'configuracoes'].includes(p)),
};

/** Acessos efectivos de um funcionário (linha da BD). */
function efectivas(f) {
  if (!f) return [];
  if (f.titular) return TODAS;
  if (Array.isArray(f.permissoes)) return f.permissoes.filter(p => TODAS.includes(p));
  return PADRAO[f.nivel_acesso] || [];
}
const interseccao = (a, b) => a.filter(x => b.includes(x));

module.exports = { MODULOS, CAPACIDADES, TODAS, ROTULOS, PADRAO, efectivas, interseccao };
