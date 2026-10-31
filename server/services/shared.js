'use strict';
/**
 * Utilitários partilhados entre services.
 */

/**
 * buildWhere — constrói cláusula WHERE parametrizada para filtros dinâmicos.
 * Extraído de routes/pedidos.js para reutilização nos services.
 */
function buildWhere(base, vals, filters = {}, alias = '') {
  const conditions = [...base];
  const values     = [...vals];
  const prefix     = alias ? `${alias}.` : '';

  for (const [col, val] of Object.entries(filters)) {
    if (val !== undefined && val !== null && val !== '') {
      values.push(val);
      conditions.push(`${prefix}${col} = $${values.length}`);
    }
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    vals:  values,
  };
}

module.exports = { buildWhere };
