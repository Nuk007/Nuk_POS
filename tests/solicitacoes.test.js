'use strict';
/**
 * Unitários (pool mockado) — solicitações do portal: validação de entrada e listagem paginada.
 * O comportamento com PostgreSQL real (isolamento entre estabelecimentos) está em
 * tests/integration/portal-solicitacoes.int.test.js.
 */
const svc = require('../server/services/solicitacoes.service');
const { broadcast } = require('../server/middleware/broadcast');

const TENANT = 'bbc44510-a49a-4e1e-88a1-cae77c7c8f02';
const valido = (extra = {}) => ({ tenantId: TENANT, tipo: 'EVENTO', nome_servico: 'Casamento', nome: 'Maria Silva', telefone: '923111222', ...extra });

beforeEach(() => { mockPool.query.mockReset(); broadcast.mockClear(); });

describe('criar', () => {
  test('grava com o tenant do servidor, normaliza o telefone e avisa o POS em tempo real', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'x', status: 'PENDENTE' }] });
    const r = await svc.criar(valido({ telefone: '923 111 222', nome_servico: '  Casamento  ' }));
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO solicitacoes_portal/);
    expect(params[1]).toBe(TENANT);
    expect(params.slice(2, 6)).toEqual(['EVENTO', 'Casamento', 'Maria Silva', '923111222']);
    expect(broadcast).toHaveBeenCalledWith('nova_solicitacao_portal', expect.objectContaining({ tipo: 'EVENTO', telefone_contacto: '923111222' }), TENANT);
    expect(r.solicitacao.status).toBe('PENDENTE');
  });

  test.each([
    ['tipo inválido', { tipo: 'OUTRO' }],
    ['serviço vazio', { nome_servico: '  ' }],
    ['serviço demasiado longo', { nome_servico: 'x'.repeat(121) }],
    ['nome curto', { nome: 'M' }],
    ['telefone inválido', { telefone: '12345' }],
  ])('recusa %s com 400 e não grava nem avisa', async (_, extra) => {
    await expect(svc.criar(valido(extra))).rejects.toMatchObject({ statusCode: 400 });
    expect(mockPool.query).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('observações são cortadas aos 500 caracteres', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{}] });
    await svc.criar(valido({ observacoes: 'a'.repeat(900) }));
    expect(mockPool.query.mock.calls[0][1][6]).toHaveLength(500);
  });
});

describe('listar', () => {
  test('filtra sempre por tenant, pagina e devolve { data, page, limit, total }', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: '1' }, { id: '2' }] }).mockResolvedValueOnce({ rows: [{ count: '7' }] });
    const r = await svc.listar({ tenantId: TENANT, status: 'PENDENTE', page: '2', limit: '2' });
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/WHERE tenant_id = \$1 AND status = \$2/);
    expect(params).toEqual([TENANT, 'PENDENTE', 2, 2]);
    expect(r).toEqual({ data: [{ id: '1' }, { id: '2' }], page: 2, limit: 2, total: 7 });
  });
  test('o limite máximo é 100 e filtros inválidos dão 400', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ count: '0' }] });
    expect((await svc.listar({ tenantId: TENANT, limit: 9999 })).limit).toBe(100);
    await expect(svc.listar({ tenantId: TENANT, status: 'XPTO' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.listar({ tenantId: TENANT, tipo: 'XPTO' })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('actualizarStatus', () => {
  test('só altera dentro do tenant; inexistente → 404; estado inválido → 400', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'a', status: 'CONFIRMADA' }] });
    const r = await svc.actualizarStatus({ tenantId: TENANT, id: 'a', status: 'CONFIRMADA' });
    expect(mockPool.query.mock.calls[0][0]).toMatch(/WHERE id = \$2 AND tenant_id = \$3/);
    expect(mockPool.query.mock.calls[0][1]).toEqual(['CONFIRMADA', 'a', TENANT]);
    expect(r.status).toBe('CONFIRMADA');
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await expect(svc.actualizarStatus({ tenantId: TENANT, id: 'b', status: 'CANCELADA' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.actualizarStatus({ tenantId: TENANT, id: 'c', status: 'XPTO' })).rejects.toMatchObject({ statusCode: 400 });
  });
});
