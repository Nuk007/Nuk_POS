'use strict';
/**
 * Acessos (módulos e capacidades) e a regra de delegação:
 *  - o TITULAR (1.º administrador) tem tudo e define os acessos dos outros administradores;
 *  - um administrador não titular só atribui aos restantes funcionários acessos que ele próprio tem
 *    (o seu limite foi fixado pelo titular) e não cria nem edita administradores.
 * `permissoes` NULL = predefinição do nível (comportamento anterior à delegação).
 */
const MODULOS = ['dashboard', 'caixa', 'pedidos', 'mesas', 'produtos', 'quartos', 'solicitacoes', 'lazer', 'loja', 'compras', 'stock', 'servicos', 'funcionarios', 'financeiro', 'patrimonio', 'clientes', 'configuracoes'];
const CAPACIDADES = ['vender_quartos', 'arrumar_quartos']; // limite para atribuir os perfis de quartos
const TODAS = [...MODULOS, ...CAPACIDADES];
const ROTULOS = {
  dashboard: 'Dashboard', pedidos: 'Pedidos', mesas: 'Mesas', quartos: 'Quartos', solicitacoes: 'Solicitações', produtos: 'Menu / Produtos',
  caixa: 'Caixa do dia', lazer: 'Lazer', loja: 'Loja', compras: 'Compras', servicos: 'Serviços', patrimonio: 'Património',
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

/**
 * Módulos LICENCIÁVEIS (o que o estabelecimento contrata). Cada um ativa um conjunto de acessos (as chaves acima).
 * `pronto: false` = ainda sem ecrãs: o superadmin não os consegue contratar.
 * Dashboard e Configuração existem sempre (a Configuração só mostra o que está contratado).
 */
const LICENCAS = {
  restauracao: { rotulo: 'Vendas · Restauração', grupo: 'Vendas', acessos: ['pedidos', 'mesas', 'produtos', 'solicitacoes'], pronto: true },
  hospedagem: { rotulo: 'Vendas · Hospedagem', grupo: 'Vendas', acessos: ['quartos', 'solicitacoes'], pronto: true },
  lazer: { rotulo: 'Vendas · Lazer', grupo: 'Vendas', acessos: ['lazer', 'solicitacoes'], pronto: false },
  loja: { rotulo: 'Vendas · Loja', grupo: 'Vendas', acessos: ['loja', 'solicitacoes'], pronto: false },
  caixa: { rotulo: 'Caixa', grupo: 'Caixa', acessos: ['clientes', 'caixa'], pronto: true },
  compras: { rotulo: 'Compras e stock', grupo: 'Compras', acessos: ['stock', 'compras'], pronto: true },
  servicos: { rotulo: 'Serviços (avarias e manutenção)', grupo: 'Serviços', acessos: ['servicos'], pronto: false },
  rh: { rotulo: 'Administração · RH', grupo: 'Administração', acessos: ['funcionarios'], pronto: true },
  financas: { rotulo: 'Administração · Finanças', grupo: 'Administração', acessos: ['financeiro'], pronto: true },
  patrimonio: { rotulo: 'Administração · Património', grupo: 'Administração', acessos: ['patrimonio'], pronto: false },
};
const SEMPRE = ['dashboard', 'configuracoes'];
const PRONTOS = Object.keys(LICENCAS).filter(k => LICENCAS[k].pronto);
// Módulos que cada plano traz por omissão (o superadmin pode ajustar por estabelecimento)
const PLANOS_MODULOS = {
  BASICO: ['restauracao', 'caixa', 'rh'],
  PRO: ['restauracao', 'hospedagem', 'caixa', 'compras', 'rh', 'financas'],
  ENTERPRISE: PRONTOS,
};
/** Módulos contratados (NULL = todos os prontos, para estabelecimentos anteriores a esta funcionalidade). */
const licenciados = (modulos) => (Array.isArray(modulos) ? modulos : PRONTOS).filter(m => LICENCAS[m]);
/** Chaves de acesso que a licença permite. */
const chavesLicenciadas = (modulos) => [...new Set([...SEMPRE, ...licenciados(modulos).flatMap(m => LICENCAS[m].acessos)])];
/** Acessos que o funcionário realmente tem: os seus ∩ o que o estabelecimento contratou. */
const efectivasLicenciadas = (f, modulos) => interseccao(efectivas(f), chavesLicenciadas(modulos));
/** Valida a lista vinda do superadmin: só módulos conhecidos e já prontos. */
function validarModulos(lista) {
  if (!Array.isArray(lista) || !lista.length) throw Object.assign(new Error('Escolha pelo menos um módulo'), { statusCode: 400 });
  const mau = lista.find(m => !LICENCAS[m] || !LICENCAS[m].pronto);
  if (mau) throw Object.assign(new Error(`Módulo indisponível: ${mau}`), { statusCode: 400 });
  return [...new Set(lista)];
}

module.exports = { LICENCAS, SEMPRE, PRONTOS, PLANOS_MODULOS, licenciados, chavesLicenciadas, efectivasLicenciadas, validarModulos, MODULOS, CAPACIDADES, TODAS, ROTULOS, PADRAO, efectivas, interseccao };
