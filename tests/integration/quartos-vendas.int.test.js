'use strict';
/** Integração — vendas de quartos pelos botões, reservas (★), arrumação com prazo, escalada e atraso no dashboard. */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app } = require('../../server/app');
const vendas = require('../../server/services/quartos-vendas.service');
const dash = require('../../server/services/dashboard.service');

let A, B, vendedor, arrumador, gerente, semPerfil, ipN = 1;
const ip = () => `10.14.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const com = (T, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(body);
const MIN = 60e3;
let seq = 0;

async function pessoa(T, nivel, flags = {}) {
  const email = `p${++seq}@${T.slug}.ao`;
  const id = (await pool.query(
    `INSERT INTO funcionarios (tenant_id, nome, email, password_hash, nivel_acesso, pode_vender_quartos, arruma_quartos)
     VALUES ($1,$2,$3,'x',$4,$5,$6) RETURNING id`, [T.tenantId, email, email, nivel, !!flags.vende, !!flags.arruma])).rows[0].id;
  return { token: jwt.sign({ id, email, nivel_acesso: nivel, tenantId: T.tenantId }, process.env.JWT_SECRET, { expiresIn: '1h' }), id, slug: T.slug };
}
async function quarto(T, numero) {
  return (await pool.query(`INSERT INTO quartos (tenant_id, numero, tipo, preco_2h, preco_pernoite, preco_diaria) VALUES ($1,$2,'SUITE',15000,30000,45000) RETURNING id`, [T.tenantId, numero])).rows[0].id;
}
const estado = async (T, id) => (await com(T, 'get', '/api/quartos')).body.find(q => q.id === id);
const daqui = min => new Date(Date.now() + min * MIN).toISOString();

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-qv-a' });
  B = await criarTenantFixture({ slug: 'it-qv-b' });
  vendedor = await pessoa(A, 'OPERADOR', { vende: true });
  arrumador = await pessoa(A, 'OPERADOR', { arruma: true });
  gerente = await pessoa(A, 'GERENTE');
  semPerfil = await pessoa(A, 'OPERADOR');
}, 60000);

describe('Venda directa pelo botão do quarto', () => {
  let q;
  beforeAll(async () => { q = await quarto(A, 'V1'); });
  test('sem o perfil «vender quartos» ninguém vende (nem o administrador)', async () => {
    expect((await com(semPerfil, 'post', `/api/quartos/${q}/vender`, { fracao: 'DUAS_HORAS' })).status).toBe(403);
    expect((await com(A, 'post', `/api/quartos/${q}/vender`, { fracao: 'DUAS_HORAS' })).status).toBe(403);
    expect((await com(gerente, 'post', `/api/quartos/${q}/vender`, { fracao: 'DUAS_HORAS' })).status).toBe(403);
  });
  test('serviço inválido → 400', async () => {
    expect((await com(vendedor, 'post', `/api/quartos/${q}/vender`, { fracao: 'SEMANA' })).status).toBe(400);
  });
  test('vende uma hora: quarto ocupado, preço do quarto e hora em que fica livre (+30 min)', async () => {
    const r = await com(vendedor, 'post', `/api/quartos/${q}/vender`, { fracao: 'DUAS_HORAS', nome_hospede: 'Carlos' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('CHECKIN');
    expect(Number(r.body.valor_total)).toBe(15000);
    const e = await estado(A, q);
    expect(e.status).toBe('OCUPADO');
    expect(e.ocupacao.nome_hospede).toBe('Carlos');
    expect(new Date(e.livre_as) - new Date(e.ocupacao.checkout)).toBe(30 * MIN);
    expect(new Date(e.ocupacao.checkout) - new Date(e.ocupacao.checkin)).toBe(2 * 60 * MIN);
  });
  test('quarto ocupado não se vende outra vez', async () => {
    const r = await com(vendedor, 'post', `/api/quartos/${q}/vender`, { fracao: 'PERNOITE' });
    expect(r.status).toBe(409);
    expect(r.body.erro).toMatch(/ocupado/i);
  });
  test('outro estabelecimento não vê nem vende este quarto', async () => {
    const outro = await pessoa(B, 'OPERADOR', { vende: true });
    expect((await com(outro, 'post', `/api/quartos/${q}/vender`, { fracao: 'DUAS_HORAS' })).status).toBe(404);
    expect((await com(B, 'get', '/api/quartos')).body.find(x => x.id === q)).toBeUndefined();
  });
});

describe('Reservas e estrela', () => {
  let q;
  beforeAll(async () => { q = await quarto(A, 'R1'); });
  test('reserva daqui a 3 h → estrela amarela, quarto continua disponível e vende-se se couber', async () => {
    const r = await com(vendedor, 'post', `/api/quartos/${q}/reservar`, { fracao: 'DUAS_HORAS', inicio: daqui(180), nome_hospede: 'Ana' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('CONFIRMADA');
    const e = await estado(A, q);
    expect(e.estrela).toBe('AMARELA');
    expect(e.status).toBe('DISPONIVEL');
    expect(e.venda_bloqueada).toBeNull();
  });
  test('período incompatível (colide com a reserva + 30 min de arrumação) é recusado', async () => {
    expect((await com(vendedor, 'post', `/api/quartos/${q}/reservar`, { fracao: 'DUAS_HORAS', inicio: daqui(240) })).status).toBe(409);
    expect((await com(vendedor, 'post', `/api/quartos/${q}/reservar`, { fracao: 'PERNOITE', inicio: daqui(100) })).status).toBe(409);
  });
  test('período compatível (depois da arrumação) é aceite', async () => {
    expect((await com(vendedor, 'post', `/api/quartos/${q}/reservar`, { fracao: 'DUAS_HORAS', inicio: daqui(180 + 120 + 40) })).status).toBe(201);
  });
  test('início no passado e data inválida → 400', async () => {
    expect((await com(vendedor, 'post', `/api/quartos/${q}/reservar`, { fracao: 'DUAS_HORAS', inicio: daqui(-60) })).status).toBe(400);
    expect((await com(vendedor, 'post', `/api/quartos/${q}/reservar`, { fracao: 'DUAS_HORAS', inicio: 'ontem' })).status).toBe(400);
  });
  test('reserva a menos de 1 h → estrela vermelha: vendas bloqueadas, reservas compatíveis continuam', async () => {
    const q2 = await quarto(A, 'R2');
    expect((await com(vendedor, 'post', `/api/quartos/${q2}/reservar`, { fracao: 'DUAS_HORAS', inicio: daqui(45) })).status).toBe(201);
    const e = await estado(A, q2);
    expect(e.estrela).toBe('VERMELHA');
    expect(e.venda_bloqueada).toMatch(/bloqueadas/);
    const v = await com(vendedor, 'post', `/api/quartos/${q2}/vender`, { fracao: 'DUAS_HORAS' });
    expect(v.status).toBe(409);
    expect(v.body.codigo).toBe('ESTRELA_VERMELHA');
    expect((await com(vendedor, 'post', `/api/quartos/${q2}/reservar`, { fracao: 'DIARIA', inicio: daqui(45 + 120 + 40) })).status).toBe(201);
  });
  test('entrada: só na última hora antes do início; depois o quarto fica ocupado', async () => {
    const q3 = await quarto(A, 'R3');
    const longe = (await com(vendedor, 'post', `/api/quartos/${q3}/reservar`, { fracao: 'DUAS_HORAS', inicio: daqui(300) })).body.id;
    const e1 = await com(vendedor, 'post', `/api/quartos/reservas/${longe}/entrada`);
    expect(e1.status).toBe(409);
    const q4 = await quarto(A, 'R4');
    const perto = (await com(vendedor, 'post', `/api/quartos/${q4}/reservar`, { fracao: 'DUAS_HORAS', inicio: daqui(20) })).body.id;
    expect((await com(semPerfil, 'post', `/api/quartos/reservas/${perto}/entrada`)).status).toBe(403);
    const e2 = await com(vendedor, 'post', `/api/quartos/reservas/${perto}/entrada`);
    expect(e2.status).toBe(200);
    expect(e2.body.status).toBe('CHECKIN');
    expect((await estado(A, q4)).status).toBe('OCUPADO');
  });
  test('cancelar reserva por iniciar (pede perfil) e não mexe no estado do quarto', async () => {
    const q5 = await quarto(A, 'R5');
    const id = (await com(vendedor, 'post', `/api/quartos/${q5}/reservar`, { fracao: 'DUAS_HORAS', inicio: daqui(300) })).body.id;
    expect((await com(semPerfil, 'post', `/api/quartos/reservas/${id}/cancelar`)).status).toBe(403);
    expect((await com(vendedor, 'post', `/api/quartos/reservas/${id}/cancelar`)).status).toBe(200);
    const e = await estado(A, q5);
    expect(e.status).toBe('DISPONIVEL');
    expect(e.estrela).toBeNull();
    expect((await com(vendedor, 'post', `/api/quartos/reservas/${id}/cancelar`)).status).toBe(409);
  });
});

describe('Abrir quarto e arrumação', () => {
  let q;
  beforeAll(async () => {
    q = await quarto(A, 'L1');
    await com(vendedor, 'post', `/api/quartos/${q}/vender`, { fracao: 'DUAS_HORAS' });
  });
  test('abrir quarto exige o perfil e só se aplica a quartos ocupados', async () => {
    expect((await com(semPerfil, 'post', `/api/quartos/${q}/abrir`)).status).toBe(403);
    const r = await com(vendedor, 'post', `/api/quartos/${q}/abrir`);
    expect(r.status).toBe(200);
    expect((await com(vendedor, 'post', `/api/quartos/${q}/abrir`)).status).toBe(409);
  });
  test('o quarto passa a «a arrumar» com prazo de 30 min e hora livre = prazo', async () => {
    const e = await estado(A, q);
    expect(e.status).toBe('LIMPEZA');
    expect(e.limpeza.escalado).toBe(false);
    const dur = new Date(e.limpeza.prazo_em) - Date.now();
    expect(dur).toBeGreaterThan(29 * MIN); expect(dur).toBeLessThanOrEqual(30 * MIN);
    expect(e.livre_as).toBe(e.limpeza.prazo_em);
    expect((await pool.query(`SELECT status, saida_em FROM reservas WHERE quarto_id=$1`, [q])).rows[0]).toMatchObject({ status: 'CHECKOUT' });
  });
  test('não se vende enquanto está a ser arrumado', async () => {
    expect((await com(vendedor, 'post', `/api/quartos/${q}/vender`, { fracao: 'DUAS_HORAS' })).status).toBe(409);
  });
  test('no prazo só os arrumadores dão o quarto como limpo (nem a chefia)', async () => {
    expect((await com(semPerfil, 'post', `/api/quartos/${q}/limpo`)).status).toBe(403);
    expect((await com(gerente, 'post', `/api/quartos/${q}/limpo`)).status).toBe(403);
    expect((await com(A, 'post', `/api/quartos/${q}/limpo`)).status).toBe(403);
    const r = await com(arrumador, 'post', `/api/quartos/${q}/limpo`);
    expect(r.status).toBe(200);
    expect(r.body.atraso_min).toBe(0);
    expect((await estado(A, q)).status).toBe('DISPONIVEL');
    expect((await com(arrumador, 'post', `/api/quartos/${q}/limpo`)).status).toBe(409);
  });
});

describe('Prazo esgotado: escalada para a chefia e atraso medido', () => {
  let q;
  beforeAll(async () => {
    q = await quarto(A, 'E1');
    await com(vendedor, 'post', `/api/quartos/${q}/vender`, { fracao: 'DUAS_HORAS' });
    await com(vendedor, 'post', `/api/quartos/${q}/abrir`);
    await pool.query(`UPDATE quarto_limpezas SET prazo_em = NOW() - interval '12 minutes 30 seconds' WHERE quarto_id = $1 AND limpo_em IS NULL`, [q]);
  });
  test('o agendador escala a tarefa e a chefia fica a poder abrir', async () => {
    const t = await vendas.processarTick();
    expect(t.escaladas).toBeGreaterThanOrEqual(1);
    const { broadcast } = require('../../server/middleware/broadcast');
    expect(broadcast).toHaveBeenCalledWith('quarto_escalado', expect.objectContaining({ quarto_id: q, numero: 'E1' }), A.tenantId);
    expect((await estado(A, q)).limpeza.escalado).toBe(true);
  });
  test('depois do prazo os arrumadores já não podem; gerente e administrador sim', async () => {
    const r = await com(arrumador, 'post', `/api/quartos/${q}/limpo`);
    expect(r.status).toBe(403);
    expect(r.body.erro).toMatch(/gerente ou supervisor/);
    const antes = await dash.criarItem({ tenantId: A.tenantId, nome: 'Atraso quartos', fonte: 'SERVICO', ref: 'QUARTO_ATRASO' });
    const ok = await com(gerente, 'post', `/api/quartos/${q}/limpo`);
    expect(ok.status).toBe(200);
    expect(ok.body.atraso_min).toBe(13); // 12 min 30 s → arredonda para cima
    expect((await estado(A, q)).status).toBe('DISPONIVEL');
    const c = await dash.comparativo({ tenantId: A.tenantId });
    const it = c.itens.find(x => x.id === antes.id);
    expect(it.quantidade.hoje).toBe(13);
    expect(it.unidade).toBe('min de atraso');
  });
});

describe('Agendador: aviso 5 min antes do fim e fecho da ocupação', () => {
  test('a 5 min do fim avisa os arrumadores; no fim passa a «a arrumar» com prazo = hora limite + 30', async () => {
    const q = await quarto(A, 'T1');
    const v = (await com(vendedor, 'post', `/api/quartos/${q}/vender`, { fracao: 'DUAS_HORAS' })).body;
    const { broadcast } = require('../../server/middleware/broadcast');
    await vendas.processarTick();
    expect((await pool.query(`SELECT 1 FROM quarto_limpezas WHERE quarto_id=$1`, [q])).rowCount).toBe(0); // ainda longe do fim
    await pool.query(`UPDATE reservas SET checkin = NOW() - interval '115 minutes 30 seconds', checkout = NOW() + interval '4 minutes 30 seconds' WHERE id = $1`, [v.id]);
    broadcast.mockClear();
    await vendas.processarTick();
    expect(broadcast).toHaveBeenCalledWith('quarto_arrumar', expect.objectContaining({ quarto_id: q, motivo: 'FIM_TEMPO' }), A.tenantId);
    let l = (await pool.query(`SELECT origem, prazo_em FROM quarto_limpezas WHERE quarto_id=$1 AND limpo_em IS NULL`, [q])).rows[0];
    expect(l.origem).toBe('FIM_TEMPO');
    const r = (await pool.query(`SELECT checkout FROM reservas WHERE id=$1`, [v.id])).rows[0];
    expect(new Date(l.prazo_em) - new Date(r.checkout)).toBe(30 * MIN);
    expect((await estado(A, q)).status).toBe('OCUPADO'); // ainda dentro do tempo
    // idempotente: não avisa duas vezes
    broadcast.mockClear();
    await vendas.processarTick();
    expect(broadcast).not.toHaveBeenCalledWith('quarto_arrumar', expect.anything(), expect.anything());
    // acabou o tempo
    await pool.query(`UPDATE reservas SET checkout = NOW() - interval '1 minute' WHERE id = $1`, [v.id]);
    await vendas.processarTick();
    expect((await estado(A, q)).status).toBe('LIMPEZA');
    expect((await pool.query(`SELECT status FROM reservas WHERE id=$1`, [v.id])).rows[0].status).toBe('CHECKOUT');
  });
});

describe('Estado manual pela chefia', () => {
  test('manutenção/bloqueio só ADMIN/GERENTE; não se vende nem reserva quarto em manutenção', async () => {
    const q = await quarto(A, 'M1');
    expect((await com(vendedor, 'patch', `/api/quartos/${q}/status`, { status: 'MANUTENCAO' })).status).toBe(403);
    expect((await com(gerente, 'patch', `/api/quartos/${q}/status`, { status: 'MANUTENCAO' })).status).toBe(200);
    expect((await com(vendedor, 'post', `/api/quartos/${q}/vender`, { fracao: 'DUAS_HORAS' })).status).toBe(409);
    expect((await com(vendedor, 'post', `/api/quartos/${q}/reservar`, { fracao: 'DUAS_HORAS', inicio: daqui(300) })).status).toBe(409);
    expect((await com(gerente, 'patch', `/api/quartos/${q}/status`, { status: 'DISPONIVEL' })).status).toBe(200);
    expect((await com(gerente, 'patch', `/api/quartos/${q}/status`, { status: 'DESTRUIDO' })).status).toBe(400);
    expect((await com(B, 'patch', `/api/quartos/${q}/status`, { status: 'BLOQUEADO' })).status).toBe(404);
  });
  test('a chefia não contorna os 30 min das arrumadoras pelo estado manual', async () => {
    const q = await quarto(A, 'M2');
    await com(vendedor, 'post', `/api/quartos/${q}/vender`, { fracao: 'DUAS_HORAS' });
    await com(vendedor, 'post', `/api/quartos/${q}/abrir`);
    expect((await com(gerente, 'patch', `/api/quartos/${q}/status`, { status: 'DISPONIVEL' })).status).toBe(403);
  });
});

describe('Migração de dados antigos (quartos e perfil do único utilizador)', () => {
  const mig = require('../../migrations/1749600000000_quartos-dados-antigos');
  const correr = () => mig.up({ sql: q => pool.query(q) });
  const hora = min => new Date(Date.now() + min * MIN);
  const antigo = async (T, numero, status, ini, fim) => {
    const id = await quarto(T, numero);
    await pool.query(`UPDATE quartos SET status='OCUPADO' WHERE id=$1`, [id]); // como o fluxo antigo deixava
    await pool.query(`INSERT INTO reservas (tenant_id, quarto_id, fracao, checkin, checkout, status, valor_total) VALUES ($1,$2,'DUAS_HORAS',$3,$4,$5,15000)`, [T.tenantId, id, hora(ini), hora(fim), status]);
    return id;
  };
  test('reserva em curso do fluxo antigo passa a ocupação com hora de libertação; terminada manda arrumar; futura liberta o quarto com ★', async () => {
    const curso = await antigo(A, 'MG1', 'CONFIRMADA', -30, 90);
    const velha = await antigo(A, 'MG2', 'CONFIRMADA', -300, -180);
    const futura = await antigo(A, 'MG3', 'CONFIRMADA', 180, 300);
    const semDados = await quarto(A, 'MG4'); await pool.query(`UPDATE quartos SET status='OCUPADO' WHERE id=$1`, [semDados]);
    await correr();
    const e1 = await estado(A, curso);
    expect(e1.status).toBe('OCUPADO');
    expect(new Date(e1.livre_as) - new Date(e1.ocupacao.checkout)).toBe(30 * MIN);
    const e2 = await estado(A, velha);
    expect(e2.status).toBe('LIMPEZA');
    expect(e2.limpeza.escalado).toBe(false);
    const e3 = await estado(A, futura);
    expect(e3.status).toBe('DISPONIVEL');
    expect(e3.estrela).toBe('AMARELA');
    expect((await estado(A, semDados)).status).toBe('OCUPADO'); // sem dados: não se adivinha
    expect((await com(vendedor, 'post', `/api/quartos/${semDados}/abrir`)).status).toBe(200); // mas pode abrir-se
    expect((await estado(A, semDados)).status).toBe('LIMPEZA');
  });
  test('é idempotente', async () => { await correr(); await correr(); });
  test('o único utilizador do estabelecimento (titular) recebe os perfis; com mais utilizadores não se mexe', async () => {
    const S = await criarTenantFixture({ slug: 'it-qv-solo' });
    await pool.query(`UPDATE funcionarios SET titular = true WHERE id = $1`, [S.userId]);
    const antes = (await pool.query(`SELECT pode_vender_quartos v, arruma_quartos a FROM funcionarios WHERE id=$1`, [S.userId])).rows[0];
    expect(antes).toEqual({ v: false, a: false });
    await correr();
    expect((await pool.query(`SELECT pode_vender_quartos v, arruma_quartos a FROM funcionarios WHERE id=$1`, [S.userId])).rows[0]).toEqual({ v: true, a: true });
    const r = await com(S, 'post', `/api/quartos/${await quarto(S, 'S1')}/vender`, { fracao: 'DUAS_HORAS' });
    expect(r.status).toBe(201);
    // estabelecimento A tem vários utilizadores: o titular (A) continua sem perfil
    await pool.query(`UPDATE funcionarios SET titular = true WHERE id = $1`, [A.userId]);
    await correr();
    expect((await pool.query(`SELECT pode_vender_quartos v FROM funcionarios WHERE id=$1`, [A.userId])).rows[0].v).toBe(false);
  });
});
