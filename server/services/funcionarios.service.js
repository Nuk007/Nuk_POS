'use strict';
/**
 * FuncionariosService — contas do estabelecimento.
 * Regra do dono: a 1.ª conta (ADMIN) é a TITULAR; não se desactiva nem se despromove — só transfere a titularidade.
 */
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const { erro, withTx } = require('./shared');
const ac = require('./acessos');

const NIVEIS = ['ADMIN', 'GERENTE', 'OPERADOR'];
const COLS = `id, nome, email, cargo, nivel_acesso, salario, media_avaliacao, total_avaliacoes, ativo, titular,
              pode_vender_quartos, arruma_quartos, permissoes, ultimo_acesso, criado_em`;

const bool = v => (v === undefined || v === null ? null : v === true || v === 'true');

const comAcessos = ({ ...f }) => ({ ...f, acessos: ac.efectivas(f) });

async function listar({ tenantId }) {
  const r = await pool.query(`SELECT ${COLS} FROM funcionarios WHERE ($1::uuid IS NULL OR tenant_id = $1) ORDER BY titular DESC, nome`, [tenantId || null]);
  return r.rows.map(comAcessos);
}

async function actorDe(tenantId, actorId) {
  const r = await pool.query(`SELECT id, nivel_acesso, titular, permissoes FROM funcionarios WHERE id = $1 AND ($2::uuid IS NULL OR tenant_id = $2) AND ativo = true`, [actorId, tenantId || null]);
  if (!r.rows[0]) throw erro(403, 'Utilizador sem acesso');
  return r.rows[0];
}

/** Lista de acessos válida (só chaves conhecidas, sem repetidos). */
function validarLista(p) {
  if (!Array.isArray(p) || p.some(x => !ac.TODAS.includes(x))) throw erro(400, 'Lista de acessos inválida');
  return [...new Set(p)];
}

/**
 * Regras de delegação. O titular pode tudo; os outros administradores só gerem funcionários (não administradores)
 * e só atribuem acessos que eles próprios têm — o limite foi fixado pelo titular.
 * Devolve a lista de acessos a gravar (undefined = não mexer).
 */
function aplicarDelegacao({ actor, alvo, nivel, permissoes, vender, arrumar }) {
  const meu = ac.efectivas(actor);
  if (!meu.includes('funcionarios')) throw erro(403, 'Não tem acesso à gestão de funcionários');
  if (actor.titular) {
    return permissoes === undefined ? undefined : (permissoes === null ? null : validarLista(permissoes));
  }
  if (nivel === 'ADMIN' || (alvo && (alvo.nivel_acesso === 'ADMIN' || alvo.titular))) {
    throw erro(403, 'Só o titular do estabelecimento cria ou altera administradores e os seus acessos.');
  }
  if ((vender === true && !meu.includes('vender_quartos')) || (arrumar === true && !meu.includes('arrumar_quartos'))) {
    throw erro(403, 'Não pode atribuir um perfil de quartos que o titular não lhe delegou.');
  }
  let lista = permissoes === undefined || permissoes === null ? undefined : validarLista(permissoes);
  if (lista) {
    const excesso = lista.filter(x => !meu.includes(x));
    if (excesso.length) throw erro(403, `Só pode atribuir acessos que tem: não pode dar ${excesso.map(x => ac.ROTULOS[x]).join(', ')}.`);
    if (alvo && ac.efectivas(alvo).some(x => !meu.includes(x))) throw erro(403, 'Este funcionário tem acessos acima do seu limite, que não pode alterar.');
  } else if (!alvo || (nivel && nivel !== alvo.nivel_acesso)) {
    // conta nova ou mudança de nível: grava a predefinição do nível já cortada pelo limite de quem atribui
    lista = ac.interseccao(ac.PADRAO[nivel || (alvo && alvo.nivel_acesso)] || [], meu);
  }
  return lista;
}

async function criar({ tenantId, actorId, nome, email, password, nivel_acesso, cargo, salario, pode_vender_quartos, arruma_quartos, permissoes }) {
  if (!nome || !email || !password) throw erro(400, 'nome, email e password são obrigatórios');
  if (!NIVEIS.includes(nivel_acesso)) throw erro(400, `nivel_acesso inválido. Valores: ${NIVEIS.join(', ')}`);
  const lista = aplicarDelegacao({ actor: await actorDe(tenantId, actorId), alvo: null, nivel: nivel_acesso, permissoes, vender: bool(pode_vender_quartos), arrumar: bool(arruma_quartos) });
  if (String(password).length < 8) throw erro(400, 'A palavra-passe deve ter pelo menos 8 caracteres');
  // M-02: unicidade de email por tenant, não global
  const ex = await pool.query(`SELECT id FROM funcionarios WHERE LOWER(email) = LOWER($1) AND ($2::uuid IS NULL OR tenant_id = $2)`, [email.trim(), tenantId || null]);
  if (ex.rows[0]) throw erro(409, 'Email já registado neste estabelecimento');
  const hash = await bcrypt.hash(password, 12);
  const r = await pool.query(
    `INSERT INTO funcionarios (id, tenant_id, nome, email, password_hash, nivel_acesso, cargo, salario, pode_vender_quartos, arruma_quartos, permissoes, ativo, criado_em)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,NOW()) RETURNING ${COLS}`,
    [uuidv4(), tenantId || null, nome.trim(), email.trim().toLowerCase(), hash, nivel_acesso, cargo || null, Number(salario) || 0, bool(pode_vender_quartos) === true, bool(arruma_quartos) === true, lista ? JSON.stringify(lista) : null]);
  return comAcessos(r.rows[0]);
}

async function actualizar({ tenantId, actorId, id, nome, nivel_acesso, ativo, password, cargo, salario, pode_vender_quartos, arruma_quartos, permissoes }) {
  if (nivel_acesso !== undefined && !NIVEIS.includes(nivel_acesso)) throw erro(400, `nivel_acesso inválido. Valores: ${NIVEIS.join(', ')}`);
  if (password !== undefined && password !== '' && String(password).length < 8) throw erro(400, 'A palavra-passe deve ter pelo menos 8 caracteres');
  const actor = await actorDe(tenantId, actorId);
  const alvo = (await pool.query(`SELECT id, nivel_acesso, titular, permissoes FROM funcionarios WHERE id = $1 AND ($2::uuid IS NULL OR tenant_id = $2)`, [id, tenantId || null])).rows[0];
  if (!alvo) throw erro(404, 'Funcionário não encontrado');
  const lista = aplicarDelegacao({ actor, alvo, nivel: nivel_acesso, permissoes, vender: bool(pode_vender_quartos), arrumar: bool(arruma_quartos) });
  const hash = password ? await bcrypt.hash(password, 12) : null;
  const novoAtivo = ativo !== undefined ? bool(ativo) : null;
  // A guarda do titular está no próprio UPDATE: nunca fica inactivo nem deixa de ser ADMIN.
  const r = await pool.query(
    `UPDATE funcionarios SET
       nome = COALESCE($1, nome),
       nivel_acesso = COALESCE($2, nivel_acesso),
       ativo = COALESCE($3, ativo),
       password_hash = COALESCE($4, password_hash),
       cargo = COALESCE($5, cargo),
       salario = COALESCE($6, salario),
       pode_vender_quartos = COALESCE($7, pode_vender_quartos),
       arruma_quartos = COALESCE($8, arruma_quartos),
       permissoes = CASE WHEN $11::boolean THEN $12::jsonb ELSE permissoes END,
       atualizado_em = NOW()
     WHERE id = $9 AND ($10::uuid IS NULL OR tenant_id = $10)
       AND NOT (titular AND (COALESCE($3, true) = false OR COALESCE($2, 'ADMIN') <> 'ADMIN'))
     RETURNING ${COLS}`,
    [nome || null, nivel_acesso || null, novoAtivo, hash, cargo === undefined ? null : cargo, salario === undefined ? null : Number(salario) || 0,
     bool(pode_vender_quartos), bool(arruma_quartos), id, tenantId || null, lista !== undefined, lista ? JSON.stringify(lista) : null]);
  if (r.rows[0]) return comAcessos(r.rows[0]);
  const ex = await pool.query(`SELECT titular FROM funcionarios WHERE id = $1 AND ($2::uuid IS NULL OR tenant_id = $2)`, [id, tenantId || null]);
  if (!ex.rows[0]) throw erro(404, 'Funcionário não encontrado');
  throw erro(403, 'O titular do estabelecimento não pode ser desactivado nem despromovido. Transfira primeiro a titularidade.');
}

/** O titular actual passa a titularidade a outro funcionário activo (que fica ADMIN). Exige a palavra-passe do titular. */
async function transferirTitularidade({ tenantId, userId, novoTitularId, password }) {
  if (!novoTitularId || !password) throw erro(400, 'Indique o novo titular e a sua palavra-passe');
  if (!tenantId) throw erro(400, 'Estabelecimento em falta');
  const eu = await pool.query(`SELECT titular, password_hash FROM funcionarios WHERE id = $1 AND tenant_id = $2 AND ativo = true`, [userId, tenantId]);
  if (!eu.rows[0] || !eu.rows[0].titular) throw erro(403, 'Só o titular do estabelecimento pode transferir a titularidade');
  if (!(await bcrypt.compare(String(password), eu.rows[0].password_hash))) throw erro(401, 'Palavra-passe incorrecta');
  if (novoTitularId === userId) throw erro(400, 'Já é o titular');
  return withTx(async (db) => {
    const alvo = await db.query(`SELECT id, nome FROM funcionarios WHERE id = $1 AND tenant_id = $2 AND ativo = true FOR UPDATE`, [novoTitularId, tenantId]);
    if (!alvo.rows[0]) throw erro(404, 'Funcionário não encontrado ou inactivo');
    await db.query(`UPDATE funcionarios SET titular = false WHERE tenant_id = $1 AND titular`, [tenantId]);
    await db.query(`UPDATE funcionarios SET titular = true, nivel_acesso = 'ADMIN', atualizado_em = NOW() WHERE id = $1`, [novoTitularId]);
    return { titular_id: novoTitularId, nome: alvo.rows[0].nome };
  });
}

/** Tem o perfil pedido? (consulta à BD: a revogação é imediata, não depende do JWT) */
async function temPerfil(tenantId, userId, coluna) {
  if (!['pode_vender_quartos', 'arruma_quartos'].includes(coluna)) throw new Error('perfil desconhecido'); // coluna fixa
  const r = await pool.query(`SELECT ${coluna} AS v FROM funcionarios WHERE id = $1 AND tenant_id = $2 AND ativo = true`, [userId, tenantId]);
  return !!(r.rows[0] && r.rows[0].v);
}

/** Metadados para a UI: acessos existentes e o limite de quem pergunta. */
async function metadadosAcessos({ tenantId, actorId }) {
  const a = await actorDe(tenantId, actorId);
  return { modulos: ac.MODULOS, capacidades: ac.CAPACIDADES, rotulos: ac.ROTULOS, padrao: ac.PADRAO, meu_limite: ac.efectivas(a), sou_titular: !!a.titular };
}

module.exports = { metadadosAcessos, listar, criar, actualizar, transferirTitularidade, temPerfil, NIVEIS };
