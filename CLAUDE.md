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
- Helmet com CSP sem `unsafe-inline` em scripts (excepção única: rota /api/docs do Swagger). **O frontend não pode usar `onclick=`/`onchange=` inline** (`script-src-attr 'none'`): no HTML gerado usar `data-on-click="funcao('arg')"` (delegação em `public/js/nukpos.js`, só chama funções globais com argumentos literais). `tests/frontend.test.js` garante isto.
- Contrato do login: `POST /api/auth/login` devolve `{ token, funcionario }`; o frontend lê `res.funcionario`.
- Logs via Pino (`server/monitoring.js`) com redacção de campos sensíveis; erros 5xx vão ao Sentry.

## Portal do cliente e Nuk-Coin (regras de dinheiro)
- O portal vive em `/cliente?r=<slug>` (o QR leva o slug; as rotas públicas usam o cabeçalho `X-Tenant-Slug`). Todo o JS está em `public/js/*.js`: **nenhuma página pode ter `<script>` inline** (CSP; `tests/frontend.test.js` verifica).
- Lógica em `services/portal.service.js`. Qualquer alteração de saldo: transacção + `SELECT … FOR UPDATE` + linha em `movimentos_nukcoin` (CARREGAMENTO, CONSUMO, ESTORNO, BONUS); saldo = Σ movimentos.
- Carregamentos só no balcão por operador (JWT), valores 5000/10000/15000/20000/25000/50000.
- Pagar com Nuk-Coin exige `cliente_id` + PIN (4 dígitos, bcrypt); débito e pedido na mesma transacção. Cancelar um pedido pago com Nuk-Coin estorna uma única vez.
- `definir-pin` só funciona enquanto o cliente não tem PIN; reposição por ADMIN/GERENTE em `/api/cliente/reset-pin`. `perfil` e `historico` exigem PIN.
- Estrelas: 5 estrelas = 20% (limite 25 000 Kz), consome as estrelas; pedidos ≥ 25 000 Kz dão 1 estrela.
- Pedidos: máquina de estados em `actualizarStatusPedido`; financeiro conta receita só de FECHADO; facturas numeradas sob `pg_advisory_xact_lock`.
- Tempo real: o POS escuta `novo_pedido`, `novo_pedido_cliente`, `cliente_novo`, `nukcoin_carregado`.

## Documentos (talão e factura em PDF)
- `services/documentos.service.js` (pdfkit): talão 80 mm em `GET /api/pedidos/:id/talao.pdf` e factura A4 em `GET /api/financeiro/faturas/:id/pdf`. Logótipo `public/img/logo-nukpos.png` sobre placa azul-escura.
- Enquanto o Nuk_POS não estiver certificado pela AGT, todos os documentos dizem «Documento sem validade fiscal». Quando houver certificação, definir `AGT_CERTIFICADO=true` (não basta: a assinatura/hash AGT e o SAF-T ainda têm de ser implementados).
- Produto GESTNUK (filial da Technuk, Lda). O frontend descarrega os PDFs com `descarregarPdf()` (nukpos.js), sem abrir janelas (CSP).

## Seed e reset
- Em produção o seed cria só os planos; o tenant/admin demo só existe fora de produção ou com `SEED_DEMO=true`. O 1.º tenant cria-se pelo fluxo SUPERADMIN (`SUPERADMIN_KEY`).
- Recomeçar do zero: `CONFIRMAR_RESET=APAGAR-TUDO node scripts/reset-db.js` (apaga o esquema `public`; reiniciar o serviço depois). Destrutivo: nunca correr sem decisão do dono.

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
- Se o admin demo `admin@nukpos.ao` já existir numa BD de produção antiga, apagá-lo/desactivá-lo (o seed deixou de o criar em produção; ver «Reset»).
- Stock não é abatido pelas vendas (sem ligação produto→stock; o tipo VENDA não é usado).
- Força bruta ao PIN do portal só limitada pelo clienteLimiter (60/10min por IP).
- @openapi parcial no portal (faltam hospedagem, perfil, eventos).
- Testar a UI em navegador real (Playwright) ainda não faz parte do CI.
- 13 das 16 rotas ainda sem camada de serviço nem testes dedicados (financeiro e reservas prioritárias).
- Cobertura unitária ~59% → meta 75%+.
- Rate limiters em memória → Redis se houver multi-instância.
- Certificação AGT (assinatura/hash, SAF-T, série certificada) antes de produção definitiva — processo a cargo do dono; os PDFs actuais não têm validade fiscal.
- Frontend (public/, ~4.800 linhas vanilla JS) sem testes.
