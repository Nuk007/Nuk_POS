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
- Nas migrações, valores por omissão de texto usam `default: pgm.func("'X'")`. Com `default: "'X'"` o node-pg-migrate duplica as aspas e uma base nova (instalação nova ou «recomeçar do zero») fica com `'LIVRE'` literal, que viola os CHECK (`tests/migracoes.test.js` guarda isto). A produção não foi afectada: foi criada pelo initDB().
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
- Tempo real: o POS escuta `novo_pedido`, `novo_pedido_cliente`, `cliente_novo`, `nukcoin_carregado`, `nova_solicitacao_portal`.
- **Nas rotas, o `tenantId` vai SEMPRE depois do corpo**: `svc.x({ ...req.body, tenantId: req.tenantId })`. Com `{ tenantId, ...req.body }` um `"tenantId": null` no corpo saltava o isolamento entre estabelecimentos (login, cadastro, pedidos…). Nas rotas públicas novas, escolher os campos do corpo explicitamente.
- Pedido de convidado (sem conta): o portal envia-o na mesma, sem `cliente_id`/`pin`; não pode pagar com NUKCOIN (400). `mesa_ref` (digitada ou vinda do QR `?mesa=M03`) tem de existir (sem distinguir maiúsculas), senão 400 e nada se grava.
- Solicitações de hospedagem, serviços e eventos: `POST /api/cliente/solicitacao` → tabela `solicitacoes_portal` (`services/solicitacoes.service.js`; migração 1749000000000, espelhada em db.js). O POS tem o módulo «Solicitações» (`/api/solicitacoes-portal`, lista paginada, `/pendentes`, `PATCH /:id/status`) com indicador no menu. Não se grava preço (os do portal são indicativos). `/pedido-hospedagem` e `solicitacoes_hospedagem` ficam por compatibilidade e já não são usados pelo portal.
- Frontend do portal (`public/js/cliente.js`): **sem modo demo/offline** — se o servidor não responder, mostra erro, mantém o carrinho e não dá nada como enviado. Navegação por `data-action` registada em `ACOES` (nunca `.onclick=`, conflita com a delegação). As categorias de produto do servidor mapeiam-se para as secções do menu em `SECCOES` (categoria nova do código = emoji em `EMOJI_CAT`; `tests/frontend.test.js` verifica as categorias padrão de `listas.service.js`). Categorias criadas por um estabelecimento caem na secção «outros» com 📦.

## Stock abatido pelas vendas
- Cada produto tem uma receita em `produto_ingredientes` (item de stock + quantidade por unidade vendida; `GET/PUT /api/produtos/:id/ingredientes`, PUT só ADMIN/GERENTE; botão «Stock» na lista de produtos). Produto sem receita não mexe no stock.
- `stock.service.baixarStockPedido` corre DENTRO da transacção do pedido (operador e portal), com `FOR UPDATE` por ordem de id: sem stock → 409 «Stock insuficiente de X» e nada é gravado nem cobrado (nem Nuk-Coin). Movimento `VENDA` com `pedido_id`.
- Cancelar o pedido devolve o stock uma só vez (movimento `ESTORNO`); fechar não mexe. Alerta `alerta_stock` após o COMMIT quando fica no mínimo.
- Migração 1748900000000 (espelhada em db.js).

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
- Força bruta ao PIN do portal só limitada pelo clienteLimiter (60/10min por IP).
- Pedidos do portal sem chave de idempotência: se a resposta se perder depois de o servidor gravar, o «tentar de novo» cria um pedido duplicado.
- Preços de hospedagem/serviços estão escritos à mão no `cliente.html` (indicativos, iguais para todos os estabelecimentos) — deviam vir da configuração de cada tenant.
- `GET /api/solicitacoes-hospedagem` (antigo) filtra por `clientes.tenant_id`, por isso não lista pedidos de convidados; usar `solicitacoes_portal`.
- @openapi parcial no portal (faltam hospedagem, perfil, eventos).
- Testar a UI em navegador real (Playwright) ainda não faz parte do CI.
- 13 das 16 rotas ainda sem camada de serviço nem testes dedicados (financeiro e reservas prioritárias).
- Cobertura unitária ~59% → meta 75%+.
- Rate limiters em memória → Redis se houver multi-instância.
- Certificação AGT (assinatura/hash, SAF-T, série certificada) antes de produção definitiva — processo a cargo do dono; os PDFs actuais não têm validade fiscal.
- Frontend (public/, ~4.800 linhas vanilla JS) sem testes.

## Quartos (configuração)
- `server/services/quartos.service.js` + `POST /api/quartos`, `PUT/DELETE /api/quartos/:id` (só ADMIN, por estabelecimento; número único por tenant → 409). Não se apaga quarto ocupado ou com histórico de reservas (409) — marcar BLOQUEADO. UI: cartão «Quartos e preços» em Configurações (`modulo_configuracoes`); o módulo Quartos é só operacional (estado, reservas).
- Ementa (criar/editar produtos, preços, ocultar, receitas de stock) também só em Configurações → Ementa (API de escrita só ADMIN); o módulo Produtos é consulta.
- **Listas configuráveis por estabelecimento** (`listas_opcoes`, `services/listas.service.js`, `/api/listas`): TIPO_QUARTO, CATEGORIA_PRODUTO, CATEGORIA_STOCK, UNIDADE_STOCK. Os CHECK da BD saíram (migração 1749100000000, espelhada em db.js — não os recolocar); a validação é contra a lista activa do tenant (`exigirValor`). Padrões semeados na 1.ª leitura (+ valores já usados). Valores não se renomeiam; em uso não se apagam (desactivam-se). Só ADMIN escreve. Lista nova = entrada em `DEFAULTS`/`USO`.
- **Titular**: a 1.ª conta ADMIN de cada estabelecimento (`funcionarios.titular`, criada na activação) não se desactiva nem se despromove (403 no próprio UPDATE de `funcionarios.service.js`); só se transfere a titularidade (`POST /api/funcionarios/transferir-titularidade`, palavra-passe do titular, novo titular fica ADMIN). Um titular por tenant (índice único). Perfis `pode_vender_quartos` e `arruma_quartos` por funcionário (migração 1749200000000). Nível `CAIXA` não existe (CHECK da BD).
- **PWA** (Android e iOS): `public/manifest.webmanifest` (POS), `/manifest-cliente.webmanifest?r=<slug>` (portal por estabelecimento) e `/sw.js` vêm de `server/routes/pwa.js` (versão no SW renova a cache a cada deploy; `server/pwa/sw.template.js`). O SW nunca toca em `/api/` nem `/socket.io`; JS/CSS rede-primeiro. `public/js/pwa.js` regista o SW, mostra «Instalar» (Android) ou as instruções «Partilhar → Adicionar ao ecrã principal» (iOS Safari). iOS exige `apple-touch-icon` 180×180 opaco (`img/apple-touch-icon.png`) e metas `apple-mobile-web-app-*` (testes em `tests/pwa.test.js`). No iOS a app instalada tem armazenamento separado do Safari: é preciso entrar de novo. Ícones gerados do emblema (fundo #0d1117).
- **Dashboard configurável** (`services/dashboard.service.js`, `/api/dashboard/comparativo|itens`, tabelas `dashboard_itens`/`dashboard_registos`, migração 1749300000000): o ADMIN define em Configurações os itens (produto, categoria, vendas de quartos/portal, contador manual, pendências). Comparação hoje / ontem / mesmo dia da semana passada em dias de Luanda; só a barra de hoje cresce. Facturação = pedidos FECHADOS + reservas não canceladas. Contadores/pendências qualquer funcionário regista. O cliente socket.io é servido localmente (`/socket.io/socket.io.js`), sem CDN.
- **Acessos delegados** (`services/acessos.js`, `middleware/modulos.js`, `funcionarios.permissoes` JSONB, migração 1749500000000): o **titular** (1.º administrador) tem tudo e é o único que cria/edita administradores e fixa o seu **limite** (`permissoes`: módulos + capacidades `vender_quartos`/`arrumar_quartos` que podem atribuir). Um administrador não titular só gere GERENTE/OPERADOR e só atribui acessos que ele próprio tem (403 caso contrário; sem lista explícita grava a predefinição do nível cortada pelo limite; não altera quem tem acessos acima do seu limite). `permissoes` NULL = predefinição do nível (`PADRAO`), sem mudança para contas antigas. `exigirModulo(chave)` aplica-se no servidor a funcionarios/stock/financeiro/clientes (montado em app.js) e às rotas de configuração (`configuracoes`); lê a BD (cache 15 s) mas só se o JWT tiver a claim `permissoes` (tokens anteriores passam até expirarem). Dashboard, pedidos, mesas, quartos, solicitações e produtos (leitura) só são escondidos na UI porque partilham endpoints entre módulos. A UI esconde menus (`aplicarAcessos`) e mostra a lista de acessos nos formulários de funcionário (`GET /api/funcionarios/acessos` dá o limite de quem pergunta).
- **Quartos — venda directa pelos botões** (`services/quartos-vendas.service.js`, `routes/quartos.js`, `jobs/quartos-scheduler.js`, migração 1749400000000: `quarto_limpezas`, `reservas.criado_por/saida_em/aviso_fim_em`): sem «+ Nova Reserva». Clique no quarto → serviço Hora (2 h) / Noite (12 h) / Diária (24 h) → Vender / Reservar / Abrir Quarto. **Só quem tem `pode_vender_quartos`** vende/reserva/abre/dá entrada/cancela (nem o ADMIN sem o perfil). Quarto fica livre 30 min depois da hora limite; folga de 30 min também entre reservas. ★ amarela = há reserva futura; ★ vermelha = começa em < 1 h → venda bloqueada (409 `ESTRELA_VERMELHA`), só reservas compatíveis. «Abrir quarto» = cliente sai antes da hora → LIMPEZA + tarefa de arrumação (prazo 30 min). Agendador (30 s, só fora de testes; `processarTick()` é testável): 5 min antes do fim avisa (`quarto_arrumar`), no fim fecha a ocupação, passado o prazo escala (`quarto_escalado`). Dentro do prazo só `arruma_quartos` dá o quarto como limpo; depois do prazo só ADMIN/GERENTE. O atraso (min) fica em `quarto_limpezas.atraso_min` e é a fonte de dashboard `QUARTO_ATRASO`. Constantes (2/12/24 h, 30/5/60 min) estão no serviço, não são configuráveis (dívida). Migração de dados 1749600000000 (corre uma vez): o titular que é o único utilizador activo recebe os perfis de quartos; reservas do fluxo antigo (que marcava o quarto OCUPADO ao reservar) passam a CHECKIN/arrumação/★. Quarto OCUPADO sem ocupação registada mostra «hora por definir» e pode abrir-se.
- **Regra do dono: tudo o que apaga, cancela ou desactiva pede confirmação** (`modalConfirmar` em modulos.js; o botão da lista chama `pedirXxx`, só o «Sim, confirmar» chama a acção; `tests/frontend-modulos.test.js` verifica). Acção destrutiva nova = passar por aí.
- **Regra do dono: toda a configuração vive no painel de Configurações**, nunca nos módulos operacionais (evita acidentes). Novas configurações vão para lá.
- **Licença por módulos e menu por categorias** (`tenants.modulos` JSONB, migração 1749700000000 espelhada em db.js; catálogo `LICENCAS` em `services/acessos.js`): o superadmin escolhe os módulos contratados (criação do tenant, predefinição por plano em `PLANOS_MODULOS`; `GET /api/saas/modulos`, `PUT /api/saas/tenants/:id/modulos`; só módulos `pronto:true`). NULL = todos os prontos (contas antigas). Cada licença liga chaves de acesso; `permissoes` do login = acessos da conta ∩ licença, e `modulos` vai no login e em `/auth/me`. `exigirLicenca('restauracao'|'hospedagem')` nos routers (app.js) e `exigirModulo` também verifica a licença (403), só com tokens que tenham a claim `permissoes`. Menu: Dashboard · Caixa · Vendas (Restauração, Hospedagem, e Solicitações do portal com qualquer licença de venda) · Compras · Administração (RH, Finanças) · Configuração; `aplicarAcessos` esconde itens e grupos vazios; Configurações só mostra cartões/listas dos módulos contratados (`licenciadoModulo`). **Por construir** (`pronto:false`, desligados no superadmin): Caixa do dia (Nuk-Coin, cartões de consumo, recebimento após fecho de mesas), Compras só com dinheiro do caixa do dia e produtos registados, Serviços (avarias e manutenção), Património, Lazer, Loja.
- **Fluxos de venda** (`public/js/venda.js`, `pedidos.origem` MESA|BALCAO|REMOTA|TAKEAWAY + `validado_em/validado_por`, migração 1749800000000 espelhada em db.js): botões Mesa | Balcão | Remota | Take Away em Vendas. **Mesa**: grelha de mesas → clique abre o painel de botões de produtos (categorias, carrinho) e `POST /api/pedidos {origem:'MESA', mesa_id}`; **Balcão**: vai direto ao painel (`origem:'BALCAO'`, sem mesa). O número de mesas define-se em Configurações → Mesas (`PUT /api/mesas/quantidade`, só ADMIN; cria M01…; reduzir pede confirmação e o servidor recusa com 409 se as mais altas estiverem em uso ou tiverem pedidos). **Remota**: pedidos do portal (QR, convidado ou cadastrado) nascem `REMOTA` com `validado_em` NULL; o ecrã Remota lista-os (`GET /api/pedidos/por-validar`, badge no menu + toast por socket `novo_pedido_cliente`) e o caixa **valida** (PATCH → EM_PREPARO, que preenche `validado_em`) ou **recusa** (CANCELADO com confirmação; estorna Nuk-Coin e stock). Convidados não pagam com Nuk-Coin nem acumulam estrelas (regra do portal). Portal: secções Comidas, Bebidas, Cigarros (SHISHA/CIGARROS), Loja, Serviços de quarto (categorias `LOJA`, `SERVICO_QUARTO`, só nos padrões de tenants novos; os existentes acrescentam-nas em Configurações → listas) e Outros. **Take Away**: só cliente cadastrado que já usou o espaço (pedido FECHADO ou reserva CHECKIN/CHECKOUT; `GET /api/pedidos/takeaway/elegivel`) e só comidas e bebidas (`categoriaTakeAway` exclui SHISHA, OUTRO e nomes com LOJA/CIGARR/TABAC/SERVIC/QUARTO — **dívida:** devia ser uma marca por categoria em Configurações). Dívida: o recebimento/fecho do pagamento das mesas e do balcão fica para a Caixa do dia.
