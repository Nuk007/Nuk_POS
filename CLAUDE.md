# Nuk_POS — Guia para Claude

Sistema de ponto de venda SaaS multi-tenant (restaurantes, bares, hotelaria) para o mercado angolano.
Stack: Node.js + Express + PostgreSQL + Socket.io. Deploy: Render (Docker), auto-deploy do `master`.

## Regras de linguagem e estilo
- Todo o código, comentários, mensagens de erro e documentação em **português de Portugal** (nunca pt-BR: "utilizador", "actualizar", "stock", "fiabilidade").
- Moeda: Kz (Kwanza). Timezone de referência: `Africa/Luanda`.

## Arquitectura (NÃO violar)
- **Rotas finas** em `server/routes/*.js`: apenas validam input HTTP, chamam o serviço e mapeiam erros. Zero lógica de negócio nas rotas.
- **Lógica de negócio** em `server/services/*.service.js`. Serviços lançam erros com `err.statusCode` (e campos extra como `err.disponivel`); as rotas fazem `if (e.statusCode) return res.status(e.statusCode).json({erro: e.message}); next(e);`.
- **SQL sempre parametrizado** (`$1, $2…`). Filtros dinâmicos SÓ via `buildWhere()` de `server/services/shared.js` — nunca concatenação de strings. Em queries com JOIN, passar o alias (`buildWhere(base, vals, filtros, 'p')`).
- **Multi-tenant**: toda a query operacional filtra por `tenant_id` (`($N::uuid IS NULL OR tenant_id = $N)`). O `tenant_id` vem do JWT via `resolverTenant`; nunca do body/query do cliente.
- **Transacções** para operações multi-tabela: `client = pool.connect()` → BEGIN/COMMIT/ROLLBACK → `finally client.release()`. Stock usa `SELECT … FOR UPDATE` contra corridas.
- Listagens paginadas: query de dados + COUNT em `Promise.all`, resposta `{ data, page, limit, total }`.

## Base de dados e migrações
- Schema base idempotente em `server/db.js` (initDB, CREATE IF NOT EXISTS). Alterações novas vão para `migrations/` (node-pg-migrate), NUNCA só para o initDB.
- `scripts/start.js` aplica migrações pendentes no arranque (produção). Numa base pré-existente marca a inicial como aplicada. Falha de migração não bloqueia o arranque.
- Índices compostos seguem os padrões de acesso reais (tenant_id + status/criado_em/categoria). Login usa índice funcional `LOWER(email)`.
- A DB de produção no Render **bloqueia todas as ligações externas** (IP allowlist vazia) — queries só de dentro do serviço.

## Segurança
- JWT (8h) com `nivel_acesso` (ADMIN/GERENTE/OPERADOR); middleware `authMiddleware`, `requerNivel`, `validarUUID`.
- Rate limiting centralizado em `server/middleware/rateLimiters.js` (global 200/15min, escrita 60/min, login 10/15min só-falhas, saas 5/15min, stock 30/min). Novos limiters vão para esse ficheiro, nunca inline.
- Helmet com CSP sem `unsafe-inline` em scripts (excepção única: rota /api/docs do Swagger).
- Logs via Pino (`server/monitoring.js`) com redacção de campos sensíveis; erros 5xx vão ao Sentry.

## Documentação da API
- Anotações `@openapi` (JSDoc) em cada rota; schemas/respostas reutilizáveis em `server/swagger.js`. UI em `/api/docs`, spec em `/api/docs.json`. Rota nova = anotação nova.

## Testes (obrigatórios para qualquer alteração)
- `npm run test:unit` — 100+ testes com pool mockado (`tests/setup.js`, globals `mockPool`/`mockClient`). Queries em `Promise.all` exigem dois `mockResolvedValueOnce`.
- `npm run test:integration` — testes contra PostgreSQL REAL (`tests/integration/`): o globalSetup arranca uma Postgres efémera (initdb/pg_ctl) ou usa `TEST_DATABASE_URL`. Fixture: `criarTenantFixture()` cria tenant+licença+admin+JWT. Cobrir: transacções/ROLLBACK, isolamento multi-tenant, constraints, concorrência.
- CI (GitHub Actions): jobs unit + integration (serviço postgres:16) + verificação de sintaxe. Tudo verde antes de push.

## Deploy e operações
- Serviço Render: `srv-dbhpj3mtlv9c739coi00` → https://nukpos.onrender.com. Push para `master` = deploy automático.
- Verificar após deploy: logs `[migrate] Migrações concluídas` + `🚀 a correr`, e `/api/health` (inclui latência DB).
- Segredos (JWT_SECRET, SENTRY_DSN, SUPERADMIN_KEY, DATABASE_URL) só nas env vars do Render — nunca no código.
- Versão no topo de `server/app.js`: `v<data>.<n>-<resumo>` — actualizar em cada deploy relevante.

## Commits
- Mensagens em pt-PT, corpo explica o porquê; agrupar por área (Arquitectura/Segurança/Testes…).

## Dívida conhecida (próximos passos)
- 13 das 16 rotas ainda sem camada de serviço nem testes dedicados (financeiro e reservas prioritárias).
- Cobertura unitária ~59% → meta 75%+.
- Rate limiters em memória → Redis se houver multi-instância.
- Certificação AGT do módulo de facturação antes de clientes pagantes.
- Frontend (public/, ~4.800 linhas vanilla JS) sem testes.
