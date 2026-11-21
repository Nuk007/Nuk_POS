'use strict';
/**
 * Documentação da API: o swagger-jsdoc tem de ler todas as anotações sem avisos. Com uma descrição com chavetas sem
 * aspas (ex.: «({ chave: valor })»), ignora o ficheiro inteiro e só escreve «Not all input has been taken into
 * account» na consola (aconteceu a 21/11/2026 com /api/configuracoes; apanhado no arranque dos testes do navegador).
 */
test('o swagger-jsdoc lê todas as rotas sem avisos e as rotas novas estão documentadas', () => {
  const avisos = [];
  const espiar = (...a) => avisos.push(a.join(' '));
  const sLog = jest.spyOn(console, 'log').mockImplementation(espiar);
  const sWarn = jest.spyOn(console, 'warn').mockImplementation(espiar);
  const sErr = jest.spyOn(console, 'error').mockImplementation(espiar);
  let spec;
  jest.isolateModules(() => { const m = require('../server/swagger'); spec = m.spec || m.swaggerSpec || m; });
  sLog.mockRestore(); sWarn.mockRestore(); sErr.mockRestore();
  expect(avisos.filter(a => /Not all input|YAML|Error in/i.test(a))).toEqual([]);
  for (const p of ['/api/configuracoes', '/api/dashboard', '/api/solicitacoes-hospedagem', '/api/produtos/etiquetas.pdf',
    '/api/produtos/codigo/{codigo}', '/api/quartos/tempos', '/api/configuracoes/fluxos/{fluxo}', '/api/pedidos/fluxos/categorias']) {
    expect([p, !!spec.paths[p]]).toEqual([p, true]);
  }
});
